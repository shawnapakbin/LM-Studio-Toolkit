/**
 * Preservation Property Tests
 *
 * These tests capture the baseline behavior of all NON-BUGGY tools on UNFIXED code.
 * They ensure that after bug fixes are applied, the behavior of unaffected tools
 * remains identical.
 *
 * Methodology: Observation-first — we call the functions on unfixed code and assert
 * the output matches expected patterns. After fixes, these same tests must still pass.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 */

import * as fc from "fast-check";
import { generateCodeForTool } from "../src/addon-transport";
import { BlenderClient } from "../src/blender-client";
import { generateRenderPreviewCode } from "../src/codegen/render-preview.py";
import { createExportToViewerTool } from "../src/tools/export-to-viewer.tool";
import { BlenderBridgeConfig } from "../src/types";

// --- Test Helpers ---

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  threeDToolHost: "http://localhost:3344",
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

/**
 * Interactive tool names that are NOT affected by any bug fix.
 * These tools should produce identical output before and after fixes.
 */
const INTERACTIVE_TOOL_NAMES = [
  "get_objects_summary",
  "get_object_detail_summary",
  "get_blendfile_summary_datablocks",
  "get_blendfile_summary_missing_files",
  "get_blendfile_summary_of_linked_libraries",
  "get_blendfile_summary_path_info",
  "get_blendfile_summary_usage_guess",
  "get_screenshot_of_area_as_image",
  "get_screenshot_of_window_as_image",
  "get_screenshot_of_window_as_json",
  "jump_to_tab_by_name",
  "jump_to_tab_by_space_type",
  "jump_to_view3d_object_by_name",
  "jump_to_view3d_object_data_by_name",
  "render_thumbnail_to_path",
  "render_viewport_to_path",
  "get_python_api_docs",
] as const;

