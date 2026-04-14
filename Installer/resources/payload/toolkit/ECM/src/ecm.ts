import {
  ErrorCode,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
} from "@shared/types";
import { createCompactorLLM, getCompactorPromptVersion } from "./compactor";
import { type EmbeddingProvider, createEmbeddingProvider } from "./embeddings";
import {
  validateAutoCompactNow,
  validateClearSession,
  validateDeleteSegment,
  validateListSegments,
  validateRetrieveContext,
  validateStoreSegment,
  validateSummarizeSession,
} from "./policy";
import { DB_PATH, ECMStore } from "./store";
import type {
  AutoCompactNowInput,
  AutoCompactNowResult,
  AutoCompactionTelemetry,
  ClearSessionInput,
  ClearSessionResult,
  DeleteSegmentInput,
  DeleteSegmentResult,
  ListSegmentsInput,
  ListSegmentsResult,
  RetrieveContextInput,
  RetrieveResult,
  ScoredSegment,
  SegmentRecord,
  StoreSegmentInput,
  SummarizeResult,
  SummarizeSessionInput,
} from "./types";

// ─── Singletons ───────────────────────────────────────────────────────────────

const store = new ECMStore(DB_PATH);
const embeddings: EmbeddingProvider = createEmbeddingProvider();
const compactor = createCompactorLLM();

const AUTO_COMPACT_ENABLED = readBoolEnv("ECM_AUTO_COMPACT_ENABLED", true);
const AUTO_COMPACT_THRESHOLD = readNumberEnv("ECM_AUTO_COMPACT_THRESHOLD", 0.7);
const AUTO_COMPACT_MODEL_CONTEXT_LIMIT = Math.max(
  1,
  Math.floor(readNumberEnv("ECM_MODEL_CONTEXT_LIMIT", 8192)),
);
const AUTO_COMPACT_KEEP_NEWEST = Math.max(
  0,
  Math.floor(readNumberEnv("ECM_AUTO_COMPACT_KEEP_NEWEST", 10)),
);
const AUTO_COMPACT_COOLDOWN_MS = Math.max(
  0,
  Math.floor(readNumberEnv("ECM_AUTO_COMPACT_COOLDOWN_MS", 120_000)),
);
const AUTO_COMPACT_SUMMARY_MAX_TOKENS = Math.max(
  32,
  Math.floor(readNumberEnv("ECM_AUTO_COMPACT_SUMMARY_MAX_TOKENS", 600)),
);
const AUTO_COMPACT_MAX_COMPRESSION_RATIO = Math.max(
  0.05,
  readNumberEnv("ECM_AUTO_COMPACT_MAX_COMPRESSION_RATIO", 0.6),
);
const AUTO_COMPACT_FORCE_LLM = readBoolEnv("ECM_AUTO_COMPACT_FORCE_LLM", false);
const COMPACTOR_MIN_CONFIDENCE = Math.max(
  0,
  Math.min(1, readNumberEnv("ECM_COMPACTOR_MIN_CONFIDENCE", 0.5)),
);
const COMPACTOR_MIN_HIGHLIGHTS = Math.max(
  1,
  Math.floor(readNumberEnv("ECM_COMPACTOR_MIN_HIGHLIGHTS", 2)),
);
const COMPACTOR_MIN_DECISIONS = Math.max(
  1,
  Math.floor(readNumberEnv("ECM_COMPACTOR_MIN_DECISIONS", 1)),
);

const compactingSessions = new Set<string>();
const lastAutoCompactAt = new Map<string, number>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom ? dot / denom : -1;
}

export function computeScore(segment: SegmentRecord, queryEmbedding: number[], now: Date): number {
  const embedding = JSON.parse(segment.embedding_json) as number[];
  const cosine = cosineSimilarity(queryEmbedding, embedding);
  const ageMs = now.getTime() - new Date(segment.created_at).getTime();
  const ageHours = ageMs / 3_600_000;
  const recency = 1 / (1 + ageHours);
  return cosine * 0.7 + segment.importance * 0.2 + recency * 0.1;
}

