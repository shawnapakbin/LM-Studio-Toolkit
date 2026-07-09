/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Python code generator for rendering a low-resolution preview.
 * Produces code that configures Blender's render settings and
 * outputs a PNG thumbnail at the specified path.
 */

import { RenderPreviewParams } from "../types";

/**
 * Generates Python code that renders a preview image from Blender.
 * The generated code:
 * - Sets resolution to width×height (defaults: 480×270)
 * - Sets output format to PNG
 * - Sets the file path from params.outputPath
 * - Calls bpy.ops.render.render(write_still=True)
 * - Sets `result` dict with the output path
 */
export function generateRenderPreviewCode(params: RenderPreviewParams): string {
  const width = params.width ?? 480;
  const height = params.height ?? 270;
  const outputPath = params.outputPath.replace(/\\/g, "/");

  return `import bpy
import base64
import os

render = bpy.context.scene.render

# Set resolution
render.resolution_x = ${width}
render.resolution_y = ${height}
render.resolution_percentage = 100

# Set output format
render.image_settings.file_format = "PNG"

# Set output path
render.filepath = "${outputPath}"

# Render
bpy.ops.render.render(write_still=True)

# Read and encode the rendered file
imageData = ""
if os.path.exists("${outputPath}"):
    with open("${outputPath}", "rb") as f:
        imageData = base64.b64encode(f.read()).decode("ascii")

result = {
    "filePath": "${outputPath}",
    "imageData": imageData
}
`;
}
