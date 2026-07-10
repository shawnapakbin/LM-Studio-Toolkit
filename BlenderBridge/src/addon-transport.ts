/**
 * Direct TCP socket transport to the Blender MCP add-on.
 *
 * The official Blender Lab MCP add-on (v1.0.0) uses a null-byte-delimited
 * JSON protocol over TCP on port 9876:
 *
 *   Request:  JSON + \0  (null byte delimiter)
 *   Format:   {"type": "execute", "code": "python_code", "strict_json": true}
 *   Response: JSON + \0  (null byte delimiter)
 *   Format:   {"status": "ok"|"error", "result": {...}, "message": "..."}
 *
 * The add-on only supports one command type: "execute" which runs Python code
 * in Blender's main thread. All higher-level operations (scene queries,
 * navigation, rendering) are implemented by generating appropriate Python code.
 *
 * This module provides:
 *   - An ExecuteBlenderCodeFn delegate for the orchestration tools
 *   - A CallToolFn delegate for the passthrough tools
 *
 * Both communicate directly with the add-on socket, eliminating the need
 * for the external `blender-mcp` CLI binary.
 */

import * as net from "net";
import { ExecuteBlenderCodeFn } from "./blender-client";
import { BlenderBridgeConfig, CallToolContent } from "./types";

/**
 * Sends a code execution request to the Blender add-on via TCP socket
 * using the null-byte-delimited protocol.
 *
 * Each call opens a new connection (the add-on closes the connection after responding).
 */
async function sendCodeToAddon(
  host: string,
  port: number,
  timeoutMs: number,
  code: string,
  strictJson: boolean = true,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const chunks: Buffer[] = [];
    let resolved = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(
          new Error(
            `Timeout: Blender add-on did not respond within ${Math.round(timeoutMs / 1000)}s`,
          ),
        );
      }
    }, timeoutMs);

    socket.on("connect", () => {
      // Protocol: JSON + null byte
      const request = JSON.stringify({
        type: "execute",
        code,
        strict_json: strictJson,
      });
      socket.write(request + "\0", "utf-8");
    });

    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      // Response is null-byte delimited — check for \0
      const all = Buffer.concat(chunks);
      const nullIdx = all.indexOf(0x00);
      if (nullIdx !== -1) {
        const jsonStr = all.slice(0, nullIdx).toString("utf-8");
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          try {
            resolve(JSON.parse(jsonStr));
          } catch (e) {
            reject(new Error(`Invalid JSON from Blender: ${(e as Error).message}`));
          }
        }
      }
    });

    socket.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error(`Socket error: ${err.message}`));
      }
    });

    socket.on("close", () => {
      if (!resolved) {
        // Connection closed before null-byte delimiter received
        const all = Buffer.concat(chunks);
        if (all.length > 0) {
          const str = all.toString("utf-8").replace(/\0$/, "");
          try {
            resolved = true;
            clearTimeout(timer);
            resolve(JSON.parse(str));
            return;
          } catch {
            // Fall through
          }
        }
        resolved = true;
        clearTimeout(timer);
        reject(new Error("Connection closed before complete response received"));
      }
    });

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error(`Socket timeout after ${Math.round(timeoutMs / 1000)}s`));
      }
    });

    socket.connect(port, host);
  });
}

/**
 * Generates Python code that implements a given MCP tool's behavior.
 * All tools ultimately execute Python in Blender — the add-on only supports "execute".
 */
