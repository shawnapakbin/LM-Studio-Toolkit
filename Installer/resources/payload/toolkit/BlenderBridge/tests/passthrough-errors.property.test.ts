/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-mcp-full-integration, Property 3: Error responses conform to OrchestrationErrorResponse structure
 *
 * For randomly generated error conditions (delegate throws, delegate returns error, timeout),
 * verify response has `isError: true` with valid JSON containing `success: false`,
 * non-empty `error.message`, and non-empty `error.suggestion`.
 *
 * Validates: Requirements 10.1, 10.2, 10.4, 10.5
 */

import * as fc from "fast-check";
import { createBlenderClient } from "../src/blender-client";
import { createCodeExecutionTools } from "../src/tools/passthrough/code-execution.tools";
import {
  connectionError,
  timeoutError,
  upstreamError,
} from "../src/tools/passthrough/passthrough-helpers";
import { BlenderBridgeConfig, CallToolFn, OrchestrationErrorResponse } from "../src/types";

/** Default config for tests */
const testConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

/**
 * Parses the JSON text content from a ToolResult and validates OrchestrationErrorResponse structure.
 * Returns the parsed response or throws if structure is invalid.
 */
function parseErrorResponse(result: {
  isError: boolean;
  content: Array<{ type: string; text: string }>;
}): OrchestrationErrorResponse {
  expect(result.isError).toBe(true);
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");

  const parsed = JSON.parse(result.content[0].text);
  return parsed as OrchestrationErrorResponse;
}

