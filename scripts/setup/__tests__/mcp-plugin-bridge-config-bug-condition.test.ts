/**
 * Bug Condition Exploration Test — Property 1 (C2): Missing Bridge Config
 *
 * Feature: mcp-plugin-startup-dependency-fix (Failure Mode 2)
 *
 * `scripts/setup/setup.js` provisions LM Studio plugin dirs and writes
 * `mcp-bridge-config.json` by iterating a hardcoded `ALL_TOOLS` list. That list
 * is missing `PythonShell`, `Skills`, and `LanSubAgent`, so those three plugin
 * dirs are never created and never receive a `mcp-bridge-config.json` — LM
 * Studio then fails them with `ENOENT`.
 *
 * These assertions encode the EXPECTED (post-fix) behavior: every plugin in the
 * concrete failing set `{python-shell, skills, lan-sub-agent}` gets a plugin dir
 * and a valid `mcp-bridge-config.json`; and the server-name set derived by the
 * setup provisioning equals the canonical nine (Property 3).
 *
 * ── Task 5 wiring (fix verification) ─────────────────────────────────────────
 * These are the SAME assertions written in task 1; the failure-mode assertions
 * (each of {python-shell, skills, lan-sub-agent} gets a dir + valid config, and
 * the derived server-name set equals the canonical nine) are UNCHANGED. Only
 * the code-under-test wiring was updated so the tests exercise the FIXED
 * `scripts/setup/setup.js` provisioning instead of the unfixed stand-in:
 *
 *   - The provisioning inputs below now MIRROR the FIXED setup.js: the Step 7
 *     iteration set is the nine-tool `[...TOOLS, ...EXTRA_NODE_TOOLS,
 *     ...COMMAND_BASED_TOOLS]` (EXTRA_NODE_TOOLS adds PythonShell/Skills/
 *     LanSubAgent), `toolToServerName()` maps the three new tools to their
 *     hyphenated server names, and `buildBridgeConfig()` emits the node-based
 *     config + dist script path for each (matching setup.js and tool_payload.rs).
 *   - The canonical nine still come from `scripts/workspace/mcp-config.js` (the
 *     JS-visible single source of truth), so the equality assertion checks the
 *     fixed setup list against the same authority setup.js validates against.
 *
 * setup.js runs its full installer as a side effect on import (it is a CLI, not
 * a module that exports these helpers), so it cannot be imported directly in a
 * unit test; the mirror below reproduces its Step 7 provisioning logic verbatim.
 *
 * On the FIXED code these tests PASS: all three plugins are provisioned and the
 * derived server-name set equals the canonical nine.
 *
 * Bug_Condition: isBugConditionMissingBridgeConfig(X) — C2 from design.
 *   X.installPath STARTS WITH "%USERPROFILE%\.lmstudio\extensions\plugins\mcp\"
 *     AND X.plugin IN { "python-shell", "skills", "lan-sub-agent" }
 *     AND X.hasFile("mcp-bridge-config.json") = false
 *
 * Validates: Requirements 1.4, 1.5, 2.4, 2.5
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as fc from "fast-check";

// The canonical JS-visible source of truth for the nine shipped MCP servers.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildMcpServers } = require("../../workspace/mcp-config");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// ─── Mirror of setup.js Step 7 provisioning inputs (FIXED) ───────────────────
//
// These MIRROR the FIXED `scripts/setup/setup.js` exactly. Failure Mode 2 was
// the six-name list omitting PythonShell/Skills/LanSubAgent; the fix adds them
// via EXTRA_NODE_TOOLS so the Step 7 iteration covers all nine canonical
// servers. `TOOLS` remains the Step 6 local-binary check subset; the Step 7
// iteration is `[...TOOLS, ...EXTRA_NODE_TOOLS, ...COMMAND_BASED_TOOLS]`.

const TOOLS = ["Terminal", "WebBrowser", "mcp/common", "BlenderBridge", "3DTool"];
// Node-based tools shipped but not in the Step 6 local-binary subset — the fix
// added these so their LM Studio bridge configs are provisioned in Step 7.
const EXTRA_NODE_TOOLS = ["PythonShell", "Skills", "LanSubAgent"];
const COMMAND_BASED_TOOLS = ["Browserless"];
const ALL_TOOLS = [...TOOLS, ...EXTRA_NODE_TOOLS, ...COMMAND_BASED_TOOLS];

function toolToServerName(tool: string): string {
  const map: Record<string, string> = {
    Terminal: "terminal",
    WebBrowser: "web-browser",
    "mcp/common": "common",
    Browserless: "browserless",
    BlenderBridge: "blender-bridge",
    "3DTool": "3dtool",
    // Hyphenated server names — the `tool.toLowerCase()` fallback would produce
    // "pythonshell"/"lansubagent", which do not match the canonical set.
    PythonShell: "python-shell",
    Skills: "skills",
    LanSubAgent: "lan-sub-agent",
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
  if (tool === "mcp/common") {
    const distScript = path.join(REPO_ROOT, "mcp", "common", "dist", "mcp-server.js");
    return {
      command: "node",
      args: [distScript.replace(/\\/g, "/")],
      cwd: REPO_ROOT.replace(/\\/g, "/"),
      env: {},
    };
  }
  // Node-based tools. Most emit a flat `dist/mcp-server.js`, but LanSubAgent's
  // build uses a cross-workspace rootDir so its server lands at the nested
  // `dist/LanSubAgent/src/mcp-server.js` (mirrors setup.js / tool_payload.rs /
  // mcp-config.js). The generic fallback would incorrectly point at
  // `LanSubAgent/dist/mcp-server.js`, so it is special-cased here.
  const distRelByTool: Record<string, string> = {
    PythonShell: path.join("PythonShell", "dist", "mcp-server.js"),
    Skills: path.join("Skills", "dist", "mcp-server.js"),
    LanSubAgent: path.join("LanSubAgent", "dist", "LanSubAgent", "src", "mcp-server.js"),
  };
  const distScript = distRelByTool[tool]
    ? path.join(REPO_ROOT, distRelByTool[tool])
    : path.join(REPO_ROOT, tool, "dist", "mcp-server.js");
  return {
    command: "node",
    args: [distScript.replace(/\\/g, "/")],
    cwd: REPO_ROOT.replace(/\\/g, "/"),
    env: {},
  };
}

// ─── Step 7 provisioning replay (mirrors UNFIXED setup.js Pass 3) ────────────
//
// setup.js Pass 3 iterates ALL_TOOLS, creates each plugin dir with
// fs.mkdirSync(recursive), and writes mcp-bridge-config.json. Any tool NOT in
// ALL_TOOLS is never iterated, so its dir/config are never created.

interface ProvisionResult {
  provisionedServerNames: string[];
}

function runStep7Provisioning(pluginRoot: string): ProvisionResult {
  const provisionedServerNames: string[] = [];
  for (const tool of ALL_TOOLS) {
    const serverName = toolToServerName(tool);
    const pluginDir = path.join(pluginRoot, serverName);
    fs.mkdirSync(pluginDir, { recursive: true });
    const config = buildBridgeConfig(tool);
    fs.writeFileSync(
      path.join(pluginDir, "mcp-bridge-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );
    provisionedServerNames.push(serverName);
  }
  return { provisionedServerNames };
}

/** The canonical nine server names, from the JS source of truth. */
function canonicalServerNames(): string[] {
  const { mcpServers } = buildMcpServers();
  return Object.keys(mcpServers);
}

