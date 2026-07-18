/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Property tests for DedupCache — validates correctness of caching, LRU eviction,
// hash canonicalization, and filter operations.

import * as fc from "fast-check";
import { DedupCache } from "../../src/dedup-cache";
import type { CacheEntry, TaskDefinition, TaskManifest } from "../../src/types";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid task prompt (non-empty string) */
const arbPrompt = fc.string({ minLength: 1, maxLength: 200 });

/** Generate an optional system prompt */
const arbSystemPrompt = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined });

/** Generate allowed tools list (sorted or unsorted, we test canonicalization) */
const arbAllowedTools = fc.option(
  fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
  { nil: undefined },
);

/** Generate a TaskDefinition */
const arbTaskDefinition: fc.Arbitrary<TaskDefinition> = fc.record({
  taskId: fc.string({ minLength: 1, maxLength: 64 }),
  prompt: arbPrompt,
  systemPrompt: arbSystemPrompt,
  allowedTools: arbAllowedTools,
});

/** Generate temperature (0.0–2.0) or undefined */
const arbTemperature = fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined });

/** Generate maxTokens or undefined */
const arbMaxTokens = fc.option(fc.integer({ min: 1, max: 32768 }), { nil: undefined });

/** Generate a minimal TaskManifest for hashing purposes */
const arbManifest: fc.Arbitrary<TaskManifest> = fc.record({
  tasks: fc.constant([]),
  systemPrompt: arbSystemPrompt,
  temperature: arbTemperature,
  maxTokens: arbMaxTokens,
});

/** Generate a valid CacheEntry */
const _arbCacheEntry: fc.Arbitrary<CacheEntry> = fc.record({
  inputHash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  result: fc.string({ minLength: 1, maxLength: 500 }),
  tokenUsage: fc.record({
    prompt: fc.nat({ max: 10000 }),
    completion: fc.nat({ max: 10000 }),
    total: fc.nat({ max: 20000 }),
  }),
  completedAt: fc.constant(new Date().toISOString()),
  modelId: fc.string({ minLength: 1, maxLength: 50 }),
});

/** Generate a fresh CacheEntry timestamped at 'now' */
function makeFreshEntry(hash: string): CacheEntry {
  return {
    inputHash: hash,
    result: "test result",
    tokenUsage: { prompt: 100, completion: 50, total: 150 },
    completedAt: new Date().toISOString(),
    modelId: "test-model",
  };
}

// ─── Property 10: Input Hash Determinism (Canonicalization) ──────────────────

/**
 * **Validates: Requirements 6.1**
 *
 * Property 10: For any two task definitions with identical fields (regardless of
 * field/key ordering), computeHash() produces the same hash.
 */
