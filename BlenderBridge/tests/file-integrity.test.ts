/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 10: File integrity metadata and reference grouping consistency
 * Feature: blender-bridge-improvements, Property 11: Missing reference list truncation
 * Feature: blender-bridge-improvements, Property 12: External modification timestamp comparison
 *
 * Tests the pure grouping logic, truncation at 500, and timestamp comparison.
 */

import * as fc from "fast-check";
import { MissingRefType } from "../src/types";

/**
 * Groups missing references by type and computes the total.
 * Mirrors the logic in file-integrity.tool.ts response construction.
 */
function groupMissingReferences(
  items: Array<{ type: MissingRefType; name: string; expectedPath: string }>,
): {
  total: number;
  byType: Record<string, number>;
  items: Array<{ type: MissingRefType; name: string; expectedPath: string }>;
} {
  const byType: Record<string, number> = {};
  for (const item of items) {
    const key = `${item.type}s`; // images, fonts, libraries, sounds
    byType[key] = (byType[key] || 0) + 1;
  }

  return {
    total: items.length,
    byType,
    items: items.slice(0, 500),
  };
}

/**
 * Detects external modification by comparing timestamps.
 * Returns true if file-on-disk mtime > last-save time.
 */
function detectExternalModification(diskMtimeMs: number, lastSaveTimeMs: number): boolean {
  return diskMtimeMs > lastSaveTimeMs;
}

describe("file-integrity property tests", () => {
  // --- Generators ---
  const missingRefTypeArb: fc.Arbitrary<MissingRefType> = fc.constantFrom(
    "image" as MissingRefType,
    "font" as MissingRefType,
    "library" as MissingRefType,
    "sound" as MissingRefType,
  );

  const fileNameArb = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-.".split("")),
    { minLength: 1, maxLength: 30 },
  );

  const filePathArb = fc
    .array(fileNameArb, { minLength: 1, maxLength: 4 })
    .map((parts) => "/" + parts.join("/"));

  const missingRefArb = fc.record({
    type: missingRefTypeArb,
    name: fileNameArb,
    expectedPath: filePathArb,
  });

  /**
   * Property 10: File integrity metadata and reference grouping consistency
   *
   * Sum of byType values equals total, and each item type matches a byType key.
   */
  describe("Property 10: File integrity metadata and reference grouping consistency", () => {
    const missingRefListArb = fc.array(missingRefArb, { minLength: 0, maxLength: 50 });

    it("sum of byType values equals total", () => {
      fc.assert(
        fc.property(missingRefListArb, (items) => {
          const result = groupMissingReferences(items);
          const sum = Object.values(result.byType).reduce((a, b) => a + b, 0);
          expect(sum).toBe(result.total);
        }),
        { numRuns: 100 },
      );
    });

    it("each item's type corresponds to a key in byType", () => {
      fc.assert(
        fc.property(missingRefListArb, (items) => {
          const result = groupMissingReferences(items);
          for (const item of items) {
            const key = `${item.type}s`;
            expect(result.byType[key]).toBeDefined();
            expect(result.byType[key]).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("byType has no zero values", () => {
      fc.assert(
        fc.property(missingRefListArb, (items) => {
          const result = groupMissingReferences(items);
          for (const count of Object.values(result.byType)) {
            expect(count).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("total equals the input length", () => {
      fc.assert(
        fc.property(missingRefListArb, (items) => {
          const result = groupMissingReferences(items);
          expect(result.total).toBe(items.length);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 11: Missing reference list truncation
   *
   * For N > 500, items array has exactly 500; total reports the true count.
   * For N <= 500, items.length equals N.
   */
  describe("Property 11: Missing reference list truncation", () => {
    it("items array is capped at 500 for large lists", () => {
      fc.assert(
        fc.property(fc.integer({ min: 501, max: 700 }), (count) => {
          const items = Array.from({ length: count }, (_, i) => ({
            type: "image" as MissingRefType,
            name: `img_${i}`,
            expectedPath: `/path/to/img_${i}.png`,
          }));
          const result = groupMissingReferences(items);
          expect(result.items.length).toBe(500);
          expect(result.total).toBe(count);
        }),
        { numRuns: 100 },
      );
    });

    it("items array equals input for lists <= 500", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 500 }), (count) => {
          const items = Array.from({ length: count }, (_, i) => ({
            type: "font" as MissingRefType,
            name: `font_${i}`,
            expectedPath: `/path/to/font_${i}.ttf`,
          }));
          const result = groupMissingReferences(items);
          expect(result.items.length).toBe(count);
          expect(result.total).toBe(count);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 12: External modification timestamp comparison
   *
   * If disk mtime > last-save time, externalModificationDetected is true.
   * Otherwise false.
   */
  describe("Property 12: External modification timestamp comparison", () => {
    it("returns true when disk mtime > last save time", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 2000000000000 }),
          fc.integer({ min: 1, max: 1000 }),
          (baseTime, delta) => {
            const lastSave = baseTime;
            const diskMtime = baseTime + delta;
            expect(detectExternalModification(diskMtime, lastSave)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("returns false when disk mtime <= last save time", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 2000000000000 }),
          fc.integer({ min: 0, max: 1000 }),
          (baseTime, delta) => {
            const diskMtime = baseTime;
            const lastSave = baseTime + delta;
            expect(detectExternalModification(diskMtime, lastSave)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("returns false when timestamps are equal", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 2000000000000 }), (timestamp) => {
          expect(detectExternalModification(timestamp, timestamp)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
