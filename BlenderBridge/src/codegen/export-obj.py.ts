/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Python code generator for OBJ export.
 * Produces code that exports the active object as an OBJ file
 * using the Blender 4.0+ wm.obj_export operator.
 */

import { ExportObjParams } from "../types";

/**
 * Generates Python code that exports the active object as OBJ.
 * The generated code:
 * - Checks if there's an active object
 * - Exports using bpy.ops.wm.obj_export (Blender 4.0+ API)
 * - Sets `result` dict with file path and object name
 */
export function generateExportObjCode(params: ExportObjParams): string {
  const outputPath = params.outputPath.replace(/\\/g, "/");

  return `import bpy

active_obj = bpy.context.active_object

if active_obj is None:
    raise Exception("No active object selected for export")

# Ensure the active object is selected for export
active_obj.select_set(True)

# Export active object as OBJ (Blender 4.0+ API)
bpy.ops.wm.obj_export(
    filepath="${outputPath}",
    export_selected_objects=True
)

result = {
    "filePath": "${outputPath}",
    "objectName": active_obj.name
}
`;
}
