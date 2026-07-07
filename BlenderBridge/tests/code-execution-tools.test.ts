/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Unit tests for code-execution passthrough tools.
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 12.1, 12.7, 12.8
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createCodeExecutionTools } from "../src/tools/passthrough/code-execution.tools";
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
  callToolImpl?: (toolName: string, args: Record<string, unknown>) => Promise<CallToolResult>,
): BlenderClient {
  return {
    executeCode: jest.fn(),
    getSceneSummary: jest.fn(),
    getBlenderVersion: jest.fn(),
    callTool: callToolImpl ?? jest.fn(),
  } as unknown as BlenderClient;
}

describe("createCodeExecutionTools", () => {
  let tools: ToolHandler[];
  let mockCallTool: jest.Mock;
  let client: BlenderClient;

  beforeEach(() => {
    mockCallTool = jest.fn();
    client = createMockClient(mockCallTool);
    tools = createCodeExecutionTools(defaultConfig, client);
  });

  it("returns two tool handlers", () => {
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("blender_execute_code");
    expect(tools[1].name).toBe("blender_cli_execute_code");
  });

  describe("blender_execute_code", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[0];
    });

    it("calls client.callTool with correct upstream tool name and args", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"result": 42}' }],
      });

      const result = await tool.handler({ code: "import bpy\nresult = 42" });

      expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code", {
        code: "import bpy\nresult = 42",
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"result": 42}');
    });

    it("returns validation error for empty code", async () => {
      const result = await tool.handler({ code: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("code");
      expect(result.content[0].text).toContain("could not be normalized");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for code exceeding max length", async () => {
      const longCode = "x".repeat(100001);
      const result = await tool.handler({ code: longCode });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("code");
      expect(result.content[0].text).toContain("100000");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("accepts code at exactly max length", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "ok" }],
      });

      const exactCode = "x".repeat(100000);
      const result = await tool.handler({ code: exactCode });

      expect(result.isError).toBe(false);
      expect(mockCallTool).toHaveBeenCalled();
    });

    it("formats upstream error results correctly", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "NameError: name 'foo' is not defined" }],
      });

      const result = await tool.handler({ code: "print(foo)" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("NameError");
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.handler({ code: "import bpy" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Connection refused");
    });
  });

  describe("blender_cli_execute_code", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[1];
    });

    it("calls client.callTool with correct upstream tool name and args", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"exported": true}' }],
      });

      const result = await tool.handler({
        blend_file: "/path/to/scene.blend",
        code: "import bpy\nresult = {'exported': True}",
      });

      expect(mockCallTool).toHaveBeenCalledWith("execute_blender_code_for_cli", {
        blend_file: "/path/to/scene.blend",
        code: "import bpy\nresult = {'exported': True}",
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"exported": true}');
    });

    it("returns validation error for empty blend_file", async () => {
      const result = await tool.handler({ blend_file: "", code: "print('hi')" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("blend_file");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for blend_file exceeding max length", async () => {
      const longPath = "a".repeat(1025);
      const result = await tool.handler({ blend_file: longPath, code: "print('hi')" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("blend_file");
      expect(result.content[0].text).toContain("1024");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for empty code", async () => {
      const result = await tool.handler({ blend_file: "/path/file.blend", code: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("code");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for code exceeding max length", async () => {
      const longCode = "x".repeat(100001);
      const result = await tool.handler({ blend_file: "/path/file.blend", code: longCode });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("code");
      expect(result.content[0].text).toContain("100000");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("validates blend_file before code (returns first failure)", async () => {
      const result = await tool.handler({ blend_file: "", code: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("blend_file");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("formats upstream error results correctly", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "File not found: /missing.blend" }],
      });

      const result = await tool.handler({
        blend_file: "/missing.blend",
        code: "import bpy",
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("File not found");
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await tool.handler({
        blend_file: "/path/file.blend",
        code: "import bpy",
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("ECONNREFUSED");
    });
  });
});
