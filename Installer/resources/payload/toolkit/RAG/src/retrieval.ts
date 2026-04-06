import type { ChunkRecord, RetrievalResult, SourceRecord } from "./types";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return -1;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  if (!denominator) {
    return -1;
  }

  return dot / denominator;
}

function parseEmbedding(value: string): number[] {
  try {
    return JSON.parse(value) as number[];
  } catch {
    return [];
  }
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function rankChunks(params: {
  queryEmbedding: number[];
  chunks: ChunkRecord[];
  sourcesById: Map<string, SourceRecord>;
  topK: number;
  minScore?: number;
}): RetrievalResult[] {
  const scored: RetrievalResult[] = [];

  for (const chunk of params.chunks) {
    const source = params.sourcesById.get(chunk.source_id);
    if (!source) {
      continue;
    }

    const embedding = parseEmbedding(chunk.embedding_json);
    const score = cosineSimilarity(params.queryEmbedding, embedding);

    if (Number.isFinite(params.minScore) && score < Number(params.minScore)) {
      continue;
    }

    scored.push({
      sourceId: source.id,
      sourceKey: source.source_key,
      title: source.title,
      chunkId: chunk.id,
      chunkIndex: chunk.chunk_index,
      content: chunk.content,
      score,
      metadata: {
        ...parseMetadata(source.metadata_json),
        ...parseMetadata(chunk.metadata_json),
      },
    });
  }

  scored.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
  return scored.slice(0, params.topK);
}
