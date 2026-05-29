export type SegmentType =
  | "conversation_turn"
  | "tool_output"
  | "document"
  | "reasoning"
  | "summary";

export interface SegmentRecord {
  id: string;
  session_id: string;
  type: SegmentType;
  content: string;
  embedding_json: string;
  token_count: number;
  metadata_json: string | null;
  importance: number;
  created_at: string;
}

export interface ScoredSegment {
  id: string;
  sessionId: string;
  type: SegmentType;
  content: string;
  tokenCount: number;
  importance: number;
  createdAt: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface StoreSegmentInput {
  sessionId: string;
  type: SegmentType;
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  includeEmbeddings?: boolean;
}

export interface RetrieveContextInput {
  sessionId: string;
  query: string;
  topK?: number;
  maxTokens?: number;
  minScore?: number;
}

export interface ListSegmentsInput {
  sessionId: string;
  limit?: number;
  offset?: number;
  includeEmbeddings?: boolean;
}

export interface DeleteSegmentInput {
  sessionId: string;
  segmentId: string;
}

export interface ClearSessionInput {
  sessionId: string;
}

export interface SummarizeSessionInput {
  sessionId: string;
  keepNewest?: number;
}

export interface AutoCompactNowInput {
  sessionId: string;
  keepNewest?: number;
}

export interface SetContinuousCompactInput {
  sessionId: string;
  enabled: boolean;
  keepNewest?: number;
}

export interface GetSessionPolicyInput {
  sessionId: string;
}

export interface SessionPolicyResult {
  sessionId: string;
  continuousCompactEnabled: boolean;
  continuousKeepNewest: number;
  policySource: "session" | "env_default";
  effectiveEnabled: boolean;
  effectiveKeepNewest: number;
  updatedAt?: string;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface RetrieveResult {
  segments: ScoredSegment[];
  totalTokens: number;
  truncated: boolean;
  autoCompaction?: AutoCompactionTelemetry;
}

export interface AutoCompactionTelemetry {
  checked: boolean;
  enabled: boolean;
  executed: boolean;
  triggerRatio: number;
  estimatedUsedTokens: number;
  modelContextLimit: number;
  threshold: number;
  keepNewest: number;
  mode: "threshold" | "continuous";
  policySource: "env" | "session";
  sourceAction: "store_segment" | "retrieve_context" | "summarize_session" | "auto_compact_now";
  reason:
    | "disabled"
    | "below_threshold"
    | "cooldown"
    | "in_progress"
    | "not_enough_segments"
    | "below_minimum_segment_count"
    | "insufficient_segments_to_compact"
    | "executed"
    | "execution_failed";
  totalSegments?: number;
  strategy?: "extractive" | "llm_highlights";
  fallbackUsed?: boolean;
  summarySegmentId?: string;
  segmentsRemoved?: number;
  summaryTokenCount?: number;
}

export interface ListSegmentsResult {
  segments: SegmentRecord[];
  total: number;
}

export interface DeleteSegmentResult {
  deleted: boolean;
}

export interface ClearSessionResult {
  deletedCount: number;
}

export interface SummarizeResult {
  summarySegmentId: string;
  originalSegmentsRemoved: number;
  summaryTokenCount: number;
}

export interface AutoCompactNowResult {
  executed: boolean;
  reason: "not_enough_segments" | "executed";
  triggerRatio: number;
  estimatedUsedTokens: number;
  modelContextLimit: number;
  threshold: number;
  summarySegmentId?: string;
  originalSegmentsRemoved?: number;
  summaryTokenCount?: number;
  strategy?: "extractive" | "llm_highlights";
  fallbackUsed?: boolean;
}

// ─── Store input ──────────────────────────────────────────────────────────────

export interface SegmentInsertInput {
  sessionId: string;
  type: SegmentType;
  content: string;
  embeddingJson: string;
  tokenCount: number;
  metadataJson: string | null;
  importance: number;
}