function parseMetadata(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toScoredSegment(seg: SegmentRecord, score: number): ScoredSegment {
  return {
    id: seg.id,
    sessionId: seg.session_id,
    type: seg.type,
    content: seg.content,
    tokenCount: seg.token_count,
    importance: seg.importance,
    createdAt: seg.created_at,
    score,
    metadata: parseMetadata(seg.metadata_json),
  };
}

// ─── Extractive summarization ─────────────────────────────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

export function extractiveSummarize(segments: SegmentRecord[]): string {
  const budget = Math.min(segments.length * 200, 2000);
  const allSentences: Array<{ text: string; position: number; segImportance: number }> = [];

  for (const seg of segments) {
    for (const sent of splitSentences(seg.content)) {
      allSentences.push({
        text: sent,
        position: allSentences.length,
        segImportance: seg.importance,
      });
    }
  }

  if (allSentences.length === 0)
    return segments
      .map((s) => s.content)
      .join(" ")
      .slice(0, budget);

  const maxLen = Math.max(...allSentences.map((s) => s.text.length), 1);
  const scored = allSentences.map((s) => ({
    ...s,
    score:
      (1 / (1 + s.position * 0.1)) * 0.4 + (s.text.length / maxLen) * 0.3 + s.segImportance * 0.3,
  }));

  scored.sort((a, b) => b.score - a.score);

  const selected: typeof scored = [];
  let charCount = 0;
  for (const s of scored) {
    if (charCount + s.text.length > budget) break;
    selected.push(s);
    charCount += s.text.length;
  }

  selected.sort((a, b) => a.position - b.position);
  return selected.map((s) => s.text).join(" ");
}

function shouldUseLLMFallback(summaryTokens: number, sourceTokens: number): boolean {
  if (AUTO_COMPACT_FORCE_LLM) return true;
  if (summaryTokens > AUTO_COMPACT_SUMMARY_MAX_TOKENS) return true;
  const compressionRatio = sourceTokens > 0 ? summaryTokens / sourceTokens : 1;
  return compressionRatio > AUTO_COMPACT_MAX_COMPRESSION_RATIO;
}

function selectSegmentsForLLMCompaction(segments: SegmentRecord[]): SegmentRecord[] {
  // Filter low-signal tool noise, but keep all content if filtering becomes too aggressive.
  const filtered = segments.filter((s) => s.type !== "tool_output" || s.importance >= 0.75);
  return filtered.length >= 2 ? filtered : segments;
}

function isCompactorQualityAcceptable(metrics: {
  highlightsCount?: number;
  decisionsCount?: number;
  confidence?: number;
}): { accepted: boolean; reason?: string } {
  if ((metrics.confidence ?? -1) < COMPACTOR_MIN_CONFIDENCE) {
    return {
      accepted: false,
      reason: `Compactor confidence ${metrics.confidence ?? "n/a"} below minimum ${COMPACTOR_MIN_CONFIDENCE}.`,
    };
  }
  if ((metrics.highlightsCount ?? 0) < COMPACTOR_MIN_HIGHLIGHTS) {
    return {
      accepted: false,
      reason: `Compactor highlights count ${metrics.highlightsCount ?? 0} below minimum ${COMPACTOR_MIN_HIGHLIGHTS}.`,
    };
  }
  if ((metrics.decisionsCount ?? 0) < COMPACTOR_MIN_DECISIONS) {
    return {
      accepted: false,
      reason: `Compactor decisions count ${metrics.decisionsCount ?? 0} below minimum ${COMPACTOR_MIN_DECISIONS}.`,
    };
  }
  return { accepted: true };
}

async function createCompactionSummary(
  sessionId: string,
  toSummarize: SegmentRecord[],
  sourceAction: "store_segment" | "retrieve_context" | "summarize_session" | "auto_compact_now",
  triggeredByAutoPolicy: boolean,
): Promise<{
  strategy: "extractive" | "llm_highlights";
  fallbackUsed: boolean;
  summarySegmentId: string;
  segmentsRemoved: number;
  summaryTokenCount: number;
}> {
  const sourceTokens = toSummarize.reduce((sum, seg) => sum + seg.token_count, 0);
  let strategy: "extractive" | "llm_highlights" = "extractive";
  let fallbackUsed = false;

  let summaryText = extractiveSummarize(toSummarize);
  let summaryTokenCount = estimateTokens(summaryText);

  const llmMetadata: Record<string, unknown> = {
    promptVersion: getCompactorPromptVersion(),
    attempted: false,
    validationPassed: false,
  };

  if (shouldUseLLMFallback(summaryTokenCount, sourceTokens)) {
    llmMetadata.attempted = true;
    fallbackUsed = true;
    const llmSegments = selectSegmentsForLLMCompaction(toSummarize);
    const llmResult = await compactor.summarize(llmSegments);
    llmMetadata.modelId = llmResult.modelId ?? null;
    llmMetadata.promptVersion = llmResult.promptVersion;
    llmMetadata.validationPassed = llmResult.validationPassed;
    llmMetadata.qualityGate = {
      minConfidence: COMPACTOR_MIN_CONFIDENCE,
      minHighlights: COMPACTOR_MIN_HIGHLIGHTS,
      minDecisions: COMPACTOR_MIN_DECISIONS,
      confidence: llmResult.confidence ?? null,
      highlightsCount: llmResult.highlightsCount ?? null,
      decisionsCount: llmResult.decisionsCount ?? null,
    };
    if (llmResult.ok && llmResult.summaryText) {
      const qualityGate = isCompactorQualityAcceptable({
        confidence: llmResult.confidence,
        highlightsCount: llmResult.highlightsCount,
        decisionsCount: llmResult.decisionsCount,
      });
      llmMetadata.qualityGatePassed = qualityGate.accepted;
      if (qualityGate.accepted) {
        summaryText = llmResult.summaryText;
        summaryTokenCount = estimateTokens(summaryText);
        strategy = "llm_highlights";
      } else {
        llmMetadata.error = qualityGate.reason;
      }
    } else {
      llmMetadata.error = llmResult.error ?? "Compactor fallback failed.";
    }
  }

  const [embedding] = await embeddings.embedBatch([summaryText]);
  const summaryRecord = store.insertSegment({
    sessionId,
    type: "summary",
    content: summaryText,
    embeddingJson: JSON.stringify(embedding),
    tokenCount: summaryTokenCount,
    metadataJson: JSON.stringify({
      summarizedCount: toSummarize.length,
      sourceAction,
      triggeredByAutoPolicy,
      strategy,
      fallbackUsed,
      compactor: llmMetadata,
    }),
    importance: 0.8,
  });

  const ids = toSummarize.map((s) => s.id);
  const { deletedCount } = store.deleteSegmentsByIds(ids);

  return {
    strategy,
    fallbackUsed,
    summarySegmentId: summaryRecord.id,
    segmentsRemoved: deletedCount,
    summaryTokenCount,
  };
}

export async function autoCompactNow(
  input: AutoCompactNowInput,
): Promise<ToolResponse<AutoCompactNowResult>> {
  try {
    const validated = validateAutoCompactNow(input);
    const keepNewest = validated.keepNewest ?? AUTO_COMPACT_KEEP_NEWEST;
    const estimatedUsedTokens = store.getSessionTokenCount(validated.sessionId, true);
    const triggerRatio = estimatedUsedTokens / AUTO_COMPACT_MODEL_CONTEXT_LIMIT;
    const toSummarize = store.getOldestNonSummarySegments(validated.sessionId, keepNewest);

    if (toSummarize.length < 2) {
      return createSuccessResponse({
        executed: false,
        reason: "not_enough_segments",
        triggerRatio,
        estimatedUsedTokens,
        modelContextLimit: AUTO_COMPACT_MODEL_CONTEXT_LIMIT,
        threshold: AUTO_COMPACT_THRESHOLD,
      });
    }

    const result = await createCompactionSummary(
      validated.sessionId,
      toSummarize,
      "auto_compact_now",
      false,
    );

    return createSuccessResponse({
      executed: true,
      reason: "executed",
      triggerRatio,
      estimatedUsedTokens,
      modelContextLimit: AUTO_COMPACT_MODEL_CONTEXT_LIMIT,
      threshold: AUTO_COMPACT_THRESHOLD,
      summarySegmentId: result.summarySegmentId,
      originalSegmentsRemoved: result.segmentsRemoved,
      summaryTokenCount: result.summaryTokenCount,
      strategy: result.strategy,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      msg,
    ) as ToolResponse<AutoCompactNowResult>;
  }
}

async function maybeAutoCompact(
  sessionId: string,
  sourceAction: "store_segment" | "retrieve_context",
): Promise<AutoCompactionTelemetry> {
  const estimatedUsedTokens = store.getSessionTokenCount(sessionId, true);
  const triggerRatio = estimatedUsedTokens / AUTO_COMPACT_MODEL_CONTEXT_LIMIT;
  const base: AutoCompactionTelemetry = {
    checked: true,
    enabled: AUTO_COMPACT_ENABLED,
    executed: false,
    triggerRatio,
    estimatedUsedTokens,
    modelContextLimit: AUTO_COMPACT_MODEL_CONTEXT_LIMIT,
    threshold: AUTO_COMPACT_THRESHOLD,
    keepNewest: AUTO_COMPACT_KEEP_NEWEST,
    sourceAction,
    reason: "below_threshold",
  };

  if (!AUTO_COMPACT_ENABLED) {
    return { ...base, reason: "disabled" };
  }

  if (triggerRatio < AUTO_COMPACT_THRESHOLD) {
    return base;
  }

  if (compactingSessions.has(sessionId)) {
    return { ...base, reason: "in_progress" };
  }

  const lastCompaction = lastAutoCompactAt.get(sessionId);
  if (lastCompaction !== undefined && Date.now() - lastCompaction < AUTO_COMPACT_COOLDOWN_MS) {
    return { ...base, reason: "cooldown" };
  }

  const toSummarize = store.getOldestNonSummarySegments(sessionId, AUTO_COMPACT_KEEP_NEWEST);
  if (toSummarize.length < 2) {
    return { ...base, reason: "not_enough_segments" };
  }

  compactingSessions.add(sessionId);
  try {
    const result = await createCompactionSummary(sessionId, toSummarize, sourceAction, true);
    lastAutoCompactAt.set(sessionId, Date.now());
    return {
      ...base,
      executed: true,
      reason: "executed",
      strategy: result.strategy,
      fallbackUsed: result.fallbackUsed,
      summarySegmentId: result.summarySegmentId,
      segmentsRemoved: result.segmentsRemoved,
      summaryTokenCount: result.summaryTokenCount,
    };
  } catch {
    return { ...base, reason: "execution_failed" };
  } finally {
    compactingSessions.delete(sessionId);
  }
}

// ─── Operations ───────────────────────────────────────────────────────────────

export async function storeSegment(input: StoreSegmentInput): Promise<ToolResponse<SegmentRecord>> {
  try {
    const validated = validateStoreSegment(input);
    const [embedding] = await embeddings.embedBatch([validated.content]);
    const tokenCount = estimateTokens(validated.content);
    const record = store.insertSegment({
      sessionId: validated.sessionId,
      type: validated.type,
      content: validated.content,
      embeddingJson: JSON.stringify(embedding),
      tokenCount,
      metadataJson: validated.metadata ? JSON.stringify(validated.metadata) : null,
      importance: validated.importance ?? 0.5,
    });

    await maybeAutoCompact(validated.sessionId, "store_segment");

    return createSuccessResponse(record);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code =
      msg.startsWith("'") || msg.startsWith("Input") || msg.includes("must be")
        ? ErrorCode.INVALID_INPUT
        : ErrorCode.EXECUTION_FAILED;
    return createErrorResponse(code, msg) as ToolResponse<SegmentRecord>;
  }
}

export async function retrieveContext(
  input: RetrieveContextInput,
): Promise<ToolResponse<RetrieveResult>> {
  try {
    const validated = validateRetrieveContext(input);
    const autoCompaction = await maybeAutoCompact(validated.sessionId, "retrieve_context");
    const [queryEmbedding] = await embeddings.embedBatch([validated.query]);
    const segments = store.getSegmentsBySession(validated.sessionId);
    const now = new Date();

    const scored = segments
      .map((seg) => ({ seg, score: computeScore(seg, queryEmbedding, now) }))
      .filter(({ score }) => validated.minScore === undefined || score >= validated.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, validated.topK ?? 10);

    const result: ScoredSegment[] = [];
    let totalTokens = 0;
    let truncated = false;
    const maxTokens = validated.maxTokens ?? 4096;

    for (const { seg, score } of scored) {
      if (totalTokens + seg.token_count > maxTokens) {
        truncated = true;
        continue;
      }
      result.push(toScoredSegment(seg, score));
      totalTokens += seg.token_count;
    }

    return createSuccessResponse({ segments: result, totalTokens, truncated, autoCompaction });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createErrorResponse(ErrorCode.EXECUTION_FAILED, msg) as ToolResponse<RetrieveResult>;
  }
}

export async function listSegments(
  input: ListSegmentsInput,
): Promise<ToolResponse<ListSegmentsResult>> {
  try {
    const validated = validateListSegments(input);
    const segments = store.listSegments(
      validated.sessionId,
      validated.limit ?? 20,
      validated.offset ?? 0,
    );
    const total = store.countSegments(validated.sessionId);
    return createSuccessResponse({ segments, total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createErrorResponse(ErrorCode.EXECUTION_FAILED, msg) as ToolResponse<ListSegmentsResult>;
  }
}

export async function deleteSegment(
  input: DeleteSegmentInput,
): Promise<ToolResponse<DeleteSegmentResult>> {
  try {
    const validated = validateDeleteSegment(input);
    const existing = store.getSegmentById(validated.segmentId);
    if (!existing) {
      return createErrorResponse(
        ErrorCode.NOT_FOUND,
        `Segment not found: ${validated.segmentId}`,
      ) as ToolResponse<DeleteSegmentResult>;
    }
    const result = store.deleteSegment(validated.segmentId);
    return createSuccessResponse(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      msg,
    ) as ToolResponse<DeleteSegmentResult>;
  }
}

export async function clearSession(
  input: ClearSessionInput,
): Promise<ToolResponse<ClearSessionResult>> {
  try {
    const validated = validateClearSession(input);
    const result = store.clearSession(validated.sessionId);
    return createSuccessResponse(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createErrorResponse(ErrorCode.EXECUTION_FAILED, msg) as ToolResponse<ClearSessionResult>;
  }
}

export async function summarizeSession(
  input: SummarizeSessionInput,
): Promise<ToolResponse<SummarizeResult>> {
  try {
    const validated = validateSummarizeSession(input);
    const toSummarize = store.getOldestNonSummarySegments(
      validated.sessionId,
      validated.keepNewest ?? 10,
    );

    if (toSummarize.length < 2) {
      return createErrorResponse(
        ErrorCode.INVALID_INPUT,
        "Not enough segments to summarize (need at least 2 non-summary segments outside keepNewest window).",
      ) as ToolResponse<SummarizeResult>;
    }

    const result = await createCompactionSummary(
      validated.sessionId,
      toSummarize,
      "summarize_session",
      false,
    );

    return createSuccessResponse({
      summarySegmentId: result.summarySegmentId,
      originalSegmentsRemoved: result.segmentsRemoved,
      summaryTokenCount: result.summaryTokenCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createErrorResponse(ErrorCode.EXECUTION_FAILED, msg) as ToolResponse<SummarizeResult>;
  }
}
