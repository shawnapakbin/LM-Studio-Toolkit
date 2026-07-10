/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Helper functions for validating and normalizing performance metrics
 * and render statistics values.
 *
 * Requirements 3, 7: Render Statistics and Performance Metrics validation
 */

import { PerformanceMetricsResult, RenderStatistics } from "./types";

/**
 * Formats a render time value to exactly 3 decimal places,
 * clamped to [0.001, 86400.000].
 */
export function formatRenderTime(value: unknown): number {
  const num = Number(value) || 0;
  const clamped = Math.max(0.001, Math.min(86400.0, num));
  return Number(clamped.toFixed(3));
}

/**
 * Formats a peak memory value to exactly 2 decimal places.
 * Returns 0.00 for invalid/negative values.
 */
export function formatPeakMemory(value: unknown): number {
  const num = Number(value) || 0;
  return Number(Math.max(0, num).toFixed(2));
}

/**
 * Validates a samples count is an integer >= 1.
 * Returns 1 for invalid values.
 */
export function validateSamples(value: unknown): number {
  const num = Math.round(Number(value) || 0);
  return Math.max(1, num);
}

/**
 * Validates a resolution dimension is a positive integer.
 * Returns 1 for invalid values.
 */
export function validateResolution(value: unknown): number {
  const num = Math.round(Number(value) || 0);
  return Math.max(1, num);
}

/**
 * Validates a scene polygon count is a non-negative integer.
 * Returns 0 for invalid/negative values.
 */
export function validateScenePolygonCount(value: unknown): number {
  const num = Math.round(Number(value) || 0);
  return Math.max(0, num);
}

/**
 * Validates and normalizes a PerformanceMetricsResult from raw Blender output.
 * Ensures all numeric fields are non-negative integers and GPU device name
 * is truncated to 256 characters.
 */
export function validatePerformanceMetrics(raw: Record<string, unknown>): PerformanceMetricsResult {
  const memory = (raw.memory as Record<string, unknown>) || {};
  const scene = (raw.scene as Record<string, unknown>) || {};
  const gpuAvailable = Boolean(raw.gpuAvailable);

  const result: PerformanceMetricsResult = {
    success: true,
    memory: {
      usedMB: Math.max(0, Math.round(Number(memory.usedMB) || 0)),
      totalMB: Math.max(0, Math.round(Number(memory.totalMB) || 0)),
    },
    scene: {
      objectCount: Math.max(0, Math.round(Number(scene.objectCount) || 0)),
      polygonCount: Math.max(0, Math.round(Number(scene.polygonCount) || 0)),
      vertexCount: Math.max(0, Math.round(Number(scene.vertexCount) || 0)),
      materialCount: Math.max(0, Math.round(Number(scene.materialCount) || 0)),
    },
    gpuAvailable,
  };

  if (gpuAvailable && raw.gpu) {
    const gpu = raw.gpu as Record<string, unknown>;
    const deviceName = String(gpu.deviceName || "Unknown GPU");
    result.gpu = {
      deviceName: deviceName.slice(0, 256),
      memoryUsageMB: Math.max(0, Math.round(Number(gpu.memoryUsageMB) || 0)),
    };
  }

  return result;
}

/**
 * Validates and normalizes RenderStatistics from raw Blender output.
 * Ensures proper numeric formatting according to Requirement 3.
 */
export function validateRenderStatistics(raw: Record<string, unknown>): RenderStatistics {
  const stats: RenderStatistics = {
    renderTimeSeconds: formatRenderTime(raw.renderTimeSeconds),
    samples: validateSamples(raw.samples),
    peakMemoryMB: formatPeakMemory(raw.peakMemoryMB),
    engineName: String(raw.engineName || "UNKNOWN"),
    resolutionWidth: validateResolution(raw.resolutionWidth),
    resolutionHeight: validateResolution(raw.resolutionHeight),
    scenePolygonCount: validateScenePolygonCount(raw.scenePolygonCount),
    gpuAvailable: Boolean(raw.gpuAvailable),
  };

  if (raw.gpuAvailable && raw.gpuDeviceName) {
    stats.gpuDeviceName = String(raw.gpuDeviceName);
  }
  if (raw.gpuAvailable && raw.gpuMemoryMB != null) {
    stats.gpuMemoryMB = formatPeakMemory(raw.gpuMemoryMB);
  }

  return stats;
}
