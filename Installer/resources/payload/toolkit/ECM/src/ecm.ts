import {
  ErrorCode,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
} from "@shared/types";
import { type EmbeddingProvider, createEmbeddingProvider } from "./embeddings";
import {
  validateClearSession,
  validateDeleteSegment,
  validateListSegments,
  validateRetrieveContext,
  validateStoreSegment,
  validateSummarizeSession,
} from "./policy";
import { DB_PATH, ECMStore } from "./store";
import type {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
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

    return createSuccessResponse({ segments: result, totalTokens, truncated });
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

    const summaryText = extractiveSummarize(toSummarize);
    const tokenCount = estimateTokens(summaryText);
    const [embedding] = await embeddings.embedBatch([summaryText]);

    const summaryRecord = store.insertSegment({
      sessionId: validated.sessionId,
      type: "summary",
      content: summaryText,
      embeddingJson: JSON.stringify(embedding),
      tokenCount,
      metadataJson: JSON.stringify({ summarizedCount: toSummarize.length }),
      importance: 0.8,
    });

    const ids = toSummarize.map((s) => s.id);
    store.deleteSegmentsByIds(ids);

    return createSuccessResponse({
      summarySegmentId: summaryRecord.id,
      originalSegmentsRemoved: ids.length,
      summaryTokenCount: tokenCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return createErrorResponse(ErrorCode.EXECUTION_FAILED, msg) as ToolResponse<SummarizeResult>;
  }
}
