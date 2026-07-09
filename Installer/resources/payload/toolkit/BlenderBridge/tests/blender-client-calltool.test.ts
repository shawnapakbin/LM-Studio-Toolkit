/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { ExecuteBlenderCodeFn, createBlenderClient } from "../src/blender-client";
import { BlenderBridgeConfig, CallToolContent, CallToolFn } from "../src/types";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

const mockExecuteCode: ExecuteBlenderCodeFn = async () => "mock output";

describe("BlenderClient.callTool", () => {
  describe("successful delegation with mock CallToolFn", () => {
    it("returns isError false with content from delegate", async () => {
      const expectedContent: CallToolContent[] = [
        { type: "text", text: '{"sceneName":"Scene","objects":[]}' },
      ];
      const mockCallTool: CallToolFn = async () => expectedContent;
      const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

      const result = await client.callTool("get_objects_summary", {});

      expect(result.isError).toBe(false);
      expect(result.content).toEqual(expectedContent);
    });

    it("returns image content from delegate unchanged", async () => {
      const expectedContent: CallToolContent[] = [
        { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
      ];
      const mockCallTool: CallToolFn = async () => expectedContent;
      const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

      const result = await client.callTool("get_screenshot_of_window_as_image", {});

      expect(result.isError).toBe(false);
      expect(result.content).toEqual(expectedContent);
    });
  });

  describe("passes correct toolName and args to delegate", () => {
    it("forwards toolName and args exactly as provided", async () => {
      const calls: { toolName: string; args: Record<string, unknown> }[] = [];
      const mockCallTool: CallToolFn = async (toolName, args) => {
        calls.push({ toolName, args });
        return [{ type: "text", text: "ok" }];
      };
      const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

      await client.callTool("get_object_detail_summary", { name: "Cube" });

      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe("get_object_detail_summary");
      expect(calls[0].args).toEqual({ name: "Cube" });
    });

    it("forwards complex args without modification", async () => {
      const calls: { toolName: string; args: Record<string, unknown> }[] = [];
      const mockCallTool: CallToolFn = async (toolName, args) => {
        calls.push({ toolName, args });
        return [{ type: "text", text: "ok" }];
      };
      const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

      const complexArgs = {
        blend_file: "C:\\projects\\model.blend",
        code: "import bpy\nresult = bpy.app.version_string",
      };
      await client.callTool("execute_blender_code_for_cli", complexArgs);

      expect(calls[0].toolName).toBe("execute_blender_code_for_cli");
      expect(calls[0].args).toEqual(complexArgs);
    });
  });

  describe("delegate not configured (undefined CallToolFn)", () => {
    it("returns isError true with not-configured message", async () => {
      const client = createBlenderClient(defaultConfig, mockExecuteCode);

      const result = await client.callTool("get_objects_summary", {});

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect((result.content[0] as { type: "text"; text: string }).text).toContain(
        "not configured",
      );
    });

    it("returns not-configured error for any tool name", async () => {
      const client = createBlenderClient(defaultConfig, mockExecuteCode);

      const result = await client.callTool("search_api_docs", { query: "bpy" });

      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: "text"; text: string }).text).toContain(
        "not configured",
      );
    });
  });

  describe("delegate throws Error", () => {
    it("returns isError true with the error message", async () => {
      const mockCallTool: CallToolFn = async () => {
        throw new Error("Connection refused to localhost:9876");
      };
      const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

      const result = await client.callTool("get_objects_summary", {});

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect((result.content[0] as { type: "text"; text: string }).text).toBe(
        "Connection refused to localhost:9876",
      );
    });

    it("returns isError true with message from non-Error throw", async () => {
      const mockCallTool: CallToolFn = async () => {
        throw "raw string error";
      };
      const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

      const result = await client.callTool("get_objects_summary", {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: "text"; text: string }).text).toBe("raw string error");
    });

    it("propagates unrecognized tool name error from delegate", async () => {
      const mockCallTool: CallToolFn = async () => {
        throw new Error("Tool 'nonexistent_tool' is not available on the upstream server");
      };
      const client = createBlenderClient(defaultConfig, mockExecuteCode, mockCallTool);

      const result = await client.callTool("nonexistent_tool", {});

      expect(result.isError).toBe(true);
      expect((result.content[0] as { type: "text"; text: string }).text).toContain(
        "nonexistent_tool",
      );
      expect((result.content[0] as { type: "text"; text: string }).text).toContain("not available");
    });
  });

  describe("timeout handling", () => {
    it("returns isError true with timeout message when delegate is slow", async () => {
      const shortTimeoutConfig = { ...defaultConfig, operationTimeoutMs: 50 };
      const mockCallTool: CallToolFn = async () => {
        return new Promise((resolve) =>
          setTimeout(() => resolve([{ type: "text", text: "late" }]), 200),
        );
      };
      const client = createBlenderClient(shortTimeoutConfig, mockExecuteCode, mockCallTool);

      const result = await client.callTool("get_objects_summary", {});

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("timed out");
    });

    it("includes the tool name in the timeout message", async () => {
      const shortTimeoutConfig = { ...defaultConfig, operationTimeoutMs: 50 };
      const mockCallTool: CallToolFn = async () => {
        return new Promise((resolve) =>
          setTimeout(() => resolve([{ type: "text", text: "late" }]), 200),
        );
      };
      const client = createBlenderClient(shortTimeoutConfig, mockExecuteCode, mockCallTool);

      const result = await client.callTool("search_api_docs", { query: "bpy" });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toContain("search_api_docs");
    });
  });

  describe("executeCode still works unchanged (regression)", () => {
    it("executeCode returns success when both delegates are provided", async () => {
      const executeDelegate: ExecuteBlenderCodeFn = async (code) => `executed: ${code}`;
      const mockCallTool: CallToolFn = async () => [{ type: "text", text: "callTool response" }];
      const client = createBlenderClient(defaultConfig, executeDelegate, mockCallTool);

      const result = await client.executeCode("import bpy");

      expect(result.success).toBe(true);
      expect(result.output).toBe("executed: import bpy");
    });

    it("executeCode works when callTool delegate is not provided", async () => {
      const executeDelegate: ExecuteBlenderCodeFn = async () => "version 5.1.0";
      const client = createBlenderClient(defaultConfig, executeDelegate);

      const result = await client.executeCode("import bpy\nresult = bpy.app.version_string");

      expect(result.success).toBe(true);
      expect(result.output).toBe("version 5.1.0");
    });

    it("executeCode timeout still works independently of callTool", async () => {
      const slowDelegate: ExecuteBlenderCodeFn = () =>
        new Promise((resolve) => setTimeout(() => resolve("late"), 200));
      const mockCallTool: CallToolFn = async () => [{ type: "text", text: "ok" }];
      const client = createBlenderClient(defaultConfig, slowDelegate, mockCallTool);

      const result = await client.executeCode("import bpy", 50);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timed out");
    });
  });
});
