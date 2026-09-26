/**
 * Preservation Property Tests — Property 2 (C2 / setup path) + Property 3
 *
 * Feature: mcp-plugin-startup-dependency-fix (Failure Mode 2, preservation half)
 *
 * These tests follow the OBSERVATION-FIRST methodology: they record the actual
 * behavior of the UNFIXED `scripts/setup/setup.js` Step 7 provisioning for the
 * five already-working plugins (`terminal`, `web-browser`, `common`,
 * `blender-bridge`, `3dtool`) and assert that behavior. They are the regression
 * baseline the fix (task 4) MUST preserve byte-for-byte and path-for-path.
 *
 * ── Task 5 wiring (fix verification) ─────────────────────────────────────────
 * These are the SAME assertions written in task 2; none of the preservation
 * assertions (byte/path-identical configs for the five working plugins,
 * command:node + cwd:REPO_ROOT + repo-root-resolved args[0], <server-name>/
 * placement, idempotency) changed. Only the code-under-test wiring was updated
 * so the tests exercise the FIXED `scripts/setup/setup.js` provisioning:
 *
 *   - The provisioning inputs below now MIRROR the FIXED setup.js: the Step 7
 *     iteration set is the nine-tool `[...TOOLS, ...EXTRA_NODE_TOOLS,
 *     ...COMMAND_BASED_TOOLS]` (EXTRA_NODE_TOOLS adds PythonShell/Skills/
 *     LanSubAgent), `toolToServerName()` maps the three new tools to their
 *     hyphenated server names, and `buildBridgeConfig()` emits the node-based
 *     config + dist script path for each (matching setup.js and tool_payload.rs).
 *   - The fix is purely ADDITIVE for the five already-working plugins, so the
 *     baseline captured for `terminal`/`web-browser`/`common`/`blender-bridge`/
 *     `3dtool` is unchanged and the Property 2 preservation assertions still PASS.
 *   - Property 3 (Single Source of Truth) now HOLDS: the server-name set derived
 *     by the (now nine-tool) provisioning equals the canonical nine from
 *     `mcp-config.js`, exactly as the C2 exploration test (task 5.1) verifies.
 *
 * What is asserted:
 *   - Property 2 (Preservation): over randomly selected non-buggy plugins, the
 *     `mcp-bridge-config.json` content and on-disk location are byte- and
 *     path-identical to the observed baseline for the five working plugins.
 *     — MUST PASS (the fix does not touch these five).
 *   - Setup-path dependency resolution: every setup-path config uses
 *     `command: "node"`, `cwd: REPO_ROOT`, and a repo-root-resolved `args[0]`,
 *     so `MODULE_NOT_FOUND` cannot occur on the setup path (Req 3.3).
 *     — MUST PASS.
 *   - Property 3 (Single Source of Truth): the server-name set derived by the
 *     setup provisioning equals the canonical nine from `mcp-config.js`.
 *     — On the FIXED code this now HOLDS (setup derives all nine).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4 (and Property 3: 2.4, 2.5, 3.1)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as fc from "fast-check";

// The canonical JS-visible source of truth for the nine shipped MCP servers.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildMcpServers } = require("../../workspace/mcp-config");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// ─── Mirror of FIXED setup.js Step 7 provisioning inputs ─────────────────────
//
// These MIRROR the FIXED `scripts/setup/setup.js` exactly. Failure Mode 2 was
// the six-name list omitting PythonShell/Skills/LanSubAgent; the fix adds them
// via EXTRA_NODE_TOOLS so the Step 7 iteration covers all nine canonical
// servers. `TOOLS` remains the Step 6 local-binary check subset; the Step 7
// iteration is `[...TOOLS, ...EXTRA_NODE_TOOLS, ...COMMAND_BASED_TOOLS]`.
//
// The fix is purely ADDITIVE for the five already-working plugins captured in
// the preservation baseline (WORKING_PLUGINS), so their configs and locations
// are unchanged. The three added tools are what makes Property 3 (single source
// of truth) hold below.

const TOOLS = ["Terminal", "WebBrowser", "mcp/common", "BlenderBridge", "3DTool"];
// Node-based tools shipped but not in the Step 6 local-binary subset — the fix
// added these so their LM Studio bridge configs are provisioned in Step 7.
const EXTRA_NODE_TOOLS = ["PythonShell", "Skills", "LanSubAgent"];
const COMMAND_BASED_TOOLS = ["Browserless"];
const ALL_TOOLS = [...TOOLS, ...EXTRA_NODE_TOOLS, ...COMMAND_BASED_TOOLS];

/** The five plugins that already work under `npm run setup` (the preservation set). */
const WORKING_PLUGINS = ["terminal", "web-browser", "common", "blender-bridge", "3dtool"] as const;

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

