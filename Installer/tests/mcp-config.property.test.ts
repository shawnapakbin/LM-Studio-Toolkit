/**
 * Property-based tests for the MCP bridge config command invariant.
 *
 * Feature: browserless-npx-migration, Property 1: Bridge Config Command Invariant
 *
 * For any environment state (any combination of set/unset BROWSERLESS_TOKEN and
 * BROWSERLESS_API_URL values), calling the bridge config builder for the Browserless
 * tool SHALL always produce `command: "npx"` and `args: ["-y", "@browserless.io/mcp"]`,
 * and SHALL NOT produce a `cwd` field or reference any local file path.
 *
 * **Validates: Requirements 1.1, 1.2, 4.1, 4.3**
 */

import * as fc from "fast-check";

import { buildBridgeConfig } from "../src/main/mcp-config";
import type { ToolDescriptor } from "../src/main/types";

describe("Feature: browserless-npx-migration, Property 1: Bridge Config Command Invariant", () => {
  // Generator for optional env values — either present (non-empty string) or absent (empty string)
  const optionalEnvValue = fc.oneof(
    fc.constant(""), // absent / empty
    fc.string({ minLength: 1, maxLength: 200 }), // present with arbitrary value
  );

  // Generator for random install root paths
  const installRootArb = fc.oneof(
    fc.constant("C:/Users/TestUser/AppData/Roaming/llm-toolkit"),
    fc.constant("/home/testuser/llm-toolkit"),
    fc.constant("/opt/llm-toolkit"),
    fc.stringOf(fc.char().filter((c) => c !== "\0" && c !== "\n"), { minLength: 1, maxLength: 100 }),
  );

  // Generator for a browserless-style tool descriptor with randomized env values
  const browserlessDescriptorArb = fc
    .record({
      token: optionalEnvValue,
      apiUrl: optionalEnvValue,
    })
    .map(
      ({ token, apiUrl }): ToolDescriptor => ({
        id: "browserless",
        displayName: "Browserless",
        command: "npx",
        args: ["-y", "@browserless.io/mcp"],
        env: {
          BROWSERLESS_TOKEN: token,
          BROWSERLESS_API_URL: apiUrl,
        },
      }),
    );

  test("command is always 'npx' regardless of env values", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        expect(config.command).toBe("npx");
      }),
      { numRuns: 100 },
    );
  });

  test("args is always ['-y', '@browserless.io/mcp'] regardless of env values", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        expect(config.args).toEqual(["-y", "@browserless.io/mcp"]);
      }),
      { numRuns: 100 },
    );
  });

  test("no cwd field is present in the output", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        expect(config).not.toHaveProperty("cwd");
      }),
      { numRuns: 100 },
    );
  });

  test("no local file path appears in args", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        for (const arg of config.args) {
          // Must not contain common file path indicators
          expect(arg).not.toMatch(/\.(js|ts|exe|mjs|cjs)$/);
          expect(arg).not.toMatch(/^(\/|[A-Z]:)/); // no absolute paths
          expect(arg).not.toContain("dist/");
          expect(arg).not.toContain("node_modules/");
        }
      }),
      { numRuns: 100 },
    );
  });

  test("all invariants hold together across random environments", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);

        // command invariant
        expect(config.command).toBe("npx");

        // args invariant
        expect(config.args).toEqual(["-y", "@browserless.io/mcp"]);

        // no cwd
        expect(config).not.toHaveProperty("cwd");

        // no local file paths in args
        for (const arg of config.args) {
          expect(arg).not.toMatch(/\.(js|ts|exe|mjs|cjs)$/);
          expect(arg).not.toMatch(/^(\/|[A-Z]:)/);
        }
      }),
      { numRuns: 100 },
    );
  });
});
