/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-mcp-full-integration, Property 6: CallToolFn argument forwarding preserves parameter names and values
 *
 * For randomly generated valid arguments, verify the delegate receives exactly the expected
 * parameters with correct upstream tool name mapping.
 *
 * Validates: Requirements 1.1, 2.1, 4.1, 5.1-5.3, 6.1, 6.2, 7.1-7.4, 8.1, 8.2, 12.1-12.6
 */

import * as fc from "fast-check";
import { BlenderClient } from "../src/blender-client";
import { createCliFileInfoTools } from "../src/tools/passthrough/cli-file-info.tools";
import { createCodeExecutionTools } from "../src/tools/passthrough/code-execution.tools";
import { createDocumentationTools } from "../src/tools/passthrough/documentation.tools";
import { createNavigationTools } from "../src/tools/passthrough/navigation.tools";
import { createRenderingTools } from "../src/tools/passthrough/rendering.tools";
import { createSceneInspectionTools } from "../src/tools/passthrough/scene-inspection.tools";
import { BlenderBridgeConfig, CallToolResult } from "../src/types";

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
 * Creates a mock client that records the toolName and args passed to callTool.
 * Returns a successful response so the handler completes normally.
 */
function createRecordingClient(): {
  client: BlenderClient;
  recorded: { toolName: string; args: Record<string, unknown> }[];
} {
  const recorded: { toolName: string; args: Record<string, unknown> }[] = [];

  const client: BlenderClient = {
    executeCode: jest.fn(),
    getSceneSummary: jest.fn(),
    getBlenderVersion: jest.fn(),
    callTool: jest.fn(
      async (toolName: string, args: Record<string, unknown>): Promise<CallToolResult> => {
        recorded.push({ toolName, args });
        return {
          isError: false,
          content: [{ type: "text", text: "ok" }],
        };
      },
    ),
  };

  return { client, recorded };
}

/**
 * Generator for valid non-empty strings suitable as tool parameters.
 * Constrained to printable ASCII, non-empty, within length limits.
 */
const validStringArb = fc.stringOf(
  fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
  { minLength: 1, maxLength: 200 },
);

/**
 * Generator for valid Python code strings (non-empty, within size limits).
 */
const validCodeArb = fc.stringOf(
  fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
  { minLength: 1, maxLength: 500 },
);

/**
 * Generator for valid max_results values (1-100).
 */
const validMaxResultsArb = fc.integer({ min: 1, max: 100 });

/**
 * Generator for valid context values (0-10).
 */
const validContextArb = fc.integer({ min: 0, max: 10 });

describe("Property 6: CallToolFn argument forwarding preserves parameter names and values", () => {
  describe("blender_execute_code → execute_blender_code", () => {
    it("forwards { code } with correct upstream tool name", async () => {
      await fc.assert(
        fc.asyncProperty(validCodeArb, async (code) => {
          const { client, recorded } = createRecordingClient();
          const tools = createCodeExecutionTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_execute_code")!;

          await tool.handler({ code });

          expect(recorded).toHaveLength(1);
          expect(recorded[0].toolName).toBe("execute_blender_code");
          expect(recorded[0].args).toEqual({ code });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_object_detail → get_object_detail_summary", () => {
    it("forwards { name } with correct upstream tool name", async () => {
      await fc.assert(
        fc.asyncProperty(validStringArb, async (name) => {
          const { client, recorded } = createRecordingClient();
          const tools = createSceneInspectionTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_object_detail")!;

          await tool.handler({ name });

          expect(recorded).toHaveLength(1);
          expect(recorded[0].toolName).toBe("get_object_detail_summary");
          expect(recorded[0].args).toEqual({ name });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_search_api → search_api_docs", () => {
    it("forwards { query, max_results, context } with correct upstream tool name and defaults", async () => {
      await fc.assert(
        fc.asyncProperty(
          validStringArb,
          fc.option(validMaxResultsArb, { nil: undefined }),
          fc.option(validContextArb, { nil: undefined }),
          async (query, max_results, context) => {
            const { client, recorded } = createRecordingClient();
            const tools = createDocumentationTools(defaultConfig, client);
            const tool = tools.find((t) => t.name === "blender_search_api")!;

            await tool.handler({ query, max_results, context });

            expect(recorded).toHaveLength(1);
            expect(recorded[0].toolName).toBe("search_api_docs");
            // The handler applies defaults: max_results defaults to 20, context defaults to 0
            expect(recorded[0].args).toEqual({
              query,
              max_results: max_results ?? 20,
              context: context ?? 0,
            });
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_switch_workspace → jump_to_tab_by_space_type", () => {
    it("forwards { space_type, allow_edits } with correct upstream tool name and defaults", async () => {
      await fc.assert(
        fc.asyncProperty(
          validStringArb,
          fc.option(fc.boolean(), { nil: undefined }),
          async (space_type, allow_edits) => {
            const { client, recorded } = createRecordingClient();
            const tools = createNavigationTools(defaultConfig, client);
            const tool = tools.find((t) => t.name === "blender_switch_workspace")!;

            await tool.handler({ space_type, allow_edits });

            expect(recorded).toHaveLength(1);
            expect(recorded[0].toolName).toBe("jump_to_tab_by_space_type");
            // The handler defaults allow_edits to false when undefined
            expect(recorded[0].args).toEqual({
              space_type,
              allow_edits: allow_edits ?? false,
            });
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_cli_file_datablocks → get_blendfile_summary_datablocks_for_cli", () => {
    it("forwards { blend_file } with correct upstream tool name", async () => {
      await fc.assert(
        fc.asyncProperty(validStringArb, async (blend_file) => {
          const { client, recorded } = createRecordingClient();
          const tools = createCliFileInfoTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_cli_file_datablocks")!;

          await tool.handler({ blend_file });

          expect(recorded).toHaveLength(1);
          expect(recorded[0].toolName).toBe("get_blendfile_summary_datablocks_for_cli");
          expect(recorded[0].args).toEqual({ blend_file });
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_render_thumbnail → render_thumbnail_to_path", () => {
    it("forwards { output_path } with correct upstream tool name", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Needs a non-whitespace string to pass validation
          validStringArb.filter((s) => s.trim().length > 0),
          async (output_path) => {
            const { client, recorded } = createRecordingClient();
            const tools = createRenderingTools(defaultConfig, client);
            const tool = tools.find((t) => t.name === "blender_render_thumbnail")!;

            await tool.handler({ output_path });

            expect(recorded).toHaveLength(1);
            expect(recorded[0].toolName).toBe("render_thumbnail_to_path");
            expect(recorded[0].args).toEqual({ output_path });
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
