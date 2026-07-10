/**
 * Property 5: All registered passthrough tools have valid metadata
 *
 * For each registered passthrough tool, verify:
 * - name starts with "blender_"
 * - description has at least 20 characters
 * - handler returns a conforming ToolResult structure (isError: boolean, content: Array with type:"text")
 *
 * Uses fast-check to generate random upstream responses and verifies the handler
 * always returns a conforming ToolResult regardless of what the mock client returns.
 *
 * **Validates: Requirements 9.2, 9.4**
 */

import * as fc from "fast-check";
import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createCliFileInfoTools } from "../src/tools/passthrough/cli-file-info.tools";
import { createCodeExecutionTools } from "../src/tools/passthrough/code-execution.tools";
import { createDocumentationTools } from "../src/tools/passthrough/documentation.tools";
import { createFileInfoTools } from "../src/tools/passthrough/file-info.tools";
import { createNavigationTools } from "../src/tools/passthrough/navigation.tools";
import { createRenderingTools } from "../src/tools/passthrough/rendering.tools";
import { createSceneInspectionTools } from "../src/tools/passthrough/scene-inspection.tools";
import { createScreenshotTools } from "../src/tools/passthrough/screenshot.tools";
import { BlenderBridgeConfig } from "../src/types";

const mockConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  threeDToolHost: "http://localhost:3344",
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

/**
 * Creates a mock BlenderClient whose callTool resolves with the given content.
 */
function createMockClient(
  responseContent: Array<{ type: "text"; text: string }>,
  isError = false,
): BlenderClient {
  return {
    executeCode: jest.fn(),
    getSceneSummary: jest.fn(),
    getBlenderVersion: jest.fn(),
    callTool: jest.fn().mockResolvedValue({
      isError,
      content: responseContent,
    }),
  } as unknown as BlenderClient;
}

/**
 * Collects all 26 passthrough tools from the 8 factory functions.
 */
function getAllPassthroughTools(client: BlenderClient): ToolHandler[] {
  return [
    ...createNavigationTools(mockConfig, client),
    ...createFileInfoTools(mockConfig, client),
    ...createCodeExecutionTools(mockConfig, client),
    ...createRenderingTools(mockConfig, client),
    ...createScreenshotTools(mockConfig, client),
    ...createDocumentationTools(mockConfig, client),
    ...createCliFileInfoTools(mockConfig, client),
    ...createSceneInspectionTools(mockConfig, client),
  ];
}

/**
 * Provides minimal valid input for each tool based on its name.
 */
function getMinimalInput(toolName: string): unknown {
  switch (toolName) {
    // Navigation tools
    case "blender_switch_tab":
      return { name: "Layout" };
    case "blender_switch_workspace":
      return { space_type: "VIEW_3D" };
    case "blender_focus_object":
      return { name: "Cube" };
    case "blender_focus_object_data":
      return { name: "Cube" };

    // Code execution tools
    case "blender_execute_code":
      return { code: "import bpy" };
    case "blender_cli_execute_code":
      return { blend_file: "/tmp/test.blend", code: "import bpy" };

    // Rendering tools
    case "blender_render_thumbnail":
      return { output_path: "/tmp/thumb.png" };
    case "blender_render_full":
      return { output_path: "/tmp/render.png" };

    // Screenshot tools
    case "blender_screenshot_area":
      return { area_ui_type: "VIEW_3D" };
    case "blender_screenshot_window":
      return {};
    case "blender_window_layout":
      return {};

    // Documentation tools
    case "blender_api_docs":
      return { identifier: "bpy.types.Scene" };
    case "blender_search_api":
      return { query: "mesh" };
    case "blender_search_manual":
      return { query: "render" };

    // Scene inspection tools
    case "blender_object_detail":
      return { name: "Cube" };
    case "blender_objects_list":
      return {};

    // File info tools (no params)
    case "blender_file_datablocks":
    case "blender_file_missing_refs":
    case "blender_file_linked_libraries":
    case "blender_file_path_info":
    case "blender_file_usage_guess":
      return {};

    // CLI file info tools
    case "blender_cli_file_datablocks":
    case "blender_cli_file_missing_refs":
    case "blender_cli_file_linked_libraries":
    case "blender_cli_file_path_info":
    case "blender_cli_file_usage_guess":
      return { blend_file: "/tmp/test.blend" };

    default:
      return {};
  }
}

