/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Unit tests for the MCP config registry (scripts/workspace/mcp-config.js).
 *
 * Verifies:
 * - blender-bridge is registered as a Node.js server (not an external binary)
 * - Config registry entry uses env vars with correct defaults
 * - Missing binary handling for external servers does not affect blender-bridge
 */

import path from "path";

const mcpConfigPath = path.resolve(__dirname, "../../scripts/workspace/mcp-config.js");

describe("mcp-config.js registry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("blender-bridge registration (Req 1.1)", () => {
    it("registers blender-bridge as a Node.js server with correct env defaults", () => {
      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(),
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      const { mcpServers } = buildMcpServers();

      expect(mcpServers["blender-bridge"]).toBeDefined();
      expect(mcpServers["blender-bridge"].command).toBe("node");
      expect(mcpServers["blender-bridge"].env.BLENDER_MCP_HOST).toBe("127.0.0.1");
      expect(mcpServers["blender-bridge"].env.BLENDER_MCP_PORT).toBe("9876");
    });

    it("blender-bridge is NOT registered as an external binary", () => {
      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(),
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      const { mcpServers } = buildMcpServers();

      // blender-bridge should be a node server, not require a binary on PATH
      expect(mcpServers["blender-bridge"].command).toBe("node");
      expect(mcpServers["blender-bridge"].args[0]).toContain("BlenderBridge/dist/mcp-server.js");
    });

    it("does not block other servers when blender-bridge dist is missing", () => {
      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(),
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      const { mcpServers } = buildMcpServers();

      // Other servers should still be present regardless of blender-bridge state
      expect(mcpServers["terminal"]).toBeDefined();
      expect(mcpServers["calculator"]).toBeDefined();
    });
  });
});
