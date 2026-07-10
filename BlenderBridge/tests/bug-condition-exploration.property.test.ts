/**
 * Bug Condition Exploration Property Tests
 *
 * These tests encode the EXPECTED (fixed) behavior for all five identified bugs
 * in the BlenderBridge MCP server. They are designed to FAIL on unfixed code,
 * thereby proving the bugs exist.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
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
 * Creates a mock BlenderClient that captures ALL Python code sent to executeCode.
 * Returns all captured codes so we can inspect the first (active-object check) call.
 */
function createCapturingMockClient(): {
  client: BlenderClient;
  getAllCapturedCodes: () => string[];
} {
  const capturedCodes: string[] = [];

  const client: BlenderClient = {
    executeCode: jest.fn(async (code: string) => {
      capturedCodes.push(code);
      // Return as if active object exists so the tool proceeds past the check
      return {
        success: true,
        output: JSON.stringify({ hasActive: true, name: "Cube" }),
      };
    }),
    getSceneSummary: jest.fn(),
    getBlenderVersion: jest.fn(),
    callTool: jest.fn(),
  };

  return { client, getAllCapturedCodes: () => capturedCodes };
}

describe("Bug Condition Exploration Tests", () => {
  /**
   * Test 1.1: Export active-object check assigns dict literal (not json.dumps string)
   *
   * Bug: The active-object check code uses `json.dumps()` which produces a string,
   * but the addon with `strict_json: true` expects a dict assigned to `result`.
   *
   * Expected behavior: The generated Python code should NOT contain `json.dumps(`
   * and should assign a dict literal to `result`.
   *
   * **Validates: Requirements 2.1**
   */
  describe("Test 1.1: Export active-object check uses dict literal", () => {
    it("active-object check code does NOT use json.dumps and assigns a dict literal to result", async () => {
      const { client, getAllCapturedCodes } = createCapturingMockClient();
      const mockHttpClient = {
        fetch: jest.fn(async () => new Response(null, { status: 200 })),
      };

      const tool = createExportToViewerTool(defaultConfig, client, mockHttpClient);

      // Invoke the handler to trigger the active-object check code generation
      await tool.handler({});

      const allCodes = getAllCapturedCodes();
      // The FIRST executeCode call is the active-object check
      expect(allCodes.length).toBeGreaterThanOrEqual(1);
      const activeObjectCheckCode = allCodes[0];

      // The code should NOT contain json.dumps( — it should use a dict literal
      expect(activeObjectCheckCode).not.toContain("json.dumps(");

      // The code should assign a dict literal to result (not a string)
      // A dict literal looks like: result = {"hasActive": ..., "name": ...}
      expect(activeObjectCheckCode).toMatch(/result\s*=\s*\{/);
    });
  });

  /**
   * Test 1.2: Render preview includes camera existence check
   *
   * Bug: `generateRenderPreviewCode` produces Python that directly calls
   * `bpy.ops.render.render(write_still=True)` without verifying camera existence.
   *
   * Expected behavior: The output should include a camera existence check
   * (`bpy.context.scene.camera`) before `bpy.ops.render.render`.
   *
   * **Validates: Requirements 2.2**
   */
  describe("Test 1.2: Render preview checks for camera existence", () => {
    it("generated render code includes camera existence check before render call", () => {
      fc.assert(
        fc.property(
          fc.record({
            outputPath: fc.stringOf(
              fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz/._-0123456789".split("")),
              { minLength: 3, maxLength: 100 },
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

            // The code should check for camera existence before rendering
            expect(code).toContain("bpy.context.scene.camera");

            // The camera check should appear BEFORE the render call
            const cameraCheckIndex = code.indexOf("bpy.context.scene.camera");
            const renderCallIndex = code.indexOf("bpy.ops.render.render");
            expect(cameraCheckIndex).toBeLessThan(renderCallIndex);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Test 1.3: Search tools perform actual introspection (not hardcoded stubs)
   *
   * Bug: `search_api_docs` and `search_manual_docs` return hardcoded stub responses
   * with `"results": []` instead of performing actual search.
   *
   * Expected behavior: The generated code should NOT contain hardcoded `"results": []`
   * and should perform actual introspection (using dir(), help(), pydoc, etc.).
   *
   * **Validates: Requirements 2.3**
   */
  describe("Test 1.3: Search tools generate real introspection code", () => {
    it("search_api_docs does NOT return hardcoded empty results and performs introspection", () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_. ".split("")), {
            minLength: 1,
            maxLength: 50,
          }),
          (query) => {
            const code = generateCodeForTool("search_api_docs", { query });

            // Should NOT contain hardcoded empty results
            expect(code).not.toContain('"results": []');

            // Should perform actual introspection (import modules, use dir/help/inspect)
            const performsIntrospection =
              code.includes("import") &&
              (code.includes("dir(") ||
                code.includes("help(") ||
                code.includes("inspect") ||
                code.includes("pydoc") ||
                code.includes("pkgutil") ||
                code.includes("__doc__"));

            expect(performsIntrospection).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Test 1.4: CLI execute_code spawns background process with blend_file
   *
   * Bug: `execute_blender_code_for_cli` simply returns `args.code` as a passthrough,
   * ignoring the `blend_file` parameter.
   *
   * Expected behavior: The generated code should contain `subprocess` and
   * `--background` with the blend_file path.
   *
   * **Validates: Requirements 2.4**
   */
  describe("Test 1.4: CLI execute_code uses subprocess with blend_file", () => {
    it("execute_blender_code_for_cli generates code with subprocess and --background", () => {
      fc.assert(
        fc.property(
          fc.record({
            blend_file: fc.stringOf(
              fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz/._-0123456789".split("")),
              { minLength: 5, maxLength: 80 },
            ),
            code: fc.stringOf(
              fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz()= 0123456789".split("")),
              {
                minLength: 5,
                maxLength: 100,
              },
            ),
          }),
          (args) => {
            const code = generateCodeForTool("execute_blender_code_for_cli", args);

            // Should contain subprocess usage
            expect(code).toContain("subprocess");

            // Should contain --background flag
            expect(code).toContain("--background");

            // Should reference the blend_file path
            expect(code).toContain(args.blend_file);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Test 1.5: CLI file-info tools use subprocess with blend_file (not suffix stripping)
   *
   * Bug: `get_blendfile_summary_datablocks_for_cli` strips the `_for_cli` suffix
   * and runs the interactive-session variant's code.
   *
   * Expected behavior: The generated code should contain `subprocess` and
   * `--background` with the blend_file path.
   *
   * **Validates: Requirements 2.5**
   */
  describe("Test 1.5: CLI file-info tools use subprocess with blend_file", () => {
    it("get_blendfile_summary_datablocks_for_cli generates code with subprocess and blend_file", () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz/._-0123456789".split("")), {
            minLength: 5,
            maxLength: 80,
          }),
          (blendFile) => {
            const code = generateCodeForTool("get_blendfile_summary_datablocks_for_cli", {
              blend_file: blendFile,
            });

            // Should contain subprocess usage
            expect(code).toContain("subprocess");

            // Should contain --background flag
            expect(code).toContain("--background");

            // Should reference the blend_file path
            expect(code).toContain(blendFile);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
