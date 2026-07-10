/**
 * Property-based tests for token round-trip through environment to config.
 * Uses fast-check to verify the token value is preserved when written to .env,
 * loaded back, and used in MCP bridge configuration generation.
 *
 * Feature: browserless-mcp-migration, Property 4: Token Round-Trip Through Environment to Config
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as fc from "fast-check";

import { loadEnvState, saveEnvState } from "../src/main/env-manager";
import { buildBridgeConfig, TOOL_DESCRIPTORS } from "../src/main/mcp-config";

/**
 * **Validates: Requirements 11.4, 3.2**
 *
 * Property 4: Token Round-Trip Through Environment to Config
 * For any non-empty token string written to the .env file as BROWSERLESS_TOKEN,
 * loading the environment state and generating the MCP bridge configuration SHALL
 * produce an env object containing BROWSERLESS_TOKEN with the same string value
 * that was written.
 */
describe("Feature: browserless-mcp-migration, Property 4: Token Round-Trip Through Environment to Config", () => {
  // Generator for .env-safe non-empty strings.
  // Dotenv parsing cannot handle newlines, carriage returns, or null bytes in unquoted values.
  // We also avoid '#' at the start (treated as comment) and leading/trailing whitespace
  // (dotenv trims unquoted values).
  const envSafeNonEmptyString = fc
    .stringOf(
      fc.char().filter((c) => c !== "\n" && c !== "\r" && c !== "\0" && c !== "#"),
      { minLength: 1 },
    )
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim()); // Ensure no leading/trailing whitespace since dotenv trims values

  function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "token-roundtrip-"));
  }

  function cleanupTempDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  test("token written to .env is preserved when loaded back via loadEnvState", () => {
    fc.assert(
      fc.property(envSafeNonEmptyString, (token) => {
        const tempDir = makeTempDir();
        try {
          // Write .env with the generated token
          saveEnvState(tempDir, {
            BROWSERLESS_TOKEN: token,
            BROWSERLESS_API_URL: "",
            LMSTUDIO_MCP_PLUGIN_ROOT: "",
          });

          // Load the state back
          const state = loadEnvState(tempDir);

          // Find the BROWSERLESS_TOKEN field in returned EnvState
          const tokenField = state.fields.find((f) => f.key === "BROWSERLESS_TOKEN");
          expect(tokenField).toBeDefined();
          expect(tokenField!.value).toBe(token);
        } finally {
          cleanupTempDir(tempDir);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("token from loaded env state is included in buildBridgeConfig output for Browserless descriptor", () => {
    const browserlessDescriptor = TOOL_DESCRIPTORS.find((t) => t.id === "browserless");
    expect(browserlessDescriptor).toBeDefined();

    fc.assert(
      fc.property(envSafeNonEmptyString, (token) => {
        const tempDir = makeTempDir();
        try {
          // Write and reload
          saveEnvState(tempDir, {
            BROWSERLESS_TOKEN: token,
            BROWSERLESS_API_URL: "",
            LMSTUDIO_MCP_PLUGIN_ROOT: "",
          });

          const state = loadEnvState(tempDir);

          // Build a descriptor with the loaded token value injected into env
          const tokenField = state.fields.find((f) => f.key === "BROWSERLESS_TOKEN");
          expect(tokenField).toBeDefined();

          // Simulate how the installer populates the descriptor env from loaded state
          const populatedDescriptor = {
            ...browserlessDescriptor!,
            env: {
              ...browserlessDescriptor!.env,
              BROWSERLESS_TOKEN: tokenField!.value,
            },
          };

          // Generate MCP bridge config
          const config = buildBridgeConfig(tempDir, populatedDescriptor);

          // Verify the config env contains the token
          expect(config.env).toBeDefined();
          expect(config.env.BROWSERLESS_TOKEN).toBe(token);
        } finally {
          cleanupTempDir(tempDir);
        }
      }),
      { numRuns: 100 },
    );
  });
});
