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
import mathutils

render = bpy.context.scene.render

# Set resolution
render.resolution_x = ${width}
render.resolution_y = ${height}
render.resolution_percentage = 100

# Set output format
render.image_settings.file_format = "PNG"

# Set output path
render.filepath = "${outputPath}"

# Ensure a camera exists before rendering
if bpy.context.scene.camera is None:
    # Calculate bounding box of all visible mesh objects
    min_coord = mathutils.Vector((float('inf'), float('inf'), float('inf')))
    max_coord = mathutils.Vector((float('-inf'), float('-inf'), float('-inf')))
    has_objects = False
    for obj in bpy.context.scene.objects:
        if obj.visible_get() and obj.type == 'MESH':
            has_objects = True
            for corner in obj.bound_box:
                world_corner = obj.matrix_world @ mathutils.Vector(corner)
                min_coord.x = min(min_coord.x, world_corner.x)
                min_coord.y = min(min_coord.y, world_corner.y)
                min_coord.z = min(min_coord.z, world_corner.z)
                max_coord.x = max(max_coord.x, world_corner.x)
                max_coord.y = max(max_coord.y, world_corner.y)
                max_coord.z = max(max_coord.z, world_corner.z)
    if not has_objects:
        min_coord = mathutils.Vector((-1, -1, -1))
        max_coord = mathutils.Vector((1, 1, 1))
    # Position camera at 1.5x diagonal distance from center
    center = (min_coord + max_coord) / 2
    diagonal = (max_coord - min_coord).length
    distance = diagonal * 1.5
    cam_data = bpy.data.cameras.new(name="TempPreviewCamera")
    cam_obj = bpy.data.objects.new(name="TempPreviewCamera", object_data=cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = center + mathutils.Vector((distance * 0.5, -distance * 0.7, distance * 0.5))
    direction = center - cam_obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam_obj.rotation_euler = rot_quat.to_euler()
    bpy.context.scene.camera = cam_obj

# Render
bpy.ops.render.render(write_still=True)

result = {
    "filePath": "${outputPath}"
}
`;
}
