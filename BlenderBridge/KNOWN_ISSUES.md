# BlenderBridge Known Issues & Improvement Backlog

Compiled from real-world usage feedback (Qwen session, July 2026).

## Critical

### 1. Viewport Screenshots Return Blank
All `blender_screenshot_window` / `blender_screenshot_area` calls return blank/white images.
This makes visual verification impossible.

**Root cause:** Likely display server / headless mode limitation in the Blender add-on's
screenshot capture path.

**Suggested fixes:**
- Add fallback render path that saves a viewport thumbnail via Cycles at minimal samples
- Support returning the last rendered image when viewport capture fails
- Document known display server limitations (Wayland, headless, etc.)

### 2. 30-Second Code Execution Timeout Too Short
Operations that legitimately take 30–90s (STL export, pixel analysis, heavy scene summaries)
time out with no way to extend.

**Suggested fixes:**
- Increase default `operationTimeoutMs` to 60000 (60s)
- Add per-tool timeout overrides for known heavy operations (render, export)
- Implement async job execution with polling for long operations
- Distinguish "Python timeout" from "operator timeout" in error messages

### 3. Blender 5.x API Breaking Changes Undocumented
Common API mismatches when using Blender 5.1:
- `SUBDIVISION` modifier → actually `SUBSURF`
- `BEVEL.limit_method = 'WIDTH'` → `'WEIGHT'`
- `bpy.ops.object.normal_make()` → `bpy.ops.mesh.normals_make_consistent()`
- `bpy.ops.export_mesh.stl()` → operator path changed
- `bpy.data.save_as()` → doesn't exist on `BlendData`

**Suggested fixes:**
- Add `blender_version` field to health check response (already partially done)
- Add a `blender_api_lookup` tool for discovering available operators by keyword
- Document version-specific breaking changes in the docs bundled with the MCP

## Moderate

### 4. No Image Viewing from Renders
Renders produce files on disk but cannot be returned through MCP as viewable content.
Users must infer success via file-existence checks.

**Suggested fixes:**
- Return rendered images as base64 `image/png` content in render tool responses
- Auto-attach last render when `blender_screenshot_area` targets IMAGE_EDITOR

### 5. Vague Operator Error Messages
Errors like "context is incorrect" or "enum not found" don't help the agent recover.

**Suggested fixes:**
- Return structured error data: operator name, required context, available enum values
- Add "did you mean?" suggestions for close-match enum/operator names
- Implement `blender_operator_help` tool for runtime parameter discovery

### 6. Fragmented File System Access
Verifying exported files requires multiple tool calls and approval tokens.

**Suggested fixes:**
- Return file paths automatically in export/render tool responses (already done for render_preview)
- Add `blender_file_list` tool for listing output directories
- Reduce approval friction for trusted temp/output paths

### 7. No Mesh Validation Tool
Cannot verify normals, manifold status, or face orientation before export (critical for 3D printing).

**Suggested fixes:**
- Add `blender_mesh_validate` tool reporting: inverted faces, non-manifold edges, loose verts
- Add `blender_mesh_normals_info` for normal distribution stats
- Auto-warn about inverted normals on STL/OBJ export

## Minor

### 8. No Quick Scene Snapshot
Getting a visual sense of the scene requires multiple tool calls with no aggregation.

### 9. Material Preview Impossible
Without working screenshots, material assignments can't be visually verified.

### 10. Export Validation Missing
No way to verify an exported file is structurally valid before handing off.

## Priority Recommendation

1. **Working screenshots** — unlocks visual feedback loop for all other operations
2. **Longer/configurable timeouts** — unblocks render and export workflows
3. **Version detection + API compatibility** — prevents wasted debugging cycles
