export type RagAction =
  | "ingest_documents"
  | "query_knowledge"
  | "list_sources"
  | "delete_source"
  | "reindex_source";

export type SourceType = "text" | "file" | "url";

export type DocumentInput = {
  sourceKey?: string;
  title?: string;
  text?: string;
  filePath?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type IngestDocumentsInput = {
  documents: DocumentInput[];
  chunkSizeTokens?: number;
  overlapTokens?: number;
  approvalInterviewId?: string;
  approvalToken?: string;
};

export type QueryKnowledgeInput = {
  query: string;
  topK?: number;
  sourceIds?: string[];
  sourceKeys?: string[];
  minScore?: number;
};

export type ListSourcesInput = {
  limit?: number;
  offset?: number;
};

export type DeleteSourceInput = {
  sourceId: string;
  approvalInterviewId?: string;
  approvalToken?: string;
};

export type ReindexSourceInput = {
  sourceId: string;
  chunkSizeTokens?: number;
  overlapTokens?: number;
  approvalInterviewId?: string;
  approvalToken?: string;
};

export type RagRequest = {
  action: RagAction;
  payload:
    | IngestDocumentsInput
    | QueryKnowledgeInput
    | ListSourcesInput
    | DeleteSourceInput
    | ReindexSourceInput;
};

export type SourceRecord = {
  id: string;
  source_key: string;
  source_type: SourceType;
  title: string | null;
  content_hash: string;
  source_text: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  last_indexed_at: string;
  chunk_count: number;
  token_count: number;
};

export type ChunkRecord = {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  embedding_json: string;
  metadata_json: string | null;
  created_at: string;
};

export type ChunkInput = {
  content: string;
  tokenCount: number;
  embedding: number[];
  metadata?: Record<string, unknown>;
};

export type RetrievalResult = {
  sourceId: string;
  sourceKey: string;
  title: string | null;
  chunkId: string;
  chunkIndex: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
};
