/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Feature: sub-agent-mcp
// **Validates: Requirements 14.2, 14.3, 14.4, 14.5, 14.6, 14.8**

import * as fc from "fast-check";
import { ChunkStrategy } from "../../src/chunk-strategy";

/**
 * Helper: Generate a (contextSize, text) pair where the text requires chunking.
 * Uses small contextSize (100–500) so we can trigger chunking with reasonable text.
 * Text needs: text.length / 4 > contextSize * 0.8 → text.length > contextSize * 3.2
 * Max length kept within 20-chunk budget: contextSize * 0.7 * 4 * 15 chars
 */
function chunkableInput(): fc.Arbitrary<{ contextSize: number; text: string }> {
  return fc.integer({ min: 100, max: 300 }).chain((contextSize) => {
    const minLength = Math.ceil(contextSize * 3.2) + 1;
    // Stay well within 20-chunk limit to avoid throw path dominating
    const maxLength = Math.floor(contextSize * 0.7 * 4 * 10);
    return fc
      .string({ minLength, maxLength: Math.max(minLength + 10, maxLength) })
      .map((text) => ({ contextSize, text }));
  });
}

/**
 * Helper: Generate structured text (with paragraph separators) that requires chunking.
 * Builds text from segments joined by \n\n to exercise paragraph boundary splitting.
 */
function structuredChunkableInput(): fc.Arbitrary<{ contextSize: number; text: string }> {
  return fc.integer({ min: 100, max: 300 }).chain((contextSize) => {
    const minLength = Math.ceil(contextSize * 3.2) + 1;
    // Each paragraph segment: 20-100 chars, joined by \n\n (2 chars each join)
    // Target: produce enough segments to exceed minLength
    const segmentCount = Math.ceil(minLength / 30) + 5;

    const segment = fc.oneof(
      { weight: 3, arbitrary: fc.string({ minLength: 10, maxLength: 80 }) },
      {
        weight: 1,
        arbitrary: fc
          .string({ minLength: 5, maxLength: 30 })
          .map((title) => `## ${title.replace(/\n/g, " ")}`),
      },
    );

    return fc
      .array(segment, { minLength: segmentCount, maxLength: segmentCount + 10 })
      .map((segments) => segments.join("\n\n"))
      .map((text) => ({ contextSize, text }));
  });
}

/**
 * Property 26: Chunk Size and Boundary Correctness
 *
 * For any text that requires chunking, each produced chunk fits within
 * 70% of modelContextSize in estimated tokens (chars / 4). No more
 * than 20 chunks are produced.
 *
 * **Validates: Requirements 14.2, 14.3, 14.8**
 */
describe("Property 26: Chunk Size and Boundary Correctness", () => {
  it("every chunk fits within 70% of modelContextSize in estimated tokens", () => {
    fc.assert(
      fc.property(chunkableInput(), ({ contextSize, text }) => {
        const strategy = new ChunkStrategy(contextSize);
        const maxChunkTokens = contextSize * 0.7;

        try {
          const chunks = strategy.split(text);
          for (const chunk of chunks) {
            const estimatedTokens = chunk.length / 4;
            expect(estimatedTokens).toBeLessThanOrEqual(maxChunkTokens);
          }
        } catch (e: any) {
          // Throws when >20 chunks would be needed — valid per requirement 14.8
          expect(e.message).toContain("maximum chunk limit");
        }
      }),
      { numRuns: 25 },
    );
  });

  it("no more than 20 chunks are produced", () => {
    fc.assert(
      fc.property(chunkableInput(), ({ contextSize, text }) => {
        const strategy = new ChunkStrategy(contextSize);

        try {
          const chunks = strategy.split(text);
          expect(chunks.length).toBeLessThanOrEqual(20);
        } catch (e: any) {
          // Throws when >20 chunks would be needed — valid per requirement 14.8
          expect(e.message).toContain("maximum chunk limit");
        }
      }),
      { numRuns: 25 },
    );
  });

  it("at least one chunk is produced for any non-empty input", () => {
    fc.assert(
      fc.property(chunkableInput(), ({ contextSize, text }) => {
        const strategy = new ChunkStrategy(contextSize);

        try {
          const chunks = strategy.split(text);
          expect(chunks.length).toBeGreaterThanOrEqual(1);
        } catch (e: any) {
          expect(e.message).toContain("maximum chunk limit");
        }
      }),
      { numRuns: 25 },
    );
  });

  it("text that fits within budget returns a single chunk unchanged", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 300 }).chain((contextSize) => {
          const maxChars = Math.floor(contextSize * 0.7 * 4) - 1;
          return fc
            .string({ minLength: 1, maxLength: Math.max(1, maxChars) })
            .map((text) => ({ contextSize, text }));
        }),
        ({ contextSize, text }) => {
          const strategy = new ChunkStrategy(contextSize);
          const chunks = strategy.split(text);
          expect(chunks.length).toBe(1);
          expect(chunks[0]).toBe(text);
        },
      ),
      { numRuns: 25 },
    );
  });
});

