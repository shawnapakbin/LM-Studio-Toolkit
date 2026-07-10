/**
 * Unit tests for rendering passthrough tools.
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createRenderingTools } from "../src/tools/passthrough/rendering.tools";
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

describe("createRenderingTools", () => {
  let tools: ToolHandler[];
  let mockCallTool: jest.Mock;
  let client: BlenderClient;

  beforeEach(() => {
    mockCallTool = jest.fn();
    client = createMockClient(mockCallTool);
    tools = createRenderingTools(defaultConfig, client);
  });

  it("returns two tool handlers", () => {
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("blender_render_thumbnail");
    expect(tools[1].name).toBe("blender_render_full");
  });

  describe("blender_render_thumbnail", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[0];
    });

    it("calls client.callTool with render_thumbnail_to_path and correct args", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Rendered to /tmp/thumb.png" }],
      });

      const result = await tool.handler({ output_path: "/tmp/thumb.png" });

      expect(mockCallTool).toHaveBeenCalledWith("render_thumbnail_to_path", {
        output_path: "/tmp/thumb.png",
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Rendered to /tmp/thumb.png");
    });

    it("returns validation error for empty output_path", async () => {
      const result = await tool.handler({ output_path: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("output_path");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for whitespace-only output_path", async () => {
      const result = await tool.handler({ output_path: "   " });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("output_path");
      expect(result.content[0].text).toContain("whitespace");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("handles upstream file-system permission error with path suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Permission denied: /root/output.png" }],
      });

      const result = await tool.handler({ output_path: "/root/output.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("Permission denied");
      expect(parsed.error.suggestion).toContain("writable");
    });

    it("handles upstream directory-not-found error with path suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "No such file or directory: /nonexistent/thumb.png" }],
      });

      const result = await tool.handler({ output_path: "/nonexistent/thumb.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.suggestion).toContain("directory exists");
    });

    it("passes through non-filesystem upstream errors without path suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Render engine crashed unexpectedly" }],
      });

      const result = await tool.handler({ output_path: "/tmp/thumb.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("Render engine crashed");
      expect(parsed.error.suggestion).toBeUndefined();
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.handler({ output_path: "/tmp/thumb.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Connection refused");
    });

    it("returns connection error for non-Error throws", async () => {
      mockCallTool.mockRejectedValue("network timeout");

      const result = await tool.handler({ output_path: "/tmp/thumb.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("network timeout");
    });
  });

  describe("blender_render_full", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[1];
    });

    it("calls client.callTool with render_viewport_to_path and correct args", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Rendered to /tmp/render.png" }],
      });

      const result = await tool.handler({ output_path: "/tmp/render.png" });

      expect(mockCallTool).toHaveBeenCalledWith("render_viewport_to_path", {
        output_path: "/tmp/render.png",
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Rendered to /tmp/render.png");
    });

    it("returns validation error for empty output_path", async () => {
      const result = await tool.handler({ output_path: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("output_path");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for whitespace-only output_path", async () => {
      const result = await tool.handler({ output_path: "\t\n  " });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("output_path");
      expect(result.content[0].text).toContain("whitespace");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("handles upstream file-system permission error with path suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Access denied writing to path /protected/render.png" }],
      });

      const result = await tool.handler({ output_path: "/protected/render.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.suggestion).toContain("writable");
    });

    it("handles upstream path-related error with suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Invalid path specified" }],
      });

      const result = await tool.handler({ output_path: "/bad/path/render.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.suggestion).toContain("directory exists");
    });

    it("passes through non-filesystem upstream errors without path suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Out of memory during render" }],
      });

      const result = await tool.handler({ output_path: "/tmp/render.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("Out of memory");
      expect(parsed.error.suggestion).toBeUndefined();
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await tool.handler({ output_path: "/tmp/render.png" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("ECONNREFUSED");
    });

    it("accepts valid paths with special characters", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Rendered successfully" }],
      });

      const result = await tool.handler({ output_path: "/tmp/my scene (1)/render.png" });

      expect(result.isError).toBe(false);
      expect(mockCallTool).toHaveBeenCalledWith("render_viewport_to_path", {
        output_path: "/tmp/my scene (1)/render.png",
      });
    });
  });
});
