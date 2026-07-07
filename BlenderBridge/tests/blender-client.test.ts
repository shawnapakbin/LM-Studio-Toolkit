/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import {
  ExecuteBlenderCodeFn,
  TimeoutError,
  createBlenderClient,
  formatExecutionError,
  withTimeout,
} from "../src/blender-client";
import { BlenderBridgeConfig } from "../src/types";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  threeDToolHost: "http://localhost:3344",
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

describe("BlenderClient", () => {
  describe("executeCode", () => {
    it("returns success with output when delegate resolves", async () => {
      const delegate: ExecuteBlenderCodeFn = async () => '{"name": "Cube"}';
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("import bpy\nresult = bpy.app.version_string");

      expect(result.success).toBe(true);
      expect(result.output).toBe('{"name": "Cube"}');
      expect(result.error).toBeUndefined();
    });

    it("passes python code to the delegate", async () => {
      let receivedCode = "";
      const delegate: ExecuteBlenderCodeFn = async (code) => {
        receivedCode = code;
        return "ok";
      };
      const client = createBlenderClient(defaultConfig, delegate);

      await client.executeCode("print('hello')");

      expect(receivedCode).toBe("print('hello')");
    });

    it("returns BLENDER_TIMEOUT when operation exceeds timeout", async () => {
      const delegate: ExecuteBlenderCodeFn = () =>
        new Promise((resolve) => setTimeout(() => resolve("late"), 200));
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("import bpy", 50);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timed out");
      expect(result.error?.suggestion).toContain("blender_health_check");
    });

    it("uses config.operationTimeoutMs as default timeout", async () => {
      const fastConfig = { ...defaultConfig, operationTimeoutMs: 50 };
      const delegate: ExecuteBlenderCodeFn = () =>
        new Promise((resolve) => setTimeout(() => resolve("late"), 200));
      const client = createBlenderClient(fastConfig, delegate);

      const result = await client.executeCode("import bpy");

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timed out");
    });

    it("formats execution errors with traceback when present", async () => {
      const tracebackError = `Traceback (most recent call last):
  File "<string>", line 1, in <module>
ModuleNotFoundError: No module named 'numpy'`;
      const delegate: ExecuteBlenderCodeFn = async () => {
        throw new Error(tracebackError);
      };
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("import numpy");

      expect(result.success).toBe(false);
      expect(result.error?.traceback).toContain("Traceback (most recent call last):");
      expect(result.error?.traceback).toContain("ModuleNotFoundError");
      expect(result.error?.message).toBe(tracebackError);
      expect(result.error?.suggestion).toBeDefined();
      expect(result.error!.suggestion!.length).toBeGreaterThan(0);
    });

    it("formats errors without traceback", async () => {
      const delegate: ExecuteBlenderCodeFn = async () => {
        throw new Error("Connection refused");
      };
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("import bpy");

      expect(result.success).toBe(false);
      expect(result.error?.traceback).toBeUndefined();
      expect(result.error?.message).toBe("Connection refused");
      expect(result.error?.suggestion).toBeDefined();
    });

    it("handles non-Error thrown values", async () => {
      const delegate: ExecuteBlenderCodeFn = async () => {
        throw "raw string error";
      };
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.executeCode("import bpy");

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("raw string error");
    });
  });

  describe("getSceneSummary", () => {
    it("executes scene summary Python code via delegate", async () => {
      let receivedCode = "";
      const delegate: ExecuteBlenderCodeFn = async (code) => {
        receivedCode = code;
        return '{"sceneName": "Scene", "objects": []}';
      };
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.getSceneSummary();

      expect(result.success).toBe(true);
      expect(receivedCode).toContain("bpy.context.scene");
      expect(receivedCode).toContain("json.dumps");
    });
  });

  describe("getBlenderVersion", () => {
    it("executes version retrieval Python code via delegate", async () => {
      let receivedCode = "";
      const delegate: ExecuteBlenderCodeFn = async (code) => {
        receivedCode = code;
        return "5.1.0";
      };
      const client = createBlenderClient(defaultConfig, delegate);

      const result = await client.getBlenderVersion();

      expect(result.success).toBe(true);
      expect(result.output).toBe("5.1.0");
      expect(receivedCode).toContain("bpy.app.version_string");
    });
  });
});

describe("formatExecutionError", () => {
  it("extracts traceback from error with Python traceback", () => {
    const error = new Error(
      `Something went wrong\nTraceback (most recent call last):\n  File "<string>", line 2\nNameError: name 'foo' is not defined`,
    );

    const result = formatExecutionError(error);

    expect(result.success).toBe(false);
    expect(result.error?.traceback).toContain("Traceback (most recent call last):");
    expect(result.error?.traceback).toContain("NameError");
  });

  it("provides ModuleNotFoundError suggestion", () => {
    const error = new Error(
      `Traceback (most recent call last):\n  File "<string>", line 1\nModuleNotFoundError: No module named 'pandas'`,
    );

    const result = formatExecutionError(error);

    expect(result.error?.suggestion).toContain("module");
  });

  it("provides AttributeError suggestion", () => {
    const error = new Error(
      `Traceback (most recent call last):\n  File "<string>", line 1\nAttributeError: 'Object' has no attribute 'foo'`,
    );

    const result = formatExecutionError(error);

    expect(result.error?.suggestion).toContain("attribute");
  });

  it("provides TypeError suggestion", () => {
    const error = new Error(
      `Traceback (most recent call last):\n  File "<string>", line 1\nTypeError: expected 2 args`,
    );

    const result = formatExecutionError(error);

    expect(result.error?.suggestion).toContain("type");
  });

  it("provides NameError suggestion", () => {
    const error = new Error(
      `Traceback (most recent call last):\n  File "<string>", line 1\nNameError: name 'x' is not defined`,
    );

    const result = formatExecutionError(error);

    expect(result.error?.suggestion).toContain("import");
  });

  it("provides RuntimeError suggestion", () => {
    const error = new Error(
      `Traceback (most recent call last):\n  File "<string>", line 1\nRuntimeError: operator not available in this context`,
    );

    const result = formatExecutionError(error);

    expect(result.error?.suggestion).toContain("runtime");
  });

  it("provides connection error suggestion", () => {
    const error = new Error("Connection refused to localhost:9876");

    const result = formatExecutionError(error);

    expect(result.error?.suggestion).toContain("blender_health_check");
  });

  it("provides generic suggestion for unknown errors", () => {
    const error = new Error("Something completely unexpected happened");

    const result = formatExecutionError(error);

    expect(result.error?.suggestion).toBeDefined();
    expect(result.error!.suggestion!.length).toBeGreaterThan(0);
  });

  it("handles non-Error values", () => {
    const result = formatExecutionError(42);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("42");
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("hello"), 1000);
    expect(result).toBe("hello");
  });

  it("rejects with TimeoutError when promise exceeds timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));

    await expect(withTimeout(slow, 50)).rejects.toThrow(TimeoutError);
  });

  it("passes through rejections from the original promise", async () => {
    const failing = Promise.reject(new Error("original error"));

    await expect(withTimeout(failing, 1000)).rejects.toThrow("original error");
  });
});