describe("Property 5: All registered passthrough tools have valid metadata", () => {
  describe("static metadata checks (exhaustive over all 26 tools)", () => {
    const client = createMockClient([{ type: "text", text: "ok" }]);
    const allTools = getAllPassthroughTools(client);

    it("total passthrough tool count is 26", () => {
      expect(allTools).toHaveLength(26);
    });

    it("every tool name starts with 'blender_'", () => {
      for (const tool of allTools) {
        expect(tool.name).toMatch(/^blender_/);
      }
    });

    it("every tool has a description of at least 20 characters", () => {
      for (const tool of allTools) {
        expect(tool.description.length).toBeGreaterThanOrEqual(20);
      }
    });

    it("all tool names are unique", () => {
      const names = allTools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("handler conformance with random upstream responses (property-based)", () => {
    /**
     * Generator: random upstream text response content.
     */
    const responseTextArb = fc.string({ minLength: 0, maxLength: 500 });

    /**
     * Generator: random upstream response (success or error) with random text content.
     */
    const upstreamResponseArb = fc.tuple(
      fc.boolean(), // isError
      fc.array(responseTextArb, { minLength: 1, maxLength: 3 }),
    );

    it("handler always returns { isError: boolean, content: Array<{type:'text', text:string}> }", async () => {
      await fc.assert(
        fc.asyncProperty(upstreamResponseArb, async ([isError, texts]) => {
          const responseContent = texts.map((t) => ({ type: "text" as const, text: t }));
          const client = createMockClient(responseContent, isError);
          const allTools = getAllPassthroughTools(client);

          // Test each tool's handler
          for (const tool of allTools) {
            const input = getMinimalInput(tool.name);
            const result = await tool.handler(input);

            // Verify ToolResult structure
            expect(typeof result.isError).toBe("boolean");
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content.length).toBeGreaterThanOrEqual(1);
            for (const item of result.content) {
              expect(item.type).toBe("text");
              expect(typeof item.text).toBe("string");
            }
          }
        }),
        { numRuns: 20 },
      );
    });

    it("handler returns isError=false when upstream returns successful response", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(responseTextArb, { minLength: 1, maxLength: 3 }),
          async (texts) => {
            const responseContent = texts.map((t) => ({ type: "text" as const, text: t }));
            const client = createMockClient(responseContent, false);
            const allTools = getAllPassthroughTools(client);

            for (const tool of allTools) {
              const input = getMinimalInput(tool.name);
              const result = await tool.handler(input);
              expect(result.isError).toBe(false);
            }
          },
        ),
        { numRuns: 20 },
      );
    });

    it("handler returns conforming result even when upstream throws", async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), async (errorMsg) => {
          const client: BlenderClient = {
            executeCode: jest.fn(),
            getSceneSummary: jest.fn(),
            getBlenderVersion: jest.fn(),
            callTool: jest.fn().mockRejectedValue(new Error(errorMsg)),
          } as unknown as BlenderClient;

          const allTools = getAllPassthroughTools(client);

          for (const tool of allTools) {
            const input = getMinimalInput(tool.name);
            const result = await tool.handler(input);

            // Even on error, must return valid ToolResult
            expect(typeof result.isError).toBe("boolean");
            expect(result.isError).toBe(true);
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content.length).toBeGreaterThanOrEqual(1);
            for (const item of result.content) {
              expect(item.type).toBe("text");
              expect(typeof item.text).toBe("string");
            }
          }
        }),
        { numRuns: 10 },
      );
    });
  });
});