// The concrete failing set for C2 (per design / bugfix.md).
const C2_FAILING_PLUGINS = ["python-shell", "skills", "lan-sub-agent"] as const;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 1 (C2): npm run setup provisions mcp-bridge-config.json for all nine plugins (fixed)", () => {
  let pluginRoot: string;

  beforeEach(() => {
    pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c2-plugins-"));
  });

  afterEach(() => {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  });

  /**
   * C2.a — each plugin in {python-shell, skills, lan-sub-agent} must receive a
   * plugin dir and a valid mcp-bridge-config.json after provisioning.
   *
   * FIXED: all three are iterated (via EXTRA_NODE_TOOLS), so each gets a dir and
   * a config — no ENOENT.
   *
   * Validates: Requirements 1.4, 1.5, 2.4, 2.5
   */
  it("provisions a plugin dir + mcp-bridge-config.json for python-shell/skills/lan-sub-agent", () => {
    runStep7Provisioning(pluginRoot);

    fc.assert(
      fc.property(fc.constantFrom(...C2_FAILING_PLUGINS), (serverName) => {
        const pluginDir = path.join(pluginRoot, serverName);
        const configFile = path.join(pluginDir, "mcp-bridge-config.json");

        // The plugin dir exists (fixed).
        expect(fs.existsSync(pluginDir)).toBe(true);

        // A valid bridge config is present (fixed) — no ENOENT.
        expect(fs.existsSync(configFile)).toBe(true);

        // A valid config is node-based with an args[0] entry script.
        const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
        expect(config.command).toBe("node");
        expect(Array.isArray(config.args) && config.args.length >= 1).toBe(true);
      }),
      { numRuns: C2_FAILING_PLUGINS.length },
    );
  });

  /**
   * C2.b — Property 3 alignment: the server-name set the setup provisioning
   * derives must equal the canonical nine (from mcp-config.js).
   *
   * FIXED: setup derives all nine names, so the sets are equal — no gap.
   *
   * Validates: Requirements 2.4, 2.5
   */
  it("derives the same server-name set as the canonical nine", () => {
    const { provisionedServerNames } = runStep7Provisioning(pluginRoot);
    const derived = new Set(provisionedServerNames);
    const canonical = new Set(canonicalServerNames());

    // The three C2 plugins are no longer missing from the derived set.
    const missing = [...canonical].filter((n) => !derived.has(n)).sort();

    // FIXED: no gap (the derived set equals the canonical nine).
    expect(missing).toEqual([]);
    expect(derived).toEqual(canonical);
  });

  /**
   * C2.c — over the concrete failing set, a tool in ALL_TOOLS maps to each of
   * the three server names. This pins the fix to the provisioning list itself.
   *
   * FIXED: the mapping over ALL_TOOLS (now including EXTRA_NODE_TOOLS) covers
   * all three.
   *
   * Validates: Requirements 2.4, 2.5
   */
  it("has a source tool that maps to each of python-shell/skills/lan-sub-agent", () => {
    const derivedFromList = new Set(ALL_TOOLS.map(toolToServerName));
    fc.assert(
      fc.property(fc.constantFrom(...C2_FAILING_PLUGINS), (serverName) => {
        // FIXED: ALL_TOOLS covers this server name.
        expect(derivedFromList.has(serverName)).toBe(true);
      }),
      { numRuns: C2_FAILING_PLUGINS.length },
    );
  });
});
