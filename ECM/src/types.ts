/**
 * ECM — Enhanced Context Memory.
 *
 * Single-purpose contract: when the chat client signals a user turn,
 * compact older conversation segments into one LLM-generated highlights
 * summary so the active context window stays small.
 */

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
  token_count: number;
  metadata_json: string | null;
  importance: number;
  created_at: string;
}

// ─── Input types ─────────────────────────────────────────────────────────────

export interface StoreSegmentInput {
  sessionId: string;
  type: SegmentType;
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface OnUserTurnInput {
  sessionId: string;
  /** Authoritative current usage from the chat client. Optional fallback to internal token count. */
  currentUsedTokens?: number;
  /** Authoritative model context limit from the chat client. Optional fallback to ECM_MODEL_CONTEXT_LIMIT env. */
  contextLimit?: number;
  /** Newest segments to preserve verbatim. Default 4. */
  keepNewest?: number;
  /** Trigger ratio (0–1). Compaction fires when ratio >= threshold. Default 0.5. */
  threshold?: number;
}

export interface ClearSessionInput {
  sessionId: string;
}

export interface GetStatusInput {
  sessionId: string;
}

// ─── Result types ────────────────────────────────────────────────────────────

export interface OnUserTurnResult {
  /** True iff a summary was created and old segments were purged. */
  compacted: boolean;
  /** Reason code for telemetry / logging. */
  reason: "below_threshold" | "not_enough_segments" | "compacted" | "in_progress" | "llm_error";
  /** currentUsedTokens / contextLimit. */
  ratio: number;
  estimatedUsedTokens: number;
  contextLimit: number;
  threshold: number;
  keepNewest: number;
  /** Pre-flight or post-flight natural-language status for the user. */
  message: string;
  /** Rough ETA in seconds for the LLM call. Set on pre-flight; 0 once compaction is complete. */
  etaSeconds: number;
  /** Set when compacted=true. */
  summarySegmentId?: string;
  segmentsRemoved?: number;
  summaryTokenCount?: number;
  /** Set when reason="llm_error". */
  error?: string;
}

export interface ClearSessionResult {
  deletedCount: number;
}

export interface GetStatusResult {
  sessionId: string;
  segmentCount: number;
  nonSummarySegmentCount: number;
  estimatedUsedTokens: number;
}

// ─── Store input ─────────────────────────────────────────────────────────────

export interface SegmentInsertInput {
  sessionId: string;
  type: SegmentType;
  content: string;
  tokenCount: number;
  metadataJson: string | null;
  importance: number;
}
