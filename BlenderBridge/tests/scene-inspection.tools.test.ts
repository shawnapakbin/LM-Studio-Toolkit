/**
 * Unit tests for scene-inspection passthrough tools.
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createSceneInspectionTools } from "../src/tools/passthrough/scene-inspection.tools";
import { BlenderBridgeConfig, CallToolResult, OrchestrationErrorResponse } from "../src/types";

// --- Test helpers ---

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
  callToolImpl: (toolName: string, args: Record<string, unknown>) => Promise<CallToolResult>,
): BlenderClient {
  return {
    executeCode: jest.fn(),
    getSceneSummary: jest.fn(),
    getBlenderVersion: jest.fn(),
    callTool: jest.fn(callToolImpl),
  };
}

function getToolByName(tools: ToolHandler[], name: string): ToolHandler {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

describe("createSceneInspectionTools", () => {
  it("returns exactly 2 tools", () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    expect(tools).toHaveLength(2);
  });

  it("returns tools with correct names", () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const names = tools.map((t) => t.name);
    expect(names).toContain("blender_object_detail");
    expect(names).toContain("blender_objects_list");
  });

  it("all tools have descriptions of at least 20 characters", () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("blender_object_detail", () => {
  it("calls get_object_detail_summary with the name parameter", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '{"type":"MESH","name":"Cube"}' }],
    }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_object_detail");

    const result = await tool.handler({ name: "Cube" });

    expect(client.callTool).toHaveBeenCalledWith("get_object_detail_summary", { name: "Cube" });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('{"type":"MESH","name":"Cube"}');
  });

  it("returns validation error for empty name", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_object_detail");

    const result = await tool.handler({ name: "" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("name");
    expect(result.content[0].text).toContain("non-empty");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for name exceeding 256 characters", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_object_detail");

    const longName = "a".repeat(257);
    const result = await tool.handler({ name: longName });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("name");
    expect(result.content[0].text).toContain("256");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("accepts name at exactly 256 characters", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '{"type":"MESH"}' }],
    }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_object_detail");

    const exactName = "a".repeat(256);
    const result = await tool.handler({ name: exactName });

    expect(result.isError).toBe(false);
    expect(client.callTool).toHaveBeenCalledWith("get_object_detail_summary", { name: exactName });
  });

  it("returns upstream error with suggestion when object not found", async () => {
    const client = createMockClient(async () => ({
      isError: true,
      content: [{ type: "text", text: "Object 'MissingCube' not found in scene" }],
    }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_object_detail");

    const result = await tool.handler({ name: "MissingCube" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("UPSTREAM_ERROR");
    expect(parsed.error.message).toContain("not found");
    expect(parsed.error.suggestion).toContain("blender_objects_list");
  });

  it("returns generic upstream error for non-not-found errors", async () => {
    const client = createMockClient(async () => ({
      isError: true,
      content: [{ type: "text", text: "Internal server error: something broke" }],
    }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_object_detail");

    const result = await tool.handler({ name: "Cube" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("UPSTREAM_ERROR");
    expect(parsed.error.message).toContain("something broke");
    // No blender_objects_list suggestion for non-not-found errors
    expect(parsed.error.suggestion).toBeUndefined();
  });

  it("returns connection error when delegate throws", async () => {
    const client = createMockClient(async () => {
      throw new Error("Connection refused");
    });
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_object_detail");

    const result = await tool.handler({ name: "Cube" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("CONNECTION_ERROR");
    expect(parsed.error.message).toBe("Connection refused");
    expect(parsed.error.suggestion).toContain("blender_health_check");
  });
});

describe("blender_objects_list", () => {
  it("calls get_objects_summary with no arguments", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '{"collections":[]}' }],
    }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_objects_list");

    const result = await tool.handler({});

    expect(client.callTool).toHaveBeenCalledWith("get_objects_summary", {});
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('{"collections":[]}');
  });

  it("returns connection error when delegate throws", async () => {
    const client = createMockClient(async () => {
      throw new Error("Process not running");
    });
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_objects_list");

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("CONNECTION_ERROR");
    expect(parsed.error.message).toBe("Process not running");
  });

  it("passes through upstream error responses", async () => {
    const client = createMockClient(async () => ({
      isError: true,
      content: [{ type: "text", text: "Scene context unavailable" }],
    }));
    const tools = createSceneInspectionTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_objects_list");

    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("UPSTREAM_ERROR");
    expect(parsed.error.message).toContain("Scene context unavailable");
  });
});
