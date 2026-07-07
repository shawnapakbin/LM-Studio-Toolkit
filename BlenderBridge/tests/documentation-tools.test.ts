/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Unit tests for documentation lookup passthrough tools.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { BlenderClient } from "../src/blender-client";
import { ToolHandler } from "../src/tools/health-check.tool";
import { createDocumentationTools } from "../src/tools/passthrough/documentation.tools";
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

describe("createDocumentationTools", () => {
  it("returns exactly 3 tools", () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    expect(tools).toHaveLength(3);
  });

  it("returns tools with correct names", () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const names = tools.map((t) => t.name);
    expect(names).toContain("blender_api_docs");
    expect(names).toContain("blender_search_api");
    expect(names).toContain("blender_search_manual");
  });

  it("all tools have descriptions of at least 20 characters", () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("blender_api_docs", () => {
  it("calls get_python_api_docs with the identifier parameter", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '{"kind":"exact","found":true}' }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const result = await tool.handler({ identifier: "bpy.types.Scene" });

    expect(client.callTool).toHaveBeenCalledWith("get_python_api_docs", {
      identifier: "bpy.types.Scene",
    });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('{"kind":"exact","found":true}');
  });

  it("returns validation error for empty identifier", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const result = await tool.handler({ identifier: "" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("identifier");
    expect(result.content[0].text).toContain("non-empty");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for identifier exceeding 256 characters", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const longId = "a".repeat(257);
    const result = await tool.handler({ identifier: longId });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("identifier");
    expect(result.content[0].text).toContain("256");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("accepts identifier at exactly 256 characters", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '{"found":true}' }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const exactId = "a".repeat(256);
    const result = await tool.handler({ identifier: exactId });

    expect(result.isError).toBe(false);
    expect(client.callTool).toHaveBeenCalledWith("get_python_api_docs", { identifier: exactId });
  });

  it("returns no-documentation message when result is empty", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: "[]" }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const result = await tool.handler({ identifier: "bpy.nonexistent" });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("No documentation found");
  });

  it("returns no-documentation message when content is empty string", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: "" }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const result = await tool.handler({ identifier: "bpy.nonexistent" });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("No documentation found");
  });

  it("returns no-documentation message when content is null text", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: "null" }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const result = await tool.handler({ identifier: "bpy.nonexistent" });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("No documentation found");
  });

  it("returns connection error when delegate throws", async () => {
    const client = createMockClient(async () => {
      throw new Error("Connection refused");
    });
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_api_docs");

    const result = await tool.handler({ identifier: "bpy.types.Scene" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("CONNECTION_ERROR");
    expect(parsed.error.message).toBe("Connection refused");
    expect(parsed.error.suggestion).toContain("blender_health_check");
  });
});

describe("blender_search_api", () => {
  it("calls search_api_docs with query and defaults", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '[{"path":"api.rst","score":10}]' }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "bake texture" });

    expect(client.callTool).toHaveBeenCalledWith("search_api_docs", {
      query: "bake texture",
      max_results: 20,
      context: 0,
    });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('[{"path":"api.rst","score":10}]');
  });

  it("passes custom max_results and context", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '[{"path":"api.rst"}]' }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    await tool.handler({ query: "render", max_results: 50, context: 3 });

    expect(client.callTool).toHaveBeenCalledWith("search_api_docs", {
      query: "render",
      max_results: 50,
      context: 3,
    });
  });

  it("returns validation error for empty query", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("query");
    expect(result.content[0].text).toContain("non-empty");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for query exceeding 256 characters", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "x".repeat(257) });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("query");
    expect(result.content[0].text).toContain("256");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for max_results below 1", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "render", max_results: 0 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("max_results");
    expect(result.content[0].text).toContain("1");
    expect(result.content[0].text).toContain("100");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for max_results above 100", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "render", max_results: 101 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("max_results");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for context below 0", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "render", context: -1 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("context");
    expect(result.content[0].text).toContain("0");
    expect(result.content[0].text).toContain("10");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for context above 10", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "render", context: 11 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("context");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns no-documentation message when results are empty", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: "[]" }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "zzz_nonexistent_topic" });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("No documentation found");
  });

  it("returns connection error when delegate throws", async () => {
    const client = createMockClient(async () => {
      throw new Error("ECONNREFUSED");
    });
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_api");

    const result = await tool.handler({ query: "render" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("CONNECTION_ERROR");
    expect(parsed.error.message).toBe("ECONNREFUSED");
    expect(parsed.error.suggestion).toContain("blender_health_check");
  });
});

describe("blender_search_manual", () => {
  it("calls search_manual_docs with query and defaults", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '[{"path":"manual.rst","score":5}]' }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    const result = await tool.handler({ query: "UV unwrap" });

    expect(client.callTool).toHaveBeenCalledWith("search_manual_docs", {
      query: "UV unwrap",
      max_results: 20,
      context: 0,
    });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('[{"path":"manual.rst","score":5}]');
  });

  it("passes custom max_results and context", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: '[{"path":"manual.rst"}]' }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    await tool.handler({ query: "sculpt", max_results: 10, context: 5 });

    expect(client.callTool).toHaveBeenCalledWith("search_manual_docs", {
      query: "sculpt",
      max_results: 10,
      context: 5,
    });
  });

  it("returns validation error for empty query", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    const result = await tool.handler({ query: "" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("query");
    expect(result.content[0].text).toContain("non-empty");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for query exceeding 256 characters", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    const result = await tool.handler({ query: "y".repeat(257) });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("query");
    expect(result.content[0].text).toContain("256");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for max_results out of range", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    const result = await tool.handler({ query: "sculpt", max_results: 200 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("max_results");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns validation error for context out of range", async () => {
    const client = createMockClient(async () => ({ isError: false, content: [] }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    const result = await tool.handler({ query: "sculpt", context: 15 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("context");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("returns no-documentation message when results are empty", async () => {
    const client = createMockClient(async () => ({
      isError: false,
      content: [{ type: "text", text: "[]" }],
    }));
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    const result = await tool.handler({ query: "zzz_nonexistent" });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("No documentation found");
  });

  it("returns connection error when delegate throws", async () => {
    const client = createMockClient(async () => {
      throw new Error("Timeout");
    });
    const tools = createDocumentationTools(defaultConfig, client);
    const tool = getToolByName(tools, "blender_search_manual");

    const result = await tool.handler({ query: "sculpt" });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text) as OrchestrationErrorResponse;
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe("CONNECTION_ERROR");
    expect(parsed.error.message).toBe("Timeout");
    expect(parsed.error.suggestion).toContain("blender_health_check");
  });
});
