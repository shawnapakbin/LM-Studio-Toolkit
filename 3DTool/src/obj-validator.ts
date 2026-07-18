import { ValidationEntry, ValidationReport } from "./types";

/**
 * Maximum number of error/warning entries to report.
 * Prevents excessively large reports for heavily malformed files.
 */
const MAX_ENTRIES = 50;

/**
 * Valid OBJ keyword prefixes. Lines must start with one of these,
 * be a comment (starting with #), or be blank.
 */
const VALID_KEYWORDS = new Set(["v", "vt", "vn", "f", "g", "o", "s", "usemtl", "mtllib"]);

/**
 * Validates OBJ file content and returns a structured report.
 *
 * Algorithm:
 * 1. First pass: count all `v ` lines to determine maxVertexIndex
 * 2. Second pass: validate face indices, detect syntax errors,
 *    track vertex references for orphan detection, and check face winding.
 * 3. Cap total entries at 50.
 */
export function validateObj(content: string): ValidationReport {
  const lines = content.split(/\r?\n/);
  const errors: ValidationEntry[] = [];
  const warnings: ValidationEntry[] = [];

  // --- First pass: count vertices ---
  let maxVertexIndex = 0;
  const vertexPositions: { x: number; y: number; z: number }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines that start with "v " (vertex position, not vt or vn)
    if (trimmed.startsWith("v ") || trimmed.startsWith("v\t")) {
      maxVertexIndex++;
      const parts = trimmed.split(/\s+/);
      const x = parseFloat(parts[1]) || 0;
      const y = parseFloat(parts[2]) || 0;
      const z = parseFloat(parts[3]) || 0;
      vertexPositions.push({ x, y, z });
    }
  }

  // --- Second pass: validate all lines ---
  const referencedVertices = new Set<number>();
  const faceNormals: { x: number; y: number; z: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (errors.length + warnings.length >= MAX_ENTRIES) break;

    const lineNum = i + 1;
    const trimmed = lines[i].trim();

    // Blank lines and comments are always valid
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Extract keyword (first whitespace-delimited token)
    const spaceIdx = trimmed.search(/\s/);
    const keyword = spaceIdx === -1 ? trimmed : trimmed.substring(0, spaceIdx);

    if (!VALID_KEYWORDS.has(keyword)) {
      errors.push({
        line: lineNum,
        message: `Unrecognized OBJ keyword: "${keyword}"`,
        severity: "error",
      });
      continue;
    }

    // Validate face lines
    if (keyword === "f") {
      const faceResult = validateFaceLine(
        trimmed,
        lineNum,
        maxVertexIndex,
        referencedVertices,
        vertexPositions,
        errors,
      );
      if (faceResult) {
        faceNormals.push(faceResult);
      }
    }
  }

  // --- Orphan vertex detection ---
  if (errors.length + warnings.length < MAX_ENTRIES) {
    for (let vi = 1; vi <= maxVertexIndex; vi++) {
      if (errors.length + warnings.length >= MAX_ENTRIES) break;
      if (!referencedVertices.has(vi)) {
        warnings.push({
          line: findVertexLine(lines, vi),
          message: `Orphan vertex: vertex ${vi} is not referenced by any face`,
          severity: "warning",
        });
      }
    }
  }

  // --- Inconsistent face winding detection ---
  if (faceNormals.length >= 2 && errors.length + warnings.length < MAX_ENTRIES) {
    detectInconsistentWinding(faceNormals, lines, warnings);
  }

  // Enforce cap on total entries
  const cappedErrors = errors.slice(0, MAX_ENTRIES);
  const remainingSlots = MAX_ENTRIES - cappedErrors.length;
  const cappedWarnings = warnings.slice(0, Math.max(0, remainingSlots));

  return {
    valid: cappedErrors.length === 0,
    errors: cappedErrors,
    warnings: cappedWarnings,
  };
}

/**
 * Parses and validates a face line, checking that all vertex indices
 * are within range. Supports OBJ formats:
 *   f v1 v2 v3 ...
 *   f v1/vt1 v2/vt2 ...
 *   f v1/vt1/vn1 v2/vt2/vn1 ...
 *   f v1//vn1 v2//vn2 ...
 *
 * Returns the face normal vector if the face has at least 3 valid vertices,
 * or null if errors were found.
 */