describe("Preservation Property Tests", () => {
  /**
   * Property: execute_blender_code passthrough is unchanged
   *
   * For all random Python code strings, `generateCodeForTool("execute_blender_code", {code})`
   * returns the raw code string unchanged.
   *
   * **Validates: Requirements 3.4**
   */
  describe("Property: execute_blender_code passthrough returns raw code unchanged", () => {
    it("returns the exact code string for any input", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 500 }), (code) => {
          const result = generateCodeForTool("execute_blender_code", { code });
          expect(result).toBe(code);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property: Interactive scene query tools produce deterministic Python code
   *
   * For all interactive tool names (non-CLI, non-export-check, non-render-no-camera),
   * calling generateCodeForTool twice with the same args produces identical output.
   * This captures that the code generation is deterministic and stable.
   *
   * **Validates: Requirements 3.6**
   */
  describe("Property: Interactive tools produce deterministic code output", () => {
    it("same tool + args always produces the same code", () => {
      fc.assert(
        fc.property(fc.constantFrom(...INTERACTIVE_TOOL_NAMES), (toolName) => {
          const args = getFixedArgsForTool(toolName);
          const result1 = generateCodeForTool(toolName, args);
          const result2 = generateCodeForTool(toolName, args);
          expect(result1).toBe(result2);
        }),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Property: Interactive tools generate valid Python code (non-empty, contains result assignment)
   *
   * For all interactive tool names with valid args, the generated code:
   * 1. Is a non-empty string
   * 2. Contains `result` assignment (for the addon protocol)
   * 3. Contains `import bpy` (for Blender API access)
   *
   * **Validates: Requirements 3.6, 3.7**
   */
  describe("Property: Interactive tools generate valid Python code with result assignment", () => {
    it("all interactive tools produce code with bpy import and result assignment", () => {
      fc.assert(
        fc.property(fc.constantFrom(...INTERACTIVE_TOOL_NAMES), (toolName) => {
          const args = getFixedArgsForTool(toolName);
          const code = generateCodeForTool(toolName, args);

          // Code is non-empty
          expect(code.length).toBeGreaterThan(0);

          // Code assigns to `result`
          expect(code).toContain("result");

          // Code uses bpy (except get_python_api_docs which uses import + help)
          if (toolName !== "get_python_api_docs") {
            expect(code).toContain("import bpy");
          }
        }),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Property: Navigation tools produce code that references the object name
   *
   * For all valid object name strings, navigation tools embed the name
   * in the generated Python code.
   *
   * **Validates: Requirements 3.6**
   */
  describe("Property: Navigation tools embed object name in generated code", () => {
    it("jump_to_view3d_object_by_name includes the name argument", () => {
      fc.assert(
        fc.property(
          fc.stringOf(
            fc.constantFrom(
              ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".split(""),
            ),
            { minLength: 1, maxLength: 30 },
          ),
          (name) => {
            const code = generateCodeForTool("jump_to_view3d_object_by_name", { name });
            expect(code).toContain(name);
            expect(code).toContain("bpy.data.objects.get");
            expect(code).toContain("view3d.view_selected");
          },
        ),
        { numRuns: 50 },
      );
    });

    it("jump_to_view3d_object_data_by_name includes the name argument", () => {
      fc.assert(
        fc.property(
          fc.stringOf(
            fc.constantFrom(
              ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".split(""),
            ),
            { minLength: 1, maxLength: 30 },
          ),
          (name) => {
            const code = generateCodeForTool("jump_to_view3d_object_data_by_name", { name });
            expect(code).toContain(name);
            expect(code).toContain("obj.data.name");
            expect(code).toContain("view3d.view_selected");
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Property: Screenshot tools produce code with screenshot operations
   *
   * Screenshot tools generate code that performs screenshot capture
   * and returns base64-encoded image data.
   *
   * **Validates: Requirements 3.6**
   */
  describe("Property: Screenshot tools generate screenshot capture code", () => {
    it("get_screenshot_of_window_as_image produces screenshot code with base64 encoding", () => {
      const code = generateCodeForTool("get_screenshot_of_window_as_image", {});
      expect(code).toContain("screenshot");
      expect(code).toContain("base64");
      expect(code).toContain("result");
    });

    it("get_screenshot_of_area_as_image produces area-specific screenshot code", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("VIEW_3D", "PROPERTIES", "OUTLINER", "IMAGE_EDITOR"),
          (areaType) => {
            const code = generateCodeForTool("get_screenshot_of_area_as_image", {
              area_ui_type: areaType,
            });
            expect(code).toContain("screenshot");
            expect(code).toContain("base64");
            expect(code).toContain(areaType);
            expect(code).toContain("result");
          },
        ),
        { numRuns: 10 },
      );
    });
  });

  /**
   * Property: generateRenderPreviewCode with valid params produces render code
   *
   * For all scene states WITH a camera (i.e., the normal path), the generated code:
   * 1. Sets resolution to the specified width×height (defaults: 480×270)
   * 2. Sets output format to PNG
   * 3. Calls bpy.ops.render.render(write_still=True)
   * 4. Returns a result dict with the filePath
   *
   * **Validates: Requirements 3.3**
   */
  describe("Property: generateRenderPreviewCode produces correct render code", () => {
    it("generates render code with resolution settings and render call", () => {
      fc.assert(
        fc.property(
          fc.record({
            outputPath: fc.stringOf(
              fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz/._-0123456789".split("")),
              { minLength: 5, maxLength: 80 },
            ),
            width: fc.option(fc.integer({ min: 64, max: 4096 }), { nil: undefined }),
            height: fc.option(fc.integer({ min: 64, max: 4096 }), { nil: undefined }),
          }),
          (params) => {
            const code = generateRenderPreviewCode({
              outputPath: params.outputPath,
              width: params.width,
              height: params.height,
            });

            const expectedWidth = params.width ?? 480;
            const expectedHeight = params.height ?? 270;

            // Resolution is set correctly
            expect(code).toContain(`render.resolution_x = ${expectedWidth}`);
            expect(code).toContain(`render.resolution_y = ${expectedHeight}`);
            expect(code).toContain("render.resolution_percentage = 100");

            // Output format is PNG
            expect(code).toContain('file_format = "PNG"');

            // Render call is present
            expect(code).toContain("bpy.ops.render.render(write_still=True)");

            // Result dict with filePath
            expect(code).toContain("result");
            expect(code).toContain("filePath");
          },
        ),
        { numRuns: 100 },
      );
    });

    it("default dimensions are 480x270", () => {
      const code = generateRenderPreviewCode({ outputPath: "/tmp/test.png" });
      expect(code).toContain("render.resolution_x = 480");
      expect(code).toContain("render.resolution_y = 270");
    });
  });

  /**
   * Property: Export tool with valid active object produces OBJ export code
   *
   * When the export tool handler runs and the active-object check succeeds
   * (mock client returns hasActive: true with a name), the second executeCode
   * call contains OBJ export code.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  describe("Property: Export tool with valid active object produces OBJ export code", () => {
    it("handler calls executeCode with OBJ export code when active object exists", async () => {
      const capturedCodes: string[] = [];

      const client: BlenderClient = {
        executeCode: jest.fn(async (code: string) => {
          capturedCodes.push(code);
          if (capturedCodes.length === 1) {
            // First call: active object check - return success
            return {
              success: true,
              output: JSON.stringify({ hasActive: true, name: "TestCube" }),
            };
          }
          // Second call: export code - return success
          return {
            success: true,
            output: JSON.stringify({ filePath: "/tmp/TestCube.obj", objectName: "TestCube" }),
          };
        }),
        getSceneSummary: jest.fn(),
        getBlenderVersion: jest.fn(),
        callTool: jest.fn(),
      };

      const mockHttpClient = {
        fetch: jest.fn(async () => new Response(null, { status: 200 })),
      };

      const tool = createExportToViewerTool(defaultConfig, client, mockHttpClient);
      const result = await tool.handler({});

      // Should have made at least 2 executeCode calls
      expect(capturedCodes.length).toBeGreaterThanOrEqual(2);

      // Second call should be the OBJ export code
      const exportCode = capturedCodes[1];
      expect(exportCode).toContain("bpy.ops.wm.obj_export");
      expect(exportCode).toContain("export_selected_objects=True");
      expect(exportCode).toContain("result");

      // Result should be success (not an error)
      expect(result.isError).toBe(false);
    });

    it("handler returns NO_ACTIVE_OBJECT error when no active object", async () => {
      const client: BlenderClient = {
        executeCode: jest.fn(async () => ({
          success: true,
          output: JSON.stringify({ hasActive: false, name: null }),
        })),
        getSceneSummary: jest.fn(),
        getBlenderVersion: jest.fn(),
        callTool: jest.fn(),
      };

      const mockHttpClient = {
        fetch: jest.fn(async () => new Response(null, { status: 200 })),
      };

      const tool = createExportToViewerTool(defaultConfig, client, mockHttpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("NO_ACTIVE_OBJECT");
    });
  });

  /**
   * Property: get_python_api_docs uses help() introspection
   *
   * The get_python_api_docs tool generates code that uses Python's help()
   * function to look up documentation for any identifier.
   *
   * **Validates: Requirements 3.5**
   */
  describe("Property: get_python_api_docs uses help() introspection", () => {
    it("generates code with help() call for any identifier", () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz.".split("")), {
            minLength: 3,
            maxLength: 40,
          }),
          (identifier) => {
            const code = generateCodeForTool("get_python_api_docs", { identifier });
            expect(code).toContain("help(");
            expect(code).toContain(identifier);
            expect(code).toContain("result");
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Property: Scene query tools produce structured collection/object code
   *
   * The get_objects_summary tool generates code that traverses the scene
   * collection hierarchy.
   *
   * **Validates: Requirements 3.6**
   */
  describe("Property: Scene query tools produce structured query code", () => {
    it("get_objects_summary generates collection traversal code", () => {
      const code = generateCodeForTool("get_objects_summary", {});
      expect(code).toContain("bpy.context.scene");
      expect(code).toContain("collection");
      expect(code).toContain("result");
    });

    it("get_object_detail_summary generates object inspection code for any name", () => {
      fc.assert(
        fc.property(
          fc.stringOf(
            fc.constantFrom(
              ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".split(""),
            ),
            { minLength: 1, maxLength: 30 },
          ),
          (name) => {
            const code = generateCodeForTool("get_object_detail_summary", { name });
            expect(code).toContain("bpy.data.objects.get");
            expect(code).toContain(name);
            expect(code).toContain("location");
            expect(code).toContain("modifiers");
            expect(code).toContain("result");
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});

// --- Helper Functions ---

/**
 * Returns fixed args for a given tool name (for determinism tests).
 */
function getFixedArgsForTool(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case "get_objects_summary":
    case "get_blendfile_summary_datablocks":
    case "get_blendfile_summary_missing_files":
    case "get_blendfile_summary_of_linked_libraries":
    case "get_blendfile_summary_path_info":
    case "get_blendfile_summary_usage_guess":
    case "get_screenshot_of_window_as_image":
    case "get_screenshot_of_window_as_json":
      return {};

    case "get_object_detail_summary":
    case "jump_to_view3d_object_by_name":
    case "jump_to_view3d_object_data_by_name":
    case "jump_to_tab_by_name":
      return { name: "Cube" };

    case "jump_to_tab_by_space_type":
      return { space_type: "VIEW_3D" };

    case "get_screenshot_of_area_as_image":
      return { area_ui_type: "VIEW_3D" };

    case "render_thumbnail_to_path":
    case "render_viewport_to_path":
      return { output_path: "/tmp/preview.png" };

    case "get_python_api_docs":
      return { identifier: "bpy.ops" };

    default:
      return {};
  }
}