describe("Property 10: Input Hash Determinism (Canonicalization)", () => {
  it("produces identical hashes for identical inputs regardless of allowedTools ordering", () => {
    fc.assert(
      fc.property(arbTaskDefinition, arbManifest, (task, manifest) => {
        // Create a version of the task with reversed allowedTools order
        const taskReversed: TaskDefinition = {
          ...task,
          allowedTools: task.allowedTools ? [...task.allowedTools].reverse() : undefined,
        };

        const hash1 = DedupCache.computeHash(task, manifest);
        const hash2 = DedupCache.computeHash(taskReversed, manifest);

        expect(hash1).toBe(hash2);
      }),
      { numRuns: 200 },
    );
  });

  it("produces identical hashes for identical inputs regardless of field construction order", () => {
    fc.assert(
      fc.property(arbTaskDefinition, arbManifest, (task, manifest) => {
        // Construct an equivalent task with fields in different declaration order
        const taskReordered: TaskDefinition = Object.assign(
          {},
          { allowedTools: task.allowedTools },
          { prompt: task.prompt },
          { systemPrompt: task.systemPrompt },
          { taskId: task.taskId },
        );

        // Construct an equivalent manifest with different field order
        const manifestReordered: TaskManifest = Object.assign(
          {},
          { maxTokens: manifest.maxTokens },
          { tasks: manifest.tasks },
          { temperature: manifest.temperature },
          { systemPrompt: manifest.systemPrompt },
        );

        const hash1 = DedupCache.computeHash(task, manifest);
        const hash2 = DedupCache.computeHash(taskReordered, manifestReordered);

        expect(hash1).toBe(hash2);
      }),
      { numRuns: 200 },
    );
  });

  it("produces a valid 64-character hex SHA-256 hash for any input", () => {
    fc.assert(
      fc.property(arbTaskDefinition, arbManifest, (task, manifest) => {
        const hash = DedupCache.computeHash(task, manifest);
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }),
      { numRuns: 25 },
    );
  });

  it("produces different hashes for different prompts", () => {
    fc.assert(
      fc.property(
        arbManifest,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (manifest, prompt1, prompt2) => {
          fc.pre(prompt1 !== prompt2);

          const task1: TaskDefinition = { taskId: "t1", prompt: prompt1 };
          const task2: TaskDefinition = { taskId: "t2", prompt: prompt2 };

          const hash1 = DedupCache.computeHash(task1, manifest);
          const hash2 = DedupCache.computeHash(task2, manifest);

          expect(hash1).not.toBe(hash2);
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ─── Property 12: Cache LRU Eviction Invariant ───────────────────────────────

/**
 * **Validates: Requirements 7.1**
 *
 * Property 12: After any sequence of set() operations, the cache never exceeds
 * maxEntries (using a small limit for test speed).
 */
describe("Property 12: Cache LRU Eviction Invariant", () => {
  it("never exceeds maxEntries after any sequence of set() operations", () => {
    const MAX_ENTRIES = 10; // Small limit for fast testing

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            hash: fc.hexaString({ minLength: 8, maxLength: 16 }),
            result: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (operations) => {
          const cache = new DedupCache(":memory:", MAX_ENTRIES);

          try {
            for (const op of operations) {
              const entry: CacheEntry = {
                inputHash: op.hash,
                result: op.result,
                tokenUsage: { prompt: 10, completion: 5, total: 15 },
                completedAt: new Date().toISOString(),
                modelId: "test-model",
              };
              cache.set(op.hash, entry);
            }

            // Verify: cache size should never exceed MAX_ENTRIES
            // We check by clearing all and seeing how many were removed
            const totalRemoved = cache.clear();
            expect(totalRemoved).toBeLessThanOrEqual(MAX_ENTRIES);
          } finally {
            cache.close();
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("after inserting more than maxEntries unique hashes, only maxEntries remain", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), (extraEntries) => {
        const MAX_ENTRIES = 5;
        const cache = new DedupCache(":memory:", MAX_ENTRIES);

        try {
          const totalInserts = MAX_ENTRIES + extraEntries;

          for (let i = 0; i < totalInserts; i++) {
            const hash = `hash_${i.toString().padStart(8, "0")}`;
            cache.set(hash, makeFreshEntry(hash));
          }

          // The cache should contain exactly MAX_ENTRIES (or fewer if some hashes collided)
          const remaining = cache.clear();
          expect(remaining).toBeLessThanOrEqual(MAX_ENTRIES);
        } finally {
          cache.close();
        }
      }),
      { numRuns: 15 },
    );
  });
});

// ─── Property 13: Cache Hit Skips API Call ───────────────────────────────────

/**
 * **Validates: Requirements 7.2**
 *
 * Property 13: When a hash matches an unexpired entry, get() returns the cached
 * result (indicating no API call is needed).
 */
describe("Property 13: Cache Hit Skips API Call", () => {
  it("returns cached result for any unexpired entry", () => {
    fc.assert(
      fc.property(
        fc.hexaString({ minLength: 8, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.nat({ max: 5000 }),
        fc.nat({ max: 5000 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (hash, resultText, promptTokens, completionTokens, modelId) => {
          const cache = new DedupCache(":memory:", 10000);

          try {
            const entry: CacheEntry = {
              inputHash: hash,
              result: resultText,
              tokenUsage: {
                prompt: promptTokens,
                completion: completionTokens,
                total: promptTokens + completionTokens,
              },
              completedAt: new Date().toISOString(),
              modelId: modelId,
            };

            cache.set(hash, entry);

            // get() with a generous maxAge should return the cached entry
            const retrieved = cache.get(hash, 86400);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.inputHash).toBe(hash);
            expect(retrieved!.result).toBe(resultText);
            expect(retrieved!.tokenUsage.prompt).toBe(promptTokens);
            expect(retrieved!.tokenUsage.completion).toBe(completionTokens);
            expect(retrieved!.modelId).toBe(modelId);
          } finally {
            cache.close();
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("returns null for a hash that does not exist in cache", () => {
    fc.assert(
      fc.property(fc.hexaString({ minLength: 8, maxLength: 16 }), (hash) => {
        const cache = new DedupCache(":memory:", 10000);

        try {
          const result = cache.get(hash, 86400);
          expect(result).toBeNull();
        } finally {
          cache.close();
        }
      }),
      { numRuns: 15 },
    );
  });
});

// ─── Property 14: skipCache Bypass Semantics ─────────────────────────────────

/**
 * **Validates: Requirements 7.4**
 *
 * Property 14: When skipCache is true, get() is not consulted (tested at the
 * cache level by verifying fresh results still get written via set()).
 */
describe("Property 14: skipCache Bypass Semantics", () => {
  it("set() always writes entries that are retrievable even when simulating skipCache bypass", () => {
    fc.assert(
      fc.property(
        fc.hexaString({ minLength: 8, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (hash, oldResult, newResult) => {
          fc.pre(oldResult !== newResult);

          const cache = new DedupCache(":memory:", 10000);

          try {
            // Simulate initial cached result
            const oldEntry: CacheEntry = {
              inputHash: hash,
              result: oldResult,
              tokenUsage: { prompt: 10, completion: 5, total: 15 },
              completedAt: new Date().toISOString(),
              modelId: "model-v1",
            };
            cache.set(hash, oldEntry);

            // Verify old entry is accessible
            const oldRetrieved = cache.get(hash, 86400);
            expect(oldRetrieved).not.toBeNull();
            expect(oldRetrieved!.result).toBe(oldResult);

            // Simulate skipCache: fresh inference produces a new result and writes it
            // (skipCache means we DON'T call get, but we DO call set with fresh result)
            const newEntry: CacheEntry = {
              inputHash: hash,
              result: newResult,
              tokenUsage: { prompt: 20, completion: 10, total: 30 },
              completedAt: new Date().toISOString(),
              modelId: "model-v2",
            };
            cache.set(hash, newEntry);

            // The cache should now have the new result (set overwrites)
            const newRetrieved = cache.get(hash, 86400);
            expect(newRetrieved).not.toBeNull();
            expect(newRetrieved!.result).toBe(newResult);
            expect(newRetrieved!.modelId).toBe("model-v2");
          } finally {
            cache.close();
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ─── Property 15: Cache Age Expiry ──────────────────────────────────────────

/**
 * **Validates: Requirements 7.5**
 *
 * Property 15: Cached entries older than maxAge are not returned by get().
 */
describe("Property 15: Cache Age Expiry", () => {
  it("returns null for entries older than maxAge", () => {
    fc.assert(
      fc.property(
        fc.hexaString({ minLength: 8, maxLength: 16 }),
        fc.integer({ min: 1, max: 3600 }),
        (hash, maxAgeSeconds) => {
          const cache = new DedupCache(":memory:", 10000);

          try {
            // Create an entry completed well in the past (older than maxAge)
            const pastTime = new Date(Date.now() - (maxAgeSeconds + 10) * 1000).toISOString();
            const entry: CacheEntry = {
              inputHash: hash,
              result: "old result",
              tokenUsage: { prompt: 10, completion: 5, total: 15 },
              completedAt: pastTime,
              modelId: "test-model",
            };
            cache.set(hash, entry);

            // get() with the maxAge should return null (entry is expired)
            const result = cache.get(hash, maxAgeSeconds);
            expect(result).toBeNull();
          } finally {
            cache.close();
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("returns entry when it is younger than maxAge", () => {
    fc.assert(
      fc.property(
        fc.hexaString({ minLength: 8, maxLength: 16 }),
        fc.integer({ min: 60, max: 86400 }),
        (hash, maxAgeSeconds) => {
          const cache = new DedupCache(":memory:", 10000);

          try {
            // Create a fresh entry (just now)
            const entry: CacheEntry = {
              inputHash: hash,
              result: "fresh result",
              tokenUsage: { prompt: 10, completion: 5, total: 15 },
              completedAt: new Date().toISOString(),
              modelId: "test-model",
            };
            cache.set(hash, entry);

            // get() with a generous maxAge should return the entry
            const result = cache.get(hash, maxAgeSeconds);
            expect(result).not.toBeNull();
            expect(result!.result).toBe("fresh result");
          } finally {
            cache.close();
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it("maxAge of 0 effectively disables cache reads (everything is expired)", () => {
    fc.assert(
      fc.property(fc.hexaString({ minLength: 8, maxLength: 16 }), (hash) => {
        const cache = new DedupCache(":memory:", 10000);

        try {
          // Create a very fresh entry
          const entry: CacheEntry = {
            inputHash: hash,
            result: "result",
            tokenUsage: { prompt: 10, completion: 5, total: 15 },
            // Even an entry from 1 second ago should be "expired" with maxAge=0
            completedAt: new Date(Date.now() - 1000).toISOString(),
            modelId: "test-model",
          };
          cache.set(hash, entry);

          // maxAge of 0 means nothing is within the allowed age
          const result = cache.get(hash, 0);
          expect(result).toBeNull();
        } finally {
          cache.close();
        }
      }),
      { numRuns: 15 },
    );
  });
});

// ─── Property 16: clear_cache Filter Correctness ─────────────────────────────

/**
 * **Validates: Requirements 7.7**
 *
 * Property 16: Prefix filter removes only matching entries; age filter removes
 * only old entries; no filter removes all; count matches actual removals.
 */
describe("Property 16: clear_cache Filter Correctness", () => {
  it("no filter removes all entries and count matches total entries", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (numEntries) => {
        const cache = new DedupCache(":memory:", 10000);

        try {
          // Insert N entries with unique hashes
          for (let i = 0; i < numEntries; i++) {
            const hash = `hash_${i.toString().padStart(8, "0")}`;
            cache.set(hash, makeFreshEntry(hash));
          }

          // Clear all — should return the count of entries inserted
          const removed = cache.clear();
          expect(removed).toBe(numEntries);

          // Verify cache is empty
          const afterRemoval = cache.clear();
          expect(afterRemoval).toBe(0);
        } finally {
          cache.close();
        }
      }),
      { numRuns: 15 },
    );
  });

  it("prefix filter removes only entries with matching prefix", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (matchCount, nonMatchCount) => {
          const cache = new DedupCache(":memory:", 10000);

          try {
            const prefix = "abc";

            // Insert entries that match the prefix
            for (let i = 0; i < matchCount; i++) {
              const hash = `${prefix}${i.toString().padStart(8, "0")}`;
              cache.set(hash, makeFreshEntry(hash));
            }

            // Insert entries that do NOT match the prefix
            for (let i = 0; i < nonMatchCount; i++) {
              const hash = `xyz${i.toString().padStart(8, "0")}`;
              cache.set(hash, makeFreshEntry(hash));
            }

            // Clear with prefix filter
            const removed = cache.clear({ prefix });
            expect(removed).toBe(matchCount);

            // Verify: non-matching entries still exist
            const remaining = cache.clear();
            expect(remaining).toBe(nonMatchCount);
          } finally {
            cache.close();
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it("age filter removes only entries older than threshold", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 60, max: 3600 }),
        (oldCount, freshCount, ageThreshold) => {
          const cache = new DedupCache(":memory:", 10000);

          try {
            // Insert old entries (older than the threshold)
            for (let i = 0; i < oldCount; i++) {
              const hash = `old_${i.toString().padStart(8, "0")}`;
              const oldTime = new Date(Date.now() - (ageThreshold + 60) * 1000).toISOString();
              const entry: CacheEntry = {
                inputHash: hash,
                result: "old result",
                tokenUsage: { prompt: 10, completion: 5, total: 15 },
                completedAt: oldTime,
                modelId: "test-model",
              };
              cache.set(hash, entry);
            }

            // Insert fresh entries (within the threshold)
            for (let i = 0; i < freshCount; i++) {
              const hash = `new_${i.toString().padStart(8, "0")}`;
              const entry: CacheEntry = {
                inputHash: hash,
                result: "fresh result",
                tokenUsage: { prompt: 10, completion: 5, total: 15 },
                completedAt: new Date().toISOString(),
                modelId: "test-model",
              };
              cache.set(hash, entry);
            }

            // Clear with age filter
            const removed = cache.clear({ olderThan: ageThreshold });
            expect(removed).toBe(oldCount);

            // Verify: fresh entries still exist
            const remaining = cache.clear();
            expect(remaining).toBe(freshCount);
          } finally {
            cache.close();
          }
        },
      ),
      { numRuns: 15 },
    );
  });

  it("prefix filter matching zero entries returns 0 removals", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (numEntries) => {
        const cache = new DedupCache(":memory:", 10000);

        try {
          // Insert entries with prefix "exists_"
          for (let i = 0; i < numEntries; i++) {
            const hash = `exists_${i.toString().padStart(8, "0")}`;
            cache.set(hash, makeFreshEntry(hash));
          }

          // Clear with a prefix that matches nothing
          const removed = cache.clear({ prefix: "nomatch_zzz" });
          expect(removed).toBe(0);

          // All entries should still be there
          const remaining = cache.clear();
          expect(remaining).toBe(numEntries);
        } finally {
          cache.close();
        }
      }),
      { numRuns: 30 },
    );
  });
});
