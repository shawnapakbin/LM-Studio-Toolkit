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

// ─── Result types ─────────────────────────────────────────────────────────────

export interface RetrieveResult {
  segments: ScoredSegment[];
  totalTokens: number;
  truncated: boolean;
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