export function generateCodeForTool(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "execute_blender_code":
      return args.code as string;

    case "execute_blender_code_for_cli": {
      const blendFile = args.blend_file as string;
      const userCode = args.code as string;
      // Generate Python code that spawns a background Blender process
      // to execute the user's code against the specified blend file
      return `
import subprocess, json, sys, tempfile, os

blend_file = ${JSON.stringify(blendFile)}
user_code = ${JSON.stringify(userCode)}

# Write user code to a temp file with a JSON result extractor appended
MARKER = "__BLENDER_CLI_RESULT_JSON__"
wrapper_suffix = """
import json as _json
try:
    _result_val = result
except NameError:
    _result_val = None
print(f"{MARKER}")
print(_json.dumps(_result_val))
"""

temp_fd, temp_path = tempfile.mkstemp(suffix=".py", prefix="blender_cli_")
try:
    with os.fdopen(temp_fd, 'w') as f:
        f.write(user_code)
        f.write("\\n")
        f.write(wrapper_suffix)

    proc = subprocess.run(
        ["blender", "--background", blend_file, "--python", temp_path],
        capture_output=True,
        text=True
    )
finally:
    os.unlink(temp_path)

# Parse the result JSON from stdout using the marker
parsed_result = None
stdout_lines = proc.stdout.split("\\n")
for i, line in enumerate(stdout_lines):
    if MARKER in line and i + 1 < len(stdout_lines):
        try:
            parsed_result = json.loads(stdout_lines[i + 1])
        except (json.JSONDecodeError, IndexError):
            pass
        break

result = {"result": parsed_result, "stdout": proc.stdout, "stderr": proc.stderr, "returncode": proc.returncode}
`.trim();
    }

    case "get_objects_summary":
      return `
import bpy
scene = bpy.context.scene
def gather_collection(col, depth=0):
    objects = []
    for obj in col.objects:
        objects.append({"name": obj.name, "type": obj.type, "parent": obj.parent.name if obj.parent else None, "visible": obj.visible_get()})
    children = []
    for child in col.children:
        children.append(gather_collection(child, depth+1))
    return {"name": col.name, "objects": objects, "children": children}
result = gather_collection(scene.collection)
`.trim();

    case "get_object_detail_summary":
      return `
import bpy
name = ${JSON.stringify(args.name)}
obj = bpy.data.objects.get(name)
if obj is None:
    result = {"error": f"Object '{name}' not found"}
else:
    result = {
        "name": obj.name, "type": obj.type,
        "location": list(obj.location), "rotation": list(obj.rotation_euler), "scale": list(obj.scale),
        "parent": obj.parent.name if obj.parent else None,
        "children": [c.name for c in obj.children],
        "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
        "constraints": [{"name": c.name, "type": c.type} for c in obj.constraints],
        "materials": [m.name if m else None for m in obj.data.material_slots] if hasattr(obj, 'data') and obj.data and hasattr(obj.data, 'material_slots') else [],
        "visible": obj.visible_get(),
        "data_name": obj.data.name if obj.data else None,
        "collections": [c.name for c in obj.users_collection],
    }
`.trim();

    case "get_blendfile_summary_datablocks":
      return `
import bpy
counts = {}
for attr in dir(bpy.data):
    val = getattr(bpy.data, attr, None)
    if hasattr(val, '__len__') and hasattr(val, 'keys'):
        counts[attr] = len(val)
result = {"datablocks": {k: v for k, v in counts.items() if v > 0}, "workspace": bpy.context.workspace.name if bpy.context.workspace else None, "render_engine": bpy.context.scene.render.engine}
`.trim();

    case "get_blendfile_summary_missing_files":
      return `
import bpy, os
missing = []
for img in bpy.data.images:
    if img.source == 'FILE' and img.filepath and not os.path.exists(bpy.path.abspath(img.filepath)):
        missing.append({"type": "image", "name": img.name, "path": img.filepath})
result = {"missing_files": missing}
`.trim();

    case "get_blendfile_summary_of_linked_libraries":
      return `
import bpy
libs = [{"filepath": lib.filepath, "name": lib.name} for lib in bpy.data.libraries]
result = {"linked_libraries": libs}
`.trim();

    case "get_blendfile_summary_path_info":
      return `
import bpy
result = {"filepath": bpy.data.filepath or "(unsaved)", "is_saved": bpy.data.is_saved, "is_dirty": bpy.data.is_dirty}
`.trim();

    case "get_blendfile_summary_usage_guess":
      return `
import bpy
guesses = []
if len(bpy.data.armatures) > 0: guesses.append({"use_case": "Character Animation", "certainty": 80})
if bpy.context.scene.render.engine == 'CYCLES': guesses.append({"use_case": "Photorealistic Rendering", "certainty": 70})
if len(bpy.data.cameras) > 1: guesses.append({"use_case": "Multi-camera Setup", "certainty": 60})
if not guesses: guesses.append({"use_case": "General 3D Modeling", "certainty": 50})
result = {"usage_guesses": guesses}
`.trim();

    // CLI variants — spawn background Blender process for file inspection
    case "get_blendfile_summary_datablocks_for_cli":
    case "get_blendfile_summary_missing_files_for_cli":
    case "get_blendfile_summary_of_linked_libraries_for_cl":
    case "get_blendfile_summary_path_info_for_cli":
    case "get_blendfile_summary_usage_guess_for_cli": {
      const blendFileCli = args.blend_file as string;
      // Get the corresponding interactive tool's query code
      const baseToolNameCli = toolName.replace(/_for_cli?$/, "").replace(/_for_cl$/, "");
      const queryCode = generateCodeForTool(baseToolNameCli, args);
      return `
import subprocess, json, tempfile, os

blend_file = ${JSON.stringify(blendFileCli)}

# The query code to run inside the background Blender process
query_code = ${JSON.stringify(queryCode)}

# Append a JSON result extractor to the query code
MARKER = "__BLENDER_CLI_RESULT_JSON__"
wrapper_suffix = """
import json as _json
try:
    _result_val = result
except NameError:
    _result_val = None
print(f"{MARKER}")
print(_json.dumps(_result_val))
"""

temp_fd, temp_path = tempfile.mkstemp(suffix=".py", prefix="blender_cli_")
try:
    with os.fdopen(temp_fd, 'w') as f:
        f.write(query_code)
        f.write("\\n")
        f.write(wrapper_suffix)

    proc = subprocess.run(
        ["blender", "--background", blend_file, "--python", temp_path],
        capture_output=True,
        text=True
    )
finally:
    os.unlink(temp_path)

# Parse the result JSON from stdout using the marker
parsed_result = None
stdout_lines = proc.stdout.split("\\n")
for i, line in enumerate(stdout_lines):
    if MARKER in line and i + 1 < len(stdout_lines):
        try:
            parsed_result = json.loads(stdout_lines[i + 1])
        except (json.JSONDecodeError, IndexError):
            pass
        break

result = {"result": parsed_result, "stdout": proc.stdout, "stderr": proc.stderr, "returncode": proc.returncode}
`.trim();
    }

    case "get_screenshot_of_area_as_image":
      return `
import bpy, tempfile, os, base64
area_type = ${JSON.stringify(args.area_ui_type || "VIEW_3D")}
temp_path = os.path.join(tempfile.gettempdir(), "blender_screenshot.png")
found_area = False
for area in bpy.context.screen.areas:
    if area.ui_type == area_type:
        override = bpy.context.copy()
        override['area'] = area
        with bpy.context.temp_override(**override):
            bpy.ops.screen.screenshot_area(filepath=temp_path)
        found_area = True
        break
if found_area and os.path.exists(temp_path):
    with open(temp_path, 'rb') as f:
        data = base64.b64encode(f.read()).decode('ascii')
    os.remove(temp_path)
    result = {"image": data, "format": "png"}
else:
    result = {"error": f"Area type '{area_type}' not found"}
`.trim();

    case "get_screenshot_of_window_as_image":
      return `
import bpy, tempfile, os, base64
temp_path = os.path.join(tempfile.gettempdir(), "blender_window_screenshot.png")
bpy.ops.screen.screenshot_area(filepath=temp_path)
if os.path.exists(temp_path):
    with open(temp_path, 'rb') as f:
        data = base64.b64encode(f.read()).decode('ascii')
    os.remove(temp_path)
    result = {"image": data, "format": "png"}
else:
    result = {"error": "Screenshot failed"}
`.trim();

    case "get_screenshot_of_window_as_json":
      return `
import bpy
areas_info = []
for area in bpy.context.screen.areas:
    areas_info.append({"type": area.type, "ui_type": area.ui_type, "width": area.width, "height": area.height})
result = {"workspace": bpy.context.workspace.name, "areas": areas_info, "active_object": bpy.context.active_object.name if bpy.context.active_object else None}
`.trim();

    case "jump_to_tab_by_name":
      return `
import bpy
name = ${JSON.stringify(args.name)}
found = False
for ws in bpy.data.workspaces:
    if ws.name == name:
        bpy.context.window.workspace = ws
        found = True
        break
result = {"switched": name, "found": found}
`.trim();

    case "jump_to_tab_by_space_type":
      return `
import bpy
space_type = ${JSON.stringify(args.space_type)}
found = False
for ws in bpy.data.workspaces:
    for screen in ws.screens:
        for area in screen.areas:
            if area.type == space_type:
                bpy.context.window.workspace = ws
                found = True
                break
        if found: break
    if found: break
result = {"switched": space_type, "found": found}
`.trim();

    case "jump_to_view3d_object_by_name":
      return `
import bpy
name = ${JSON.stringify(args.name)}
obj = bpy.data.objects.get(name)
if obj:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    override = bpy.context.copy()
                    override['area'] = area
                    override['region'] = region
                    with bpy.context.temp_override(**override):
                        bpy.ops.view3d.view_selected()
                    break
            break
    result = {"focused": name}
else:
    result = {"error": f"Object '{name}' not found"}
`.trim();

    case "jump_to_view3d_object_data_by_name":
      return `
import bpy
name = ${JSON.stringify(args.name)}
found = None
for obj in bpy.data.objects:
    if obj.data and obj.data.name == name:
        found = obj
        break
if found:
    bpy.ops.object.select_all(action='DESELECT')
    found.select_set(True)
    bpy.context.view_layer.objects.active = found
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for region in area.regions:
                if region.type == 'WINDOW':
                    override = bpy.context.copy()
                    override['area'] = area
                    override['region'] = region
                    with bpy.context.temp_override(**override):
                        bpy.ops.view3d.view_selected()
                    break
            break
    result = {"focused": found.name}
else:
    result = {"error": f"Object data '{name}' not found"}
`.trim();

    case "render_thumbnail_to_path":
      return `
import bpy
output_path = ${JSON.stringify(args.output_path)}
scene = bpy.context.scene
orig_x, orig_y = scene.render.resolution_x, scene.render.resolution_y
orig_pct = scene.render.resolution_percentage
orig_path = scene.render.filepath
scene.render.resolution_x = 320
scene.render.resolution_y = 180
scene.render.resolution_percentage = 100
scene.render.filepath = output_path
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
scene.render.resolution_x = orig_x
scene.render.resolution_y = orig_y
scene.render.resolution_percentage = orig_pct
scene.render.filepath = orig_path
result = {"rendered": output_path}
`.trim();

    case "render_viewport_to_path":
      return `
import bpy
output_path = ${JSON.stringify(args.output_path)}
scene = bpy.context.scene
orig_path = scene.render.filepath
scene.render.filepath = output_path
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
scene.render.filepath = orig_path
result = {"rendered": output_path}
`.trim();

    case "get_python_api_docs":
      return `
import io, contextlib
identifier = ${JSON.stringify(args.identifier)}
f = io.StringIO()
try:
    parts = identifier.split('.')
    obj = __import__(parts[0])
    for p in parts[1:]:
        obj = getattr(obj, p)
    with contextlib.redirect_stdout(f):
        help(obj)
    doc_text = f.getvalue()[:5000]
    result = {"identifier": identifier, "found": True, "content": doc_text}
except Exception as e:
    result = {"identifier": identifier, "found": False, "error": str(e)}
`.trim();

    case "search_api_docs":
      return `
import inspect, importlib
query = ${JSON.stringify(args.query)}.lower()
results = []
modules_to_search = ["bpy", "bpy.types", "bpy.ops", "bpy.props", "bpy.utils", "mathutils", "bmesh", "gpu", "bgl", "aud", "bl_math", "freestyle", "idprop"]
for mod_name in modules_to_search:
    try:
        mod = importlib.import_module(mod_name)
    except ImportError:
        continue
    if query in mod_name.lower():
        doc = ""
        try:
            doc = (mod.__doc__ or "")[:200]
        except Exception:
            pass
        results.append({"module_path": mod_name, "name": mod_name, "type": "module", "docstring": doc, "score": 100})
    for attr_name in dir(mod):
        if attr_name.startswith("_"):
            continue
        full_name = f"{mod_name}.{attr_name}"
        try:
            obj = getattr(mod, attr_name)
        except Exception:
            continue
        try:
            obj_doc = str(getattr(obj, "__doc__", None) or "")
        except Exception:
            obj_doc = ""
        name_match = query in attr_name.lower()
        doc_match = query in obj_doc[:500].lower()
        if name_match or doc_match:
            score = 90 if name_match else 50
            try:
                if inspect.isclass(obj):
                    obj_type = "class"
                elif inspect.isfunction(obj) or inspect.isbuiltin(obj):
                    obj_type = "function"
                elif inspect.ismodule(obj):
                    obj_type = "module"
                else:
                    obj_type = "attribute"
            except Exception:
                obj_type = "attribute"
            results.append({"module_path": mod_name, "name": attr_name, "type": obj_type, "docstring": obj_doc[:200], "score": score})
results.sort(key=lambda x: x["score"], reverse=True)
results = results[:20]
result = {"query": ${JSON.stringify(args.query)}, "results": results}
`.trim();

    case "search_manual_docs":
      return `
import inspect, importlib
query = ${JSON.stringify(args.query)}.lower()
results = []
modules_to_search = ["bpy", "bpy.types", "bpy.ops", "bpy.props", "bpy.utils", "bpy.path", "bpy.app", "mathutils", "bmesh", "gpu", "bgl", "aud", "bl_math", "freestyle", "idprop"]
for mod_name in modules_to_search:
    try:
        mod = importlib.import_module(mod_name)
    except ImportError:
        continue
    if query in mod_name.lower():
        doc = ""
        try:
            doc = (mod.__doc__ or "")[:200]
        except Exception:
            pass
        results.append({"module_path": mod_name, "name": mod_name, "type": "module", "docstring": doc, "score": 100})
    for attr_name in dir(mod):
        if attr_name.startswith("_"):
            continue
        full_name = f"{mod_name}.{attr_name}"
        try:
            obj = getattr(mod, attr_name)
        except Exception:
            continue
        try:
            obj_doc = str(getattr(obj, "__doc__", None) or "")
        except Exception:
            obj_doc = ""
        name_match = query in attr_name.lower()
        doc_match = query in obj_doc[:500].lower()
        if name_match or doc_match:
            score = 90 if name_match else 50
            try:
                if inspect.isclass(obj):
                    obj_type = "class"
                elif inspect.isfunction(obj) or inspect.isbuiltin(obj):
                    obj_type = "function"
                elif inspect.ismodule(obj):
                    obj_type = "module"
                else:
                    obj_type = "attribute"
            except Exception:
                obj_type = "attribute"
            results.append({"module_path": mod_name, "name": attr_name, "type": obj_type, "docstring": obj_doc[:200], "score": score})
results.sort(key=lambda x: x["score"], reverse=True)
results = results[:20]
result = {"query": ${JSON.stringify(args.query)}, "results": results, "note": "Results from Blender Python API introspection of available documentation resources"}
`.trim();

    default:
      return `result = {"error": "Tool '${toolName}' not implemented via direct addon transport"}`;
  }
}

