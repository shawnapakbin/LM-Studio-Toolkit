/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 17: Cache lookup semantics
 * Feature: blender-bridge-improvements, Property 18: Cache search token matching and ranking
 * Feature: blender-bridge-improvements, Property 19: Cache persistence round-trip with size limiting
 * Feature: blender-bridge-improvements, Property 20: Cache version invalidation
 *
 * Tests the DocCache class directly for put/get/search/invalidateAll/persistence.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";
import { DocCache } from "../src/doc-cache";
import { DocCacheEntry } from "../src/types";

describe("doc-cache property tests", () => {
  let testDir: string;
  let cacheFilePath: string;

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `doc-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
    cacheFilePath = path.join(testDir, "doc-cache.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  // --- Generators ---
  const identifierArb = fc
    .array(
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_".split("")), {
        minLength: 1,
        maxLength: 10,
      }),
      { minLength: 1, maxLength: 4 },
    )
    .map((parts) => "bpy." + parts.join("."));

  const contentArb = fc.string({ minLength: 1, maxLength: 200 });

  const entryArb = fc.record({
    identifier: identifierArb,
    content: contentArb,
    fetchedAt: fc.integer({ min: 1000000000000, max: 2000000000000 }),
    blenderVersion: fc.constant("5.1.0"),
  });

  const entryListArb = fc.array(entryArb, { minLength: 1, maxLength: 20 });

  /**
   * Property 17: Cache lookup semantics
   *
   * If put(entry) is called, get(identifier) returns that entry.
   * If not put, get returns null.
   */
  describe("Property 17: Cache lookup semantics", () => {
    it("get returns the entry after put", () => {
      fc.assert(
        fc.property(entryArb, (entry) => {
          const cache = new DocCache("5.1.0", cacheFilePath);
          cache.put(entry);
          const result = cache.get(entry.identifier);
          expect(result).not.toBeNull();
          expect(result!.identifier).toBe(entry.identifier);
          expect(result!.content).toBe(entry.content);
          expect(result!.fetchedAt).toBe(entry.fetchedAt);
        }),
        { numRuns: 100 },
      );
    });

    it("get returns null for identifiers not in cache", () => {
      fc.assert(
        fc.property(identifierArb, (identifier) => {
          const cache = new DocCache("5.1.0", cacheFilePath);
          const result = cache.get(identifier);
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it("put overwrites existing entry for same identifier", () => {
      fc.assert(
        fc.property(entryArb, contentArb, (entry, newContent) => {
          const cache = new DocCache("5.1.0", cacheFilePath);
          cache.put(entry);
          const updatedEntry = { ...entry, content: newContent };
          cache.put(updatedEntry);
          const result = cache.get(entry.identifier);
          expect(result).not.toBeNull();
          expect(result!.content).toBe(newContent);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 18: Cache search token matching and ranking
   *
   * Results include only entries where every query token appears
   * in the identifier or content (case-insensitive).
   * At most 20 results are returned.
   */
  describe("Property 18: Cache search token matching and ranking", () => {
    it("search results contain all query tokens in identifier or content", () => {
      fc.assert(
        fc.property(entryListArb, (entries) => {
          const cache = new DocCache("5.1.0", cacheFilePath);
          for (const entry of entries) {
            cache.put(entry);
          }

          // Use a token from the first entry's identifier for search
          const firstEntry = entries[0];
          const token = firstEntry.identifier.split(".").pop()!;
          if (token.length === 0) return;

          const results = cache.search(token);
          for (const result of results) {
            const haystack = (result.identifier + " " + result.content).toLowerCase();
            expect(haystack).toContain(token.toLowerCase());
          }
        }),
        { numRuns: 100 },
      );
    });

    it("search returns at most 20 results", () => {
      fc.assert(
        fc.property(fc.array(entryArb, { minLength: 25, maxLength: 30 }), (entries) => {
          const cache = new DocCache("5.1.0", cacheFilePath);
          // Give all entries a common token so they all match
          for (const entry of entries) {
            entry.content = "common_search_token " + entry.content;
            cache.put(entry);
          }

          const results = cache.search("common_search_token");
          expect(results.length).toBeLessThanOrEqual(20);
        }),
        { numRuns: 100 },
      );
    });

    it("search with multiple tokens requires all tokens to match", () => {
      const cache = new DocCache("5.1.0", cacheFilePath);
      cache.put({
        identifier: "bpy.types.Object",
        content: "The base class for all objects in Blender",
        fetchedAt: Date.now(),
        blenderVersion: "5.1.0",
      });
      cache.put({
        identifier: "bpy.types.Mesh",
        content: "Mesh data block for polygonal geometry",
        fetchedAt: Date.now(),
        blenderVersion: "5.1.0",
      });

      // Search for "object base" — should match first entry only
      const results = cache.search("object base");
      for (const result of results) {
        const haystack = (result.identifier + " " + result.content).toLowerCase();
        expect(haystack).toContain("object");
        expect(haystack).toContain("base");
      }
    });

    it("empty query returns empty results", () => {
      const cache = new DocCache("5.1.0", cacheFilePath);
      cache.put({
        identifier: "bpy.types.Object",
        content: "Test content",
        fetchedAt: Date.now(),
        blenderVersion: "5.1.0",
      });
      expect(cache.search("")).toEqual([]);
      expect(cache.search("   ")).toEqual([]);
    });
  });

  /**
   * Property 19: Cache persistence round-trip with size limiting
   *
   * Entries written to disk can be read back. If total exceeds max size,
   * oldest entries are evicted.
   */
  describe("Property 19: Cache persistence round-trip with size limiting", () => {
    it("entries persist to disk and are readable on a new instance", () => {
      fc.assert(
        fc.property(entryArb, (entry) => {
          const cache1 = new DocCache("5.1.0", cacheFilePath);
          cache1.put(entry);

          // Create a new cache instance reading from same file
          const cache2 = new DocCache("5.1.0", cacheFilePath);
          const result = cache2.get(entry.identifier);
          expect(result).not.toBeNull();
          expect(result!.identifier).toBe(entry.identifier);
          expect(result!.content).toBe(entry.content);
        }),
        { numRuns: 100 },
      );
    });

    it("size limiting evicts oldest entries when exceeded", () => {
      // Use a tiny max size to force eviction
      const tinyMaxSize = 500; // 500 bytes

      const cache = new DocCache("5.1.0", cacheFilePath, tinyMaxSize);

      // Add entries until we exceed the tiny limit
      const entries: DocCacheEntry[] = [];
      for (let i = 0; i < 10; i++) {
        const entry: DocCacheEntry = {
          identifier: `bpy.types.Type${i}`,
          content: `Content for type ${i} with some extra text to increase size`,
          fetchedAt: 1000000000000 + i * 1000, // Increasing timestamps
          blenderVersion: "5.1.0",
        };
        entries.push(entry);
        cache.put(entry);
      }

      // After eviction, the most recent entries should still be accessible
      const lastEntry = entries[entries.length - 1];
      const result = cache.get(lastEntry.identifier);
      expect(result).not.toBeNull();

      // The cache file should be within the size limit
      const stats = cache.getStats();
      expect(stats.sizeBytes).toBeLessThanOrEqual(tinyMaxSize);
    });
  });

  /**
   * Property 20: Cache version invalidation
   *
   * When the Blender version changes, all cached entries become inaccessible.
   */
  describe("Property 20: Cache version invalidation", () => {
    it("version change invalidates all previously cached entries", () => {
      fc.assert(
        fc.property(entryArb, (entry) => {
          const cache1 = new DocCache("5.1.0", cacheFilePath);
          cache1.put(entry);

          // Verify entry is accessible
          expect(cache1.get(entry.identifier)).not.toBeNull();

          // Create cache with different version — should not find the entry
          const cache2 = new DocCache("5.2.0", cacheFilePath);
          const result = cache2.get(entry.identifier);
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });

    it("invalidateAll clears all entries", () => {
      fc.assert(
        fc.property(entryListArb, (entries) => {
          const cache = new DocCache("5.1.0", cacheFilePath);
          for (const entry of entries) {
            cache.put(entry);
          }

          cache.invalidateAll();

          for (const entry of entries) {
            expect(cache.get(entry.identifier)).toBeNull();
          }
        }),
        { numRuns: 100 },
      );
    });

    it("setBlenderVersion invalidates when version differs", () => {
      const cache = new DocCache("5.1.0", cacheFilePath);
      cache.put({
        identifier: "bpy.types.Object",
        content: "Object documentation",
        fetchedAt: Date.now(),
        blenderVersion: "5.1.0",
      });

      expect(cache.get("bpy.types.Object")).not.toBeNull();

      cache.setBlenderVersion("5.2.0");
      expect(cache.get("bpy.types.Object")).toBeNull();
    });

    it("setBlenderVersion does not invalidate when version is the same", () => {
      const cache = new DocCache("5.1.0", cacheFilePath);
      cache.put({
        identifier: "bpy.types.Object",
        content: "Object documentation",
        fetchedAt: Date.now(),
        blenderVersion: "5.1.0",
      });

      cache.setBlenderVersion("5.1.0");
      expect(cache.get("bpy.types.Object")).not.toBeNull();
    });
  });
});
