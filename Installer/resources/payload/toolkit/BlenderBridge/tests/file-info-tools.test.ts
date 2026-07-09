/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Unit tests for interactive file-info passthrough tools.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createFileInfoTools } from "../src/tools/passthrough/file-info.tools";
import { BlenderBridgeConfig, CallToolResult } from "../src/types";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
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

describe("createFileInfoTools", () => {
  let tools: ToolHandler[];
  let mockCallTool: jest.Mock;
  let client: BlenderClient;

  beforeEach(() => {
    mockCallTool = jest.fn();
    client = createMockClient(mockCallTool);
    tools = createFileInfoTools(defaultConfig, client);
  });

  it("returns five tool handlers", () => {
    expect(tools).toHaveLength(5);
  });

  it("has correct tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "blender_file_datablocks",
      "blender_file_missing_refs",
      "blender_file_linked_libraries",
      "blender_file_path_info",
      "blender_file_usage_guess",
    ]);
  });

  describe("blender_file_datablocks", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[0];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"meshes": 5}' }],
      });

      const result = await tool.handler({});

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_datablocks", {});
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"meshes": 5}');
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Connection refused");
    });

    it("returns connection error with stringified non-Error throw", async () => {
      mockCallTool.mockRejectedValue("socket hangup");

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("socket hangup");
    });
  });

  describe("blender_file_missing_refs", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[1];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"missing": []}' }],
      });

      const result = await tool.handler({});

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_missing_files", {});
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"missing": []}');
    });

    it("returns connection error when client throws timeout", async () => {
      mockCallTool.mockRejectedValue(new Error("ETIMEDOUT"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("ETIMEDOUT");
    });
  });

  describe("blender_file_linked_libraries", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[2];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"libraries": []}' }],
      });

      const result = await tool.handler({});

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_of_linked_libraries", {});
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"libraries": []}');
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
    });
  });

  describe("blender_file_path_info", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[3];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"path": "/scene.blend"}' }],
      });

      const result = await tool.handler({});

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_path_info", {});
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"path": "/scene.blend"}');
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("read ECONNRESET"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("read ECONNRESET");
    });
  });

  describe("blender_file_usage_guess", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[4];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"useCases": []}' }],
      });

      const result = await tool.handler({});

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_usage_guess", {});
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"useCases": []}');
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Connection timeout"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Connection timeout");
    });

    it("formats upstream error results correctly", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Internal Blender error" }],
      });

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("Internal Blender error");
    });
  });
});
