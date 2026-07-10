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
  extractOperatorInfo,
  findClosestMatches,
  formatExecutionError,
  levenshteinDistance,
  similarityRatio,
  withTimeout,
} from "../src/blender-client";
import { BlenderBridgeConfig } from "../src/types";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
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
      expect(result.error?.operationType).toBe("code_execution");
      expect(result.error?.timeoutMs).toBe(50);
      expect(result.error?.suggestion).toContain("Retry with extended timeout");
      expect(result.error?.suggestion).toContain("50ms");
      expect(result.error?.suggestion).toContain("code_execution");
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

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("SUBSURF", "SUBSURF")).toBe(0);
  });

  it("returns length of other string when one is empty", () => {
    expect(levenshteinDistance("", "HELLO")).toBe(5);
    expect(levenshteinDistance("HELLO", "")).toBe(5);
  });

  it("computes correct distance for single-character changes", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1);
    expect(levenshteinDistance("cat", "cats")).toBe(1);
    expect(levenshteinDistance("cat", "at")).toBe(1);
  });

  it("computes correct distance for multi-character differences", () => {
    expect(levenshteinDistance("MIRROR", "ARRAY")).toBe(4);
    expect(levenshteinDistance("BEVEL", "BOOLEAN")).toBe(5);
  });
});

describe("similarityRatio", () => {
  it("returns 1 for identical strings", () => {
    expect(similarityRatio("SUBSURF", "SUBSURF")).toBe(1);
  });

  it("returns 0 for completely different strings of same length", () => {
    // "abc" vs "xyz" - distance 3, max length 3, ratio = 0
    expect(similarityRatio("abc", "xyz")).toBe(0);
  });

  it("returns correct ratio for partially similar strings", () => {
    // "SUBSURF" (7) vs "SUBDIVISION" (11) - max len 11
    const ratio = similarityRatio("SUBSURF", "SUBDIVISION");
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it("returns 1 for two empty strings", () => {
    expect(similarityRatio("", "")).toBe(1);
  });
});

describe("findClosestMatches", () => {
  const modifierEnums = ["ARRAY", "BEVEL", "BOOLEAN", "MIRROR", "SUBSURF"];

  it("finds SUBSURF as closest match for SUBDIVISION", () => {
    const matches = findClosestMatches("SUBDIVISION", modifierEnums);
    expect(matches).toContain("SUBSURF");
    expect(matches[0]).toBe("SUBSURF");
  });

  it("returns exact match when present (distance 0)", () => {
    const matches = findClosestMatches("ARRAY", modifierEnums);
    expect(matches[0]).toBe("ARRAY");
  });

  it("finds close matches within distance 3", () => {
    // "BOOLEN" is distance 2 from "BOOLEAN"
    const matches = findClosestMatches("BOOLEN", modifierEnums);
    expect(matches).toContain("BOOLEAN");
  });

  it("returns empty when no candidates are close", () => {
    const matches = findClosestMatches("COMPLETELY_DIFFERENT_VALUE", modifierEnums);
    expect(matches.length).toBe(0);
  });

  it("is case-insensitive", () => {
    const matches = findClosestMatches("subsurf", modifierEnums);
    expect(matches).toContain("SUBSURF");
  });

  it("sorts by similarity ratio (best match first)", () => {
    // "MIRRO" is distance 1 from "MIRROR" and distance 4 from "ARRAY"
    const matches = findClosestMatches("MIRRO", modifierEnums);
    expect(matches[0]).toBe("MIRROR");
  });
});

describe("extractOperatorInfo - did you mean suggestions", () => {
  it("suggests closest enum match for SUBDIVISION → SUBSURF", () => {
    const message = `RuntimeError: bpy.ops.object.modifier_add(): enum "SUBDIVISION" not found in ('ARRAY', 'BEVEL', 'BOOLEAN', 'MIRROR', 'SUBSURF')`;

    const info = extractOperatorInfo(message);

    expect(info).not.toBeNull();
    expect(info!.operatorName).toBe("object.modifier_add");
    expect(info!.availableEnums).toEqual(["ARRAY", "BEVEL", "BOOLEAN", "MIRROR", "SUBSURF"]);
    expect(info!.suggestions).toBeDefined();
    expect(
      info!.suggestions!.some((s) => s.includes("Did you mean") && s.includes("SUBSURF")),
    ).toBe(true);
  });

  it("suggests closest enum match for typos", () => {
    const message = `RuntimeError: bpy.ops.object.modifier_add(): enum "BOOLEN" not found in ('ARRAY', 'BEVEL', 'BOOLEAN', 'MIRROR', 'SUBSURF')`;

    const info = extractOperatorInfo(message);

    expect(info).not.toBeNull();
    expect(info!.suggestions).toBeDefined();
    expect(
      info!.suggestions!.some((s) => s.includes("Did you mean") && s.includes("BOOLEAN")),
    ).toBe(true);
  });

  it("does not suggest when no enum is close enough", () => {
    const message = `RuntimeError: bpy.ops.object.modifier_add(): enum "ZZZZZ" not found in ('ARRAY', 'BEVEL', 'BOOLEAN', 'MIRROR', 'SUBSURF')`;

    const info = extractOperatorInfo(message);

    expect(info).not.toBeNull();
    expect(info!.availableEnums).toEqual(["ARRAY", "BEVEL", "BOOLEAN", "MIRROR", "SUBSURF"]);
    // No "Did you mean" suggestions since nothing is close
    const didYouMeanSuggestions = (info!.suggestions || []).filter((s) =>
      s.includes("Did you mean"),
    );
    expect(didYouMeanSuggestions.length).toBe(0);
  });

  it("preserves context suggestions alongside enum suggestions", () => {
    const message = `RuntimeError: bpy.ops.object.modifier_add(): context is incorrect; enum "BOOLEN" not found in ('ARRAY', 'BEVEL', 'BOOLEAN', 'MIRROR', 'SUBSURF')`;

    const info = extractOperatorInfo(message);

    expect(info).not.toBeNull();
    // Should have both context suggestion and did-you-mean suggestion
    expect(info!.suggestions!.some((s) => s.includes("OBJECT mode"))).toBe(true);
    expect(
      info!.suggestions!.some((s) => s.includes("Did you mean") && s.includes("BOOLEAN")),
    ).toBe(true);
  });

  it("returns null for non-operator errors", () => {
    const message = "Connection refused to localhost:9876";
    const info = extractOperatorInfo(message);
    expect(info).toBeNull();
  });
});
