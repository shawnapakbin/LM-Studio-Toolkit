/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Python code generator for Blender object creation.
 * Produces deterministic bpy.ops calls based on typed parameters.
 */

import { CreateObjectParams } from "../types";

/** Maps geometry types to their corresponding bpy.ops call paths. */
const GEOMETRY_OPS_MAP: Record<CreateObjectParams["geometryType"], string> = {
  cube: "bpy.ops.mesh.primitive_cube_add",
  sphere: "bpy.ops.mesh.primitive_uv_sphere_add",
  cylinder: "bpy.ops.mesh.primitive_cylinder_add",
  cone: "bpy.ops.mesh.primitive_cone_add",
  torus: "bpy.ops.mesh.primitive_torus_add",
  plane: "bpy.ops.mesh.primitive_plane_add",
  circle: "bpy.ops.mesh.primitive_circle_add",
  curve: "bpy.ops.curve.primitive_bezier_curve_add",
  empty: "bpy.ops.object.empty_add",
};

/** Formats a number as a Python float literal (always includes decimal point). */
function toPythonFloat(value: number): string {
  const str = String(value);
  if (str.includes(".") || str.includes("e") || str.includes("E")) {
    return str;
  }
  return str + ".0";
}

/** Formats a 3-tuple as a Python tuple literal. */
function toPythonTuple(values: [number, number, number]): string {
  return `(${toPythonFloat(values[0])}, ${toPythonFloat(values[1])}, ${toPythonFloat(values[2])})`;
}

/**
 * Generates Python code to create a Blender object with the specified parameters.
 *
 * The generated code:
 * 1. Imports bpy
 * 2. Calls the appropriate bpy.ops primitive creation operator
 * 3. Passes location, rotation, and scale transforms
 * 4. Renames the active object to the given name
 * 5. Sets a `result` dict with the object's name and type
 */
export function generateCreateObjectCode(params: CreateObjectParams): string {
  const {
    name,
    geometryType,
    location = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
  } = params;

  const opsCall = GEOMETRY_OPS_MAP[geometryType];
  const locationStr = toPythonTuple(location);
  const rotationStr = toPythonTuple(rotation);
  const scaleStr = toPythonTuple(scale);

  // Escape backslashes and quotes in the name for safe Python string embedding
  const escapedName = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const lines = [
    "import bpy",
    "",
    `# Create ${geometryType} primitive`,
    `${opsCall}(`,
    `    location=${locationStr},`,
    `    rotation=${rotationStr},`,
    `    scale=${scaleStr}`,
    ")",
    "",
    "# Rename active object",
    "obj = bpy.context.active_object",
    `obj.name = "${escapedName}"`,
    "",
    `result = {"name": obj.name, "type": obj.type}`,
    "",
  ];

  return lines.join("\n");
}
