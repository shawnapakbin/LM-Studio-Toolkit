/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 7: Render statistics numeric formatting
 * Feature: blender-bridge-improvements, Property 15: Performance metrics non-negative integers
 *
 * Tests type-validation-helpers.ts pure functions:
 * formatRenderTime, formatPeakMemory, validateSamples,
 * validateResolution, validateScenePolygonCount, validatePerformanceMetrics.
 */

import * as fc from "fast-check";
import {
  formatPeakMemory,
  formatRenderTime,
  validatePerformanceMetrics,
  validateResolution,
  validateSamples,
  validateScenePolygonCount,
} from "../src/type-validation-helpers";

describe("type-validation property tests", () => {
  /**
   * Property 7 (additional): Individual validation helper correctness
   */
  describe("Property 7: Validation helper functions", () => {
    it("formatRenderTime always returns value with 3 decimal places in [0.001, 86400]", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: -1000, max: 200000, noNaN: true, noDefaultInfinity: true }),
            fc.constant(0),
            fc.constant(-1),
            fc.constant(100000),
          ),
          (value) => {
            const result = formatRenderTime(value);
            expect(result).toBeGreaterThanOrEqual(0.001);
            expect(result).toBeLessThanOrEqual(86400.0);
            // Exactly 3 decimal places
            expect(result).toBe(Number(result.toFixed(3)));
          },
        ),
        { numRuns: 100 },
      );
    });

    it("formatPeakMemory always returns non-negative value with 2 decimal places", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.double({ min: -1000, max: 100000, noNaN: true, noDefaultInfinity: true }),
            fc.constant(0),
            fc.constant(-50),
          ),
          (value) => {
            const result = formatPeakMemory(value);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBe(Number(result.toFixed(2)));
          },
        ),
        { numRuns: 100 },
      );
    });

    it("validateSamples always returns integer >= 1", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -100, max: 1000 }),
            fc.constant(0),
            fc.constant(-5),
            fc.constant(0.5),
            fc.constant(null as unknown as number),
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

    it("validateResolution always returns positive integer", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -100, max: 10000 }),
            fc.constant(0),
            fc.constant(-1),
            fc.constant(null as unknown as number),
          ),
          (value) => {
            const result = validateResolution(value);
            expect(Number.isInteger(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("validateScenePolygonCount always returns non-negative integer", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -1000, max: 1000000 }),
            fc.constant(0),
            fc.constant(-5),
            fc.constant(null as unknown as number),
          ),
          (value) => {
            const result = validateScenePolygonCount(value);
            expect(Number.isInteger(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 15: Performance metrics non-negative integers
   *
   * All memory and scene fields are non-negative integers.
   */
  describe("Property 15: Performance metrics non-negative integers", () => {
    const rawMetricsArb = fc.record({
      memory: fc.record({
        usedMB: fc.oneof(
          fc.double({ min: -100, max: 100000, noNaN: true, noDefaultInfinity: true }),
          fc.constant(null as unknown as number),
        ),
        totalMB: fc.oneof(
          fc.double({ min: -100, max: 100000, noNaN: true, noDefaultInfinity: true }),
          fc.constant(null as unknown as number),
        ),
      }),
      scene: fc.record({
        objectCount: fc.oneof(
          fc.integer({ min: -100, max: 10000 }),
          fc.constant(null as unknown as number),
        ),
        polygonCount: fc.oneof(
          fc.integer({ min: -100, max: 1000000 }),
          fc.constant(null as unknown as number),
        ),
        vertexCount: fc.oneof(
          fc.integer({ min: -100, max: 1000000 }),
          fc.constant(null as unknown as number),
        ),
        materialCount: fc.oneof(
          fc.integer({ min: -100, max: 1000 }),
          fc.constant(null as unknown as number),
        ),
      }),
      gpuAvailable: fc.boolean(),
      gpu: fc.option(
        fc.record({
          deviceName: fc.string({ minLength: 0, maxLength: 300 }),
          memoryUsageMB: fc.oneof(
            fc.double({ min: -100, max: 100000, noNaN: true, noDefaultInfinity: true }),
            fc.constant(null as unknown as number),
          ),
        }),
        { nil: undefined },
      ),
    });

    it("memory.usedMB is a non-negative integer", () => {
      fc.assert(
        fc.property(rawMetricsArb, (raw) => {
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(Number.isInteger(result.memory.usedMB)).toBe(true);
          expect(result.memory.usedMB).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("memory.totalMB is a non-negative integer", () => {
      fc.assert(
        fc.property(rawMetricsArb, (raw) => {
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(Number.isInteger(result.memory.totalMB)).toBe(true);
          expect(result.memory.totalMB).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("scene.objectCount is a non-negative integer", () => {
      fc.assert(
        fc.property(rawMetricsArb, (raw) => {
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(Number.isInteger(result.scene.objectCount)).toBe(true);
          expect(result.scene.objectCount).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("scene.polygonCount is a non-negative integer", () => {
      fc.assert(
        fc.property(rawMetricsArb, (raw) => {
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(Number.isInteger(result.scene.polygonCount)).toBe(true);
          expect(result.scene.polygonCount).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("scene.vertexCount is a non-negative integer", () => {
      fc.assert(
        fc.property(rawMetricsArb, (raw) => {
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(Number.isInteger(result.scene.vertexCount)).toBe(true);
          expect(result.scene.vertexCount).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("scene.materialCount is a non-negative integer", () => {
      fc.assert(
        fc.property(rawMetricsArb, (raw) => {
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(Number.isInteger(result.scene.materialCount)).toBe(true);
          expect(result.scene.materialCount).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 100 },
      );
    });

    it("success is always true from validatePerformanceMetrics", () => {
      fc.assert(
        fc.property(rawMetricsArb, (raw) => {
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
