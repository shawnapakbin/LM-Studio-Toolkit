/**
 * Unit tests for navigation passthrough tools.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createNavigationTools } from "../src/tools/passthrough/navigation.tools";
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

describe("createNavigationTools", () => {
  let tools: ToolHandler[];
  let mockCallTool: jest.Mock;
  let client: BlenderClient;

  beforeEach(() => {
    mockCallTool = jest.fn();
    client = createMockClient(mockCallTool);
    tools = createNavigationTools(defaultConfig, client);
  });

  it("returns four tool handlers", () => {
    expect(tools).toHaveLength(4);
    expect(tools[0].name).toBe("blender_switch_tab");
    expect(tools[1].name).toBe("blender_switch_workspace");
    expect(tools[2].name).toBe("blender_focus_object");
    expect(tools[3].name).toBe("blender_focus_object_data");
  });

  // --- blender_switch_tab ---
  describe("blender_switch_tab", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[0];
    });

    it("calls upstream jump_to_tab_by_name with correct args", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Switched to Layout" }],
      });

      const result = await tool.handler({ name: "Layout" });

      expect(mockCallTool).toHaveBeenCalledWith("jump_to_tab_by_name", { name: "Layout" });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Switched to Layout");
    });

    it("returns validation error for empty name", async () => {
      const result = await tool.handler({ name: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("name");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for name exceeding 256 characters", async () => {
      const longName = "a".repeat(257);
      const result = await tool.handler({ name: longName });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("name");
      expect(result.content[0].text).toContain("256");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns upstream error with suggestion when tab not found", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Workspace 'Nonexistent' not found" }],
      });

      const result = await tool.handler({ name: "Nonexistent" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("not found");
      expect(parsed.error.suggestion).toContain("workspace tab");
      expect(parsed.error.suggestion).toContain("does not exist");
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.handler({ name: "Layout" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Connection refused");
    });
  });

  // --- blender_switch_workspace ---
  describe("blender_switch_workspace", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[1];
    });

    it("calls upstream jump_to_tab_by_space_type with correct args and allow_edits defaults to false", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Switched to VIEW_3D workspace" }],
      });

      const result = await tool.handler({ space_type: "VIEW_3D" });

      expect(mockCallTool).toHaveBeenCalledWith("jump_to_tab_by_space_type", {
        space_type: "VIEW_3D",
        allow_edits: false,
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Switched to VIEW_3D workspace");
    });

    it("forwards allow_edits=true to upstream", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Created new workspace for PROPERTIES" }],
      });

      const result = await tool.handler({ space_type: "PROPERTIES", allow_edits: true });

      expect(mockCallTool).toHaveBeenCalledWith("jump_to_tab_by_space_type", {
        space_type: "PROPERTIES",
        allow_edits: true,
      });
      expect(result.isError).toBe(false);
    });

    it("returns validation error for empty space_type", async () => {
      const result = await tool.handler({ space_type: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("space_type");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for space_type exceeding 256 characters", async () => {
      const longType = "X".repeat(257);
      const result = await tool.handler({ space_type: longType });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("space_type");
      expect(result.content[0].text).toContain("256");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns upstream error with suggestion when workspace not found", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Space type does not exist in current layout" }],
      });

      const result = await tool.handler({ space_type: "NONEXISTENT" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("does not exist");
      expect(parsed.error.suggestion).toContain("workspace space type");
      expect(parsed.error.suggestion).toContain("does not exist");
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await tool.handler({ space_type: "VIEW_3D" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("ECONNREFUSED");
    });
  });

  // --- blender_focus_object ---
  describe("blender_focus_object", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[2];
    });

    it("calls upstream jump_to_view3d_object_by_name with correct args and allow_edits defaults to false", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Focused on Cube" }],
      });

      const result = await tool.handler({ name: "Cube" });

      expect(mockCallTool).toHaveBeenCalledWith("jump_to_view3d_object_by_name", {
        name: "Cube",
        allow_edits: false,
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Focused on Cube");
    });

    it("forwards allow_edits=true to upstream", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Un-hidden and focused on HiddenObject" }],
      });

      const result = await tool.handler({ name: "HiddenObject", allow_edits: true });

      expect(mockCallTool).toHaveBeenCalledWith("jump_to_view3d_object_by_name", {
        name: "HiddenObject",
        allow_edits: true,
      });
      expect(result.isError).toBe(false);
    });

    it("returns validation error for empty name", async () => {
      const result = await tool.handler({ name: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("name");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for name exceeding 256 characters", async () => {
      const longName = "z".repeat(257);
      const result = await tool.handler({ name: longName });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("name");
      expect(result.content[0].text).toContain("256");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns upstream error with target-specific suggestion when object not found", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Object 'MissingObj' not found in scene" }],
      });

      const result = await tool.handler({ name: "MissingObj" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("not found");
      expect(parsed.error.suggestion).toContain("object");
      expect(parsed.error.suggestion).toContain("does not exist");
    });

    it("returns connection error when client throws non-Error", async () => {
      mockCallTool.mockRejectedValue("network timeout");

      const result = await tool.handler({ name: "Cube" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("network timeout");
    });
  });

  // --- blender_focus_object_data ---
  describe("blender_focus_object_data", () => {
    let tool: ToolHandler;

    beforeEach(() => {
      tool = tools[3];
    });

    it("calls upstream jump_to_view3d_object_data_by_name with correct args and allow_edits defaults to false", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Focused on data block CubeMesh" }],
      });

      const result = await tool.handler({ name: "CubeMesh" });

      expect(mockCallTool).toHaveBeenCalledWith("jump_to_view3d_object_data_by_name", {
        name: "CubeMesh",
        allow_edits: false,
      });
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe("Focused on data block CubeMesh");
    });

    it("forwards allow_edits=true to upstream", async () => {
      mockCallTool.mockResolvedValue({
        isError: false,
        content: [{ type: "text", text: "Un-hidden and focused on HiddenMesh" }],
      });

      const result = await tool.handler({ name: "HiddenMesh", allow_edits: true });

      expect(mockCallTool).toHaveBeenCalledWith("jump_to_view3d_object_data_by_name", {
        name: "HiddenMesh",
        allow_edits: true,
      });
      expect(result.isError).toBe(false);
    });

    it("returns validation error for empty name", async () => {
      const result = await tool.handler({ name: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("name");
      expect(result.content[0].text).toContain("non-empty");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns validation error for name exceeding 256 characters", async () => {
      const longName = "m".repeat(257);
      const result = await tool.handler({ name: longName });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("name");
      expect(result.content[0].text).toContain("256");
      expect(mockCallTool).not.toHaveBeenCalled();
    });

    it("returns upstream error with target-specific suggestion when data block not found", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Data block 'UnknownData' not found" }],
      });

      const result = await tool.handler({ name: "UnknownData" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("not found");
      expect(parsed.error.suggestion).toContain("data block");
      expect(parsed.error.suggestion).toContain("does not exist");
    });

    it("returns connection error when client throws", async () => {
      mockCallTool.mockRejectedValue(new Error("Socket closed"));

      const result = await tool.handler({ name: "CubeMesh" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("CONNECTION_ERROR");
      expect(parsed.error.message).toBe("Socket closed");
    });

    it("passes through non-not-found upstream errors without target suggestion", async () => {
      mockCallTool.mockResolvedValue({
        isError: true,
        content: [{ type: "text", text: "Internal server error occurred" }],
      });

      const result = await tool.handler({ name: "SomeMesh" });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe("UPSTREAM_ERROR");
      expect(parsed.error.message).toContain("Internal server error");
      // No target-specific suggestion for non-"not found" errors
      expect(parsed.error.suggestion).toBeUndefined();
    });
  });
});
