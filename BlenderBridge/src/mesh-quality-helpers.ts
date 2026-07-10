/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Helper functions for mesh quality scoring.
 * Provides pure computation of quality scores and grade derivation
 * from mesh defect counts.
 *
 * Requirement 6: Mesh Quality Scoring
 */

import { QualityGrade } from "./types";

/**
 * Computes a mesh quality score from defect counts.
 *
 * Formula:
 *   score = 100 - nonManifoldEdges*5 - degenerateFaces*4 - looseVertices*2 - ngons*1
 *   score = clamp(score, 0, 100)
 *
 * @param nonManifoldEdges - Count of non-manifold edges
 * @param degenerateFaces - Count of degenerate faces (area <= 1e-6)
 * @param looseVertices - Count of loose vertices
 * @param ngons - Count of n-gon faces (vertices > 4)
 * @returns Quality score clamped to [0, 100]
 */
export function computeQualityScore(
  nonManifoldEdges: number,
  degenerateFaces: number,
  looseVertices: number,
  ngons: number,
): number {
  let score = 100;
  score -= nonManifoldEdges * 5;
  score -= degenerateFaces * 4;
  score -= looseVertices * 2;
  score -= ngons * 1;
  return Math.max(0, Math.min(100, score));
}

/**
 * Derives a quality grade letter from a numeric quality score.
 *
 * Thresholds:
 *   A: 90-100
 *   B: 80-89
 *   C: 70-79
 *   D: 60-69
 *   F: 0-59
 *
 * @param score - Quality score in range [0, 100]
 * @returns Quality grade letter
 */
export function deriveQualityGrade(score: number): QualityGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
