/**
 * Unit tests for preflight skip behavior in setup script.
 *
 * Tests that when the preflight check (Browserless/scripts/preflight-check.js)
 * returns exit code 1, the Browserless bridge config is NOT written,
 * while all other tool configs continue to sync normally.
 *
 * **Validates: Requirements 5.3, 5.4**
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const TOOLS = [
  "Terminal",
  "WebBrowser",
  "Calculator",
  "DocumentScraper",
  "Clock",
  "AskUser",
  "RAG",
  "BlenderBridge",
];

const COMMAND_BASED_TOOLS = ["Browserless"];
const ALL_TOOLS = [...TOOLS, ...COMMAND_BASED_TOOLS];

interface SyncResult {
  synced: string[];
  skipped: string[];
  warnings: string[];
}

/**
 * Simulates the Step 6 sync logic from setup.js for testing purposes.
 * Accepts injectable dependencies for spawnSync, fs, and plugin directory checks.
 */
function syncBridgeConfigs(deps: {
  pluginDirExists: (tool: string) => boolean;
  preflightScriptExists: () => boolean;
  runPreflight: () => { status: number | null };
  writeConfig: (tool: string, config: object) => void;
  buildBridgeConfig: (tool: string) => object;
}): SyncResult {
  const result: SyncResult = { synced: [], skipped: [], warnings: [] };

  for (const tool of ALL_TOOLS) {
    if (!deps.pluginDirExists(tool)) {
      result.skipped.push(tool);
      continue;
    }

    // Run preflight check for command-based tools before writing bridge config
    if (COMMAND_BASED_TOOLS.includes(tool)) {
      if (deps.preflightScriptExists()) {
        const preflight = deps.runPreflight();
        if (preflight.status !== 0) {
          result.warnings.push("Browserless skipped: Node.js 24+ required");
          result.skipped.push(tool);
          continue;
        }
      }
    }

    const config = deps.buildBridgeConfig(tool);
    deps.writeConfig(tool, config);
    result.synced.push(tool);
  }

  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Preflight skip behavior in setup (Req 5.3, 5.4)", () => {
  test("when preflight returns exit code 1, Browserless bridge config is NOT written", () => {
    const writtenConfigs: string[] = [];

    const result = syncBridgeConfigs({
      pluginDirExists: () => true, // All plugin dirs exist
      preflightScriptExists: () => true,
      runPreflight: () => ({ status: 1 }), // Preflight FAILS
      writeConfig: (tool) => {
        writtenConfigs.push(tool);
      },
      buildBridgeConfig: (tool) => ({ command: "node", args: [`${tool}/dist/mcp-server.js`] }),
    });

    // Browserless should NOT appear in synced tools
    expect(result.synced).not.toContain("Browserless");
    // Browserless should appear in skipped tools
    expect(result.skipped).toContain("Browserless");
    // No config file written for Browserless
    expect(writtenConfigs).not.toContain("Browserless");
    // Warning should be logged
    expect(result.warnings).toContain("Browserless skipped: Node.js 24+ required");
  });

  test("when preflight returns exit code 1, all other tool configs continue to sync", () => {
    const writtenConfigs: string[] = [];

    const result = syncBridgeConfigs({
      pluginDirExists: () => true, // All plugin dirs exist
      preflightScriptExists: () => true,
      runPreflight: () => ({ status: 1 }), // Preflight FAILS
      writeConfig: (tool) => {
        writtenConfigs.push(tool);
      },
      buildBridgeConfig: (tool) => ({ command: "node", args: [`${tool}/dist/mcp-server.js`] }),
    });

    // All non-command-based tools should be synced
    for (const tool of TOOLS) {
      expect(result.synced).toContain(tool);
      expect(writtenConfigs).toContain(tool);
    }
  });

  test("when preflight returns exit code 0, Browserless bridge config IS written", () => {
    const writtenConfigs: string[] = [];

    const result = syncBridgeConfigs({
      pluginDirExists: () => true,
      preflightScriptExists: () => true,
      runPreflight: () => ({ status: 0 }), // Preflight PASSES
      writeConfig: (_tool) => {
        writtenConfigs.push(_tool);
      },
      buildBridgeConfig: (_tool) => ({ command: "npx", args: ["-y", "@browserless.io/mcp"] }),
    });

    // Browserless should be synced when preflight passes
    expect(result.synced).toContain("Browserless");
    expect(writtenConfigs).toContain("Browserless");
    // No warnings
    expect(result.warnings).toHaveLength(0);
  });

  test("when preflight script does not exist, Browserless config is written (no gate)", () => {
    const writtenConfigs: string[] = [];

    const result = syncBridgeConfigs({
      pluginDirExists: () => true,
      preflightScriptExists: () => false, // Script missing
      runPreflight: () => {
        throw new Error("Should not be called");
      },
      writeConfig: (_tool) => {
        writtenConfigs.push(_tool);
      },
      buildBridgeConfig: (_tool) => ({ command: "npx", args: ["-y", "@browserless.io/mcp"] }),
    });

    // Without preflight script, Browserless should still sync
    expect(result.synced).toContain("Browserless");
    expect(writtenConfigs).toContain("Browserless");
  });

  test("when Browserless plugin dir does not exist, it is skipped without running preflight", () => {
    let preflightCalled = false;

    const result = syncBridgeConfigs({
      pluginDirExists: (tool) => tool !== "Browserless", // Browserless not installed
      preflightScriptExists: () => true,
      runPreflight: () => {
        preflightCalled = true;
        return { status: 0 };
      },
      writeConfig: () => {},
      buildBridgeConfig: (_tool) => ({ command: "node", args: [] }),
    });

    // Browserless skipped because plugin dir missing
    expect(result.skipped).toContain("Browserless");
    expect(result.synced).not.toContain("Browserless");
    // Preflight should NOT have been called (dir check is first)
    expect(preflightCalled).toBe(false);
  });
});

describe("Integration: preflight skip with actual preflight script", () => {
  const preflightScript = path.resolve(__dirname, "..", "scripts", "preflight-check.js");

  test("running preflight on current Node (< 24) produces non-zero exit code", () => {
    // This test is conditional — only meaningful on Node < 24
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor >= 24) {
      // If running on Node 24+, the preflight will pass
      const result = spawnSync("node", [preflightScript], { stdio: "pipe" });
      expect(result.status).toBe(0);
    } else {
      // On Node < 24, preflight should fail with exit code 1
      const result = spawnSync("node", [preflightScript], { stdio: "pipe" });
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toContain("24");
    }
  });

  test("simulated Node < 24 causes preflight to exit 1", () => {
    const code = `
      Object.defineProperty(process.versions, 'node', {
        value: '22.0.0',
        writable: true,
        configurable: true
      });
      require(${JSON.stringify(preflightScript.replace(/\\/g, "/"))});
    `;
    const result = spawnSync("node", ["-e", code], { stdio: "pipe", timeout: 5000 });
    expect(result.status).toBe(1);
  });

  test("simulated Node >= 24 causes preflight to exit 0", () => {
    const code = `
      Object.defineProperty(process.versions, 'node', {
        value: '24.0.0',
        writable: true,
        configurable: true
      });
      require(${JSON.stringify(preflightScript.replace(/\\/g, "/"))});
    `;
    const result = spawnSync("node", ["-e", code], { stdio: "pipe", timeout: 5000 });
    expect(result.status).toBe(0);
  });
});
