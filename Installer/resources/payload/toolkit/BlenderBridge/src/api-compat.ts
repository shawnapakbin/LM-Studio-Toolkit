/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Blender API compatibility mappings for handling breaking changes
 * between Blender versions (particularly 4.x → 5.x).
 *
 * This module provides:
 *   - A mapping table of known API breaking changes
 *   - A function to apply compatibility transformations to Python code
 *     based on the detected Blender version
 */

/**
 * Describes a single API compatibility mapping from a deprecated pattern
 * to its replacement in newer Blender versions.
 */
export interface ApiMapping {
  /** Regex pattern matching the deprecated API usage in Python code. */
  pattern: RegExp;
  /** Replacement string (may include regex capture group references). */
  replacement: string;
  /** Human-readable description of what changed. */
  description: string;
  /** Minimum Blender version [major, minor, patch] where this mapping applies. */
  minVersion: [number, number, number];
}

/**
 * Known API breaking changes between Blender 4.x and 5.x.
 *
 * Each mapping specifies a regex pattern for the deprecated usage,
 * the replacement, and the minimum version where the change applies.
 */
const API_COMPATIBILITY_MAPPINGS: ApiMapping[] = [
  // Export operator renames (4.x → 5.x)
  {
    pattern: /bpy\.ops\.export_mesh\.stl\b/g,
    replacement: "bpy.ops.wm.stl_export",
    description:
      "STL export operator moved from export_mesh.stl to wm.stl_export in Blender 5.x",
    minVersion: [5, 0, 0],
  },
  {
    pattern: /bpy\.ops\.export_mesh\.obj\b/g,
    replacement: "bpy.ops.wm.obj_export",
    description:
      "OBJ export operator moved from export_mesh.obj to wm.obj_export in Blender 5.x",
    minVersion: [5, 0, 0],
  },
  {
    pattern: /bpy\.ops\.export_mesh\.ply\b/g,
    replacement: "bpy.ops.wm.ply_export",
    description:
      "PLY export operator moved from export_mesh.ply to wm.ply_export in Blender 5.x",
    minVersion: [5, 0, 0],
  },
  // Modifier type rename: SUBSURF → SUBDIVISION (5.x)
  {
    pattern: /type\s*=\s*['"]SUBSURF['"]/g,
    replacement: "type='SUBDIVISION'",
    description:
      "Subdivision modifier type renamed from SUBSURF to SUBDIVISION in Blender 5.x",
    minVersion: [5, 0, 0],
  },
  // Shade smooth operator rename (5.x)
  {
    pattern: /bpy\.ops\.object\.shade_smooth\b(?!_by_angle)/g,
    replacement: "bpy.ops.object.shade_smooth_by_angle",
    description:
      "shade_smooth operator replaced by shade_smooth_by_angle in Blender 5.x",
    minVersion: [5, 0, 0],
  },
];

/**
 * Returns the full list of API compatibility mappings.
 * Useful for inspection, testing, or custom filtering.
 */
export function getApiCompatibilityMappings(): ApiMapping[] {
  return API_COMPATIBILITY_MAPPINGS;
}

/**
 * Compares a Blender version tuple against a minimum required version.
 * Returns true if `version` is greater than or equal to `minVersion`.
 */
function versionAtLeast(
  version: [number, number, number],
  minVersion: [number, number, number],
): boolean {
  if (version[0] !== minVersion[0]) return version[0] > minVersion[0];
  if (version[1] !== minVersion[1]) return version[1] > minVersion[1];
  return version[2] >= minVersion[2];
}

/**
 * Applies API compatibility mappings to Python code based on the detected
 * Blender version. Only modifies code containing deprecated patterns for
 * the given version — standard code passes through character-for-character.
 *
 * @param code - The Python code string to transform
 * @param version - The detected Blender version as [major, minor, patch]
 * @returns The transformed code with deprecated APIs replaced, or the
 *          original code unchanged if no mappings apply
 */
export function applyCompatibilityLayer(
  code: string,
  version: [number, number, number],
): string {
  let result = code;

  for (const mapping of API_COMPATIBILITY_MAPPINGS) {
    if (versionAtLeast(version, mapping.minVersion)) {
      // Reset lastIndex for global regexes to ensure clean matching
      mapping.pattern.lastIndex = 0;
      result = result.replace(mapping.pattern, mapping.replacement);
    }
  }

  return result;
}
