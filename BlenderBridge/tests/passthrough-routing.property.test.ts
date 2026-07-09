/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-mcp-full-integration, Property 4: Delegate routing uses correct delegate based on tool type
 *
 * Verify orchestration tools call ExecuteBlenderCodeFn and passthrough tools call CallToolFn.
 * Verify when CallToolFn is undefined, passthrough tools return error.
 *
 * Validates: Requirements 1.4, 1.5, 11.3, 11.4
 */

import * as fc from "fast-check";
import { ExecuteBlenderCodeFn, createBlenderClient } from "../src/blender-client";
import { BlenderBridgeConfig, CallToolFn } from "../src/types";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

describe("passthrough-routing property tests — Property 4: Delegate routing uses correct delegate based on tool type", () => {
  // --- Generators ---

  /** Generator: random tool names for passthrough (any string that would be used as an upstream tool name) */
  const randomToolNameArb = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_0123456789".split("")),
    { minLength: 1, maxLength: 60 },
  );

  /** Generator: random args objects for callTool */
  const randomArgsArb = fc.dictionary(
    fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_".split("")), {
      minLength: 1,
      maxLength: 20,
    }),
    fc.oneof(fc.string({ minLength: 0, maxLength: 50 }), fc.integer(), fc.boolean()),
    { minKeys: 0, maxKeys: 5 },
  );

  /** Generator: random Python code strings for executeCode */
  const randomPythonCodeArb = fc.stringOf(fc.char(), {
    minLength: 1,
    maxLength: 200,
  });

  // --- Property Tests ---

  describe("executeCode calls ExecuteBlenderCodeFn delegate (not CallToolFn)", () => {
    /**
     * For any random Python code, executeCode routes to the ExecuteBlenderCodeFn delegate.
     * The CallToolFn delegate is never invoked.
     */
    it("executeCode always routes to ExecuteBlenderCodeFn for any Python code input", async () => {
      await fc.assert(
        fc.asyncProperty(randomPythonCodeArb, async (pythonCode) => {
          const executeCalls: string[] = [];
          const callToolCalls: { toolName: string; args: Record<string, unknown> }[] = [];

          const mockExecuteCode: ExecuteBlenderCodeFn = async (code) => {
            executeCalls.push(code);
            return "executed";
          };

          const mockCallTool: CallToolFn = async (toolName, args) => {
            callToolCalls.push({ toolName, args });
            return [{ type: "text", text: "callTool response" }];
          };

          const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

          const result = await client.executeCode(pythonCode);

          // ExecuteBlenderCodeFn was called
          expect(executeCalls).toHaveLength(1);
          expect(executeCalls[0]).toBe(pythonCode);

          // CallToolFn was NOT called
          expect(callToolCalls).toHaveLength(0);

          // Result comes from ExecuteBlenderCodeFn
          expect(result.success).toBe(true);
          expect(result.output).toBe("executed");
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("callTool calls CallToolFn delegate (not ExecuteBlenderCodeFn)", () => {
    /**
     * For any random tool name and args, callTool routes to the CallToolFn delegate.
     * The ExecuteBlenderCodeFn delegate is never invoked.
     */
    it("callTool always routes to CallToolFn for any tool name", async () => {
      await fc.assert(
        fc.asyncProperty(randomToolNameArb, randomArgsArb, async (toolName, args) => {
          const executeCalls: string[] = [];
          const callToolCalls: { toolName: string; args: Record<string, unknown> }[] = [];

          const mockExecuteCode: ExecuteBlenderCodeFn = async (code) => {
            executeCalls.push(code);
            return "executed";
          };

          const mockCallTool: CallToolFn = async (tn, a) => {
            callToolCalls.push({ toolName: tn, args: a });
            return [{ type: "text", text: "delegated" }];
          };

          const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

          const result = await client.callTool(toolName, args);

          // CallToolFn was called
          expect(callToolCalls).toHaveLength(1);
          expect(callToolCalls[0].toolName).toBe(toolName);
          expect(callToolCalls[0].args).toEqual(args);

          // ExecuteBlenderCodeFn was NOT called
          expect(executeCalls).toHaveLength(0);

          // Result comes from CallToolFn
          expect(result.isError).toBe(false);
          expect(result.content).toEqual([{ type: "text", text: "delegated" }]);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("callTool returns error when CallToolFn is undefined", () => {
    /**
     * For any random tool name, when CallToolFn is not provided,
     * callTool returns isError: true with a "not configured" message.
     */
    it("returns isError true with 'not configured' message for any tool name", async () => {
      await fc.assert(
        fc.asyncProperty(randomToolNameArb, randomArgsArb, async (toolName, args) => {
          const executeCalls: string[] = [];

          const mockExecuteCode: ExecuteBlenderCodeFn = async (code) => {
            executeCalls.push(code);
            return "executed";
          };

          // No CallToolFn delegate provided
          const client = createBlenderClient(defaultConfig, mockExecuteCode);

          const result = await client.callTool(toolName, args);

          // Should return error
          expect(result.isError).toBe(true);
          expect(result.content).toHaveLength(1);
          expect(result.content[0]).toHaveProperty("type", "text");
          const text = (result.content[0] as { type: "text"; text: string }).text;
          expect(text.toLowerCase()).toContain("not configured");

          // ExecuteBlenderCodeFn should NOT be called as fallback
          expect(executeCalls).toHaveLength(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("executeCode still works without CallToolFn configured", () => {
    /**
     * When CallToolFn is undefined, executeCode still works correctly
     * using ExecuteBlenderCodeFn — it does not require CallToolFn.
     */
    it("executeCode succeeds without CallToolFn for any Python code", async () => {
      await fc.assert(
        fc.asyncProperty(randomPythonCodeArb, async (pythonCode) => {
          const executeCalls: string[] = [];

          const mockExecuteCode: ExecuteBlenderCodeFn = async (code) => {
            executeCalls.push(code);
            return `result: ${code.slice(0, 20)}`;
          };

          // No CallToolFn delegate
          const client = createBlenderClient(defaultConfig, mockExecuteCode);

          const result = await client.executeCode(pythonCode);

          // executeCode works
          expect(result.success).toBe(true);
          expect(executeCalls).toHaveLength(1);
          expect(executeCalls[0]).toBe(pythonCode);
        }),
        { numRuns: 100 },
      );
    });
  });
});
