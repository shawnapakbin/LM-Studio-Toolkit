/**
 * Unit tests for CLI file-info passthrough tools.
 * Validates: Requirements 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createCliFileInfoTools } from "../src/tools/passthrough/cli-file-info.tools";
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

describe("createCliFileInfoTools", () => {
  let tools: ToolHandler[];
  let mockCallTool: jest.Mock;
  let client: BlenderClient;

  beforeEach(() => {
    mockCallTool = jest.fn();
    client = createMockClient(mockCallTool);
    tools = createCliFileInfoTools(defaultConfig, client);
  });

  it("returns five tool handlers", () => {
    expect(tools).toHaveLength(5);
  });

  it("has correct tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "blender_cli_file_datablocks",
      "blender_cli_file_missing_refs",
      "blender_cli_file_linked_libraries",
      "blender_cli_file_path_info",
      "blender_cli_file_usage_guess",
    ]);
  });

  describe("blender_cli_file_datablocks", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[0];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"meshes": 5}' }],
      });

      const result = await tool.handler({ blend_file: "/path/to/scene.blend" });

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_datablocks_for_cli", {
        blend_file: "/path/to/scene.blend",
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('{"meshes": 5}');
    });

    it("returns validation error for empty blend_file", async () => {
      const result = await tool.handler({ blend_file: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("blend_file");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for blend_file exceeding max length", async () => {
      const longPath = "a".repeat(1025);
      const result = await tool.handler({ blend_file: longPath });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("blend_file");
      expect(result.content[0].text).toContain("1024");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.handler({ blend_file: "/path/file.blend" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
    });
  });

  describe("blender_cli_file_missing_refs", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[1];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"missing": []}' }],
      });

      const result = await tool.handler({ blend_file: "/scene.blend" });

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_missing_files_for_cli", {
        blend_file: "/scene.blend",
      });
      expect(result.isError).toBe(false);
    });

    it("returns validation error for empty blend_file", async () => {
      const result = await tool.handler({ blend_file: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("blend_file");
      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });

  describe("blender_cli_file_linked_libraries", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[2];
    });

    it("calls client.callTool with correct upstream tool name (truncated)", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"libraries": []}' }],
      });

      const result = await tool.handler({ blend_file: "/scene.blend" });

      expect(mockCallTool).toHaveBeenCalledWith(
        "get_blendfile_summary_of_linked_libraries_for_cl",
        {
          blend_file: "/scene.blend",
        },
      );
      expect(result.isError).toBe(false);
    });

    it("returns validation error for empty blend_file", async () => {
      const result = await tool.handler({ blend_file: "" });

      expect(result.isError).toBe(true);
      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });

  describe("blender_cli_file_path_info", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[3];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"path": "/scene.blend"}' }],
      });

      const result = await tool.handler({ blend_file: "/scene.blend" });

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_path_info_for_cli", {
        blend_file: "/scene.blend",
      });
      expect(result.isError).toBe(false);
    });

    it("returns validation error for empty blend_file", async () => {
      const result = await tool.handler({ blend_file: "" });

      expect(result.isError).toBe(true);
      expect(mockCallTool).not.toHaveBeenCalled();
    });
  });

  describe("blender_cli_file_usage_guess", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[4];
    });

    it("calls client.callTool with correct upstream tool name", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: '{"useCases": []}' }],
      });

      const result = await tool.handler({ blend_file: "/scene.blend" });

      expect(mockCallTool).toHaveBeenCalledWith("get_blendfile_summary_usage_guess_for_cli", {
        blend_file: "/scene.blend",
      });
      expect(result.isError).toBe(false);
    });

    it("returns validation error for empty blend_file", async () => {
      const result = await tool.handler({ blend_file: "" });

      expect(result.isError).toBe(true);
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("formats upstream error results correctly", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "File not found: /missing.blend" }],
      });

      const result = await tool.handler({ blend_file: "/missing.blend" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("File not found");
    });
  });
});