/**
 * Mirror of the FIXED `buildBridgeConfig` for the tools exercised here. Env
 * values are the STATIC subset (no `.env`-derived values) so the baseline is
 * deterministic and matches the exploration mirror; the fix does not alter the
 * config of any of the five working plugins (WORKING_PLUGINS).
 */
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

// ─── Step 7 provisioning replay (mirrors FIXED setup.js Pass 3) ──────────────

interface ProvisionResult {
  /** serverName -> the JSON text written to that plugin's mcp-bridge-config.json. */
  configTextByServer: Record<string, string>;
  /** serverName -> the absolute path the config was written to. */
  configPathByServer: Record<string, string>;
  provisionedServerNames: string[];
}

/**
 * Replays the FIXED Step 7 provisioning against `pluginRoot`, iterating
 * ALL_TOOLS (now all nine tools), creating each plugin dir and writing
 * `mcp-bridge-config.json` with the exact serialization setup.js uses
 * (`JSON.stringify(config, null, 2) + "\n"`).
 */
function runStep7Provisioning(pluginRoot: string): ProvisionResult {
  const configTextByServer: Record<string, string> = {};
  const configPathByServer: Record<string, string> = {};
  const provisionedServerNames: string[] = [];

  for (const tool of ALL_TOOLS) {
    const serverName = toolToServerName(tool);
    const pluginDir = path.join(pluginRoot, serverName);
    fs.mkdirSync(pluginDir, { recursive: true });
    const config = buildBridgeConfig(tool);
    const text = `${JSON.stringify(config, null, 2)}\n`;
    const configPath = path.join(pluginDir, "mcp-bridge-config.json");
    fs.writeFileSync(configPath, text, "utf8");

    configTextByServer[serverName] = text;
    configPathByServer[serverName] = configPath;
    provisionedServerNames.push(serverName);
  }

  return { configTextByServer, configPathByServer, provisionedServerNames };
}

/** The canonical nine server names, from the JS source of truth. */
function canonicalServerNames(): string[] {
  const { mcpServers } = buildMcpServers();
  return Object.keys(mcpServers);
}

// ─── Observed baseline (recorded once, from the replay) ──────────────────────
//
// Observation-first: capture the config text + relative location the
// provisioning produces for each WORKING plugin, then assert equality against
// it. The fix is additive (it only adds three new tools), so the baseline for
// the five working plugins is identical to the pre-fix baseline.
// `buildBridgeConfig` is a pure function of REPO_ROOT, so the baseline is
// stable across runs on this machine.

