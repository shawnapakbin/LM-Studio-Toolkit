/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 7: Render statistics numeric formatting
 *
 * Tests validateRenderStatistics() for proper numeric formatting:
 * - renderTimeSeconds: 3 decimal places, [0.001, 86400.000]
 * - peakMemoryMB: 2 decimal places
 * - samples: integer >= 1
 * - resolutionWidth/Height: positive integers
 * - scenePolygonCount: non-negative integer
 */

import * as fc from "fast-check";
import {
  formatPeakMemory,
  formatRenderTime,
  validateRenderStatistics,
  validateSamples,
} from "../src/type-validation-helpers";

describe("render-stats property tests", () => {
  /**
   * Property 7: Render statistics numeric formatting
   */
  describe("Property 7: Render statistics numeric formatting", () => {
    const rawStatsArb = fc.record({
      renderTimeSeconds: fc.oneof(
        fc.double({ min: -100, max: 100000, noNaN: true, noDefaultInfinity: true }),
        fc.constant(0),
        fc.constant(null as unknown as number),
        fc.constant(undefined as unknown as number),
      ),
      samples: fc.oneof(
        fc.integer({ min: -10, max: 1000 }),
        fc.constant(0),
        fc.constant(null as unknown as number),
      ),
      peakMemoryMB: fc.oneof(
        fc.double({ min: -100, max: 10000, noNaN: true, noDefaultInfinity: true }),
        fc.constant(0),
        fc.constant(null as unknown as number),
      ),
      engineName: fc.oneof(fc.constantFrom("CYCLES", "EEVEE", "WORKBENCH"), fc.constant(null)),
      resolutionWidth: fc.oneof(
        fc.integer({ min: -10, max: 8000 }),
        fc.constant(0),
        fc.constant(null as unknown as number),
      ),
      resolutionHeight: fc.oneof(
        fc.integer({ min: -10, max: 8000 }),
        fc.constant(0),
        fc.constant(null as unknown as number),
      ),
      scenePolygonCount: fc.oneof(
        fc.integer({ min: -100, max: 1000000 }),
        fc.constant(0),
        fc.constant(null as unknown as number),
      ),
      gpuAvailable: fc.boolean(),
    });

    it("renderTimeSeconds has exactly 3 decimal places", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          const str = stats.renderTimeSeconds.toString();
          // If no decimal point, it should be a whole number with .000
          const _decimalPart = str.split(".")[1] || "";
          // formatRenderTime uses toFixed(3), result should parse back to same
          expect(stats.renderTimeSeconds).toBe(Number(stats.renderTimeSeconds.toFixed(3)));
        }),
        { numRuns: 100 },
      );
    });

    it("renderTimeSeconds is in range [0.001, 86400.000]", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          expect(stats.renderTimeSeconds).toBeGreaterThanOrEqual(0.001);
          expect(stats.renderTimeSeconds).toBeLessThanOrEqual(86400.0);
        }),
        { numRuns: 100 },
      );
    });

    it("peakMemoryMB has exactly 2 decimal places", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          expect(stats.peakMemoryMB).toBe(Number(stats.peakMemoryMB.toFixed(2)));
        }),
        { numRuns: 100 },
      );
    });

    it("peakMemoryMB is non-negative", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          expect(stats.peakMemoryMB).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("samples is an integer >= 1", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          expect(Number.isInteger(stats.samples)).toBe(true);
          expect(stats.samples).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 100 },
      );
    });

    it("resolutionWidth is a positive integer", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          expect(Number.isInteger(stats.resolutionWidth)).toBe(true);
          expect(stats.resolutionWidth).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 100 },
      );
    });

    it("resolutionHeight is a positive integer", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          expect(Number.isInteger(stats.resolutionHeight)).toBe(true);
          expect(stats.resolutionHeight).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 100 },
      );
    });

    it("scenePolygonCount is a non-negative integer", () => {
      fc.assert(
        fc.property(rawStatsArb, (raw) => {
          const stats = validateRenderStatistics(raw as Record<string, unknown>);
          expect(Number.isInteger(stats.scenePolygonCount)).toBe(true);
          expect(stats.scenePolygonCount).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("formatRenderTime clamps values correctly", () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1000, max: 100000, noNaN: true, noDefaultInfinity: true }),
          (value) => {
            const result = formatRenderTime(value);
            expect(result).toBeGreaterThanOrEqual(0.001);
            expect(result).toBeLessThanOrEqual(86400.0);
            expect(result).toBe(Number(result.toFixed(3)));
          },
        ),
        { numRuns: 100 },
      );
    });

    it("formatPeakMemory returns non-negative with 2 decimal places", () => {
      fc.assert(
        fc.property(
          fc.double({ min: -1000, max: 100000, noNaN: true, noDefaultInfinity: true }),
          (value) => {
            const result = formatPeakMemory(value);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBe(Number(result.toFixed(2)));
          },
        ),
        { numRuns: 100 },
      );
    });

    it("validateSamples returns integer >= 1", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -100, max: 1000 }),
            fc.constant(0),
            fc.double({ min: -10, max: 100, noNaN: true, noDefaultInfinity: true }),
          ),
          (value) => {
            const result = validateSamples(value);
            expect(Number.isInteger(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(1);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
