/**
 * Property-based test for LM Studio configurator environment pass-through.
 * Verifies that verifyLmStudio correctly maps BROWSERLESS_API_KEY → BROWSERLESS_TOKEN
 * and preserves BROWSERLESS_API_URL in the top-level mcp.json output.
 *
 * Feature: browserless-npx-migration, Property 6: LM Studio Configurator Receives Resolved Environment
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as fc from "fast-check";

import { saveEnvState } from "../src/main/env-manager";

// We need to mock homedir and the LM Studio app detection so we can
// control where mcp.json is written and ensure the sync runs.
jest.mock("node:os", () => {
  const actual = jest.requireActual("node:os");
  return {
    ...actual,
    homedir: jest.fn(actual.homedir),
  };
});

// Mock child_process to avoid real `which` calls for LM Studio detection
jest.mock("node:child_process", () => ({
  spawnSync: jest.fn(() => ({ status: 1, stdout: "", stderr: "" })),
}));

/**
 * **Validates: Requirements 11.1, 11.2**
 *
 * Property 6: LM Studio Configurator Receives Resolved Environment
 * For any set of environment variables (BROWSERLESS_API_KEY and BROWSERLESS_API_URL
 * with varying values), when the LM Studio sync runs, the Browserless entry in the
 * top-level mcp.json output must have env.BROWSERLESS_TOKEN matching the input
 * BROWSERLESS_API_KEY value, and env.BROWSERLESS_API_URL preserved exactly if non-empty.
 */
describe("Feature: browserless-npx-migration, Property 6: LM Studio Configurator Receives Resolved Environment", () => {
  // Generator for .env-safe non-empty strings (no newlines, nulls, '=', or '#')
  const envSafeNonEmptyString = fc
    .stringOf(
      fc.char().filter((c) => c !== "\n" && c !== "\r" && c !== "\0" && c !== "=" && c !== "#"),
      { minLength: 1 },
    )
    .filter((s) => s.trim().length > 0)
    .map((s) => s.trim());

  // Generator for non-empty URL-like strings
  const nonEmptyUrlString = fc
    .oneof(
      fc.webUrl(),
      fc
        .stringOf(
          fc
            .char()
            .filter((c) => c !== "\n" && c !== "\r" && c !== "\0" && c !== "=" && c !== "#"),
          { minLength: 1 },
        )
        .filter((s) => s.trim().length > 0)
        .map((s) => s.trim()),
    )
    .filter((s) => s.length > 0);

  function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "lmstudio-sync-prop-"));
  }

  function cleanupTempDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  test("BROWSERLESS_API_KEY maps to BROWSERLESS_TOKEN and BROWSERLESS_API_URL is preserved in mcp.json", () => {
    fc.assert(
      fc.property(envSafeNonEmptyString, nonEmptyUrlString, (apiKey, apiUrl) => {
        const tempInstallRoot = makeTempDir();
        const tempHome = makeTempDir();

        try {
          // Point homedir to our temp location for mcp.json output
          (os.homedir as jest.Mock).mockReturnValue(tempHome);

          // Create the LM Studio app marker so the sync doesn't skip
          // We mock existsSync for the app path detection by creating a fake app path
          const fakeLmStudioDir = path.join(tempHome, ".lmstudio");
          const fakePluginRoot = path.join(fakeLmStudioDir, "extensions", "plugins", "mcp");
          fs.mkdirSync(fakePluginRoot, { recursive: true });

          // Write .env with our generated values
          saveEnvState(tempInstallRoot, {
            BROWSERLESS_API_KEY: apiKey,
            BROWSERLESS_API_URL: apiUrl,
            LMSTUDIO_MCP_PLUGIN_ROOT: "",
          });

          // Re-require verifyLmStudio to pick up the mocked homedir
          // We use the override parameter to control plugin root
          const { verifyLmStudio } = require("../src/main/lmstudio-sync");

          // Call verifyLmStudio with our temp install root and override plugin root
          verifyLmStudio(tempInstallRoot, fakePluginRoot);

          // Read the top-level mcp.json that was written
          const mcpJsonPath = path.join(fakeLmStudioDir, "mcp.json");
          expect(fs.existsSync(mcpJsonPath)).toBe(true);

          const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
          const browserlessEntry = mcpJson.mcpServers?.browserless;

          expect(browserlessEntry).toBeDefined();
          expect(browserlessEntry.env).toBeDefined();

          // Assert: BROWSERLESS_TOKEN matches the input BROWSERLESS_API_KEY value
          expect(browserlessEntry.env.BROWSERLESS_TOKEN).toBe(apiKey);

          // Assert: BROWSERLESS_API_URL is preserved exactly
          expect(browserlessEntry.env.BROWSERLESS_API_URL).toBe(apiUrl);
        } finally {
          cleanupTempDir(tempInstallRoot);
          cleanupTempDir(tempHome);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("empty BROWSERLESS_API_URL is omitted from output env", () => {
    fc.assert(
      fc.property(envSafeNonEmptyString, (apiKey) => {
        const tempInstallRoot = makeTempDir();
        const tempHome = makeTempDir();

        try {
          (os.homedir as jest.Mock).mockReturnValue(tempHome);

          const fakeLmStudioDir = path.join(tempHome, ".lmstudio");
          const fakePluginRoot = path.join(fakeLmStudioDir, "extensions", "plugins", "mcp");
          fs.mkdirSync(fakePluginRoot, { recursive: true });

          // Write .env with empty BROWSERLESS_API_URL
          saveEnvState(tempInstallRoot, {
            BROWSERLESS_API_KEY: apiKey,
            BROWSERLESS_API_URL: "",
            LMSTUDIO_MCP_PLUGIN_ROOT: "",
          });

          const { verifyLmStudio } = require("../src/main/lmstudio-sync");

          verifyLmStudio(tempInstallRoot, fakePluginRoot);

          const mcpJsonPath = path.join(fakeLmStudioDir, "mcp.json");
          const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
          const browserlessEntry = mcpJson.mcpServers?.browserless;

          expect(browserlessEntry).toBeDefined();
          expect(browserlessEntry.env).toBeDefined();

          // Assert: BROWSERLESS_TOKEN matches the input key
          expect(browserlessEntry.env.BROWSERLESS_TOKEN).toBe(apiKey);

          // Assert: BROWSERLESS_API_URL is NOT present when empty
          expect(browserlessEntry.env).not.toHaveProperty("BROWSERLESS_API_URL");
        } finally {
          cleanupTempDir(tempInstallRoot);
          cleanupTempDir(tempHome);
        }
      }),
      { numRuns: 100 },
    );
  });
});
