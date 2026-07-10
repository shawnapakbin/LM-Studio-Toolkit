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
 * Geometry types that do NOT accept the `scale` keyword argument
 * in their bpy.ops primitive_*_add() operator. For these types,
 * scale must be applied after creation via obj.scale.
 */
const GEOMETRY_NO_SCALE_PARAM: ReadonlySet<string> = new Set(["torus"]);

/**
 * Generates Python code to create a Blender object with the specified parameters.
 *
 * The generated code:
 * 1. Imports bpy
 * 2. Calls the appropriate bpy.ops primitive creation operator
 * 3. Passes location, rotation, and (where supported) scale transforms
 * 4. For geometry types that don't accept `scale`, applies it post-creation
 * 5. Renames the active object to the given name
 * 6. Sets a `result` dict with the object's name and type
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

  // Some operators (torus, circle, curve) don't accept `scale` as a keyword arg.
  // For those, we apply scale post-creation via obj.scale.
  const supportsScaleParam = !GEOMETRY_NO_SCALE_PARAM.has(geometryType);

  const lines = ["import bpy", "", `# Create ${geometryType} primitive`];

  if (supportsScaleParam) {
    lines.push(
      `${opsCall}(`,
      `    location=${locationStr},`,
      `    rotation=${rotationStr},`,
      `    scale=${scaleStr}`,
      ")",
    );
  } else {
    lines.push(`${opsCall}(`, `    location=${locationStr},`, `    rotation=${rotationStr}`, ")");
  }

  lines.push(
    "",
    "# Rename active object",
    "obj = bpy.context.active_object",
    `obj.name = "${escapedName}"`,
  );

  // Apply scale post-creation for geometry types that don't support it as a parameter
  if (!supportsScaleParam) {
    lines.push(
      "",
      "# Apply scale post-creation (operator does not accept scale keyword)",
      `obj.scale = ${scaleStr}`,
    );
  }

  lines.push("", `result = {"name": obj.name, "type": obj.type}`, "");

  return lines.join("\n");
}
