import type { EmbeddingProvider } from "./embeddings";

function splitIntoSentences(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!normalized) {
    return [];
  }

  const chunks = normalized.split(/(?<=[.!?])\s+/);
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

export type ChunkDraft = {
  content: string;
  tokenCount: number;
};

export async function chunkTextByTokens(
  text: string,
  provider: EmbeddingProvider,
  chunkSizeTokens: number,
  overlapTokens: number,
): Promise<ChunkDraft[]> {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return [];
  }

  const result: ChunkDraft[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = await provider.countTokens(sentence);

    if (buffer.length === 0) {
      buffer.push(sentence);
      bufferTokens = sentenceTokens;
      continue;
    }

    const candidate = `${buffer.join(" ")} ${sentence}`;
    const candidateTokens = await provider.countTokens(candidate);

    if (candidateTokens <= chunkSizeTokens) {
      buffer.push(sentence);
      bufferTokens = candidateTokens;
      continue;
    }

    result.push({
      content: buffer.join(" ").trim(),
      tokenCount: bufferTokens,
    });

    if (overlapTokens > 0) {
      const carry: string[] = [];
      let carryTokens = 0;
      for (let i = buffer.length - 1; i >= 0; i--) {
        const tokenCount = await provider.countTokens(buffer[i]);
        if (carryTokens + tokenCount > overlapTokens) {
          break;
        }
        carry.unshift(buffer[i]);
        carryTokens += tokenCount;
      }
      buffer = [...carry, sentence];
      bufferTokens = await provider.countTokens(buffer.join(" "));
    } else {
      buffer = [sentence];
      bufferTokens = sentenceTokens;
    }
  }

  if (buffer.length > 0) {
    result.push({
      content: buffer.join(" ").trim(),
      tokenCount: bufferTokens,
    });
  }

  return result.filter((chunk) => chunk.content.length > 0);
}
