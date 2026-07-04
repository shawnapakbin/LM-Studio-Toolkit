import {
  ErrorCode,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
} from "@shared/types";
import {
  type CompactorLLM,
  type CompactorRunResult,
  createCompactorLLM,
  getCompactorPromptVersion,
} from "./compactor";
import {
  ValidationError,
  validateClearSession,
  validateGetStatus,
  validateOnUserTurn,
  validateStoreSegment,
} from "./policy";
import { DB_PATH, ECMStore } from "./store";
import type { ClearSessionResult, GetStatusResult, OnUserTurnResult, SegmentRecord } from "./types";

// ─── Module state ────────────────────────────────────────────────────────────

let storeInstance: ECMStore | undefined;
let compactorInstance: CompactorLLM | undefined;

function getStore(): ECMStore {
  if (!storeInstance) {
    storeInstance = new ECMStore(DB_PATH);
  }
  return storeInstance;
}

function getCompactor(): CompactorLLM {
  if (!compactorInstance) {
    compactorInstance = createCompactorLLM();
  }
  return compactorInstance;
}

/** For tests. */
export function resetEcmState(): void {
  storeInstance?.close();
  storeInstance = undefined;
  compactorInstance = undefined;
  inFlight.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inFlight = new Set<string>();

export function estimateTokens(text: string): number {
  // Rough heuristic; ~4 chars/token.
  return Math.max(1, Math.ceil(text.length / 4));
}

function readNumberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function defaultContextLimit(): number {
  return readNumberEnv("ECM_MODEL_CONTEXT_LIMIT", 8192);
}

/** ECM only activates for models with a context window this large or bigger. */
const MIN_CONTEXT_FOR_COMPACTION = 16_000;

/** Default post-compaction target: aim to drop context below this ratio. */
const TARGET_RATIO_DEFAULT = 0.4;

function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

// ─── store_segment ───────────────────────────────────────────────────────────

export async function storeSegment(input: unknown): Promise<ToolResponse<SegmentRecord>> {
  let validated: ReturnType<typeof validateStoreSegment>;
  try {
    validated = validateStoreSegment(input);
  } catch (err) {
    if (err instanceof ValidationError) {
      return createErrorResponse(
        ErrorCode.INVALID_INPUT,
        err.message,
      ) as ToolResponse<SegmentRecord>;
    }
    throw err;
  }

  try {
    const tokenCount = estimateTokens(validated.content);
    const segment = getStore().insertSegment({
      sessionId: validated.sessionId,
      type: validated.type,
      content: validated.content,
      tokenCount,
      metadataJson: validated.metadata ? JSON.stringify(validated.metadata) : null,
      importance: validated.importance ?? 0.5,
    });
    return createSuccessResponse(segment);
  } catch (err) {
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      err instanceof Error ? err.message : String(err),
    ) as ToolResponse<SegmentRecord>;
  }
}

// ─── clear_session ───────────────────────────────────────────────────────────

export async function clearSession(input: unknown): Promise<ToolResponse<ClearSessionResult>> {
  let validated: ReturnType<typeof validateClearSession>;
  try {
    validated = validateClearSession(input);
  } catch (err) {
    if (err instanceof ValidationError) {
      return createErrorResponse(
        ErrorCode.INVALID_INPUT,
        err.message,
      ) as ToolResponse<ClearSessionResult>;
    }
    throw err;
  }
  const result = getStore().clearSession(validated.sessionId);
  return createSuccessResponse(result);
}

// ─── get_status ──────────────────────────────────────────────────────────────

export async function getStatus(input: unknown): Promise<ToolResponse<GetStatusResult>> {
  let validated: ReturnType<typeof validateGetStatus>;
  try {
    validated = validateGetStatus(input);
  } catch (err) {
    if (err instanceof ValidationError) {
      return createErrorResponse(
        ErrorCode.INVALID_INPUT,
        err.message,
      ) as ToolResponse<GetStatusResult>;
    }
    throw err;
  }
  const store = getStore();
  return createSuccessResponse({
    sessionId: validated.sessionId,
    segmentCount: store.countSegments(validated.sessionId),
    nonSummarySegmentCount: store.countNonSummarySegments(validated.sessionId),
    estimatedUsedTokens: store.getSessionTokenCount(validated.sessionId),
  });
}

// ─── on_user_turn ────────────────────────────────────────────────────────────

