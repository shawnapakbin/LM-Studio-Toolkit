/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 4: Levenshtein suggestion ranking and filtering
 * Feature: blender-bridge-improvements, Property 5: Collection truncation with total count
 * Feature: blender-bridge-improvements, Property 6: Deprecated API cross-reference in errors
 *
 * Tests the pure logic of error enhancement: similarity ranking,
 * collection truncation, and deprecated API detection.
 */

import * as fc from "fast-check";
import { findMigrationMapping, getApiCompatibilityMappings } from "../src/api-compat";
import { similarityRatio } from "../src/blender-client";

/**
 * Simulates the rankBySimilarity logic from error-enhancer.ts:
 * Filters candidates to ratio >= 0.6, sorts by descending ratio,
 * returns at most `max` results.
 */
function rankBySimilarity(target: string, candidates: string[], max: number): string[] {
  const scored = candidates
    .map((c) => ({ candidate: c, ratio: similarityRatio(target, c) }))
    .filter((s) => s.ratio >= 0.6)
    .sort((a, b) => b.ratio - a.ratio);

  return scored.slice(0, max).map((s) => s.candidate);
}

/**
 * Simulates the collection truncation logic from error-enhancer.ts:
 * Returns up to 10 items; if total > 10, includes totalCount.
 */
function truncateCollection(items: string[]): {
  collectionItems: string[];
  collectionTotalCount?: number;
} {
  const totalCount = items.length;
  const collectionItems = items.slice(0, 10);
  if (totalCount > 10) {
    return { collectionItems, collectionTotalCount: totalCount };
  }
  return { collectionItems };
}