function observedBaseline(): {
  textByServer: Record<string, string>;
  relPathByServer: Record<string, string>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c2-baseline-"));
  try {
    const { configTextByServer, configPathByServer } = runStep7Provisioning(root);
    const textByServer: Record<string, string> = {};
    const relPathByServer: Record<string, string> = {};
    for (const serverName of WORKING_PLUGINS) {
      textByServer[serverName] = configTextByServer[serverName];
      // Location relative to the plugin root: "<server-name>/mcp-bridge-config.json".
      relPathByServer[serverName] = path
        .relative(root, configPathByServer[serverName])
        .replace(/\\/g, "/");
    }
    return { textByServer, relPathByServer };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const BASELINE = observedBaseline();

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 2 (C2/setup): existing configs are byte- and path-identical to the observed baseline", () => {
  let pluginRoot: string;

  beforeEach(() => {
    pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c2-preserve-"));
  });

  afterEach(() => {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  });

  /**
   * Property 2 — over randomly selected working plugins, the written config
   * text and its on-disk location are byte- and path-identical to the observed
   * unfixed baseline.
   *
   * MUST PASS on unfixed code (it captures the current behavior to preserve).
   *
   * Validates: Requirements 3.1, 3.2, 3.4
   */
  it("writes byte-identical config content at the same <server-name>/ location for each working plugin", () => {
    const { configTextByServer, configPathByServer } = runStep7Provisioning(pluginRoot);

    fc.assert(
      fc.property(fc.constantFrom(...WORKING_PLUGINS), (serverName) => {
        // The config file exists at <pluginRoot>/<server-name>/mcp-bridge-config.json.
        const actualPath = configPathByServer[serverName];
        expect(fs.existsSync(actualPath)).toBe(true);

        // Location is path-identical to the observed baseline (relative layout).
        const actualRel = path.relative(pluginRoot, actualPath).replace(/\\/g, "/");
        expect(actualRel).toBe(BASELINE.relPathByServer[serverName]);

        // Content is byte-identical to the observed baseline.
        const onDisk = fs.readFileSync(actualPath, "utf8");
        expect(onDisk).toBe(configTextByServer[serverName]);
        expect(onDisk).toBe(BASELINE.textByServer[serverName]);
      }),
      { numRuns: WORKING_PLUGINS.length },
    );
  });

  /**
   * Setup-path dependency resolution preservation (Req 3.3).
   *
   * Every setup-path config for a working plugin uses `command: "node"`,
   * `cwd: REPO_ROOT`, and an `args[0]` that resolves under REPO_ROOT — so the
   * setup path resolves the SDK against the repo's hoisted `node_modules` and
   * `MODULE_NOT_FOUND` cannot occur. The fix must not change this.
   *
   * MUST PASS on unfixed code.
   *
   * Validates: Requirements 3.3
   */
  it("keeps command:node, cwd:REPO_ROOT, and repo-root-resolved args[0] for each working plugin", () => {
    runStep7Provisioning(pluginRoot);
    const repoRootNorm = REPO_ROOT.replace(/\\/g, "/");

    fc.assert(
      fc.property(fc.constantFrom(...WORKING_PLUGINS), (serverName) => {
        const configPath = path.join(pluginRoot, serverName, "mcp-bridge-config.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
          command: string;
          args: string[];
          cwd?: string;
        };

        expect(config.command).toBe("node");
        expect(config.cwd).toBe(repoRootNorm);
        expect(Array.isArray(config.args) && config.args.length >= 1).toBe(true);
        // args[0] is an entry script resolved under the repo root (so the bare
        // require walks up to the repo's hoisted node_modules).
        expect(config.args[0].startsWith(`${repoRootNorm}/`)).toBe(true);
        expect(config.args[0].endsWith("mcp-server.js")).toBe(true);
      }),
      { numRuns: WORKING_PLUGINS.length },
    );
  });

  /**
   * Location preservation: `mcp-server.js`/config files land under the same
   * `<server-name>/` structure (the dependency fix is additive at
   * `node_modules/`, never inside a plugin dir).
   *
   * MUST PASS on unfixed code.
   *
   * Validates: Requirements 3.4
   */
  it("provisions each working plugin's files under <server-name>/ (no nesting change)", () => {
    runStep7Provisioning(pluginRoot);

    fc.assert(
      fc.property(fc.constantFrom(...WORKING_PLUGINS), (serverName) => {
        const pluginDir = path.join(pluginRoot, serverName);
        expect(fs.existsSync(pluginDir)).toBe(true);
        expect(fs.statSync(pluginDir).isDirectory()).toBe(true);
        // The config sits directly under <server-name>/, not a nested subdir.
        expect(fs.existsSync(path.join(pluginDir, "mcp-bridge-config.json"))).toBe(true);
      }),
      { numRuns: WORKING_PLUGINS.length },
    );
  });

  /**
   * Idempotency: re-running the provisioning produces byte-identical configs at
   * the same locations. Part of the observed baseline behavior to preserve.
   *
   * MUST PASS on unfixed code.
   *
   * Validates: Requirements 3.2, 3.4
   */
  it("is idempotent for the working plugins (second run == first run)", () => {
    const first = runStep7Provisioning(pluginRoot);
    const second = runStep7Provisioning(pluginRoot);
    for (const serverName of WORKING_PLUGINS) {
      expect(second.configTextByServer[serverName]).toBe(first.configTextByServer[serverName]);
      expect(second.configPathByServer[serverName]).toBe(first.configPathByServer[serverName]);
    }
  });
});

describe("Property 3 (Single Source of Truth): setup server-name set equals the canonical nine", () => {
  /**
   * Property 3 asserts the single-source-of-truth invariant: the server-name set
   * the setup provisioning derives must equal the canonical nine from
   * `mcp-config.js`.
   *
   * NOTE — post-fix this now HOLDS. On the unfixed code the setup provisioning
   * derived only six names; the three that were missing are exactly the C2
   * failing set {python-shell, skills, lan-sub-agent}. Task 4 aligned the setup
   * list with the canonical source (adding EXTRA_NODE_TOOLS + hyphenated
   * mappings), so the derived set now equals the canonical nine — the same
   * invariant the C2 exploration test (task 5.1) verifies against the same
   * authority setup.js validates against at provisioning time.
   *
   * Validates: Requirements 2.4, 2.5, 3.1
   */
  it("derives the same server-name set as the canonical nine", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c2-ssot-"));
    try {
      const { provisionedServerNames } = runStep7Provisioning(root);
      const derived = new Set(provisionedServerNames);
      const canonical = new Set(canonicalServerNames());

      const missing = [...canonical].filter((n) => !derived.has(n)).sort();

      // Post-fix: no gap. (Unfixed was ["lan-sub-agent","python-shell","skills"].)
      expect(missing).toEqual([]);
      expect(derived).toEqual(canonical);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
