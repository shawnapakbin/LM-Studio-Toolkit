/**
 * Property-based tests for token round-trip through environment to config.
 * Uses fast-check to verify the token value is preserved when written to .env,
 * loaded back, resolved, and used in MCP bridge configuration generation.
 *
 * Feature: browserless-npx-migration, Property 2: Token Round-Trip Through Environment to Config
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as fc from "fast-check";

import { loadEnvState, resolveBrowserlessToken, saveEnvState } from "../src/main/env-manager";
import { TOOL_DESCRIPTORS, buildBridgeConfig } from "../src/main/mcp-config";

/**
 * **Validates: Requirements 2.2, 2.3, 4.2, 6.3, 8.1, 8.3, 8.4, 8.5**
 *
 * Property 2: Token Round-Trip Through Environment to Config
 * For any non-empty .env-safe string written to the .env file as BROWSERLESS_API_KEY,
 * loading the environment state, resolving the token via resolveBrowserlessToken,
 * placing it into the browserless descriptor env as BROWSERLESS_TOKEN, and calling
 * buildBridgeConfig SHALL produce an env object containing BROWSERLESS_TOKEN with that
 * same string value. The output SHALL NOT contain BROWSERLESS_API_KEY.
 */
describe("Feature: browserless-npx-migration, Property 2: Token Round-Trip Through Environment to Config", () => {
  // Generator for .env-safe non-empty strings.
  // Dotenv parsing cannot handle newlines, carriage returns, or null bytes in unquoted values.
  // We also exclude '=' (breaks key=value parsing) and '#' at the start (treated as comment).
  // Leading/trailing whitespace is trimmed by dotenv for unquoted values.
  const envSafeNonEmptyString = fc
    .stringOf(
      fc.char().filter((c) => c !== "\n" && c !== "\r" && c !== "\0" && c !== "=" && c !== "#"),
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

  test("token written as BROWSERLESS_API_KEY round-trips to BROWSERLESS_TOKEN in bridge config", () => {
    const browserlessDescriptor = TOOL_DESCRIPTORS.find((t) => t.id === "browserless");
    expect(browserlessDescriptor).toBeDefined();

    fc.assert(
      fc.property(envSafeNonEmptyString, (token) => {
        const tempDir = makeTempDir();
        try {
          // Step 1: Write the token to .env as BROWSERLESS_API_KEY
          saveEnvState(tempDir, {
            BROWSERLESS_API_KEY: token,
            BROWSERLESS_API_URL: "",
            LMSTUDIO_MCP_PLUGIN_ROOT: "",
          });

          // Step 2: Load environment state back
          const state = loadEnvState(tempDir);
          const envRecord = Object.fromEntries(state.fields.map((f) => [f.key, f.value]));

          // Step 3: Resolve the token via resolveBrowserlessToken
          const resolvedToken = resolveBrowserlessToken(envRecord);

          // Step 4: Place resolved token into a copy of the browserless descriptor as BROWSERLESS_TOKEN
          const populatedDescriptor = {
            ...browserlessDescriptor!,
            env: {
              ...browserlessDescriptor!.env,
              BROWSERLESS_TOKEN: resolvedToken,
            },
          };

          // Step 5: Generate bridge config
          const config = buildBridgeConfig(tempDir, populatedDescriptor);

          // Assert: output env contains BROWSERLESS_TOKEN with exact same value
          expect(config.env).toBeDefined();
          expect(config.env.BROWSERLESS_TOKEN).toBe(token);

          // Assert: output env does NOT contain BROWSERLESS_API_KEY
          expect(config.env).not.toHaveProperty("BROWSERLESS_API_KEY");
        } finally {
          cleanupTempDir(tempDir);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * **Validates: Requirements 2.4, 8.2**
 *
 * Property 3: URL Pass-Through Preservation
 * For any non-empty URL string set as BROWSERLESS_API_URL in the tool descriptor env,
 * the generated bridge config env block SHALL contain BROWSERLESS_API_URL with that
 * exact string value preserved without transformation.
 */
describe("Feature: browserless-npx-migration, Property 3: URL Pass-Through Preservation", () => {
  // Generator for arbitrary non-empty URL-like strings.
  // We generate both realistic URLs and arbitrary strings to verify no transformation occurs.
  const nonEmptyUrlString = fc
    .oneof(
      // Realistic URL patterns
      fc.webUrl(),
      // Arbitrary non-empty strings to verify no transformation occurs
      fc
        .string({ minLength: 1 })
        .filter((s) => s.trim().length > 0),
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  test("BROWSERLESS_API_URL in descriptor env is preserved exactly in buildBridgeConfig output", () => {
    const browserlessDescriptor = TOOL_DESCRIPTORS.find((t) => t.id === "browserless");
    expect(browserlessDescriptor).toBeDefined();

    fc.assert(
      fc.property(nonEmptyUrlString, (url) => {
        // Create a descriptor copy with the generated URL
        const descriptorWithUrl = {
          ...browserlessDescriptor!,
          env: {
            ...browserlessDescriptor!.env,
            BROWSERLESS_API_URL: url,
          },
        };

        // Build bridge config — for command-based tools, env passes through directly
        const config = buildBridgeConfig("/fake/install/root", descriptorWithUrl);

        // Assert the URL is preserved exactly without any transformation
        expect(config.env).toBeDefined();
        expect(config.env.BROWSERLESS_API_URL).toBe(url);
      }),
      { numRuns: 100 },
    );
  });
});