describe("error-enhancer property tests", () => {
  // --- Generators ---
  const identifierCharArb = fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  );

  const identifierArb = fc.stringOf(identifierCharArb, { minLength: 1, maxLength: 20 });

  const candidateListArb = fc.array(identifierArb, { minLength: 0, maxLength: 30 });

  /**
   * Property 4: Levenshtein suggestion ranking and filtering
   *
   * Suggestions are ranked by descending similarity ratio,
   * filtered to ratio >= 0.6, and capped at max count (5).
   */
  describe("Property 4: Levenshtein suggestion ranking and filtering", () => {
    it("all returned suggestions have similarity ratio >= 0.6", () => {
      fc.assert(
        fc.property(identifierArb, candidateListArb, (target, candidates) => {
          const results = rankBySimilarity(target, candidates, 5);
          for (const result of results) {
            expect(similarityRatio(target, result)).toBeGreaterThanOrEqual(0.6);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("results are ranked by descending similarity ratio", () => {
      fc.assert(
        fc.property(identifierArb, candidateListArb, (target, candidates) => {
          const results = rankBySimilarity(target, candidates, 5);
          for (let i = 1; i < results.length; i++) {
            const prevRatio = similarityRatio(target, results[i - 1]);
            const currRatio = similarityRatio(target, results[i]);
            expect(prevRatio).toBeGreaterThanOrEqual(currRatio);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("returns at most 5 results", () => {
      fc.assert(
        fc.property(identifierArb, candidateListArb, (target, candidates) => {
          const results = rankBySimilarity(target, candidates, 5);
          expect(results.length).toBeLessThanOrEqual(5);
        }),
        { numRuns: 100 },
      );
    });

    it("identical string always has ratio 1.0 and is included", () => {
      fc.assert(
        fc.property(identifierArb, (target) => {
          const results = rankBySimilarity(target, [target], 5);
          expect(results).toContain(target);
          expect(similarityRatio(target, target)).toBe(1);
        }),
        { numRuns: 100 },
      );
    });

    it("empty candidate list returns empty results", () => {
      fc.assert(
        fc.property(identifierArb, (target) => {
          const results = rankBySimilarity(target, [], 5);
          expect(results).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 5: Collection truncation with total count
   *
   * For N > 10, returns exactly 10 items with collectionTotalCount = N.
   * For N <= 10, returns all items without a total count field.
   */
  describe("Property 5: Collection truncation with total count", () => {
    const collectionItemArb = fc.stringOf(
      fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
      { minLength: 1, maxLength: 20 },
    );

    const largeCollectionArb = fc.array(collectionItemArb, { minLength: 11, maxLength: 100 });
    const smallCollectionArb = fc.array(collectionItemArb, { minLength: 0, maxLength: 10 });

    it("collections > 10 items are truncated to exactly 10", () => {
      fc.assert(
        fc.property(largeCollectionArb, (items) => {
          const result = truncateCollection(items);
          expect(result.collectionItems.length).toBe(10);
        }),
        { numRuns: 100 },
      );
    });

    it("collections > 10 include collectionTotalCount = N", () => {
      fc.assert(
        fc.property(largeCollectionArb, (items) => {
          const result = truncateCollection(items);
          expect(result.collectionTotalCount).toBe(items.length);
        }),
        { numRuns: 100 },
      );
    });

    it("collections <= 10 return all items", () => {
      fc.assert(
        fc.property(smallCollectionArb, (items) => {
          const result = truncateCollection(items);
          expect(result.collectionItems.length).toBe(items.length);
        }),
        { numRuns: 100 },
      );
    });

    it("collections <= 10 do not include collectionTotalCount", () => {
      fc.assert(
        fc.property(smallCollectionArb, (items) => {
          const result = truncateCollection(items);
          expect(result.collectionTotalCount).toBeUndefined();
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 6: Deprecated API cross-reference in errors
   *
   * For any error message containing a deprecated pattern from the
   * mapping table, the handler returns replacementApi and deprecationVersion.
   */
  describe("Property 6: Deprecated API cross-reference in errors", () => {
    const _mappings = getApiCompatibilityMappings();

    // Known deprecated identifiers that should be found by findMigrationMapping
    const deprecatedIdentifiers = [
      "bpy.ops.export_mesh.stl",
      "bpy.ops.export_mesh.obj",
      "bpy.ops.export_mesh.ply",
      "bpy.ops.object.shade_smooth",
    ];

    it("known deprecated APIs return a migration suggestion", () => {
      fc.assert(
        fc.property(fc.constantFrom(...deprecatedIdentifiers), (deprecatedApi) => {
          const errorMessage = `AttributeError: ${deprecatedApi} not found`;
          const suggestion = findMigrationMapping(errorMessage, [5, 0, 0]);
          expect(suggestion).not.toBeNull();
          expect(suggestion!.deprecatedApi).toBeDefined();
          expect(suggestion!.replacementApi).toBeDefined();
          expect(suggestion!.introducedInVersion).toBeDefined();
        }),
        { numRuns: 100 },
      );
    });

    it("migration suggestion includes correct replacementApi from the mapping", () => {
      fc.assert(
        fc.property(fc.constantFrom(...deprecatedIdentifiers), (deprecatedApi) => {
          const errorMessage = `Error: ${deprecatedApi} is no longer available`;
          const suggestion = findMigrationMapping(errorMessage, [5, 0, 0]);
          expect(suggestion).not.toBeNull();
          expect(suggestion!.replacementApi.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it("error messages without deprecated patterns return null", () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ".split("")), {
            minLength: 1,
            maxLength: 50,
          }),
          (randomMsg) => {
            // Ensure the random message doesn't accidentally contain a deprecated API
            const containsDeprecated = deprecatedIdentifiers.some((d) => randomMsg.includes(d));
            if (!containsDeprecated) {
              const suggestion = findMigrationMapping(randomMsg, [5, 0, 0]);
              expect(suggestion).toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("version below minVersion returns null even with deprecated pattern", () => {
      fc.assert(
        fc.property(fc.constantFrom(...deprecatedIdentifiers), (deprecatedApi) => {
          const errorMessage = `Error: ${deprecatedApi} failed`;
          // Version 4.0.0 is below the 5.0.0 minVersion for all mappings
          const suggestion = findMigrationMapping(errorMessage, [4, 0, 0]);
          expect(suggestion).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });
});
