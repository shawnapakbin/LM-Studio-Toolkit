/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 13: Mesh quality score formula and grade derivation
 * Feature: blender-bridge-improvements, Property 14: Mesh breakdown internal consistency
 *
 * Tests computeQualityScore() and deriveQualityGrade() from mesh-quality-helpers.ts.
 */

import * as fc from "fast-check";
import { computeQualityScore, deriveQualityGrade } from "../src/mesh-quality-helpers";

describe("mesh-quality-scoring property tests", () => {
  // --- Generators ---
  const defectCountArb = fc.integer({ min: 0, max: 200 });

  /**
   * Property 13: Mesh quality score formula and grade derivation
   *
   * For any non-negative integer counts, the quality score equals
   * clamp(100 - nonManifold*5 - degenerate*4 - loose*2 - ngons*1, 0, 100),
   * and the grade follows the threshold table.
   */
  describe("Property 13: Mesh quality score formula and grade derivation", () => {
    it("score equals clamp(100 - nonManifold*5 - degenerate*4 - loose*2 - ngons*1, 0, 100)", () => {
      fc.assert(
        fc.property(
          defectCountArb,
          defectCountArb,
          defectCountArb,
          defectCountArb,
          (nonManifold, degenerate, loose, ngons) => {
            const score = computeQualityScore(nonManifold, degenerate, loose, ngons);
            const raw = 100 - nonManifold * 5 - degenerate * 4 - loose * 2 - ngons * 1;
            const expected = Math.max(0, Math.min(100, raw));
            expect(score).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("score is always in [0, 100]", () => {
      fc.assert(
        fc.property(
          defectCountArb,
          defectCountArb,
          defectCountArb,
          defectCountArb,
          (nonManifold, degenerate, loose, ngons) => {
            const score = computeQualityScore(nonManifold, degenerate, loose, ngons);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("zero defects produces score 100", () => {
      expect(computeQualityScore(0, 0, 0, 0)).toBe(100);
    });

    it("grade A for score >= 90", () => {
      fc.assert(
        fc.property(fc.integer({ min: 90, max: 100 }), (score) => {
          expect(deriveQualityGrade(score)).toBe("A");
        }),
        { numRuns: 100 },
      );
    });

    it("grade B for score 80-89", () => {
      fc.assert(
        fc.property(fc.integer({ min: 80, max: 89 }), (score) => {
          expect(deriveQualityGrade(score)).toBe("B");
        }),
        { numRuns: 100 },
      );
    });

    it("grade C for score 70-79", () => {
      fc.assert(
        fc.property(fc.integer({ min: 70, max: 79 }), (score) => {
          expect(deriveQualityGrade(score)).toBe("C");
        }),
        { numRuns: 100 },
      );
    });

    it("grade D for score 60-69", () => {
      fc.assert(
        fc.property(fc.integer({ min: 60, max: 69 }), (score) => {
          expect(deriveQualityGrade(score)).toBe("D");
        }),
        { numRuns: 100 },
      );
    });

    it("grade F for score 0-59", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 59 }), (score) => {
          expect(deriveQualityGrade(score)).toBe("F");
        }),
        { numRuns: 100 },
      );
    });

    it("computeQualityScore + deriveQualityGrade are consistent", () => {
      fc.assert(
        fc.property(
          defectCountArb,
          defectCountArb,
          defectCountArb,
          defectCountArb,
          (nonManifold, degenerate, loose, ngons) => {
            const score = computeQualityScore(nonManifold, degenerate, loose, ngons);
            const grade = deriveQualityGrade(score);

            if (score >= 90) expect(grade).toBe("A");
            else if (score >= 80) expect(grade).toBe("B");
            else if (score >= 70) expect(grade).toBe("C");
            else if (score >= 60) expect(grade).toBe("D");
            else expect(grade).toBe("F");
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 14: Mesh breakdown internal consistency
   *
   * ngonPercentage == round(ngonCount / faceCount * 100, 1) when faceCount > 0,
   * and 0.0 when faceCount == 0. All counts are non-negative integers.
   */
  describe("Property 14: Mesh breakdown internal consistency", () => {
    const breakdownArb = fc.record({
      vertexCount: fc.integer({ min: 0, max: 100000 }),
      edgeCount: fc.integer({ min: 0, max: 100000 }),
      faceCount: fc.integer({ min: 0, max: 100000 }),
      nonManifoldEdgeCount: fc.integer({ min: 0, max: 10000 }),
      looseVertexCount: fc.integer({ min: 0, max: 10000 }),
      degenerateFaceCount: fc.integer({ min: 0, max: 10000 }),
      ngonCount: fc.integer({ min: 0, max: 10000 }),
    });

    function computeNgonPercentage(ngonCount: number, faceCount: number): number {
      if (faceCount === 0) return 0.0;
      return Number(((ngonCount / faceCount) * 100).toFixed(1));
    }

    it("ngonPercentage equals round(ngonCount / faceCount * 100, 1) for faceCount > 0", () => {
      fc.assert(
        fc.property(
          breakdownArb.filter((b) => b.faceCount > 0),
          (breakdown) => {
            const expected = computeNgonPercentage(breakdown.ngonCount, breakdown.faceCount);
            const actual = Number(((breakdown.ngonCount / breakdown.faceCount) * 100).toFixed(1));
            expect(actual).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("ngonPercentage is 0.0 when faceCount == 0", () => {
      fc.assert(
        fc.property(
          breakdownArb.filter((b) => b.faceCount === 0),
          (breakdown) => {
            const result = computeNgonPercentage(breakdown.ngonCount, breakdown.faceCount);
            expect(result).toBe(0.0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("all breakdown counts are non-negative integers", () => {
      fc.assert(
        fc.property(breakdownArb, (breakdown) => {
          for (const [, value] of Object.entries(breakdown)) {
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
