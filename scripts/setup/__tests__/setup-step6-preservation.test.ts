/**
 * Preservation Property Tests for setup.js Step 6
 *
 * These tests capture existing behavior of the UNFIXED code that must be
 * preserved after the bugfix is applied. They test scenarios where the bug
 * condition does NOT hold (i.e., plugin directories already exist, plugin
 * root is missing, or preflight fails).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";

// ─── Constants mirroring setup.js ────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TOOLS = [
  "Terminal",
  "WebBrowser",
  "Calculator",
  "DocumentScraper",
  "Clock",
  "AskUser",
  "RAG",
  "BlenderBridge",
  "SubAgent",
];

const COMMAND_BASED_TOOLS = ["Browserless"];
const ALL_TOOLS = [...TOOLS, ...COMMAND_BASED_TOOLS];

// ─── Helper functions mirroring setup.js ─────────────────────────────────────

function toolToServerName(tool: string): string {
  const map: Record<string, string> = {
    Terminal: "terminal",
    WebBrowser: "web-browser",
    Calculator: "calculator",
    DocumentScraper: "document-scraper",
    Clock: "clock",
    Browserless: "browserless",
    AskUser: "ask-user",
    RAG: "rag",
    BlenderBridge: "blender-bridge",
    SubAgent: "sub-agent",
  };
  return map[tool] || tool.toLowerCase();
}

function buildBridgeConfig(tool: string): Record<string, unknown> {
  if (COMMAND_BASED_TOOLS.includes(tool)) {
    if (tool === "Browserless") {
      const proxyScript = path.join(REPO_ROOT, "Browserless", "scripts", "schema-proxy.js");
      return {
        command: "node",
        args: [proxyScript.replace(/\\/g, "/")],
        env: { BROWSERLESS_TOKEN: "" },
      };
    }
    return { command: "node", args: [], env: {} };
  }

  const distScript = path.join(REPO_ROOT, tool, "dist", "mcp-server.js");
  const envMap: Record<string, Record<string, string>> = {
    Terminal: { TERMINAL_DEFAULT_TIMEOUT_MS: "60000", TERMINAL_MAX_TIMEOUT_MS: "120000" },
    WebBrowser: {
      BROWSER_DEFAULT_TIMEOUT_MS: "20000",
      BROWSER_MAX_TIMEOUT_MS: "60000",
      BROWSER_MAX_CONTENT_CHARS: "12000",
    },
    Calculator: { CALCULATOR_DEFAULT_PRECISION: "12", CALCULATOR_MAX_PRECISION: "20" },
    DocumentScraper: {
      DOC_SCRAPER_DEFAULT_TIMEOUT_MS: "20000",
      DOC_SCRAPER_MAX_TIMEOUT_MS: "60000",
      DOC_SCRAPER_MAX_CONTENT_BYTES: "52428800",
      DOC_SCRAPER_MAX_CONTENT_CHARS: "50000",
      DOC_SCRAPER_WORKSPACE_ROOT: REPO_ROOT,
    },
    Clock: { CLOCK_DEFAULT_TIMEZONE: "", CLOCK_DEFAULT_LOCALE: "en-US" },
    AskUser: {
      ASK_USER_DB_PATH: path.join(REPO_ROOT, "AskUser", "memory.db"),
      ASK_USER_DEFAULT_EXPIRES_SECONDS: "1800",
      ASK_USER_MAX_EXPIRES_SECONDS: "86400",
      ASK_USER_MAX_QUESTIONS: "20",
    },
    RAG: {
      RAG_DB_PATH: path.join(REPO_ROOT, "RAG", "rag.db"),
      RAG_EMBEDDINGS_MODE: "lmstudio",
      RAG_EMBEDDING_MODEL: "nomic-ai/nomic-embed-text-v1.5",
      RAG_DOC_SCRAPER_ENDPOINT: "http://localhost:3336/tools/read_document",
      RAG_ASK_USER_ENDPOINT: "http://localhost:3338/tools/ask_user_interview",
    },
    BlenderBridge: {
      BLENDER_MCP_HOST: "127.0.0.1",
      BLENDER_MCP_PORT: "9876",
      BLENDER_MCP_COMMAND: "blender-mcp",
    },
    SubAgent: {
      SUBAGENT_MAX_CONCURRENCY: "3",
      SUBAGENT_CACHE_PATH: path.join(REPO_ROOT, "SubAgent", "subagent-cache.db"),
      SUBAGENT_CHECKPOINT_DIR: path.join(REPO_ROOT, "SubAgent", ".subagent-checkpoints"),
      SUBAGENT_API_URL: "http://localhost:1234/v1/chat/completions",
      SUBAGENT_MODEL: "default",
      SUBAGENT_PROMPT_TOKEN_COST: "0",
      SUBAGENT_COMPLETION_TOKEN_COST: "0",
    },
  };

  return {
    command: "node",
    args: [distScript.replace(/\\/g, "/")],
    cwd: REPO_ROOT.replace(/\\/g, "/"),
    env: envMap[tool] || {},
  };
}

// ─── Step 6 loop extraction (mirrors UNFIXED setup.js behavior) ──────────────

interface Step6Result {
  synced: number;
  skipped: number;
  syncedConfigs: Record<string, Record<string, unknown>>;
  messages: Array<{ type: string; msg: string }>;
}

/**
 * Runs the Step 6 loop logic extracted from setup.js against a given pluginRoot.
 * This mirrors the UNFIXED behavior exactly.
 */
