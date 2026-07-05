/**
 * Unit tests for BlenderBridge orchestration tools.
 *
 * Validates: Requirements 4.2, 4.6, 8.2, 8.3, 8.4
 */

import { validateCreateObjectInput } from "../src/tools/create-object.tool";
import { createExportToViewerTool, HttpClient } from "../src/tools/export-to-viewer.tool";
import { createBlenderClient, BlenderClient, ExecuteBlenderCodeFn } from "../src/blender-client";
import { BlenderBridgeConfig } from "../src/types";
import * as fs from "fs";

// Mock fs module for existsSync
jest.mock("fs");
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

const defaultConfig: BlenderBridgeConfig = {
  blenderMcpHost: "127.0.0.1",
  blenderMcpPort: 9876,
  blenderMcpCommand: "blender-mcp",
  blenderMcpArgs: [],
  threeDToolHost: "http://localhost:3344",
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

// --- export-to-viewer tests ---

describe("export-to-viewer", () => {
  /** Helper to create a mock BlenderClient */
  function createMockClient(executeCodeFn: ExecuteBlenderCodeFn): BlenderClient {
    return createBlenderClient(defaultConfig, executeCodeFn);
  }

  /** Helper to create a mock HttpClient */
  function createMockHttpClient(
    healthResponse?: { ok: boolean } | "reject",
    loadResponse?: { ok: boolean } | "reject",
  ): HttpClient {
    return {
      fetch: jest.fn(async (url: string, options?: RequestInit) => {
        if (url.includes("/health")) {
          if (healthResponse === "reject") throw new Error("Connection refused");
          return { ok: healthResponse?.ok ?? false } as Response;
        }
        if (url.includes("/api/load")) {
          if (loadResponse === "reject") throw new Error("Connection refused");
          return { ok: loadResponse?.ok ?? false } as Response;
        }
        throw new Error(`Unexpected URL: ${url}`);
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("NO_ACTIVE_OBJECT (Req 8.4)", () => {
    it("returns NO_ACTIVE_OBJECT error when no object is active", async () => {
      // Mock: executeCode returns hasActive: false
      const delegate: ExecuteBlenderCodeFn = async () =>
        JSON.stringify({ hasActive: false, name: null });
      const client = createMockClient(delegate);
      const httpClient = createMockHttpClient();

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.error.code).toBe("NO_ACTIVE_OBJECT");
    });

    it("returns NO_ACTIVE_OBJECT error when active check returns null name", async () => {
      const delegate: ExecuteBlenderCodeFn = async () =>
        JSON.stringify({ hasActive: true, name: null });
      const client = createMockClient(delegate);
      const httpClient = createMockHttpClient();

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error.code).toBe("NO_ACTIVE_OBJECT");
    });
  });

  describe("viewer unavailable (Req 8.3)", () => {
    it("returns success with viewerTriggered: false when viewer /health rejects", async () => {
      let callCount = 0;
      const delegate: ExecuteBlenderCodeFn = async () => {
        callCount++;
        if (callCount === 1) {
          // First call: active object check
          return JSON.stringify({ hasActive: true, name: "Cube" });
        }
        // Second call: export
        return JSON.stringify({ filePath: "/tmp/Cube.obj", objectName: "Cube" });
      };
      const client = createMockClient(delegate);
      const httpClient = createMockHttpClient("reject");

      // File exists on disk
      mockExistsSync.mockReturnValue(true);

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.viewerTriggered).toBe(false);
      expect(response.message).toContain("viewer");
    });

    it("returns success with message about viewer unavailable when /health times out", async () => {
      let callCount = 0;
      const delegate: ExecuteBlenderCodeFn = async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ hasActive: true, name: "Sphere" });
        }
        return JSON.stringify({ filePath: "/tmp/Sphere.obj", objectName: "Sphere" });
      };
      const client = createMockClient(delegate);

      // Simulate timeout by rejecting
      const httpClient: HttpClient = {
        fetch: jest.fn(async () => {
          throw new Error("AbortError: signal timed out");
        }),
      };

      mockExistsSync.mockReturnValue(true);

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.viewerTriggered).toBe(false);
      expect(response.message).toBeDefined();
    });
  });

  describe("dual-condition POST (Req 8.2)", () => {
    it("does NOT trigger viewer when /health passes but file does NOT exist", async () => {
      let callCount = 0;
      const delegate: ExecuteBlenderCodeFn = async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ hasActive: true, name: "Cube" });
        }
        return JSON.stringify({ filePath: "/tmp/Cube.obj", objectName: "Cube" });
      };
      const client = createMockClient(delegate);
      const httpClient = createMockHttpClient({ ok: true }, { ok: true });

      // File does NOT exist on disk
      mockExistsSync.mockReturnValue(false);

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.viewerTriggered).toBe(false);
    });

    it("does NOT trigger viewer when /health fails but file exists", async () => {
      let callCount = 0;
      const delegate: ExecuteBlenderCodeFn = async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ hasActive: true, name: "Cube" });
        }
        return JSON.stringify({ filePath: "/tmp/Cube.obj", objectName: "Cube" });
      };
      const client = createMockClient(delegate);
      const httpClient = createMockHttpClient("reject");

      // File exists
      mockExistsSync.mockReturnValue(true);

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.viewerTriggered).toBe(false);
    });

    it("triggers viewer when BOTH /health passes AND file exists on disk", async () => {
      let callCount = 0;
      const delegate: ExecuteBlenderCodeFn = async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ hasActive: true, name: "Cube" });
        }
        return JSON.stringify({ filePath: "/tmp/Cube.obj", objectName: "Cube" });
      };
      const client = createMockClient(delegate);
      const httpClient = createMockHttpClient({ ok: true }, { ok: true });

      // File exists
      mockExistsSync.mockReturnValue(true);

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      const result = await tool.handler({});

      expect(result.isError).toBe(false);
      const response = JSON.parse(result.content[0].text);
      expect(response.viewerTriggered).toBe(true);
    });

    it("POSTs to /api/load with correct payload when both conditions met", async () => {
      let callCount = 0;
      const delegate: ExecuteBlenderCodeFn = async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ hasActive: true, name: "MyCube" });
        }
        return JSON.stringify({ filePath: "/tmp/MyCube.obj", objectName: "MyCube" });
      };
      const client = createMockClient(delegate);
      const mockFetch = jest.fn(async (url: string, options?: RequestInit) => {
        return { ok: true } as Response;
      });
      const httpClient: HttpClient = { fetch: mockFetch };

      mockExistsSync.mockReturnValue(true);

      const tool = createExportToViewerTool(defaultConfig, client, httpClient);
      await tool.handler({});

      // Verify /api/load was called with correct body
      const loadCall = mockFetch.mock.calls.find(([url]) =>
        (url as string).includes("/api/load"),
      );
      expect(loadCall).toBeDefined();
      const loadOptions = loadCall![1] as unknown as RequestInit;
      expect(loadOptions.method).toBe("POST");
      const body = JSON.parse(loadOptions.body as string);
      expect(body.filePath).toContain("MyCube.obj");
      expect(body.workspace).toBeDefined();
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

  it("includes suggestion about health check in timeout response", async () => {
    const delegate: ExecuteBlenderCodeFn = () =>
      new Promise((resolve) => setTimeout(() => resolve("late"), 500));
    const client = createBlenderClient(defaultConfig, delegate);

    const result = await client.executeCode("import bpy", 50);

    expect(result.success).toBe(false);
    expect(result.error?.suggestion).toContain("health_check");
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
