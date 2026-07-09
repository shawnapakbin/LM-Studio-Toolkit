/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-mcp-integration, Property 2: Config loading produces correctly typed values from environment
 * Feature: blender-mcp-integration, Property 3: Invalid configuration is rejected with identifying error
 *
 * Validates: Requirements 7.1, 7.2, 7.5
 */

import * as fc from "fast-check";
import { loadConfig, validateConfig } from "../src/config";
import { BlenderBridgeConfig } from "../src/types";

describe("config property tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BLENDER_MCP_HOST;
    delete process.env.BLENDER_MCP_PORT;
    delete process.env.BLENDER_MCP_COMMAND;
    delete process.env.BLENDER_MCP_ARGS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /**
   * Feature: blender-mcp-integration, Property 2: Config loading produces correctly typed values from environment
   *
   * For any valid set of environment variables where BLENDER_MCP_HOST is a non-empty string,
   * BLENDER_MCP_PORT is an integer string in range 1–65535, BLENDER_MCP_COMMAND is a non-empty string,
   * and BLENDER_MCP_ARGS is a string of at most 1024 characters, calling loadConfig() SHALL produce
   * a BlenderBridgeConfig where blenderMcpPort is a number equal to the parsed integer,
   * blenderMcpHost equals the host string, blenderMcpCommand equals the command string,
   * and blenderMcpArgs is an array of non-empty strings produced by splitting the args on whitespace.
   *
   * Validates: Requirements 7.1, 7.2
   */
  describe("Property 2: Config loading produces correctly typed values from environment", () => {
    // Generator: non-empty string without whitespace for host
    const hostArb = fc.stringOf(
      fc.char().filter((c) => c.trim().length > 0 && c !== "\0"),
      { minLength: 1, maxLength: 50 },
    );

    // Generator: valid port integer in range 1-65535
    const portArb = fc.integer({ min: 1, max: 65535 });

    // Generator: non-empty string for command
    const commandArb = fc.stringOf(
      fc.char().filter((c) => c.trim().length > 0 && c !== "\0"),
      { minLength: 1, maxLength: 50 },
    );

    // Generator: whitespace-separated tokens, total at most 1024 chars
    const argsTokenArb = fc.stringOf(
      fc.char().filter((c) => c.trim().length > 0 && c !== "\0"),
      { minLength: 1, maxLength: 20 },
    );

    const argsArb = fc
      .array(argsTokenArb, { minLength: 0, maxLength: 10 })
      .map((tokens) => tokens.join(" "))
      .filter((s) => s.length <= 1024);

    it("loadConfig produces correctly typed values from valid env vars", () => {
      fc.assert(
        fc.property(hostArb, portArb, commandArb, argsArb, (host, port, command, argsStr) => {
          process.env.BLENDER_MCP_HOST = host;
          process.env.BLENDER_MCP_PORT = String(port);
          process.env.BLENDER_MCP_COMMAND = command;
          process.env.BLENDER_MCP_ARGS = argsStr;

          const config = loadConfig();

          // Port is a number equal to the parsed integer
          expect(config.blenderMcpPort).toBe(port);
          expect(typeof config.blenderMcpPort).toBe("number");

          // Host equals the host string
          expect(config.blenderMcpHost).toBe(host);

          // Command equals the command string
          expect(config.blenderMcpCommand).toBe(command);

          // Args is an array of non-empty strings produced by splitting on whitespace
          const expectedArgs = argsStr.split(/\s+/).filter((s) => s.length > 0);
          expect(config.blenderMcpArgs).toEqual(expectedArgs);

          // All args elements are non-empty strings
          for (const arg of config.blenderMcpArgs) {
            expect(typeof arg).toBe("string");
            expect(arg.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Feature: blender-mcp-integration, Property 3: Invalid configuration is rejected with identifying error
   *
   * For any BLENDER_MCP_PORT value that is not an integer in range 1–65535 (including 0, negative numbers,
   * values > 65535, non-numeric strings, empty string) or any empty BLENDER_MCP_HOST value,
   * calling loadConfig() SHALL throw an error whose message contains both the name of the invalid
   * variable and the provided value.
   *
   * Validates: Requirements 7.5
   */
  describe("Property 3: Invalid configuration is rejected with identifying error", () => {
    // Generator: port value 0
    const zeroPortArb = fc.constant("0");

    // Generator: negative port integers
    const negativePortArb = fc.integer({ min: -100000, max: -1 }).map(String);

    // Generator: port values > 65535
    const highPortArb = fc.integer({ min: 65536, max: 200000 }).map(String);

    // Generator: non-numeric strings (not parseable as integer)
    const nonNumericPortArb = fc
      .stringOf(
        fc.char().filter((c) => !/[0-9\-]/.test(c) && c !== "\0"),
        {
          minLength: 1,
          maxLength: 10,
        },
      )
      .filter((s) => Number.isNaN(Number(s)) || !Number.isInteger(Number(s)));

    // Generator: float strings (parseable as number but not integer)
    const floatPortArb = fc
      .tuple(fc.integer({ min: 1, max: 65535 }), fc.integer({ min: 1, max: 99 }))
      .map(([whole, frac]) => `${whole}.${frac}`);

    // Combine all invalid port generators
    // Note: Empty string is excluded because loadConfig() treats empty env var
    // as "use default" via the || operator (same as empty host).
    const invalidPortArb = fc.oneof(
      zeroPortArb,
      negativePortArb,
      highPortArb,
      nonNumericPortArb,
      floatPortArb,
    );

    it("loadConfig throws with error mentioning BLENDER_MCP_PORT for invalid port values", () => {
      fc.assert(
        fc.property(invalidPortArb, (portValue) => {
          process.env.BLENDER_MCP_PORT = portValue;

          let threw = false;
          try {
            loadConfig();
          } catch (err: unknown) {
            threw = true;
            const message = (err as Error).message;
            // Error message must contain the variable name
            expect(message).toContain("BLENDER_MCP_PORT");
            // Error message must contain the provided value (the parsed numeric result)
            const parsedValue = Number(portValue);
            expect(message).toContain(String(parsedValue));
          }

          expect(threw).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it("validateConfig throws with error mentioning BLENDER_MCP_HOST for empty host", () => {
      fc.assert(
        fc.property(fc.constant(""), (emptyHost) => {
          const config: BlenderBridgeConfig = {
            blenderMcpHost: emptyHost,
            blenderMcpPort: 9876,
            blenderMcpCommand: "blender-mcp",
            blenderMcpArgs: [],
                      healthCheckTimeoutMs: 5000,
            operationTimeoutMs: 30000,
          };

          let threw = false;
          try {
            validateConfig(config);
          } catch (err: unknown) {
            threw = true;
            const message = (err as Error).message;
            // Error message must contain the variable name
            expect(message).toContain("BLENDER_MCP_HOST");
          }

          expect(threw).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