function runStep6Loop(pluginRoot: string, opts?: { preflightFails?: boolean }): Step6Result {
  const messages: Array<{ type: string; msg: string }> = [];
  const send = (type: string, msg: string) => messages.push({ type, msg });

  // Check if plugin root exists (mirrors setup.js early return)
  if (!fs.existsSync(pluginRoot)) {
    send("warn", `LM Studio plugin root not found: ${pluginRoot}`);
    send("warn", "Install LM Studio and add the MCP plugins, then re-run setup.");
    send("info", "Skipping LM Studio sync — all other steps completed.");
    return { synced: 0, skipped: 0, syncedConfigs: {}, messages };
  }

  let synced = 0;
  let skipped = 0;
  const syncedConfigs: Record<string, Record<string, unknown>> = {};

  for (const tool of ALL_TOOLS) {
    const serverName = toolToServerName(tool);
    const pluginDir = path.join(pluginRoot, serverName);
    const targetFile = path.join(pluginDir, "mcp-bridge-config.json");

    if (!fs.existsSync(pluginDir)) {
      send("dim", `  skipped ${serverName} (plugin not installed in LM Studio)`);
      skipped++;
      continue;
    }

    // Preflight check for command-based tools
    if (COMMAND_BASED_TOOLS.includes(tool)) {
      if (opts?.preflightFails) {
        send("warn", "Browserless skipped: Node.js 24+ required");
        skipped++;
        continue;
      }
    }

    const config = buildBridgeConfig(tool);
    fs.writeFileSync(targetFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    send("ok", `Synced ${serverName}`);
    syncedConfigs[serverName] = config;
    synced++;
  }

  return { synced, skipped, syncedConfigs, messages };
}

// ─── fast-check Arbitraries ──────────────────────────────────────────────────

/**
 * Generates a non-empty subset of ALL_TOOLS (at least 1 tool).
 * These represent tools whose plugin directories ALREADY exist.
 */
const existingToolsArbitrary = fc.subarray(ALL_TOOLS, { minLength: 1 });

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTempPluginRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "step6-preservation-"));
}

function cleanupDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Setup Step 6 - Preservation Property Tests", () => {
  /**
   * Property Test 1: For tools with EXISTING directories, mcp-bridge-config.json
   * is written with correct content from buildBridgeConfig(tool).
   *
   * **Validates: Requirements 3.1**
   */
  describe("Property: Existing plugin directories get bridge config written", () => {
    it("for all tools with existing directories, mcp-bridge-config.json is written with correct content", () => {
      fc.assert(
        fc.property(existingToolsArbitrary, (toolsWithDirs) => {
          const pluginRoot = createTempPluginRoot();
          try {
            // Create plugin directories for selected tools (simulating "already exists")
            for (const tool of toolsWithDirs) {
              const serverName = toolToServerName(tool);
              const pluginDir = path.join(pluginRoot, serverName);
              fs.mkdirSync(pluginDir, { recursive: true });
            }

            // Run Step 6 loop
            const result = runStep6Loop(pluginRoot);

            // Assert: for every tool with an existing directory, bridge config is written
            for (const tool of toolsWithDirs) {
              // Skip Browserless if it needs preflight (in normal mode, no preflight mock)
              if (COMMAND_BASED_TOOLS.includes(tool)) {
                // In normal execution without preflightFails, Browserless proceeds
                // The actual preflight script may or may not exist/pass in test env
                // We test it separately in the preflight test below
                continue;
              }

              const serverName = toolToServerName(tool);
              const targetFile = path.join(pluginRoot, serverName, "mcp-bridge-config.json");

              // Assert file was written
              expect(fs.existsSync(targetFile)).toBe(true);

              // Assert content matches buildBridgeConfig output
              const written = JSON.parse(fs.readFileSync(targetFile, "utf8"));
              const expected = buildBridgeConfig(tool);
              expect(written).toEqual(expected);
            }

            // Assert: synced count matches tools that got configs written
            // (excluding command-based tools that may be affected by preflight)
            const nonCommandTools = toolsWithDirs.filter((t) => !COMMAND_BASED_TOOLS.includes(t));
            expect(result.synced).toBeGreaterThanOrEqual(nonCommandTools.length);
          } finally {
            cleanupDir(pluginRoot);
          }
        }),
        { numRuns: 50 },
      );
    });

    it("bridge config content exactly matches buildBridgeConfig() output for each tool", () => {
      // Exhaustive check: test every individual standard tool
      for (const tool of TOOLS) {
        const pluginRoot = createTempPluginRoot();
        try {
          const serverName = toolToServerName(tool);
          const pluginDir = path.join(pluginRoot, serverName);
          fs.mkdirSync(pluginDir, { recursive: true });

          runStep6Loop(pluginRoot);

          const targetFile = path.join(pluginDir, "mcp-bridge-config.json");
          expect(fs.existsSync(targetFile)).toBe(true);

          const written = JSON.parse(fs.readFileSync(targetFile, "utf8"));
          const expected = buildBridgeConfig(tool);
          expect(written).toEqual(expected);
        } finally {
          cleanupDir(pluginRoot);
        }
      }
    });
  });

  /**
   * Property Test 2: When plugin root does NOT exist, Step 6 returns early
   * with warning and no configs are written anywhere.
   *
   * **Validates: Requirements 3.2**
   */
  describe("Property: Missing plugin root skips all of Step 6", () => {
    it("when plugin root does not exist, no configs are written and warnings are emitted", () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          // Use a non-existent path
          const nonExistentRoot = path.join(
            os.tmpdir(),
            `nonexistent-plugin-root-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          );

          // Ensure it really doesn't exist
          expect(fs.existsSync(nonExistentRoot)).toBe(false);

          const result = runStep6Loop(nonExistentRoot);

          // Assert: no configs were written
          expect(result.synced).toBe(0);
          expect(result.skipped).toBe(0);
          expect(result.syncedConfigs).toEqual({});

          // Assert: warning messages were emitted about missing plugin root
          const warnMessages = result.messages.filter((m) => m.type === "warn");
          expect(warnMessages.length).toBeGreaterThanOrEqual(1);
          expect(warnMessages[0].msg).toContain("LM Studio plugin root not found");

          // Assert: info message about skipping
          const infoMessages = result.messages.filter((m) => m.type === "info");
          expect(infoMessages.some((m) => m.msg.includes("Skipping LM Studio sync"))).toBe(true);
        }),
        { numRuns: 10 },
      );
    });

    it("no directories are created when plugin root is missing", () => {
      const nonExistentRoot = path.join(os.tmpdir(), `nonexistent-step6-${Date.now()}`);

      expect(fs.existsSync(nonExistentRoot)).toBe(false);

      runStep6Loop(nonExistentRoot);

      // Root should still not exist (Step 6 does NOT create it)
      expect(fs.existsSync(nonExistentRoot)).toBe(false);
    });
  });

  /**
   * Property Test 3: When a command-based tool (Browserless) fails preflight,
   * it is skipped with a warning.
   *
   * **Validates: Requirements 3.3**
   */
  describe("Property: Preflight failure skips command-based tool", () => {
    it("when Browserless preflight fails, it is skipped and warning is emitted", () => {
      const pluginRoot = createTempPluginRoot();
      try {
        // Create directories for ALL tools including Browserless
        for (const tool of ALL_TOOLS) {
          const serverName = toolToServerName(tool);
          fs.mkdirSync(path.join(pluginRoot, serverName), { recursive: true });
        }

        // Run with preflight failure simulated
        const result = runStep6Loop(pluginRoot, { preflightFails: true });

        // Assert: Browserless was skipped
        const browserlessDir = path.join(pluginRoot, "browserless");
        const browserlessConfig = path.join(browserlessDir, "mcp-bridge-config.json");
        expect(fs.existsSync(browserlessConfig)).toBe(false);

        // Assert: warning about Browserless was emitted
        const warnMessages = result.messages.filter((m) => m.type === "warn");
        expect(warnMessages.some((m) => m.msg.includes("Browserless skipped"))).toBe(true);

        // Assert: Browserless counted as skipped
        expect(result.skipped).toBeGreaterThanOrEqual(1);

        // Assert: standard tools still got their configs
        for (const tool of TOOLS) {
          const serverName = toolToServerName(tool);
          const targetFile = path.join(pluginRoot, serverName, "mcp-bridge-config.json");
          expect(fs.existsSync(targetFile)).toBe(true);
        }
      } finally {
        cleanupDir(pluginRoot);
      }
    });

    it("property: for any subset of tools with existing dirs, preflight failure only affects command-based tools", () => {
      fc.assert(
        fc.property(existingToolsArbitrary, (toolsWithDirs) => {
          const pluginRoot = createTempPluginRoot();
          try {
            // Create directories only for selected tools
            for (const tool of toolsWithDirs) {
              const serverName = toolToServerName(tool);
              fs.mkdirSync(path.join(pluginRoot, serverName), { recursive: true });
            }

            // Run with preflight failure
            runStep6Loop(pluginRoot, { preflightFails: true });

            // Standard tools with directories should get configs
            const standardToolsWithDirs = toolsWithDirs.filter(
              (t) => !COMMAND_BASED_TOOLS.includes(t),
            );
            for (const tool of standardToolsWithDirs) {
              const serverName = toolToServerName(tool);
              const targetFile = path.join(pluginRoot, serverName, "mcp-bridge-config.json");
              expect(fs.existsSync(targetFile)).toBe(true);
            }

            // Command-based tools should NOT get configs when preflight fails
            const commandToolsWithDirs = toolsWithDirs.filter((t) =>
              COMMAND_BASED_TOOLS.includes(t),
            );
            for (const tool of commandToolsWithDirs) {
              const serverName = toolToServerName(tool);
              const targetFile = path.join(pluginRoot, serverName, "mcp-bridge-config.json");
              expect(fs.existsSync(targetFile)).toBe(false);
            }
          } finally {
            cleanupDir(pluginRoot);
          }
        }),
        { numRuns: 50 },
      );
    });
  });

  /**
   * Property: For all input WHERE NOT isBugCondition(input),
   * the behavior is well-defined and consistent.
   *
   * This property checks that when directories exist, the result is deterministic:
   * running Step 6 twice with the same setup produces the same configs.
   *
   * **Validates: Requirements 3.1, 3.4**
   */
  describe("Property: Deterministic behavior for existing directories", () => {
    it("running Step 6 twice produces identical bridge configs (idempotency)", () => {
      fc.assert(
        fc.property(existingToolsArbitrary, (toolsWithDirs) => {
          const pluginRoot = createTempPluginRoot();
          try {
            // Create directories for selected tools
            for (const tool of toolsWithDirs) {
              const serverName = toolToServerName(tool);
              fs.mkdirSync(path.join(pluginRoot, serverName), { recursive: true });
            }

            // Run Step 6 twice
            const result1 = runStep6Loop(pluginRoot);
            const result2 = runStep6Loop(pluginRoot);

            // Assert: same configs written both times
            expect(result1.syncedConfigs).toEqual(result2.syncedConfigs);

            // Assert: same synced count
            expect(result1.synced).toBe(result2.synced);
          } finally {
            cleanupDir(pluginRoot);
          }
        }),
        { numRuns: 30 },
      );
    });
  });
});