/**
 * Creates an ExecuteBlenderCodeFn delegate that sends Python code
 * directly to the Blender add-on's TCP socket using null-byte-delimited protocol.
 */
export function createAddonExecuteCodeDelegate(config: BlenderBridgeConfig): ExecuteBlenderCodeFn {
  return async (pythonCode: string): Promise<string> => {
    const response = await sendCodeToAddon(
      config.blenderMcpHost,
      config.blenderMcpPort,
      config.operationTimeoutMs,
      pythonCode,
      true,
    );

    if (response.status === "error") {
      throw new Error((response.message as string) || "Unknown error from Blender");
    }

    const result = response.result;
    if (result === undefined || result === null) {
      // Some code doesn't set `result`, return stdout if available
      return (response.stdout as string) || "";
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  };
}

/**
 * Creates a CallToolFn delegate that translates MCP tool calls into
 * Python code, executes via the add-on socket, and returns MCP content format.
 */
export function createAddonCallToolDelegate(
  config: BlenderBridgeConfig,
): (toolName: string, args: Record<string, unknown>) => Promise<CallToolContent[]> {
  return async (toolName: string, args: Record<string, unknown>): Promise<CallToolContent[]> => {
    const code = generateCodeForTool(toolName, args);

    const response = await sendCodeToAddon(
      config.blenderMcpHost,
      config.blenderMcpPort,
      config.operationTimeoutMs,
      code,
      true,
    );

    if (response.status === "error") {
      const message = (response.message as string) || "Unknown error from Blender";
      throw new Error(message);
    }

    const result = response.result;
    if (result === undefined || result === null) {
      const stdout = (response.stdout as string) || "";
      return [{ type: "text", text: stdout || "Code executed successfully (no result returned)" }];
    }
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return [{ type: "text", text }];
  };
}
