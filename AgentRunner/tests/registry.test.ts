/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Tool Registry Tests
 */

import { ToolCapability, ToolRegistry, ToolStatus, registerDefaultTools } from "../src/registry";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  afterEach(() => {
    registry.stopHealthCheckMonitor();
  });

  describe("Tool Registration", () => {
    test("registers a tool", () => {
      registry.register({
        id: "test-tool",
        name: "Test Tool",
        description: "A test tool",
        version: "1.0.0",
        capabilities: [ToolCapability.COMPUTE],
        httpEndpoint: "http://localhost:3000",
        healthEndpoint: "http://localhost:3000/health",
        schemaEndpoint: "http://localhost:3000/schema",
        status: ToolStatus.UNKNOWN,
      });

      const tool = registry.getTool("test-tool");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("Test Tool");
      expect(tool?.capabilities).toContain(ToolCapability.COMPUTE);
    });

    test("gets all registered tools", () => {
      registry.register({
        id: "tool1",
        name: "Tool 1",
        description: "First tool",
        version: "1.0.0",
        capabilities: [ToolCapability.READ],
        httpEndpoint: "http://localhost:3001",
        healthEndpoint: "http://localhost:3001/health",
        schemaEndpoint: "http://localhost:3001/schema",
        status: ToolStatus.UNKNOWN,
      });

      registry.register({
        id: "tool2",
        name: "Tool 2",
        description: "Second tool",
        version: "1.0.0",
        capabilities: [ToolCapability.EXECUTE],
        httpEndpoint: "http://localhost:3002",
        healthEndpoint: "http://localhost:3002/health",
        schemaEndpoint: "http://localhost:3002/schema",
        status: ToolStatus.UNKNOWN,
      });

      const allTools = registry.getAllTools();
      expect(allTools).toHaveLength(2);
      expect(allTools.map((t) => t.id)).toContain("tool1");
      expect(allTools.map((t) => t.id)).toContain("tool2");
    });

    test("returns undefined for non-existent tool", () => {
      const tool = registry.getTool("non-existent");
      expect(tool).toBeUndefined();
    });
  });

  describe("Tool Filtering", () => {
    beforeEach(() => {
      registry.register({
        id: "read-tool",
        name: "Read Tool",
        description: "Read-only tool",
        version: "1.0.0",
        capabilities: [ToolCapability.READ],
        httpEndpoint: "http://localhost:3001",
        healthEndpoint: "http://localhost:3001/health",
        schemaEndpoint: "http://localhost:3001/schema",
        status: ToolStatus.HEALTHY,
      });

      registry.register({
        id: "execute-tool",
        name: "Execute Tool",
        description: "Execute tool",
        version: "1.0.0",
        capabilities: [ToolCapability.EXECUTE],
        httpEndpoint: "http://localhost:3002",
        healthEndpoint: "http://localhost:3002/health",
        schemaEndpoint: "http://localhost:3002/schema",
        status: ToolStatus.UNHEALTHY,
      });

      registry.register({
        id: "compute-tool",
        name: "Compute Tool",
        description: "Compute tool",
        version: "1.0.0",
        capabilities: [ToolCapability.COMPUTE],
        httpEndpoint: "http://localhost:3003",
        healthEndpoint: "http://localhost:3003/health",
        schemaEndpoint: "http://localhost:3003/schema",
        status: ToolStatus.HEALTHY,
      });
    });

    test("filters tools by capability", () => {
      const readTools = registry.getToolsByCapability(ToolCapability.READ);
      expect(readTools).toHaveLength(1);
      expect(readTools[0].id).toBe("read-tool");

      const executeTools = registry.getToolsByCapability(ToolCapability.EXECUTE);
      expect(executeTools).toHaveLength(1);
      expect(executeTools[0].id).toBe("execute-tool");
    });

    test("filters healthy tools only", () => {
      const healthyTools = registry.getHealthyTools();
      expect(healthyTools).toHaveLength(2);
      expect(healthyTools.map((t) => t.id)).toContain("read-tool");
      expect(healthyTools.map((t) => t.id)).toContain("compute-tool");
      expect(healthyTools.map((t) => t.id)).not.toContain("execute-tool");
    });
  });

  describe("Statistics", () => {
    test("provides accurate statistics", () => {
      registry.register({
        id: "tool1",
        name: "Tool 1",
        description: "First tool",
        version: "1.0.0",
        capabilities: [ToolCapability.READ, ToolCapability.COMPUTE],
        httpEndpoint: "http://localhost:3001",
        healthEndpoint: "http://localhost:3001/health",
        schemaEndpoint: "http://localhost:3001/schema",
        status: ToolStatus.HEALTHY,
      });

      registry.register({
        id: "tool2",
        name: "Tool 2",
        description: "Second tool",
        version: "1.0.0",
        capabilities: [ToolCapability.EXECUTE],
        httpEndpoint: "http://localhost:3002",
        healthEndpoint: "http://localhost:3002/health",
        schemaEndpoint: "http://localhost:3002/schema",
        status: ToolStatus.UNHEALTHY,
      });

      const stats = registry.getStats();
      expect(stats.totalTools).toBe(2);
      expect(stats.healthyTools).toBe(1);
      expect(stats.unhealthyTools).toBe(1);
      expect(stats.unknownTools).toBe(0);
      expect(stats.toolsByCapability[ToolCapability.READ]).toBe(1);
      expect(stats.toolsByCapability[ToolCapability.COMPUTE]).toBe(1);
      expect(stats.toolsByCapability[ToolCapability.EXECUTE]).toBe(1);
    });
  });

  describe("Default Tools Registration", () => {
    test("registers all default tools", () => {
      registerDefaultTools(registry);

      const allTools = registry.getAllTools();
      expect(allTools.length).toBeGreaterThanOrEqual(5);

      const toolIds = allTools.map((t) => t.id);
      expect(toolIds).toContain("terminal");
      expect(toolIds).toContain("webbrowser");
      expect(toolIds).toContain("calculator");
      expect(toolIds).toContain("document-scraper");
      expect(toolIds).toContain("clock");
      expect(toolIds).toContain("browserless");
    });

    test("default tools have correct properties", () => {
      registerDefaultTools(registry);

      const calculator = registry.getTool("calculator");
      expect(calculator).toBeDefined();
      expect(calculator?.name).toBe("Calculator");
      expect(calculator?.capabilities).toContain(ToolCapability.COMPUTE);
      expect(calculator?.version).toBe("1.0.0");
      expect(calculator?.status).toBe(ToolStatus.UNKNOWN);
    });
  });

  describe("Health Check", () => {
    test("returns error for non-existent tool", async () => {
      const result = await registry.checkToolHealth("non-existent");
      expect(result.success).toBe(false);
      expect(result.status).toBe(ToolStatus.UNKNOWN);
      expect(result.error).toContain("not found");
    });

    test("detects unhealthy tool (network error)", async () => {
      registry.register({
        id: "test-tool",
        name: "Test Tool",
        description: "Test",
        version: "1.0.0",
        capabilities: [ToolCapability.COMPUTE],
        httpEndpoint: "http://localhost:9999",
        healthEndpoint: "http://localhost:9999/health",
        schemaEndpoint: "http://localhost:9999/schema",
        status: ToolStatus.UNKNOWN,
      });

      const result = await registry.checkToolHealth("test-tool");
      expect(result.success).toBe(false);
      expect(result.status).toBe(ToolStatus.UNHEALTHY);
      expect(result.error).toBeDefined();
    }, 10000);
  });
});
