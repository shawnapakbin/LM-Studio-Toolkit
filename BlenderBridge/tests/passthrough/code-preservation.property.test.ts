/**
 * Property-based tests for code preservation (passthrough unchanged).
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * These tests capture the baseline behavior of the UNFIXED code:
 * - Valid non-empty code strings pass through to Blender unchanged
 * - Empty strings are rejected with validation error
 * - Code exceeding 100,000 chars is rejected with length error
 * - blender_cli_execute_code forwards valid code and blend_file unchanged
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

/**
 * Arbitrary for generating valid non-empty Python code strings.
 * Generates strings with ASCII printable characters and properly escaped newlines.
 * Length range: 1 to 1000 (for fast property checks).
 */
const validCodeArbitrary = fc.stringOf(
  fc.oneof(
    fc
      .char()
      .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126), // printable ASCII
    fc.constant("\n"), // newline characters (properly in-string, not raw JSON)
    fc.constant("\t"), // tabs
  ),
  { minLength: 1, maxLength: 1000 },
);

/**
 * Arbitrary for generating valid code strings of various lengths up to the max limit.
 * Uses a weighted approach to cover short, medium, and near-limit strings.
 */
const validCodeVariousLengths = fc.oneof(
  fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126),
    {
      minLength: 1,
      maxLength: 10,
    },
  ),
  fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126),
    {
      minLength: 100,
      maxLength: 500,
    },
  ),
  fc.stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126),
    {
      minLength: 1000,
      maxLength: 5000,
    },
  ),
);

/**
 * Arbitrary for generating Unicode strings that include non-ASCII characters.
 * Valid code can contain Unicode (e.g., Python comments, string literals).
 */
const unicodeCodeArbitrary = fc.stringOf(
  fc.oneof(
    fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126),
    fc
      .unicode()
      .filter((c) => c.charCodeAt(0) >= 128), // non-ASCII unicode
  ),
  { minLength: 1, maxLength: 500 },
);