export async function onUserTurn(input: unknown): Promise<ToolResponse<OnUserTurnResult>> {
  let validated: ReturnType<typeof validateOnUserTurn>;
  try {
    validated = validateOnUserTurn(input);
  } catch (err) {
    if (err instanceof ValidationError) {
      return createErrorResponse(
        ErrorCode.INVALID_INPUT,
        err.message,
      ) as ToolResponse<OnUserTurnResult>;
    }
    throw err;
  }

  const store = getStore();
  const sessionId = validated.sessionId;
  const keepNewest = validated.keepNewest ?? 4;
  const threshold = validated.threshold ?? 0.5;
  const targetRatio = validated.targetRatio ?? TARGET_RATIO_DEFAULT;
  const contextLimit = validated.contextLimit ?? defaultContextLimit();
  const estimatedUsedTokens = validated.currentUsedTokens ?? store.getSessionTokenCount(sessionId);
  const ratio = contextLimit > 0 ? estimatedUsedTokens / contextLimit : 0;

  const baseResult = (extra: Partial<OnUserTurnResult>): OnUserTurnResult => ({
    compacted: false,
    reason: "below_threshold",
    ratio,
    estimatedUsedTokens,
    contextLimit,
    threshold,
    targetRatio,
    keepNewest,
    message: "",
    etaSeconds: 0,
    ...extra,
  });

  // Below threshold — no-op.
  if (ratio < threshold) {
    return createSuccessResponse(
      baseResult({
        reason: "below_threshold",
        message: `Context at ${formatPercent(ratio)} of ${contextLimit} tokens — below ${formatPercent(threshold)} trigger. No compaction needed.`,
      }),
    );
  }

  // Auto-activation gate: only compact for models with large context windows (≥ 16k).
  // Small-context models gain little from compaction overhead.
  if (contextLimit < MIN_CONTEXT_FOR_COMPACTION) {
    return createSuccessResponse(
      baseResult({
        reason: "context_too_small",
        message: `Context limit ${contextLimit} is below the minimum ${MIN_CONTEXT_FOR_COMPACTION} tokens for compaction. ECM only activates for large-context models (≥16k).`,
      }),
    );
  }

  // Identify candidates: oldest non-summary segments past keepNewest.
  const candidates = store.getOldestNonSummarySegments(sessionId, keepNewest);
  if (candidates.length < 2) {
    return createSuccessResponse(
      baseResult({
        reason: "not_enough_segments",
        message: `Context at ${formatPercent(ratio)} but only ${candidates.length} older segment(s) available beyond the newest ${keepNewest}. Compaction skipped.`,
      }),
    );
  }

  // Guard against re-entry.
  if (inFlight.has(sessionId)) {
    return createSuccessResponse(
      baseResult({
        reason: "in_progress",
        message: "Compaction already in progress for this session; skipping duplicate trigger.",
        etaSeconds: estimateEtaSeconds(candidates.length),
      }),
    );
  }
  inFlight.add(sessionId);
  try {
    const eta = estimateEtaSeconds(candidates.length);
    process.stderr.write(
      `[ECM] Compacting ${candidates.length} segments for session "${sessionId}" — context ${formatPercent(ratio)} (~${eta}s)…\n`,
    );

    const run = await getCompactor().summarize(candidates);
    if (!run.ok || !run.summaryText) {
      const errMsg = run.error ?? "LLM compactor returned no summary.";
      process.stderr.write(`[ECM] Compaction failed: ${errMsg}\n`);
      return createSuccessResponse(
        baseResult({
          reason: "llm_error",
          error: errMsg,
          message: `Compaction failed: ${errMsg}. Conversation history was preserved unchanged.`,
        }),
      );
    }

    const summarySegment = writeSummary(sessionId, candidates, run);
    const removed = store.deleteSegmentsByIds(candidates.map((c) => c.id));

    const postRatio = contextLimit > 0 ? store.getSessionTokenCount(sessionId) / contextLimit : 0;

    process.stderr.write(
      `[ECM] Compaction complete — removed ${removed.deletedCount} segments, summary ${summarySegment.token_count} tokens, context now ${formatPercent(postRatio)}.\n`,
    );

    return createSuccessResponse(
      baseResult({
        compacted: true,
        reason: "compacted",
        message: `Compacted ${removed.deletedCount} older segments into a highlights summary. Context dropped from ${formatPercent(ratio)} to ~${formatPercent(postRatio)}.`,
        etaSeconds: 0,
        summarySegmentId: summarySegment.id,
        segmentsRemoved: removed.deletedCount,
        summaryTokenCount: summarySegment.token_count,
      }),
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[ECM] Compaction errored: ${errMsg}\n`);
    return createSuccessResponse(
      baseResult({
        reason: "llm_error",
        error: errMsg,
        message: `Compaction errored: ${errMsg}. Conversation history was preserved unchanged.`,
      }),
    );
  } finally {
    inFlight.delete(sessionId);
  }
}

function estimateEtaSeconds(segmentCount: number): number {
  return Math.min(30, Math.max(2, segmentCount));
}

function writeSummary(
  sessionId: string,
  candidates: SegmentRecord[],
  run: CompactorRunResult,
): SegmentRecord {
  const summaryText = run.summaryText as string;
  return getStore().insertSegment({
    sessionId,
    type: "summary",
    content: summaryText,
    tokenCount: estimateTokens(summaryText),
    metadataJson: JSON.stringify({
      kind: "ecm_compaction_summary",
      promptVersion: getCompactorPromptVersion(),
      modelId: run.modelId,
      sourceSegmentIds: candidates.map((c) => c.id),
      sourceSegmentCount: candidates.length,
      highlightsCount: run.highlightsCount,
      decisionsCount: run.decisionsCount,
      confidence: run.confidence,
      validationPassed: run.validationPassed,
    }),
    importance: 0.9,
  });
}
