import type {
  DeleteSourceInput,
  IngestDocumentsInput,
  ListSourcesInput,
  QueryKnowledgeInput,
  ReindexSourceInput,
} from "./types";

export const MAX_DOCUMENTS_PER_INGEST = Number(process.env.RAG_MAX_DOCUMENTS_PER_INGEST ?? 20);
export const MAX_TEXT_LENGTH = Number(process.env.RAG_MAX_TEXT_LENGTH ?? 2_000_000);
export const DEFAULT_CHUNK_SIZE_TOKENS = Number(process.env.RAG_CHUNK_SIZE_TOKENS ?? 350);
export const DEFAULT_OVERLAP_TOKENS = Number(process.env.RAG_CHUNK_OVERLAP_TOKENS ?? 40);
export const MAX_CHUNK_SIZE_TOKENS = Number(process.env.RAG_MAX_CHUNK_SIZE_TOKENS ?? 1200);
export const MAX_OVERLAP_TOKENS = Number(process.env.RAG_MAX_OVERLAP_TOKENS ?? 300);
export const DEFAULT_TOP_K = Number(process.env.RAG_QUERY_TOP_K ?? 6);
export const MAX_TOP_K = Number(process.env.RAG_MAX_TOP_K ?? 25);

export function normalizeChunkSize(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CHUNK_SIZE_TOKENS;
  }
  return Math.min(Math.max(Math.floor(Number(value)), 50), MAX_CHUNK_SIZE_TOKENS);
}

export function normalizeOverlap(value?: number, chunkSize?: number): number {
  if (!Number.isFinite(value)) {
    return Math.min(
      DEFAULT_OVERLAP_TOKENS,
      Math.max((chunkSize || DEFAULT_CHUNK_SIZE_TOKENS) - 1, 0),
    );
  }

  const normalized = Math.min(Math.max(Math.floor(Number(value)), 0), MAX_OVERLAP_TOKENS);
  const maxAllowed = Math.max((chunkSize || DEFAULT_CHUNK_SIZE_TOKENS) - 1, 0);
  return Math.min(normalized, maxAllowed);
}

export function normalizeTopK(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TOP_K;
  }
  return Math.min(Math.max(Math.floor(Number(value)), 1), MAX_TOP_K);
}

export function validateIngestInput(input: IngestDocumentsInput): string | undefined {
  if (!Array.isArray(input.documents) || input.documents.length === 0) {
    return "'documents' must be a non-empty array.";
  }

  if (input.documents.length > MAX_DOCUMENTS_PER_INGEST) {
    return `At most ${MAX_DOCUMENTS_PER_INGEST} documents are allowed per ingest request.`;
  }

  for (const [index, document] of input.documents.entries()) {
    const hasText = typeof document.text === "string" && document.text.trim().length > 0;
    const hasFilePath =
      typeof document.filePath === "string" && document.filePath.trim().length > 0;
    const hasUrl = typeof document.url === "string" && document.url.trim().length > 0;

    if (!hasText && !hasFilePath && !hasUrl) {
      return `Document at index ${index} must provide one of text, filePath, or url.`;
    }

    if (hasText && (document.text as string).length > MAX_TEXT_LENGTH) {
      return `Document at index ${index} exceeds max text length ${MAX_TEXT_LENGTH}.`;
    }
  }

  return undefined;
}

export function validateQueryInput(input: QueryKnowledgeInput): string | undefined {
  if (!input.query || !input.query.trim()) {
    return "'query' is required.";
  }

  if (input.query.length > 5000) {
    return "'query' is too long.";
  }

  return undefined;
}

export function validateListInput(input: ListSourcesInput): string | undefined {
  if (
    input.limit !== undefined &&
    (!Number.isFinite(input.limit) || input.limit < 1 || input.limit > 200)
  ) {
    return "'limit' must be between 1 and 200.";
  }

  if (input.offset !== undefined && (!Number.isFinite(input.offset) || input.offset < 0)) {
    return "'offset' must be >= 0.";
  }

  return undefined;
}

export function validateDeleteInput(input: DeleteSourceInput): string | undefined {
  if (!input.sourceId || !input.sourceId.trim()) {
    return "'sourceId' is required.";
  }

  return undefined;
}

export function validateReindexInput(input: ReindexSourceInput): string | undefined {
  if (!input.sourceId || !input.sourceId.trim()) {
    return "'sourceId' is required.";
  }

  return undefined;
}
