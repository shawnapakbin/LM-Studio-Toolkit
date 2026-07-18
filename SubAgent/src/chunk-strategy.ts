/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * Input splitting along logical boundaries for oversized sub-task prompts.
 *
 * When a task's estimated token count exceeds the model's context budget,
 * ChunkStrategy splits the prompt into smaller pieces using a priority order
 * of boundary types: paragraph breaks > section headers > newlines > word boundaries.
 *
 * Each chunk fits within 70% of the model's context size (in estimated tokens),
 * and no more than 20 chunks are produced per task.
 */
export class ChunkStrategy {
  private readonly modelContextSize: number;
  private readonly maxChunks = 20;

  constructor(modelContextSize: number) {
    this.modelContextSize = modelContextSize;
  }

  /**
   * Returns true when the estimated token count exceeds 80% of the model's
   * context window (same threshold as TokenBudget).
   */
  needsChunking(estimatedTokens: number): boolean {
    return estimatedTokens > this.modelContextSize * 0.8;
  }

  /**
   * Split the prompt into chunks that each fit within 70% of modelContextSize
   * in estimated tokens. Uses boundary priority: paragraph > header > newline > word.
   *
   * Throws if the input cannot be split into 20 or fewer valid chunks.
   */
  split(prompt: string): string[] {
    const maxChunkTokens = this.getMaxChunkTokens();

    // If the prompt already fits in a single chunk, return as-is
    if (this.estimateTokens(prompt) <= maxChunkTokens) {
      return [prompt];
    }

    // Try splitting at each boundary level in priority order
    let chunks = this.splitAtParagraphs(prompt, maxChunkTokens);
    if (this.allChunksFit(chunks, maxChunkTokens)) {
      return this.enforceMaxChunks(chunks);
    }

    // Some paragraph chunks are still too large — try headers
    chunks = this.refineSplits(chunks, maxChunkTokens, (text, limit) =>
      this.splitAtHeaders(text, limit),
    );
    if (this.allChunksFit(chunks, maxChunkTokens)) {
      return this.enforceMaxChunks(chunks);
    }

    // Try newlines
    chunks = this.refineSplits(chunks, maxChunkTokens, (text, limit) =>
      this.splitAtNewlines(text, limit),
    );
    if (this.allChunksFit(chunks, maxChunkTokens)) {
      return this.enforceMaxChunks(chunks);
    }

    // Final fallback: word boundaries
    chunks = this.refineSplits(chunks, maxChunkTokens, (text, limit) =>
      this.splitAtWords(text, limit),
    );

    return this.enforceMaxChunks(chunks);
  }

  /**
   * Maximum tokens allowed per chunk: 70% of modelContextSize.
   */
  private getMaxChunkTokens(): number {
    return this.modelContextSize * 0.7;
  }

  /**
   * Estimate tokens using chars / 4 (same formula as TokenBudget).
   */
  private estimateTokens(text: string): number {
    return text.length / 4;
  }

  /**
   * Check if all chunks fit within the token limit.
   */
  private allChunksFit(chunks: string[], maxChunkTokens: number): boolean {
    return chunks.every((chunk) => this.estimateTokens(chunk) <= maxChunkTokens);
  }

  /**
   * Re-split any oversized chunks using the provided splitter function.
   */
  private refineSplits(
    chunks: string[],
    maxChunkTokens: number,
    splitter: (text: string, limit: number) => string[],
  ): string[] {
    const result: string[] = [];
    for (const chunk of chunks) {
      if (this.estimateTokens(chunk) <= maxChunkTokens) {
        result.push(chunk);
      } else {
        result.push(...splitter(chunk, maxChunkTokens));
      }
    }
    return result;
  }

  /**
   * Enforce the maximum of 20 chunks. Throws if more are needed.
   */
  private enforceMaxChunks(chunks: string[]): string[] {
    if (chunks.length > this.maxChunks) {
      throw new Error(
        `Input is too large to chunk within the maximum chunk limit of ${this.maxChunks}. ` +
          `Splitting produced ${chunks.length} chunks. Reduce input size or increase model context size.`,
      );
    }
    return chunks;
  }

  /**
   * Split text at paragraph boundaries (double newline: \n\n).
   * Accumulates segments until adding the next would exceed the limit.
   */
  private splitAtParagraphs(text: string, maxChunkTokens: number): string[] {
    return this.splitAtDelimiter(text, "\n\n", maxChunkTokens);
  }

  /**
   * Split text at section headers (lines starting with #).
   * Each header starts a new segment.
   */
  private splitAtHeaders(text: string, maxChunkTokens: number): string[] {
    // Split before lines that start with #
    const segments = text.split(/(?=^#{1,6}\s)/m);
    return this.accumulateSegments(segments, maxChunkTokens);
  }

  /**
   * Split text at single newline boundaries.
   */
  private splitAtNewlines(text: string, maxChunkTokens: number): string[] {
    return this.splitAtDelimiter(text, "\n", maxChunkTokens);
  }

  /**
   * Split text at word boundaries (spaces).
   * This is the last resort — guarantees each chunk fits.
   */
  private splitAtWords(text: string, maxChunkTokens: number): string[] {
    const maxChars = maxChunkTokens * 4;
    const words = text.split(/(\s+)/);
    const chunks: string[] = [];
    let current = "";

    for (const word of words) {
      if (current.length + word.length <= maxChars) {
        current += word;
      } else {
        if (current.length > 0) {
          chunks.push(current);
        }
        // If a single word exceeds the limit, force-split it
        if (word.length > maxChars) {
          const parts = this.forceChopString(word, maxChars);
          chunks.push(...parts.slice(0, -1));
          current = parts[parts.length - 1];
        } else {
          current = word;
        }
      }
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Generic delimiter-based splitting. Splits text on the delimiter,
   * then accumulates segments into chunks that fit within the token limit.
   */
  private splitAtDelimiter(text: string, delimiter: string, maxChunkTokens: number): string[] {
    const parts = text.split(delimiter);
    const segments = parts.map((part, i) => (i < parts.length - 1 ? part + delimiter : part));
    return this.accumulateSegments(segments, maxChunkTokens);
  }

  /**
   * Accumulate segments into chunks, ensuring each chunk fits within
   * the token limit. Does not further split individual segments that
   * exceed the limit — those are returned as-is for refinement at
   * a lower boundary level.
   */
  private accumulateSegments(segments: string[], maxChunkTokens: number): string[] {
    const chunks: string[] = [];
    let current = "";

    for (const segment of segments) {
      const combined = current + segment;
      if (this.estimateTokens(combined) <= maxChunkTokens) {
        current = combined;
      } else {
        if (current.length > 0) {
          chunks.push(current);
        }
        current = segment;
      }
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    if (chunks.length > 0) {
      return chunks;
    }
    const joined = segments.join("");
    return joined.length > 0 ? [joined] : [];
  }

  /**
   * Force-split a string into pieces of at most maxChars characters.
   * Used as the absolute last resort when no boundaries exist.
   */
  private forceChopString(text: string, maxChars: number): string[] {
    const pieces: string[] = [];
    let offset = 0;
    while (offset < text.length) {
      pieces.push(text.slice(offset, offset + maxChars));
      offset += maxChars;
    }
    return pieces;
  }
}
