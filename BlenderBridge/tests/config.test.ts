/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { loadConfig, validateConfig } from "../src/config";
import { BlenderBridgeConfig } from "../src/types";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all BLENDER_MCP_* vars
    delete process.env.BLENDER_MCP_HOST;
    delete process.env.BLENDER_MCP_PORT;
    delete process.env.BLENDER_MCP_COMMAND;
    delete process.env.BLENDER_MCP_ARGS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("loadConfig", () => {
    it("returns correct defaults when no env vars are set", () => {
      const config = loadConfig();
      expect(config.blenderMcpHost).toBe("127.0.0.1");
      expect(config.blenderMcpPort).toBe(9876);
      expect(config.blenderMcpCommand).toBe("blender-mcp");
      expect(config.blenderMcpArgs).toEqual([]);
      expect(config.healthCheckTimeoutMs).toBe(5000);
      expect(config.operationTimeoutMs).toBe(30000);
    });

    it("reads BLENDER_MCP_HOST from environment", () => {
      process.env.BLENDER_MCP_HOST = "192.168.1.100";
      const config = loadConfig();
      expect(config.blenderMcpHost).toBe("192.168.1.100");
    });

    it("reads BLENDER_MCP_PORT as integer", () => {
      process.env.BLENDER_MCP_PORT = "8080";
      const config = loadConfig();
      expect(config.blenderMcpPort).toBe(8080);
    });

    it("reads BLENDER_MCP_COMMAND from environment", () => {
      process.env.BLENDER_MCP_COMMAND = "/usr/local/bin/blender-mcp";
      const config = loadConfig();
      expect(config.blenderMcpCommand).toBe("/usr/local/bin/blender-mcp");
    });

    it("splits BLENDER_MCP_ARGS by whitespace and filters empty", () => {
      process.env.BLENDER_MCP_ARGS = "--verbose  --port 9876  ";
      const config = loadConfig();
      expect(config.blenderMcpArgs).toEqual(["--verbose", "--port", "9876"]);
    });

    it("accepts valid port boundary value 1", () => {
      process.env.BLENDER_MCP_PORT = "1";
      const config = loadConfig();
      expect(config.blenderMcpPort).toBe(1);
    });

    it("accepts valid port boundary value 65535", () => {
      process.env.BLENDER_MCP_PORT = "65535";
      const config = loadConfig();
      expect(config.blenderMcpPort).toBe(65535);
    });

    it("throws on port 0 with message containing 'BLENDER_MCP_PORT' and '0'", () => {
      process.env.BLENDER_MCP_PORT = "0";
      expect(() => loadConfig()).toThrow(/BLENDER_MCP_PORT/);
      try {
        loadConfig();
      } catch (e: any) {
        expect(e.message).toContain("0");
      }
    });

    it("throws on port -1 with message containing 'BLENDER_MCP_PORT' and '-1'", () => {
      process.env.BLENDER_MCP_PORT = "-1";
      expect(() => loadConfig()).toThrow(/BLENDER_MCP_PORT/);
      try {
        loadConfig();
      } catch (e: any) {
        expect(e.message).toContain("-1");
      }
    });

    it("throws on port 65536 with message containing 'BLENDER_MCP_PORT' and '65536'", () => {
      process.env.BLENDER_MCP_PORT = "65536";
      expect(() => loadConfig()).toThrow(/BLENDER_MCP_PORT/);
      try {
        loadConfig();
      } catch (e: any) {
        expect(e.message).toContain("65536");
      }
    });

    it("throws on port 'abc' with message containing 'BLENDER_MCP_PORT' and 'NaN'", () => {
      process.env.BLENDER_MCP_PORT = "abc";
      expect(() => loadConfig()).toThrow(/BLENDER_MCP_PORT/);
      try {
        loadConfig();
      } catch (e: any) {
        expect(e.message).toContain("NaN");
      }
    });

    it("throws on port > 65535", () => {
      process.env.BLENDER_MCP_PORT = "70000";
      expect(() => loadConfig()).toThrow("BLENDER_MCP_PORT");
    });

    it("uses default port when BLENDER_MCP_PORT is empty string", () => {
      process.env.BLENDER_MCP_PORT = "";
      // Empty string falls through to default "9876" due to || operator
      const config = loadConfig();
      expect(config.blenderMcpPort).toBe(9876);
    });

    it("uses default host when BLENDER_MCP_HOST is empty string", () => {
      process.env.BLENDER_MCP_HOST = "";
      // Empty string falls through to default "127.0.0.1" due to || operator
      const config = loadConfig();
      expect(config.blenderMcpHost).toBe("127.0.0.1");
    });

    it("splits BLENDER_MCP_ARGS with leading/trailing/multiple whitespace correctly", () => {
      process.env.BLENDER_MCP_ARGS = "  --flag1   --flag2  ";
      const config = loadConfig();
      expect(config.blenderMcpArgs).toEqual(["--flag1", "--flag2"]);
    });

    it("accepts BLENDER_MCP_ARGS with exactly 1024 chars", () => {
      process.env.BLENDER_MCP_ARGS = "a".repeat(1024);
      const config = loadConfig();
      expect(config.blenderMcpArgs).toEqual(["a".repeat(1024)]);
    });

    it("throws when BLENDER_MCP_ARGS exceeds 1024 chars", () => {
      process.env.BLENDER_MCP_ARGS = "a".repeat(1025);
      expect(() => loadConfig()).toThrow("BLENDER_MCP_ARGS");
    });
  });

  describe("validateConfig", () => {
    const validConfig: BlenderBridgeConfig = {
      blenderMcpHost: "127.0.0.1",
      blenderMcpPort: 9876,
      blenderMcpCommand: "blender-mcp",
      blenderMcpArgs: [],
          healthCheckTimeoutMs: 5000,
      operationTimeoutMs: 30000,
    };

    it("does not throw for valid config", () => {
      expect(() => validateConfig(validConfig)).not.toThrow();
    });

    it("throws when port is less than 1", () => {
      expect(() => validateConfig({ ...validConfig, blenderMcpPort: 0 })).toThrow(
        /BLENDER_MCP_PORT.*0/,
      );
    });

    it("throws when port is greater than 65535", () => {
      expect(() => validateConfig({ ...validConfig, blenderMcpPort: 99999 })).toThrow(
        /BLENDER_MCP_PORT.*99999/,
      );
    });

    it("throws when port is NaN", () => {
      expect(() => validateConfig({ ...validConfig, blenderMcpPort: NaN })).toThrow(
        /BLENDER_MCP_PORT/,
      );
    });

    it("throws when port is a float", () => {
      expect(() => validateConfig({ ...validConfig, blenderMcpPort: 80.5 })).toThrow(
        /BLENDER_MCP_PORT/,
      );
    });

    it("throws when host is empty", () => {
      expect(() => validateConfig({ ...validConfig, blenderMcpHost: "" })).toThrow(
        /BLENDER_MCP_HOST/,
      );
    });

    it("throws when args exceed 1024 chars", () => {
      const longArgs = ["a".repeat(1025)];
      expect(() => validateConfig({ ...validConfig, blenderMcpArgs: longArgs })).toThrow(
        /BLENDER_MCP_ARGS.*1025/,
      );
    });

    it("accepts port at boundary 1", () => {
      expect(() => validateConfig({ ...validConfig, blenderMcpPort: 1 })).not.toThrow();
    });

    it("accepts port at boundary 65535", () => {
      expect(() => validateConfig({ ...validConfig, blenderMcpPort: 65535 })).not.toThrow();
    });

    it("writes to stderr before throwing on invalid port", () => {
      const stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        validateConfig({ ...validConfig, blenderMcpPort: 0 });
      } catch {
        // expected
      }
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("BLENDER_MCP_PORT"));
      stderrSpy.mockRestore();
    });

    it("writes to stderr before throwing on empty host", () => {
      const stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        validateConfig({ ...validConfig, blenderMcpHost: "" });
      } catch {
        // expected
      }
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("BLENDER_MCP_HOST"));
      stderrSpy.mockRestore();
    });

    it("writes to stderr before throwing on oversized args", () => {
      const stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        validateConfig({ ...validConfig, blenderMcpArgs: ["a".repeat(1025)] });
      } catch {
        // expected
      }
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("BLENDER_MCP_ARGS"));
      stderrSpy.mockRestore();
    });
  });
});
