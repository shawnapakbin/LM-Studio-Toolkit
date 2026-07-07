/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Bug Condition Exploration Property Test - Code Parameter Normalization Failure
 *
 * **Validates: Requirements 1.1, 1.2, 1.4, 2.1, 2.2, 2.4**
 *
 * These tests encode the EXPECTED behavior after the fix is applied.
 * On UNFIXED code, they MUST FAIL — failure confirms the bug exists.
 *
 * The bug: blender_execute_code handler does not normalize malformed code
 * parameters (arrays, objects, null/undefined). Instead it either:
 * - Rejects them via Zod schema (z.string()) before the handler runs, OR
 * - Returns an unhelpful "code must be a non-empty string" error with no diagnostics
 */

import * as fc from "fast-check";
import { BlenderClient } from "../../src/blender-client";
import { ToolHandler } from "../../src/tools/health-check.tool";
import { createCodeExecutionTools } from "../../src/tools/passthrough/code-execution.tools";
import { BlenderBridgeConfig, CallToolResult } from "../../src/types";

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
  callToolImpl?: (toolName: string, args: Record<string, unknown>) => Promise<CallToolResult>,
): BlenderClient {
  return {
    executeCode: jest.fn(),
    getSceneSummary: jest.fn(),
    getBlenderVersion: jest.fn(),
    callTool: callToolImpl ?? jest.fn(),
  } as unknown as BlenderClient;
}

describe("Bug Condition: Code Parameter Normalization Failure", () => {
  let tool: ToolHandler;
  let mockCallTool: jest.Mock;

  beforeEach(() => {
    mockCallTool = jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: '{"success": true}' }],
    });
    const client = createMockClient(mockCallTool);
    const tools = createCodeExecutionTools(defaultConfig, client);
    tool = tools[0]; // blender_execute_code
  });

  describe("Property 1: Array-of-lines inputs should be normalized by joining with newlines", () => {
    /**
     * **Validates: Requirements 2.1, 2.4**
     *
     * When code arrives as an array of strings (e.g., LLM sends lines separately),
     * the handler should join them with \n and forward the result to Blender.
     */
    it("should normalize array-of-lines input by joining with newlines", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 20 }),
          async (lines: string[]) => {
            mockCallTool.mockClear();
            mockCallTool.mockResolvedValue({
              isError: false,
              content: [{ type: "text", text: '{"success": true}' }],
            });

            const result = await tool.handler({ code: lines });

            // Expected behavior: array is joined and forwarded to Blender
            const expectedCode = lines.join("\n");
            expect(result.isError).toBe(false);
            expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", {
              code: expectedCode,
            });
          },
        ),
        { numRuns: 50 },
      );
    });

    it("should normalize a concrete array input: ['import bpy', \"print('hello')\"]", async () => {
      const result = await tool.handler({ code: ["import bpy", "print('hello')"] });

      // Expected: normalized to "import bpy\nprint('hello')" and forwarded
      expect(result.isError).toBe(false);
      expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", {
        code: "import bpy\nprint('hello')",
      });
    });
  });

  describe("Property 2: Object inputs with code-like fields should have string extracted", () => {
    /**
     * **Validates: Requirements 1.4, 2.1, 2.4**
     *
     * When code arrives as an object with a known code-like field (python, code, text),
     * the handler should extract the string value and forward it to Blender.
     */
    it("should extract code from objects with 'python' field", async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1, maxLength: 500 }), async (codeStr: string) => {
          mockCallTool.mockClear();
          mockCallTool.mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: '{"success": true}' }],
          });

          const result = await tool.handler({ code: { python: codeStr } });

          expect(result.isError).toBe(false);
          expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", {
            code: codeStr,
          });
        }),
        { numRuns: 50 },
      );
    });

    it("should extract code from objects with 'code' field", async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1, maxLength: 500 }), async (codeStr: string) => {
          mockCallTool.mockClear();
          mockCallTool.mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: '{"success": true}' }],
          });

          const result = await tool.handler({ code: { code: codeStr } });

          expect(result.isError).toBe(false);
          expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", {
            code: codeStr,
          });
        }),
        { numRuns: 50 },
      );
    });

    it("should extract code from objects with 'text' field", async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1, maxLength: 500 }), async (codeStr: string) => {
          mockCallTool.mockClear();
          mockCallTool.mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: '{"success": true}' }],
          });

          const result = await tool.handler({ code: { text: codeStr } });

          expect(result.isError).toBe(false);
          expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", {
            code: codeStr,
          });
        }),
        { numRuns: 50 },
      );
    });

    it("should extract from concrete object: { python: 'import bpy' }", async () => {
      const result = await tool.handler({ code: { python: "import bpy" } });

      expect(result.isError).toBe(false);
      expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", {
        code: "import bpy",
      });
    });
  });

  describe("Property 3: Unrecoverable inputs should return diagnostic errors", () => {
    /**
     * **Validates: Requirements 1.2, 2.2**
     *
     * When code is undefined, null, or otherwise unrecoverable, the error response
     * should include: the actual typeof, and a preview of the raw value.
     */
    it("should return diagnostic error with typeof for undefined input", async () => {
      const result = await tool.handler({ code: undefined });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      // Expected: diagnostic error contains type info
      expect(text).toContain("undefined");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should return diagnostic error with typeof for null input", async () => {
      const result = await tool.handler({ code: null });

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      // Expected: diagnostic error contains type/value info
      expect(text.toLowerCase()).toMatch(/null|object/);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("should return diagnostic error with preview for unrecoverable object", async () => {
      const weirdInput = { code: { nested: { deep: 42 } } };
      const result = await tool.handler(weirdInput);

      expect(result.isError).toBe(true);
      const text = result.content[0].text;
      // Expected: diagnostic error should contain typeof and a preview
      expect(text).toContain("object");
      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });
});
