/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-mcp-full-integration, Property 1: Passthrough delegation preserves upstream responses
 *
 * For randomly generated valid inputs and mock delegate responses, verify
 * the tool returns upstream content unchanged with `isError: false`.
 *
 * Validates: Requirements 1.1, 2.1, 2.2, 3.1-3.5, 4.1, 4.2, 5.1-5.3, 6.1-6.3, 7.1-7.4, 8.1, 8.2, 12.1-12.6
 */

import * as fc from "fast-check";
import { BlenderClient } from "../src/blender-client";
import { createCliFileInfoTools } from "../src/tools/passthrough/cli-file-info.tools";
import { createCodeExecutionTools } from "../src/tools/passthrough/code-execution.tools";
import { createDocumentationTools } from "../src/tools/passthrough/documentation.tools";
import { createFileInfoTools } from "../src/tools/passthrough/file-info.tools";
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

function createMockClient(
  callToolImpl: (toolName: string, args: Record<string, unknown>) => Promise<CallToolResult>,
): BlenderClient {
  return {
    executeCode: jest.fn(),
    getSceneSummary: jest.fn(),
    getBlenderVersion: jest.fn(),
    callTool: callToolImpl,
  } as unknown as BlenderClient;
}

describe("Property 1: Passthrough delegation preserves upstream responses", () => {
  /**
   * Generator for valid non-empty strings suitable as tool parameters.
   * Constrained to printable ASCII to avoid encoding edge cases.
   */
  const validStringArb = fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127),
    { minLength: 1, maxLength: 200 },
  );

  /**
   * Generator for random response text content returned by mock upstream.
   */
  const responseTextArb = fc.string({ minLength: 1, maxLength: 1000 });

  describe("blender_file_datablocks (no params, file-info category)", () => {
    it("returns upstream response text unchanged with isError: false", async () => {
      await fc.assert(
        fc.asyncProperty(responseTextArb, async (responseText) => {
          const mockCallTool = jest.fn().mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: responseText }],
          } as CallToolResult);

          const client = createMockClient(mockCallTool);
          const tools = createFileInfoTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_file_datablocks")!;

          const result = await tool.handler({});

          expect(result.isError).toBe(false);
          expect(result.content).toHaveLength(1);
          expect(result.content[0].text).toBe(responseText);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_object_detail (name param, scene-inspection category)", () => {
    it("returns upstream response text unchanged with isError: false", async () => {
      await fc.assert(
        fc.asyncProperty(validStringArb, responseTextArb, async (name, responseText) => {
          const mockCallTool = jest.fn().mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: responseText }],
          } as CallToolResult);

          const client = createMockClient(mockCallTool);
          const tools = createSceneInspectionTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_object_detail")!;

          const result = await tool.handler({ name });

          expect(result.isError).toBe(false);
          expect(result.content).toHaveLength(1);
          expect(result.content[0].text).toBe(responseText);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_search_api (query + optional params, documentation category)", () => {
    it("returns upstream response text unchanged with isError: false", async () => {
      await fc.assert(
        fc.asyncProperty(validStringArb, responseTextArb, async (query, responseText) => {
          const mockCallTool = jest.fn().mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: responseText }],
          } as CallToolResult);

          const client = createMockClient(mockCallTool);
          const tools = createDocumentationTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_search_api")!;

          const result = await tool.handler({ query });

          // Note: blender_search_api has special "empty result" handling.
          // If responseText is "", "null", or "[]", it returns a fixed message.
          // For non-empty, non-null, non-empty-array content, it passes through.
          if (responseText === "" || responseText === "null" || responseText === "[]") {
            expect(result.isError).toBe(false);
            expect(result.content[0].text).toBe("No documentation found for the given query.");
          } else {
            expect(result.isError).toBe(false);
            expect(result.content).toHaveLength(1);
            expect(result.content[0].text).toBe(responseText);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_execute_code (code param, code-execution category)", () => {
    it("returns upstream response text unchanged with isError: false", async () => {
      await fc.assert(
        fc.asyncProperty(validStringArb, responseTextArb, async (code, responseText) => {
          const mockCallTool = jest.fn().mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: responseText }],
          } as CallToolResult);

          const client = createMockClient(mockCallTool);
          const tools = createCodeExecutionTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_execute_code")!;

          const result = await tool.handler({ code });

          expect(result.isError).toBe(false);
          expect(result.content).toHaveLength(1);
          expect(result.content[0].text).toBe(responseText);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("blender_cli_file_datablocks (blend_file param, CLI category)", () => {
    it("returns upstream response text unchanged with isError: false", async () => {
      await fc.assert(
        fc.asyncProperty(validStringArb, responseTextArb, async (blendFile, responseText) => {
          const mockCallTool = jest.fn().mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: responseText }],
          } as CallToolResult);

          const client = createMockClient(mockCallTool);
          const tools = createCliFileInfoTools(defaultConfig, client);
          const tool = tools.find((t) => t.name === "blender_cli_file_datablocks")!;

          const result = await tool.handler({ blend_file: blendFile });

          expect(result.isError).toBe(false);
          expect(result.content).toHaveLength(1);
          expect(result.content[0].text).toBe(responseText);
        }),
        { numRuns: 100 },
      );
    });
  });
});