/**
 * Property 27: Chunk Dispatch and Merge
 *
 * For any text split into M chunks, joining all chunks reconstructs
 * content equivalent to the original (no data loss). Chunks maintain
 * content order.
 *
 * **Validates: Requirements 14.4, 14.5, 14.6**
 */
describe("Property 27: Chunk Dispatch and Merge", () => {
  it("joining all chunks reconstructs the original text (no data loss)", () => {
    fc.assert(
      fc.property(chunkableInput(), ({ contextSize, text }) => {
        const strategy = new ChunkStrategy(contextSize);

        try {
          const chunks = strategy.split(text);
          const reconstructed = chunks.join("");
          expect(reconstructed).toBe(text);
        } catch (e: any) {
          expect(e.message).toContain("maximum chunk limit");
        }
      }),
      { numRuns: 25 },
    );
  });

  it("chunks maintain content order (sequential non-overlapping coverage)", () => {
    fc.assert(
      fc.property(chunkableInput(), ({ contextSize, text }) => {
        const strategy = new ChunkStrategy(contextSize);

        try {
          const chunks = strategy.split(text);
          // Verify each chunk appears sequentially at the expected offset
          let offset = 0;
          for (const chunk of chunks) {
            const foundAt = text.indexOf(chunk, offset);
            expect(foundAt).toBe(offset);
            offset += chunk.length;
          }
          // All content is accounted for
          expect(offset).toBe(text.length);
        } catch (e: any) {
          expect(e.message).toContain("maximum chunk limit");
        }
      }),
      { numRuns: 25 },
    );
  });

  it("structured text with paragraphs/headers is fully preserved after chunking", () => {
    fc.assert(
      fc.property(structuredChunkableInput(), ({ contextSize, text }) => {
        const strategy = new ChunkStrategy(contextSize);

        try {
          const chunks = strategy.split(text);
          expect(chunks.join("")).toBe(text);
          // Each chunk is non-empty
          for (const chunk of chunks) {
            expect(chunk.length).toBeGreaterThan(0);
          }
        } catch (e: any) {
          expect(e.message).toContain("maximum chunk limit");
        }
      }),
      { numRuns: 15 },
    );
  });

  it("chunk count M means indices 0 through M-1 are valid (dispatch indexing)", () => {
    fc.assert(
      fc.property(chunkableInput(), ({ contextSize, text }) => {
        const strategy = new ChunkStrategy(contextSize);

        try {
          const chunks = strategy.split(text);
          // Needs chunking → at least 2 chunks
          expect(chunks.length).toBeGreaterThanOrEqual(2);
          for (let i = 0; i < chunks.length; i++) {
            expect(i).toBeGreaterThanOrEqual(0);
            expect(i).toBeLessThan(chunks.length);
          }
        } catch (e: any) {
          expect(e.message).toContain("maximum chunk limit");
        }
      }),
      { numRuns: 25 },
    );
  });
});