describe("Preservation Property Tests - Valid Code Passthrough Unchanged", () => {
  let tools: ToolHandler[];
  let mockCallTool: jest.Mock;
  let client: BlenderClient;
  let executeCodeTool: ToolHandler;
  let cliExecuteCodeTool: ToolHandler;

  beforeEach(() => {
    mockCallTool = jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: "ok" }],
    });
    client = createMockClient(mockCallTool);
    tools = createCodeExecutionTools(defaultConfig, client);
    executeCodeTool = tools[0];
    cliExecuteCodeTool = tools[1];
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Property: For any valid non-empty code string within the length limit,
   * the handler forwards it to client.callTool with the exact same string (no modification).
   */
  it("forwards valid ASCII code strings to Blender unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(validCodeArbitrary, async (code) => {
        mockCallTool.mockClear();
        mockCallTool.mockResolvedValue({
          isError: false,
          content: [{ type: "text", text: "ok" }],
        });

        const result = await executeCodeTool.handler({ code });

        expect(result.isError).toBe(false);
        expect(mockCallTool).toHaveBeenCalledTimes(1);
        expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", { code });
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Property: For any valid Unicode code string within the length limit,
   * the handler forwards it to client.callTool unchanged.
   */
  it("forwards valid Unicode code strings to Blender unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(unicodeCodeArbitrary, async (code) => {
        mockCallTool.mockClear();
        mockCallTool.mockResolvedValue({
          isError: false,
          content: [{ type: "text", text: "ok" }],
        });

        const result = await executeCodeTool.handler({ code });

        expect(result.isError).toBe(false);
        expect(mockCallTool).toHaveBeenCalledTimes(1);
        expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", { code });
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Property: For valid code strings of various lengths (1 to 5000),
   * no modification occurs during passthrough.
   */
  it("forwards code strings of various lengths without modification", async () => {
    await fc.assert(
      fc.asyncProperty(validCodeVariousLengths, async (code) => {
        mockCallTool.mockClear();
        mockCallTool.mockResolvedValue({
          isError: false,
          content: [{ type: "text", text: "ok" }],
        });

        const result = await executeCodeTool.handler({ code });

        expect(result.isError).toBe(false);
        expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", { code });
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Property: Empty string input is rejected with a validation error.
   * After the fix, the error message includes diagnostic information
   * (type, length, preview) instead of the generic "non-empty" message.
   */
  it("rejects empty string with validation error", async () => {
    const result = await executeCodeTool.handler({ code: "" });

    expect(result.isError).toBe(true);
    // After the fix, empty strings go through normalizeCodeParam (returns null)
    // then buildDiagnosticError produces a diagnostic message with type info.
    // The key preservation property is that empty strings are still REJECTED.
    expect(result.content[0].text).toMatch(/non-empty|could not be normalized/);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Property: Code exceeding 100,000 characters is rejected with a length validation error.
   */
  it("rejects code exceeding 100,000 characters with length error", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 100001, max: 200000 }), async (length) => {
        mockCallTool.mockClear();
        const longCode = "x".repeat(length);
        const result = await executeCodeTool.handler({ code: longCode });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("100000");
        expect(mockCallTool).not.toHaveBeenCalled();
      }),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Property: Code at exactly 100,000 characters is accepted (boundary check).
   */
  it("accepts code at exactly 100,000 characters", async () => {
    mockCallTool.mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: "ok" }],
    });

    const exactCode = "x".repeat(100000);
    const result = await executeCodeTool.handler({ code: exactCode });

    expect(result.isError).toBe(false);
    expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", { code: exactCode });
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: Successful execution results are returned in the existing CallToolResult format
   * with isError: false and content passed through.
   */
  it("returns upstream success results in existing format", async () => {
    await fc.assert(
      fc.asyncProperty(
        validCodeArbitrary,
        fc.string({ minLength: 1, maxLength: 200 }),
        async (code, responseText) => {
          mockCallTool.mockClear();
          mockCallTool.mockResolvedValue({
            isError: false,
            content: [{ type: "text", text: responseText }],
          });

          const result = await executeCodeTool.handler({ code });

          expect(result.isError).toBe(false);
          expect(result.content[0].text).toBe(responseText);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Property: blender_cli_execute_code with valid code and blend_file forwards
   * both parameters unchanged to client.callTool.
   */
  it("blender_cli_execute_code forwards valid code and blend_file unchanged", async () => {
    const validBlendFile = fc.stringOf(
      fc.char().filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126),
      { minLength: 1, maxLength: 100 },
    );

    await fc.assert(
      fc.asyncProperty(validCodeArbitrary, validBlendFile, async (code, blendFile) => {
        mockCallTool.mockClear();
        mockCallTool.mockResolvedValue({
          isError: false,
          content: [{ type: "text", text: "ok" }],
        });

        const result = await cliExecuteCodeTool.handler({ blend_file: blendFile, code });

        expect(result.isError).toBe(false);
        expect(mockCallTool).toHaveBeenCalledTimes(1);
        expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code_for_cli", {
          blend_file: blendFile,
          code,
        });
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Property: blender_cli_execute_code rejects empty code with validation error
   * (same behavior as blender_execute_code).
   */
  it("blender_cli_execute_code rejects empty code", async () => {
    const result = await cliExecuteCodeTool.handler({ blend_file: "/path/file.blend", code: "" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("could not be normalized");
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Property: blender_cli_execute_code rejects code exceeding length limit.
   */
  it("blender_cli_execute_code rejects code exceeding 100,000 characters", async () => {
    const longCode = "x".repeat(100001);
    const result = await cliExecuteCodeTool.handler({
      blend_file: "/path/file.blend",
      code: longCode,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("100000");
    expect(mockCallTool).not.toHaveBeenCalled();
  });
});
