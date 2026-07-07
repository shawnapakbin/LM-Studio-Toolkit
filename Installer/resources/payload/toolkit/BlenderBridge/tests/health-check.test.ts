/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import * as net from "net";
import { exec } from "child_process";
import {
  checkAddonConnectivity,
  checkMcpServerProcess,
  runHealthCheck,
  BlenderInfo,
} from "../src/health-check";
import { BlenderBridgeConfig, HealthCheckError, HealthCheckSuccess } from "../src/types";

// Mock child_process.exec
jest.mock("child_process", () => ({
  exec: jest.fn(),
}));

const mockedExec = exec as unknown as jest.MockedFunction<
  (cmd: string, cb: (error: Error | null, stdout?: string, stderr?: string) => void) => void
>;

function createTestConfig(overrides?: Partial<BlenderBridgeConfig>): BlenderBridgeConfig {
  return {
    blenderMcpHost: "127.0.0.1",
    blenderMcpPort: 9876,
    blenderMcpCommand: "blender-mcp",
    blenderMcpArgs: [],
    threeDToolHost: "http://localhost:3344",
    healthCheckTimeoutMs: 5000,
    operationTimeoutMs: 30000,
    ...overrides,
  };
}

describe("health-check", () => {
  describe("checkAddonConnectivity", () => {
    it("returns true when a TCP server accepts the connection", async () => {
      // Create a local TCP server to accept connections
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as net.AddressInfo).port;

      try {
        const result = await checkAddonConnectivity("127.0.0.1", port, 2000);
        expect(result).toBe(true);
      } finally {
        server.close();
      }
    });

    it("returns false when no server is listening (connection refused)", async () => {
      // Use a port that is very unlikely to be in use
      const result = await checkAddonConnectivity("127.0.0.1", 19999, 1000);
      expect(result).toBe(false);
    });

    it("returns false when connection times out", async () => {
      // Use a non-routable address to simulate timeout
      const result = await checkAddonConnectivity("192.0.2.1", 9876, 500);
      expect(result).toBe(false);
    });
  });

  describe("checkMcpServerProcess", () => {
    beforeEach(() => {
      mockedExec.mockReset();
    });

    it("returns true when the command is found on PATH", async () => {
      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null, "/usr/local/bin/blender-mcp", "");
      });

      const result = await checkMcpServerProcess("blender-mcp");
      expect(result).toBe(true);
    });

    it("returns false when the command is not found", async () => {
      mockedExec.mockImplementation((_cmd, cb) => {
        cb(new Error("not found"));
      });

      const result = await checkMcpServerProcess("blender-mcp");
      expect(result).toBe(false);
    });

    it("uses 'where' on Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null);
      });

      await checkMcpServerProcess("blender-mcp");

      expect(mockedExec).toHaveBeenCalledWith(
        "where blender-mcp",
        expect.any(Function),
      );

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("uses 'which' on non-Windows platforms", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null);
      });

      await checkMcpServerProcess("blender-mcp");

      expect(mockedExec).toHaveBeenCalledWith(
        "which blender-mcp",
        expect.any(Function),
      );

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("runHealthCheck", () => {
    let server: net.Server;
    let port: number;

    beforeEach(async () => {
      mockedExec.mockReset();
      // Start a local TCP server to simulate the Blender addon
      server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as net.AddressInfo).port;
    });

    afterEach(() => {
      server.close();
    });

    it("returns BLENDER_ADDON_UNREACHABLE when addon TCP fails", async () => {
      server.close();
      // Use a port with no listener
      const config = createTestConfig({ blenderMcpPort: 19998, healthCheckTimeoutMs: 500 });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(new Error("not found"));
      });

      const result = await runHealthCheck(config);

      expect(result.status).toBe("error");
      const errorResult = result as HealthCheckError;
      expect(errorResult.error.code).toBe("BLENDER_ADDON_UNREACHABLE");
      expect(errorResult.error.message).toContain("127.0.0.1:19998");
      expect(errorResult.error.remediation).toContain("Blender 5.1+");
    });

    it("returns BLENDER_ADDON_UNREACHABLE when both addon and MCP fail (priority)", async () => {
      server.close();
      const config = createTestConfig({ blenderMcpPort: 19997, healthCheckTimeoutMs: 500 });

      // MCP also fails
      mockedExec.mockImplementation((_cmd, cb) => {
        cb(new Error("not found"));
      });

      const result = await runHealthCheck(config);

      expect(result.status).toBe("error");
      const errorResult = result as HealthCheckError;
      expect(errorResult.error.code).toBe("BLENDER_ADDON_UNREACHABLE");
    });

    it("returns BLENDER_MCP_NOT_INSTALLED when addon passes but MCP not found", async () => {
      const config = createTestConfig({ blenderMcpPort: port, healthCheckTimeoutMs: 2000 });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(new Error("not found"));
      });

      const result = await runHealthCheck(config);

      expect(result.status).toBe("error");
      const errorResult = result as HealthCheckError;
      expect(errorResult.error.code).toBe("BLENDER_MCP_NOT_INSTALLED");
      expect(errorResult.error.message).toContain("blender-mcp");
      expect(errorResult.error.remediation).toContain(".mcpb bundle");
    });

    it("returns success when both checks pass (no blender info callback)", async () => {
      const config = createTestConfig({ blenderMcpPort: port, healthCheckTimeoutMs: 2000 });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null);
      });

      const result = await runHealthCheck(config);

      expect(result.status).toBe("ok");
      const successResult = result as HealthCheckSuccess;
      expect(successResult.addonListening).toBe(true);
      expect(successResult.blenderVersion).toBeUndefined();
      expect(successResult.sceneName).toBeUndefined();
    });

    it("returns success with version and scene when blender info callback is provided", async () => {
      const config = createTestConfig({ blenderMcpPort: port, healthCheckTimeoutMs: 2000 });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null);
      });

      const getBlenderInfo = async (): Promise<BlenderInfo> => ({
        version: "5.1.0",
        sceneName: "Scene",
        isBlankProject: true,
      });

      const result = await runHealthCheck(config, getBlenderInfo);

      expect(result.status).toBe("ok");
      const successResult = result as HealthCheckSuccess;
      expect(successResult.addonListening).toBe(true);
      expect(successResult.blenderVersion).toBe("5.1.0");
      expect(successResult.sceneName).toBe("Scene");
      expect(successResult.blankProjectWarning).toBeUndefined();
    });

    it("includes blank project warning when scene is not blank", async () => {
      const config = createTestConfig({ blenderMcpPort: port, healthCheckTimeoutMs: 2000 });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null);
      });

      const getBlenderInfo = async (): Promise<BlenderInfo> => ({
        version: "5.1.0",
        sceneName: "MyProject",
        isBlankProject: false,
      });

      const result = await runHealthCheck(config, getBlenderInfo);

      expect(result.status).toBe("ok");
      const successResult = result as HealthCheckSuccess;
      expect(successResult.addonListening).toBe(true);
      expect(successResult.blankProjectWarning).toContain("Existing scene detected");
    });

    it("still returns success if blender info callback throws", async () => {
      const config = createTestConfig({ blenderMcpPort: port, healthCheckTimeoutMs: 2000 });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null);
      });

      const getBlenderInfo = async (): Promise<BlenderInfo> => {
        throw new Error("connection lost");
      };

      const result = await runHealthCheck(config, getBlenderInfo);

      expect(result.status).toBe("ok");
      const successResult = result as HealthCheckSuccess;
      expect(successResult.addonListening).toBe(true);
      expect(successResult.blenderVersion).toBeUndefined();
    });

    it("success response does NOT contain any error field at root level (Req 3.4)", async () => {
      const config = createTestConfig({ blenderMcpPort: port, healthCheckTimeoutMs: 2000 });

      mockedExec.mockImplementation((_cmd, cb) => {
        cb(null);
      });

      const getBlenderInfo = async (): Promise<BlenderInfo> => ({
        version: "5.1.0",
        sceneName: "Scene",
        isBlankProject: true,
      });

      const result = await runHealthCheck(config, getBlenderInfo);

      expect(result.status).toBe("ok");
      // Success response must NOT have an "error" field at root level
      expect("error" in result).toBe(false);
      // Also verify no "code" or "remediation" at root
      expect("code" in result).toBe(false);
      expect("remediation" in result).toBe(false);
    });
  });
});
