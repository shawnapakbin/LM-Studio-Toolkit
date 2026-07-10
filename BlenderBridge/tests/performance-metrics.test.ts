/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 15: Performance metrics non-negative integers
 * Feature: blender-bridge-improvements, Property 16: GPU device name length constraint
 *
 * Tests validatePerformanceMetrics() for numeric correctness
 * and GPU device name truncation at 256 characters.
 */

import * as fc from "fast-check";
import { validatePerformanceMetrics } from "../src/type-validation-helpers";

describe("performance-metrics property tests", () => {
  // --- Generators ---
  const rawMetricsArb = fc.record({
    memory: fc.record({
      usedMB: fc.oneof(
        fc.double({ min: -500, max: 200000, noNaN: true, noDefaultInfinity: true }),
        fc.constant(0),
      ),
      totalMB: fc.oneof(
        fc.double({ min: -500, max: 200000, noNaN: true, noDefaultInfinity: true }),
        fc.constant(0),
      ),
    }),
    scene: fc.record({
      objectCount: fc.oneof(fc.integer({ min: -100, max: 100000 }), fc.constant(0)),
      polygonCount: fc.oneof(fc.integer({ min: -100, max: 10000000 }), fc.constant(0)),
      vertexCount: fc.oneof(fc.integer({ min: -100, max: 10000000 }), fc.constant(0)),
      materialCount: fc.oneof(fc.integer({ min: -100, max: 10000 }), fc.constant(0)),
    }),
    gpuAvailable: fc.boolean(),
    gpu: fc.option(
      fc.record({
        deviceName: fc.string({ minLength: 0, maxLength: 500 }),
        memoryUsageMB: fc.oneof(
          fc.double({ min: -100, max: 100000, noNaN: true, noDefaultInfinity: true }),
          fc.constant(0),
        ),
      }),
      { nil: undefined },
    ),
  });

  /**
   * Property 15: Performance metrics non-negative integers
   */
  describe("Property 15: Performance metrics non-negative integers", () => {
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
  });

  /**
   * Property 16: GPU device name length constraint
   *
   * gpu.deviceName is at most 256 characters. If raw name exceeds 256,
   * it is truncated.
   */
  describe("Property 16: GPU device name length constraint", () => {
    it("gpu.deviceName is at most 256 characters when GPU is available", () => {
      fc.assert(
        fc.property(
          fc.record({
            memory: fc.record({
              usedMB: fc.constant(1024),
              totalMB: fc.constant(8192),
            }),
            scene: fc.record({
              objectCount: fc.constant(10),
              polygonCount: fc.constant(1000),
              vertexCount: fc.constant(500),
              materialCount: fc.constant(3),
            }),
            gpuAvailable: fc.constant(true),
            gpu: fc.record({
              deviceName: fc.string({ minLength: 0, maxLength: 500 }),
              memoryUsageMB: fc.constant(4096),
            }),
          }),
          (raw) => {
            const result = validatePerformanceMetrics(raw as Record<string, unknown>);
            if (result.gpu) {
              expect(result.gpu.deviceName.length).toBeLessThanOrEqual(256);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("long device names are truncated to exactly 256 characters", () => {
      const longName = "A".repeat(300);
      const raw = {
        memory: { usedMB: 1024, totalMB: 8192 },
        scene: { objectCount: 10, polygonCount: 1000, vertexCount: 500, materialCount: 3 },
        gpuAvailable: true,
        gpu: { deviceName: longName, memoryUsageMB: 4096 },
      };
      const result = validatePerformanceMetrics(raw as Record<string, unknown>);
      expect(result.gpu).toBeDefined();
      expect(result.gpu!.deviceName.length).toBe(256);
    });

    it("device names <= 256 chars are preserved unchanged", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 256 }), (deviceName) => {
          const raw = {
            memory: { usedMB: 1024, totalMB: 8192 },
            scene: { objectCount: 10, polygonCount: 1000, vertexCount: 500, materialCount: 3 },
            gpuAvailable: true,
            gpu: { deviceName, memoryUsageMB: 4096 },
          };
          const result = validatePerformanceMetrics(raw as Record<string, unknown>);
          expect(result.gpu).toBeDefined();
          expect(result.gpu!.deviceName).toBe(deviceName);
        }),
        { numRuns: 100 },
      );
    });

    it("gpu.memoryUsageMB is a non-negative integer when GPU is available", () => {
      fc.assert(
        fc.property(
          fc.record({
            memory: fc.record({
              usedMB: fc.constant(1024),
              totalMB: fc.constant(8192),
            }),
            scene: fc.record({
              objectCount: fc.constant(10),
              polygonCount: fc.constant(1000),
              vertexCount: fc.constant(500),
              materialCount: fc.constant(3),
            }),
            gpuAvailable: fc.constant(true),
            gpu: fc.record({
              deviceName: fc.constant("Test GPU"),
              memoryUsageMB: fc.oneof(
                fc.double({ min: -100, max: 100000, noNaN: true, noDefaultInfinity: true }),
                fc.constant(0),
              ),
            }),
          }),
          (raw) => {
            const result = validatePerformanceMetrics(raw as Record<string, unknown>);
            if (result.gpu) {
              expect(Number.isInteger(result.gpu.memoryUsageMB)).toBe(true);
              expect(result.gpu.memoryUsageMB).toBeGreaterThanOrEqual(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("gpu field is absent when gpuAvailable is false", () => {
      const raw = {
        memory: { usedMB: 1024, totalMB: 8192 },
        scene: { objectCount: 10, polygonCount: 1000, vertexCount: 500, materialCount: 3 },
        gpuAvailable: false,
      };
      const result = validatePerformanceMetrics(raw as Record<string, unknown>);
      expect(result.gpu).toBeUndefined();
    });
  });
});
