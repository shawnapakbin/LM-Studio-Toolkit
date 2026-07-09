/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Unit tests for BlenderBridge orchestration tools.
 *
 * Validates: Requirements 4.2, 4.6, 8.2, 8.3, 8.4
 */

import { BlenderClient, ExecuteBlenderCodeFn, createBlenderClient } from "../src/blender-client";
import { validateCreateObjectInput } from "../src/tools/create-object.tool";
import { BlenderBridgeConfig } from "../src/types";

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  healthCheckTimeoutMs: 5000,
  operationTimeoutMs: 30000,
};

// --- create-object validation tests (Req 4.2) ---

describe("create-object validation (Req 4.2)", () => {
  describe("name validation", () => {
    it("rejects name longer than 63 characters with '1-63 characters' message", () => {
      const longName = "a".repeat(64);
      const result = validateCreateObjectInput({
        name: longName,
        geometryType: "cube",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("1-63 characters");
    });

    it("rejects empty name with '1-63 characters' message", () => {
      const result = validateCreateObjectInput({
        name: "",
        geometryType: "cube",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("1-63 characters");
    });

    it("rejects name with spaces with 'alphanumeric' message", () => {
      const result = validateCreateObjectInput({
        name: "my object",
        geometryType: "cube",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("alphanumeric");
    });

    it("rejects name with dashes with 'alphanumeric' message", () => {
      const result = validateCreateObjectInput({
        name: "my-object",
        geometryType: "cube",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("alphanumeric");
    });

    it("rejects name with special characters with 'alphanumeric' message", () => {
      const result = validateCreateObjectInput({
        name: "obj@#$!",
        geometryType: "cube",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("alphanumeric");
    });
  });

  describe("geometry type validation", () => {
    it("rejects invalid geometry type 'hexagon' with accepted types list", () => {
      const result = validateCreateObjectInput({
        name: "MyObject",
        geometryType: "hexagon",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("cube");
      expect(result).toContain("sphere");
      expect(result).toContain("cylinder");
      expect(result).toContain("cone");
      expect(result).toContain("torus");
      expect(result).toContain("plane");
      expect(result).toContain("circle");
      expect(result).toContain("curve");
      expect(result).toContain("empty");
    });

    it("rejects unknown geometry type 'triangle'", () => {
      const result = validateCreateObjectInput({
        name: "MyObject",
        geometryType: "triangle",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("geometryType");
    });
  });

  describe("transform validation", () => {
    it("rejects location with NaN value", () => {
      const result = validateCreateObjectInput({
        name: "MyObject",
        geometryType: "cube",
        location: [1, NaN, 3],
      });

      expect(result).not.toBeNull();
      expect(result).toContain("location");
    });

    it("rejects scale with 0 value", () => {
      const result = validateCreateObjectInput({
        name: "MyObject",
        geometryType: "cube",
        scale: [1, 0, 1],
      });

      expect(result).not.toBeNull();
      expect(result).toContain("scale");
    });

    it("rejects scale with negative value", () => {
      const result = validateCreateObjectInput({
        name: "MyObject",
        geometryType: "cube",
        scale: [1, 1, -2],
      });

      expect(result).not.toBeNull();
      expect(result).toContain("scale");
    });

    it("rejects rotation with Infinity", () => {
      const result = validateCreateObjectInput({
        name: "MyObject",
        geometryType: "cube",
        rotation: [0, Infinity, 0],
      });

      expect(result).not.toBeNull();
      expect(result).toContain("rotation");
    });
  });

  describe("valid inputs", () => {
    it("returns null for valid minimal input", () => {
      const result = validateCreateObjectInput({
        name: "MyCube",
        geometryType: "cube",
      });

      expect(result).toBeNull();
    });

    it("returns null for valid input with all transforms", () => {
      const result = validateCreateObjectInput({
        name: "Object_123",
        geometryType: "sphere",
        location: [1.5, -2.3, 0],
        rotation: [0, 3.14159, 1.57],
        scale: [2, 2, 2],
      });

      expect(result).toBeNull();
    });

    it("returns null for maximum-length valid name", () => {
      const maxName = "a".repeat(63);
      const result = validateCreateObjectInput({
        name: maxName,
        geometryType: "empty",
      });

      expect(result).toBeNull();
    });
  });
});

// --- Timeout handling tests (Req 4.6) ---

describe("timeout handling (Req 4.6)", () => {
  it("returns BLENDER_TIMEOUT with 'timed out' message when operation exceeds timeout", async () => {
    // Delegate that never resolves (within time)
    const delegate: ExecuteBlenderCodeFn = () =>
      new Promise((resolve) => setTimeout(() => resolve("late"), 500));
    const client = createBlenderClient(defaultConfig, delegate);

    // Use a very short timeout (50ms) for test speed
    const result = await client.executeCode("import bpy\nbpy.ops.mesh.primitive_cube_add()", 50);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("timed out");
  });

  it("includes structured timeout info with operation type and retry guidance", async () => {
    const delegate: ExecuteBlenderCodeFn = () =>
      new Promise((resolve) => setTimeout(() => resolve("late"), 500));
    const client = createBlenderClient(defaultConfig, delegate);

    const result = await client.executeCode("import bpy", 50);

    expect(result.success).toBe(false);
    expect(result.error?.operationType).toBe("code_execution");
    expect(result.error?.timeoutMs).toBe(50);
    expect(result.error?.suggestion).toContain("Retry with extended timeout");
  });

  it("produces timeout at elapsed >= 30s (uses config.operationTimeoutMs)", async () => {
    // Set operationTimeoutMs very short to simulate the 30s boundary behavior
    const fastTimeoutConfig = { ...defaultConfig, operationTimeoutMs: 50 };
    const delegate: ExecuteBlenderCodeFn = () =>
      new Promise((resolve) => setTimeout(() => resolve("late"), 200));
    const client = createBlenderClient(fastTimeoutConfig, delegate);

    // When no explicit timeout is passed, config.operationTimeoutMs is used
    const result = await client.executeCode("long_running_operation()");

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("timed out");
    expect(result.error?.suggestion).toBeDefined();
  });
});