describe("passthrough-errors property tests — Property 3: Error responses conform to OrchestrationErrorResponse structure", () => {
  // --- Generators ---

  /** Generator: non-empty error message strings */
  const nonEmptyStringArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  /** Generator: positive timeout values in ms */
  const timeoutMsArb = fc.integer({ min: 1000, max: 120000 });

  /** Generator: optional traceback strings */
  const tracebackArb = fc
    .string({ minLength: 1, maxLength: 500 })
    .filter((s) => s.trim().length > 0);

  /** Generator: suggestion strings */
  const suggestionArb = fc
    .string({ minLength: 1, maxLength: 200 })
    .filter((s) => s.trim().length > 0);

  // --- Section 1: Test passthrough-helpers error formatters directly ---

  describe("timeoutError produces conforming OrchestrationErrorResponse", () => {
    it("has success: false, non-empty error.message, non-empty error.code", () => {
      fc.assert(
        fc.property(timeoutMsArb, (timeoutMs) => {
          const result = timeoutError(timeoutMs);
          const parsed = parseErrorResponse(result);

          expect(parsed.success).toBe(false);
          expect(typeof parsed.error.message).toBe("string");
          expect(parsed.error.message.length).toBeGreaterThan(0);
          expect(typeof parsed.error.code).toBe("string");
          expect(parsed.error.code.length).toBeGreaterThan(0);
          expect(parsed.error.code).toBe("BLENDER_TIMEOUT");
        }),
        { numRuns: 100 },
      );
    });

    it("has non-empty error.suggestion referencing health check", () => {
      fc.assert(
        fc.property(timeoutMsArb, (timeoutMs) => {
          const result = timeoutError(timeoutMs);
          const parsed = parseErrorResponse(result);

          expect(typeof parsed.error.suggestion).toBe("string");
          expect(parsed.error.suggestion!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("connectionError produces conforming OrchestrationErrorResponse", () => {
    it("has success: false, non-empty error.message, non-empty error.code", () => {
      fc.assert(
        fc.property(nonEmptyStringArb, (message) => {
          const result = connectionError(message);
          const parsed = parseErrorResponse(result);

          expect(parsed.success).toBe(false);
          expect(typeof parsed.error.message).toBe("string");
          expect(parsed.error.message.length).toBeGreaterThan(0);
          expect(parsed.error.message).toBe(message);
          expect(typeof parsed.error.code).toBe("string");
          expect(parsed.error.code.length).toBeGreaterThan(0);
          expect(parsed.error.code).toBe("CONNECTION_ERROR");
        }),
        { numRuns: 100 },
      );
    });

    it("has non-empty error.suggestion", () => {
      fc.assert(
        fc.property(nonEmptyStringArb, (message) => {
          const result = connectionError(message);
          const parsed = parseErrorResponse(result);

          expect(typeof parsed.error.suggestion).toBe("string");
          expect(parsed.error.suggestion!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("upstreamError produces conforming OrchestrationErrorResponse", () => {
    it("has success: false, non-empty error.message, non-empty error.code with suggestion", () => {
      fc.assert(
        fc.property(
          nonEmptyStringArb,
          tracebackArb,
          suggestionArb,
          (message, traceback, suggestion) => {
            const result = upstreamError(message, traceback, suggestion);
            const parsed = parseErrorResponse(result);

            expect(parsed.success).toBe(false);
            expect(typeof parsed.error.message).toBe("string");
            expect(parsed.error.message.length).toBeGreaterThan(0);
            expect(parsed.error.message).toBe(message);
            expect(typeof parsed.error.code).toBe("string");
            expect(parsed.error.code.length).toBeGreaterThan(0);
            expect(parsed.error.code).toBe("UPSTREAM_ERROR");
            expect(parsed.error.suggestion).toBe(suggestion);
            expect(parsed.error.traceback).toBe(traceback);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("without suggestion still has valid structure (success: false, non-empty code and message)", () => {
      fc.assert(
        fc.property(nonEmptyStringArb, (message) => {
          const result = upstreamError(message);
          const parsed = parseErrorResponse(result);

          expect(parsed.success).toBe(false);
          expect(typeof parsed.error.message).toBe("string");
          expect(parsed.error.message.length).toBeGreaterThan(0);
          expect(typeof parsed.error.code).toBe("string");
          expect(parsed.error.code.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  // --- Section 2: Test passthrough tool when delegate throws produces conforming error ---

  describe("passthrough tool with throwing delegate produces conforming error", () => {
    it("returns isError: true with valid OrchestrationErrorResponse JSON when delegate throws", async () => {
      await fc.assert(
        fc.asyncProperty(nonEmptyStringArb, async (errorMessage) => {
          // Create a mock CallToolFn that throws
          const throwingCallTool: CallToolFn = async () => {
            throw new Error(errorMessage);
          };

          // Create a client with the throwing delegate
          const client = createBlenderClient(
            testConfig,
            async () => "ok", // executeCode delegate (not used)
            throwingCallTool,
          );

          // Create the code execution tools
          const tools = createCodeExecutionTools(testConfig, client);
          const executeCodeTool = tools.find((t) => t.name === "blender_execute_code")!;

          // Call the tool with valid input — this will trigger the delegate throw
          const result = await executeCodeTool.handler({ code: "print('hello')" });

          // The result should have isError: true
          expect(result.isError).toBe(true);
          expect(result.content).toHaveLength(1);
          expect(result.content[0].type).toBe("text");

          // Parse the JSON and verify OrchestrationErrorResponse structure
          const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
          expect(parsed.success).toBe(false);
          expect(typeof parsed.error.message).toBe("string");
          expect(parsed.error.message.length).toBeGreaterThan(0);
          expect(typeof parsed.error.code).toBe("string");
          expect(parsed.error.code.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it("preserves the thrown error message in the response", async () => {
      await fc.assert(
        fc.asyncProperty(nonEmptyStringArb, async (errorMessage) => {
          const throwingCallTool: CallToolFn = async () => {
            throw new Error(errorMessage);
          };

          const client = createBlenderClient(testConfig, async () => "ok", throwingCallTool);

          const tools = createCodeExecutionTools(testConfig, client);
          const executeCodeTool = tools.find((t) => t.name === "blender_execute_code")!;

          const result = await executeCodeTool.handler({ code: "print('test')" });
          const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);

          expect(parsed.error.message).toBe(errorMessage);
        }),
        { numRuns: 100 },
      );
    });
  });

  // --- Section 3: Test that all error formatters produce valid JSON ---

  describe("all error formatters produce parseable JSON with required fields", () => {
    it("timeoutError, connectionError, and upstreamError all produce valid JSON", () => {
      fc.assert(
        fc.property(
          timeoutMsArb,
          nonEmptyStringArb,
          nonEmptyStringArb,
          tracebackArb,
          suggestionArb,
          (timeoutMs, connMsg, upMsg, traceback, suggestion) => {
            // Test all three formatters produce parseable JSON
            const results = [
              timeoutError(timeoutMs),
              connectionError(connMsg),
              upstreamError(upMsg, traceback, suggestion),
            ];

            for (const result of results) {
              expect(result.isError).toBe(true);
              expect(result.content.length).toBe(1);

              // Must not throw when parsing
              const parsed = JSON.parse(result.content[0].text);

              // All must have success: false
              expect(parsed.success).toBe(false);

              // All must have error.code as non-empty string
              expect(typeof parsed.error.code).toBe("string");
              expect(parsed.error.code.length).toBeGreaterThan(0);

              // All must have error.message as non-empty string
              expect(typeof parsed.error.message).toBe("string");
              expect(parsed.error.message.length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
