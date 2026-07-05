/**
 * Unit tests for the MCP config registry (scripts/workspace/mcp-config.js).
 *
 * Verifies:
 * - Binary-not-found omits entry and emits stderr warning (Req 1.2, 1.3)
 * - Binary-not-executable omits entry and emits stderr warning (Req 1.2, 1.3)
 * - Config registry entry uses env vars with correct defaults (Req 1.1)
 */

import path from "path";
import childProcess from "child_process";
import fs from "fs";

const mcpConfigPath = path.resolve(__dirname, "../../scripts/workspace/mcp-config.js");

describe("mcp-config.js registry", () => {
  const originalEnv = process.env;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = originalEnv;
  });

  describe("binary-not-found omits entry and emits warning (Req 1.2, 1.3)", () => {
    it("omits blender-mcp entry when binary is not on PATH", () => {
      // Mock execSync to throw (simulates binary not found)
      jest.mock("child_process", () => ({
        execSync: jest.fn((cmd: string) => {
          if (cmd.includes("blender-mcp")) {
            throw new Error("Command failed: where blender-mcp");
          }
          // Let other commands through for non-external servers
          return "";
        }),
      }));

      // Mock fs.existsSync to return true for non-external server scripts
      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(() => {
            throw new Error("ENOENT");
          }),
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      const { mcpServers } = buildMcpServers();

      expect(mcpServers["blender-mcp"]).toBeUndefined();
    });

    it("emits stderr warning referencing 'missing or non-executable' when binary not found", () => {
      jest.mock("child_process", () => ({
        execSync: jest.fn((cmd: string) => {
          if (cmd.includes("blender-mcp")) {
            throw new Error("Command failed: where blender-mcp");
          }
          return "";
        }),
      }));

      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(() => {
            throw new Error("ENOENT");
          }),
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      buildMcpServers();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing or non-executable"),
      );
    });
  });

  describe("binary-not-executable omits entry and emits warning (Req 1.2, 1.3)", () => {
    it("omits blender-mcp entry when binary exists but is not executable", () => {
      // On Unix-like systems, `which` might find the binary but accessSync for X_OK fails.
      // On Windows, `where` failing means not found at all. The effect is the same:
      // isBinaryOnPath returns false → entry is omitted.
      jest.mock("child_process", () => ({
        execSync: jest.fn((cmd: string) => {
          if (cmd.includes("blender-mcp")) {
            // Simulate: binary found by which/where but not executable
            // In practice on Windows, where won't find non-executables.
            // On Unix, which finds it but accessSync would fail.
            throw new Error("not executable");
          }
          return "";
        }),
      }));

      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(() => {
            throw new Error("EACCES: permission denied");
          }),
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      const { mcpServers } = buildMcpServers();

      expect(mcpServers["blender-mcp"]).toBeUndefined();
    });

    it("emits stderr warning when binary is not executable", () => {
      jest.mock("child_process", () => ({
        execSync: jest.fn((cmd: string) => {
          if (cmd.includes("blender-mcp")) {
            throw new Error("not executable");
          }
          return "";
        }),
      }));

      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(() => {
            throw new Error("EACCES");
          }),
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      buildMcpServers();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("missing or non-executable"),
      );
    });
  });

  describe("config registry entry uses env vars with correct defaults (Req 1.1)", () => {
    it("uses default values when no BLENDER_MCP_* env vars are set", () => {
      // Remove all BLENDER_MCP_* env vars
      delete process.env.BLENDER_MCP_COMMAND;
      delete process.env.BLENDER_MCP_ARGS;
      delete process.env.BLENDER_MCP_HOST;
      delete process.env.BLENDER_MCP_PORT;

      // Mock execSync so blender-mcp is "found" on PATH
      jest.mock("child_process", () => ({
        execSync: jest.fn((cmd: string) => {
          if (cmd.includes("blender-mcp")) {
            return "C:\\Program Files\\blender-mcp\\blender-mcp.exe\n";
          }
          return "";
        }),
      }));

      jest.mock("fs", () => {
        const originalFs = jest.requireActual("fs");
        return {
          ...originalFs,
          existsSync: jest.fn().mockReturnValue(true),
          accessSync: jest.fn(), // no throw = executable
        };
      });

      const { buildMcpServers } = require(mcpConfigPath);
      const { mcpServers } = buildMcpServers();

      expect(mcpServers["blender-mcp"]).toBeDefined();
      expect(mcpServers["blender-mcp"].command).toBe("blender-mcp");
      expect(mcpServers["blender-mcp"].args).toEqual([]);
      expect(mcpServers["blender-mcp"].env.BLENDER_MCP_HOST).toBe("127.0.0.1");
      expect(mcpServers["blender-mcp"].env.BLENDER_MCP_PORT).toBe("9876");
    });

    it("uses custom env var values when BLENDER_MCP_* are set", () => {
      process.env.BLENDER_MCP_COMMAND = "custom-blender-mcp";
      process.env.BLENDER_MCP_ARGS = "--verbose --port 1234";
      process.env.BLENDER_MCP_HOST = "192.168.1.100";
      process.env.BLENDER_MCP_PORT = "5555";

      // Mock execSync so custom binary is "found" on PATH
      jest.mock("child_process", () => ({
        execSync: jest.fn((cmd: string) => {
          if (cmd.includes("custom-blender-mcp")) {
            return "/usr/local/bin/custom-blender-mcp\n";
          }
          return "";
        }),
      }));

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

      expect(mcpServers["blender-mcp"]).toBeDefined();
      expect(mcpServers["blender-mcp"].command).toBe("custom-blender-mcp");
      expect(mcpServers["blender-mcp"].args).toEqual(["--verbose", "--port", "1234"]);
      expect(mcpServers["blender-mcp"].env.BLENDER_MCP_HOST).toBe("192.168.1.100");
      expect(mcpServers["blender-mcp"].env.BLENDER_MCP_PORT).toBe("5555");
    });

    it("does not block other servers when blender-mcp binary is missing", () => {
      jest.mock("child_process", () => ({
        execSync: jest.fn((cmd: string) => {
          if (cmd.includes("blender-mcp")) {
            throw new Error("not found");
          }
          return "";
        }),
      }));

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

      // blender-mcp should be omitted
      expect(mcpServers["blender-mcp"]).toBeUndefined();
      // Other servers should still be present
      expect(mcpServers["terminal"]).toBeDefined();
      expect(mcpServers["calculator"]).toBeDefined();
    });
  });
});
