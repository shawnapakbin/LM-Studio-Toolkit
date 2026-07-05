/**
 * Python code generator for scene summary extraction.
 * Produces code that iterates through the Blender scene to build
 * a hierarchy of objects, captures the active object, and gathers
 * render settings.
 */

/**
 * Generates Python code that extracts a full scene summary from Blender.
 * The generated code sets a `result` dict containing:
 * - objects: list of {name, type, parent} for each scene object
 * - activeObject: name of the active object (or null)
 * - renderSettings: resolution, engine, and output format
 */
export function generateSceneSummaryCode(): string {
  return `import bpy

scene = bpy.context.scene

# Build object hierarchy
objects = []
for obj in scene.objects:
    objects.append({
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None
    })

# Get active object
active_obj = bpy.context.active_object
active_object_name = active_obj.name if active_obj else None

# Get render settings
render = scene.render
render_settings = {
    "resolution_x": render.resolution_x,
    "resolution_y": render.resolution_y,
    "engine": render.engine,
    "output_format": render.image_settings.file_format
}

result = {
    "objects": objects,
    "activeObject": active_object_name,
    "renderSettings": render_settings
}
`;
}
