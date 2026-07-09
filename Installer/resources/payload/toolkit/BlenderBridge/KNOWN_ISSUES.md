# BlenderBridge Known Issues & Improvement Backlog

Compiled from real-world usage feedback (Qwen session, July 2026).

## Critical

### 1. Viewport Screenshots Return Blank
All `blender_screenshot_window` / `blender_screenshot_area` calls return blank/white images.
This makes visual verification impossible.

**Root cause:** Likely display server / headless mode limitation in the Blender add-on's
screenshot capture path.

**Status:** Open — pending runtime testing to confirm whether the decoupling of 3DTools
from BlenderBridge has already resolved it.

**Suggested fixes:**
- Add fallback render path that saves a viewport thumbnail via Cycles at minimal samples
- Support returning the last rendered image when viewport capture fails
- Document known display server limitations (Wayland, headless, etc.)

### ~~2. 30-Second Code Execution Timeout Too Short~~ ✅ FIXED

**Status:** Resolved — per-operation timeout overrides implemented.

- Renders and exports now use 90s timeout (configurable via `BLENDER_RENDER_TIMEOUT_MS` / `BLENDER_EXPORT_TIMEOUT_MS`)
- Default operations retain 30s timeout
- Structured timeout errors include operation type, timeout duration, and retry suggestion

### ~~3. Blender 5.x API Breaking Changes~~ ✅ FIXED

**Status:** Resolved — automatic version detection and API compatibility layer implemented.

- Blender version detected via `bpy.app.version` and cached
- Compatibility mappings applied for known 5.x breaking changes:
  - `bpy.ops.export_mesh.stl()` → `bpy.ops.wm.stl_export()`
  - `bpy.ops.object.normal_make()` → `bpy.ops.mesh.normals_make_consistent()`
  - Modifier type remapping (SUBSURF ↔ SUBDIVISION)
- Standard code that doesn't use deprecated APIs passes through unmodified

## Moderate

### ~~4. No Image Viewing from Renders~~ ✅ FIXED

**Status:** Resolved — render tool now returns inline base64-encoded PNG images.

- `blender_render_preview` returns `{ type: "image", data: base64, mimeType: "image/png" }` content
- Text response with file path retained for backward compatibility

### ~~5. Vague Operator Error Messages~~ ✅ FIXED

**Status:** Resolved — structured operator error messages with recovery guidance.

- Errors now include operator name, required context, available enum values
- "Did you mean?" suggestions via Levenshtein distance for close-match enum/operator names
- Traceback preserved alongside structured data

### 6. Fragmented File System Access
Verifying exported files requires multiple tool calls and approval tokens.

**Status:** Open (partially mitigated — render_preview now returns file path automatically).

**Suggested fixes:**
- Add `blender_file_list` tool for listing output directories
- Reduce approval friction for trusted temp/output paths

### ~~7. No Mesh Validation Tool~~ ✅ FIXED

**Status:** Resolved — `blender_mesh_validate` tool added.

- Reports inverted faces, non-manifold edges, loose vertices, face orientation issues
- Returns structured `MeshValidationResult` with `isValid` boolean
- Uses `bmesh` module for accurate geometry analysis

## Minor

### 8. No Quick Scene Snapshot
Getting a visual sense of the scene requires multiple tool calls with no aggregation.

**Status:** Open.

### 9. Material Preview Impossible
Without working screenshots, material assignments can't be visually verified.

**Status:** Open — depends on issue #1 resolution.

### 10. Export Validation Missing
No way to verify an exported file is structurally valid before handing off.

**Status:** Open (partially mitigated by mesh validation before export).

### 11. LLM Code Parameter Confusion ✅ FIXED

**Status:** Resolved — robust code parameter normalization with diagnostic errors.

Qwen (and potentially other models) sometimes send an object like `{"result": "Layout"}` 
instead of a Python code string to `blender_execute_code`, causing infinite retry loops.

**Fix applied:**
- `normalizeCodeParam` now extracts code from object fields (`python`, `code`, `text`, `script`, `command`, `result`)
- `looksLikePythonCode` heuristic prevents extracting non-code values from `result` field
- Diagnostic error explicitly detects "echoing back results" pattern and provides a concrete correct usage example
- Tool description and parameter descriptions include explicit format examples

## Priority Recommendation

1. **Working screenshots** — unlocks visual feedback loop for all other operations (only remaining critical issue)
2. **File system access improvements** — reduces friction for export verification workflows
3. **Export validation** — structural validation of exported files
