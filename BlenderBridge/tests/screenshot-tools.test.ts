/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Unit tests for screenshot passthrough tools.
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createScreenshotTools } from "../src/tools/passthrough/screenshot.tools";
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

describe("createScreenshotTools", () => {
  let tools: ToolHandler[];
  let mockCallTool: jest.Mock;
  let client: BlenderClient;

  beforeEach(() => {
    mockCallTool = jest.fn();
    client = createMockClient(mockCallTool);
    tools = createScreenshotTools(defaultConfig, client);
  });

  it("returns three tool handlers", () => {
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe("blender_screenshot_area");
    expect(tools[1].name).toBe("blender_screenshot_window");
    expect(tools[2].name).toBe("blender_window_layout");
  });

  describe("blender_screenshot_area", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[0];
    });

    it("calls client.callTool with get_screenshot_of_area_as_image for valid enum value", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "screenshot captured" }],
      });

      const result = await tool.handler({ area_ui_type: "VIEW_3D" });

      expect(mockCallTool).toHaveBeenCalledWith("get_screenshot_of_area_as_image", {
        area_ui_type: "VIEW_3D",
        size_limit_in_bytes: 0,
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("screenshot captured");
    });

    it("accepts all valid area_ui_type enum values", async () => {
      const validTypes = [
        "VIEW_3D",
        "IMAGE_EDITOR",
        "UV",
        "ShaderNodeTree",
        "CompositorNodeTree",
        "GeometryNodeTree",
        "TextureNodeTree",
        "SEQUENCE_EDITOR",
        "CLIP_EDITOR",
        "DOPESHEET_EDITOR",
        "GRAPH_EDITOR",
        "NLA_EDITOR",
        "TEXT_EDITOR",
        "CONSOLE",
        "INFO",
        "TOPBAR",
        "STATUSBAR",
        "OUTLINER",
        "PROPERTIES",
        "FILE_BROWSER",
        "SPREADSHEET",
        "PREFERENCES",
      ];

      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "ok" }],
      });

      for (const areaType of validTypes) {
        const result = await tool.handler({ area_ui_type: areaType });
        expect(result.isError).toBe(false);
      }
    });

    it("returns validation error for invalid area_ui_type", async () => {
      const result = await tool.handler({ area_ui_type: "INVALID_TYPE" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("area_ui_type");
      expect(result.content[0].text).toContain("must be one of");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("forwards size_limit_in_bytes when provided", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "ok" }],
      });

      await tool.handler({ area_ui_type: "VIEW_3D", size_limit_in_bytes: 5000000 });

      expect(mockCallTool).toHaveBeenCalledWith("get_screenshot_of_area_as_image", {
        area_ui_type: "VIEW_3D",
        size_limit_in_bytes: 5000000,
      });
    });

    it("defaults size_limit_in_bytes to 0 when not provided", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "ok" }],
      });

      await tool.handler({ area_ui_type: "OUTLINER" });

      expect(mockCallTool).toHaveBeenCalledWith("get_screenshot_of_area_as_image", {
        area_ui_type: "OUTLINER",
        size_limit_in_bytes: 0,
      });
    });

    it("returns validation error for size_limit_in_bytes exceeding max (10485760)", async () => {
      const result = await tool.handler({
        area_ui_type: "VIEW_3D",
        size_limit_in_bytes: 10485761,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("size_limit_in_bytes");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for negative size_limit_in_bytes", async () => {
      const result = await tool.handler({
        area_ui_type: "VIEW_3D",
        size_limit_in_bytes: -1,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("size_limit_in_bytes");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("handles image-too-large upstream error with suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Image too large: exceeds size limit of 1048576 bytes" }],
      });

      const result = await tool.handler({
        area_ui_type: "VIEW_3D",
        size_limit_in_bytes: 1048576,
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.suggestion).toContain("size_limit_in_bytes");
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.handler({ area_ui_type: "VIEW_3D" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Connection refused");
    });
  });

  describe("blender_screenshot_window", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[1];
    });

    it("calls client.callTool with get_screenshot_of_window_as_image", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "window screenshot captured" }],
      });

      const result = await tool.handler({});

      expect(mockCallTool).toHaveBeenCalledWith("get_screenshot_of_window_as_image", {
        size_limit_in_bytes: 0,
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("window screenshot captured");
    });

    it("forwards size_limit_in_bytes when provided", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "ok" }],
      });

      await tool.handler({ size_limit_in_bytes: 2000000 });

      expect(mockCallTool).toHaveBeenCalledWith("get_screenshot_of_window_as_image", {
        size_limit_in_bytes: 2000000,
      });
    });

    it("returns validation error for size_limit_in_bytes exceeding max", async () => {
      const result = await tool.handler({ size_limit_in_bytes: 10485761 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("size_limit_in_bytes");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for negative size_limit_in_bytes", async () => {
      const result = await tool.handler({ size_limit_in_bytes: -5 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("size_limit_in_bytes");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("handles image-too-large upstream error with suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Image size exceeds the specified limit" }],
      });

      const result = await tool.handler({ size_limit_in_bytes: 500000 });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.suggestion).toContain("size_limit_in_bytes");
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("ECONNREFUSED");
    });
  });

  describe("blender_window_layout", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[2];
    });

    it("calls client.callTool with get_screenshot_of_window_as_json", async () => {
      const layoutJson = JSON.stringify({
        areas: [{ type: "VIEW_3D", width: 800, height: 600 }],
        active_object: "Cube",
      });

      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: layoutJson }],
      });

      const result = await tool.handler({});

      expect(mockCallTool).toHaveBeenCalledWith("get_screenshot_of_window_as_json", {});
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe(layoutJson);
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Process not running"));

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Process not running");
      expect(parsed.error.suggestion).toContain("blender_health_check");
    });

    it("passes through upstream error responses", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "No active window found" }],
      });

      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("No active window found");
    });
  });
});
