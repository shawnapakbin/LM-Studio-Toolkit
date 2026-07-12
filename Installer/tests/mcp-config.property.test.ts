/**
 * Property-based tests for the MCP bridge config schema-proxy invariant.
 *
 * Feature: browserless-npx-migration, Property 1: Bridge Config Schema-Proxy Invariant
 *
 * For any environment state (any combination of set/unset BROWSERLESS_TOKEN and
 * BROWSERLESS_API_URL values), calling the bridge config builder for the Browserless
 * tool SHALL always produce a node-based config pointing to schema-proxy.js,
 * which wraps the official @browserless.io/mcp package to fix non-anchored schema
 * patterns that break LM Studio's structured output parser.
 *
 * **Validates: Requirements 1.1, 1.2, 4.1, 4.3**
 */

import * as fc from "fast-check";

import { buildBridgeConfig } from "../src/main/mcp-config";
import type { ToolDescriptor } from "../src/main/types";

describe("Feature: browserless-npx-migration, Property 1: Bridge Config Schema-Proxy Invariant", () => {
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
        relativeScript: "Browserless/scripts/schema-proxy.js",
        env: {
          BROWSERLESS_TOKEN: token,
          BROWSERLESS_API_URL: apiUrl,
        },
      }),
    );

  test("command contains 'node' regardless of env values", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        expect(config.command).toContain("node");
      }),
      { numRuns: 100 },
    );
  });

  test("args[0] points to schema-proxy.js regardless of env values", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        expect(config.args[0]).toContain("schema-proxy.js");
        expect(config.args[0]).toContain("Browserless/scripts");
      }),
      { numRuns: 100 },
    );
  });

  test("args[0] uses forward slashes on all platforms", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        expect(config.args[0]).not.toContain("\\");
      }),
      { numRuns: 100 },
    );
  });

  test("config has cwd field (node-based pattern)", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);
        expect(config).toHaveProperty("cwd");
      }),
      { numRuns: 100 },
    );
  });

  test("all invariants hold together across random environments", () => {
    fc.assert(
      fc.property(installRootArb, browserlessDescriptorArb, (installRoot, descriptor) => {
        const config = buildBridgeConfig(installRoot, descriptor);

        // command is node-based
        expect(config.command).toContain("node");

        // args points to schema-proxy
        expect(config.args[0]).toContain("schema-proxy.js");

        // forward slashes
        expect(config.args[0]).not.toContain("\\");

        // has cwd
        expect(config).toHaveProperty("cwd");
      }),
      { numRuns: 100 },
    );
  });
});