function validateFaceLine(
  line: string,
  lineNum: number,
  maxVertexIndex: number,
  referencedVertices: Set<number>,
  vertexPositions: { x: number; y: number; z: number }[],
  errors: ValidationEntry[],
): { x: number; y: number; z: number } | null {
  const parts = line.split(/\s+/).slice(1); // skip "f" keyword

  if (parts.length < 3) {
    if (errors.length < MAX_ENTRIES) {
      errors.push({
        line: lineNum,
        message: `Face must have at least 3 vertices, found ${parts.length}`,
        severity: "error",
      });
    }
    return null;
  }

  const resolvedIndices: number[] = [];
  let hasError = false;

  for (const part of parts) {
    // Extract vertex index (first component before any slash)
    const vertexStr = part.split("/")[0];
    const vertexIdx = parseInt(vertexStr, 10);

    if (isNaN(vertexIdx) || vertexIdx === 0) {
      if (errors.length < MAX_ENTRIES) {
        errors.push({
          line: lineNum,
          message: `Invalid vertex index "${vertexStr}" in face`,
          severity: "error",
        });
      }
      hasError = true;
      continue;
    }

    // Resolve negative indices (OBJ spec: -1 = last vertex)
    let resolved: number;
    if (vertexIdx < 0) {
      resolved = maxVertexIndex + vertexIdx + 1;
    } else {
      resolved = vertexIdx;
    }

    // Check bounds
    if (resolved < 1 || resolved > maxVertexIndex) {
      if (errors.length < MAX_ENTRIES) {
        errors.push({
          line: lineNum,
          message: `Face references vertex index ${vertexIdx} (resolved to ${resolved}), but only ${maxVertexIndex} vertices exist`,
          severity: "error",
        });
      }
      hasError = true;
      continue;
    }

    referencedVertices.add(resolved);
    resolvedIndices.push(resolved);
  }

  if (hasError || resolvedIndices.length < 3) {
    return null;
  }

  // Compute face normal from first three vertices using cross product
  const v0 = vertexPositions[resolvedIndices[0] - 1];
  const v1 = vertexPositions[resolvedIndices[1] - 1];
  const v2 = vertexPositions[resolvedIndices[2] - 1];

  if (!v0 || !v1 || !v2) return null;

  const edge1 = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z };
  const edge2 = { x: v2.x - v0.x, y: v2.y - v0.y, z: v2.z - v0.z };

  const normal = {
    x: edge1.y * edge2.z - edge1.z * edge2.y,
    y: edge1.z * edge2.x - edge1.x * edge2.z,
    z: edge1.x * edge2.y - edge1.y * edge2.x,
  };

  return normal;
}

/**
 * Finds the line number of the nth vertex definition (1-indexed).
 */
function findVertexLine(lines: string[], vertexIndex: number): number {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("v ") || trimmed.startsWith("v\t")) {
      count++;
      if (count === vertexIndex) {
        return i + 1;
      }
    }
  }
  return 1; // fallback
}

/**
 * Detects inconsistent face winding by comparing face normal directions.
 * Uses a simple heuristic: if a significant proportion of face normals
 * point in the opposite direction of the majority, flag a warning.
 *
 * For a consistently wound mesh, all face normals should point "outward."
 * We detect inconsistency by checking if some normals are flipped relative
 * to the average normal direction.
 */
function detectInconsistentWinding(
  faceNormals: { x: number; y: number; z: number }[],
  lines: string[],
  warnings: ValidationEntry[],
): void {
  if (faceNormals.length < 2) return;

  // Normalize all face normals and compute average direction
  const normalized: { x: number; y: number; z: number }[] = [];
  for (const n of faceNormals) {
    const mag = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (mag > 1e-10) {
      normalized.push({ x: n.x / mag, y: n.y / mag, z: n.z / mag });
    }
  }

  if (normalized.length < 2) return;

  // Compute average normal direction
  let avgX = 0,
    avgY = 0,
    avgZ = 0;
  for (const n of normalized) {
    avgX += n.x;
    avgY += n.y;
    avgZ += n.z;
  }
  const avgMag = Math.sqrt(avgX * avgX + avgY * avgY + avgZ * avgZ);
  if (avgMag < 1e-10) return; // normals cancel out completely - definitely inconsistent

  avgX /= avgMag;
  avgY /= avgMag;
  avgZ /= avgMag;

  // Count how many normals point against the average (dot product < 0)
  let flippedCount = 0;
  const flippedFaceIndices: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const dot = normalized[i].x * avgX + normalized[i].y * avgY + normalized[i].z * avgZ;
    if (dot < 0) {
      flippedCount++;
      flippedFaceIndices.push(i);
    }
  }

  // If between 10% and 90% of faces are flipped, flag as inconsistent
  const ratio = flippedCount / normalized.length;
  if (ratio > 0.1 && ratio < 0.9 && flippedCount > 0) {
    // Find line numbers of the first few flipped faces
    const faceLinesInFile = findFaceLines(lines);
    const samplesToReport = Math.min(flippedFaceIndices.length, 3);

    for (let i = 0; i < samplesToReport; i++) {
      if (warnings.length >= MAX_ENTRIES) break;
      const faceIdx = flippedFaceIndices[i];
      const lineNum = faceIdx < faceLinesInFile.length ? faceLinesInFile[faceIdx] : 1;
      warnings.push({
        line: lineNum,
        message: `Inconsistent face winding: face normal direction is opposite to majority`,
        severity: "warning",
      });
    }
  }
}

/**
 * Returns an array of line numbers (1-indexed) for all face lines in the file.
 */
function findFaceLines(lines: string[]): number[] {
  const faceLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("f ") || trimmed.startsWith("f\t")) {
      faceLines.push(i + 1);
    }
  }
  return faceLines;
}
