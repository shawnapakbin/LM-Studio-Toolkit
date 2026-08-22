#!/usr/bin/env node
/**
 * LLM Toolkit Setup Script
 * Cross-platform: Windows, macOS, Linux
 * Usage:
 *   node scripts/setup/setup.js           # Full install
 *   node scripts/setup/setup.js --repair  # Repair/reinstall
 *   node scripts/setup/setup.js --gui     # Launch browser GUI
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const { execSync, spawnSync, spawn } = require("child_process");

// ─── Constants ───────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ENV_FILE = path.join(REPO_ROOT, ".env");
const ENV_EXAMPLE = path.join(REPO_ROOT, ".env.example");
const CONFIG_FILE = path.join(REPO_ROOT, "llm-toolkit.config.yaml");
const MIN_NODE_MAJOR = 18;
const MIN_NPM_MAJOR = 8;

const TOOLS = [
  "Terminal",
  "WebBrowser",
  "mcp/common",
  "RAG",
  "BlenderBridge",
  "3DTool",
  "SubAgent",
];

// Tools that use npx command-based MCP (no local binary to verify)
const COMMAND_BASED_TOOLS = ["Browserless"];

// All tools for LM Studio sync (includes command-based)
const ALL_TOOLS = [...TOOLS, ...COMMAND_BASED_TOOLS];

// ─── Colour helpers (no deps) ─────────────────────────────────────────────────

const NO_COLOR = process.env.NO_COLOR || process.env.CI;
const c = {
  reset: NO_COLOR ? "" : "\x1b[0m",
  bold: NO_COLOR ? "" : "\x1b[1m",
  green: NO_COLOR ? "" : "\x1b[32m",
  yellow: NO_COLOR ? "" : "\x1b[33m",
  red: NO_COLOR ? "" : "\x1b[31m",
  cyan: NO_COLOR ? "" : "\x1b[36m",
  dim: NO_COLOR ? "" : "\x1b[2m",
};

function ok(msg) { console.log(`${c.green}✓${c.reset} ${msg}`); }
function warn(msg) { console.warn(`${c.yellow}⚠${c.reset}  ${msg}`); }
function fail(msg) { console.error(`${c.red}✗${c.reset} ${msg}`); }
function info(msg) { console.log(`${c.cyan}→${c.reset} ${msg}`); }
function section(msg) { console.log(`\n${c.bold}${msg}${c.reset}`); }
function dim(msg) { console.log(`${c.dim}  ${msg}${c.reset}`); }

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_REPAIR = args.includes("--repair");
const IS_GUI = args.includes("--gui");
const IS_CI = args.includes("--ci") || !!process.env.CI;

// ─── GUI launcher ─────────────────────────────────────────────────────────────

if (IS_GUI) {
  const guiPath = path.join(__dirname, "setup-gui.html");
  if (!fs.existsSync(guiPath)) {
    fail("GUI file not found: scripts/setup/setup-gui.html");
    process.exit(1);
  }
  const http = require("http");
  const html = fs.readFileSync(guiPath, "utf8");
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else if (req.method === "POST" && req.url === "/run") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const send = (type, msg) => res.write(`data: ${JSON.stringify({ type, msg })}\n\n`);
      runSetup({ send, repair: false }).then(() => {
        send("done", "Setup complete.");
        res.end();
      }).catch((err) => {
        send("error", err.message);
        res.end();
      });
    } else if (req.method === "POST" && req.url === "/repair") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const send = (type, msg) => res.write(`data: ${JSON.stringify({ type, msg })}\n\n`);
      runSetup({ send, repair: true }).then(() => {
        send("done", "Repair complete.");
        res.end();
      }).catch((err) => {
        send("error", err.message);
        res.end();
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const PORT = 7432;
  server.listen(PORT, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${PORT}`;
    info(`Setup GUI running at ${url}`);
    // Try to open browser cross-platform
    const open = process.platform === "win32" ? "start" :
                 process.platform === "darwin" ? "open" : "xdg-open";
    try { execSync(`${open} ${url}`, { stdio: "ignore" }); } catch {}
    info("Press Ctrl+C to stop the GUI server.");
  });
  return;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const consoleSend = (type, msg) => {
  if (type === "ok") ok(msg);
  else if (type === "warn") warn(msg);
  else if (type === "error") fail(msg);
  else if (type === "info") info(msg);
  else if (type === "section") section(msg);
  else dim(msg);
};

runSetup({ send: consoleSend, repair: IS_REPAIR }).then(() => {
  section("Setup complete!");
  console.log(`\n${c.bold}Next steps:${c.reset}`);
  console.log("  1. Open LM Studio and restart the MCP plugin.");
  console.log("  2. If Browserless tools are needed, ensure BROWSERLESS_API_KEY is set in .env");
  console.log("  3. Run: npm run startup:check\n");
}).catch((err) => {
  fail(`Setup failed: ${err.message}`);
  process.exit(1);
});

// ─── Core setup logic (shared by CLI and GUI) ─────────────────────────────────

/**
 * Runs a shell command with realtime streaming output.
 * Each line of stdout/stderr is forwarded to the send callback as it arrives.
 * Returns a promise that resolves on success, rejects on failure.
 */
function runStreaming(command, args, { cwd, send, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd || REPO_ROOT,
      shell: true,
      env: { ...process.env },
    });

    let stderr = "";

    child.stdout.on("data", (data) => {
      const lines = data.toString().split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        send("dim", `  ${label}: ${line}`);
      }
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
      const lines = data.toString().split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        // npm often writes progress to stderr, treat as info not error
        send("dim", `  ${label}: ${line}`);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`${label} failed to start: ${err.message}`));
    });
  });
}

async function runSetup({ send, repair }) {
  const errors = [];

  // ── Step 1: Detect and install prerequisites ────────────────────────────────
  send("section", "Step 1/7 — Checking prerequisites");

  // ── Node.js detection ────────────────────────────────────────────────────────
  let nodeAvailable = false;
  let nodeVersion = null;
  try {
    nodeVersion = execSync("node --version", { encoding: "utf8" }).trim();
    const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
    if (nodeMajor >= MIN_NODE_MAJOR) {
      nodeAvailable = true;
      send("ok", `Node ${nodeVersion} detected — skipping install`);
    } else {
      send("warn", `Node ${nodeVersion} detected but ${MIN_NODE_MAJOR}+ required — will upgrade`);
    }
  } catch {
    send("info", "Node.js not found — will install automatically");
  }

  if (!nodeAvailable) {
    await installNode({ send });
    // Verify install succeeded
    try {
      nodeVersion = execSync("node --version", { encoding: "utf8" }).trim();
      const nodeMajor = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
      if (nodeMajor < MIN_NODE_MAJOR) {
        throw new Error(`Installed Node ${nodeVersion} but ${MIN_NODE_MAJOR}+ required`);
      }
      send("ok", `Node ${nodeVersion} installed successfully`);
    } catch (err) {
      const msg = `Node.js installation failed: ${err.message}`;
      send("error", msg);
      throw new Error(msg);
    }
  }

  // ── npm detection ────────────────────────────────────────────────────────────
  let npmAvailable = false;
  try {
    const npmVersion = execSync("npm --version", { encoding: "utf8" }).trim();
    const npmMajor = Number(npmVersion.split(".")[0]);
    if (npmMajor >= MIN_NPM_MAJOR) {
      npmAvailable = true;
      send("ok", `npm ${npmVersion} detected — skipping install`);
    } else {
      send("warn", `npm ${npmVersion} detected. npm ${MIN_NPM_MAJOR}+ recommended. Run: npm install -g npm`);
      npmAvailable = true; // Old but usable
    }
  } catch {
    send("warn", "npm not found. It should have been installed with Node.js.");
    send("info", "Attempting to install npm...");
    try {
      execSync("node -e \"require('child_process').execSync('npx npm@latest --yes -- --version')\"", { encoding: "utf8" });
      const npmVersion = execSync("npm --version", { encoding: "utf8" }).trim();
      send("ok", `npm ${npmVersion} installed`);
      npmAvailable = true;
    } catch {
      const msg = "npm is not available and could not be installed. Please install Node.js from https://nodejs.org which includes npm.";
      send("error", msg);
      throw new Error(msg);
    }
  }

  // ── git detection (optional) ─────────────────────────────────────────────────
  try {
    const gitVersion = execSync("git --version", { encoding: "utf8" }).trim();
    send("ok", gitVersion);
  } catch {
    send("warn", "git not found. Not required for setup but needed for contributions.");
  }

  // ── Step 2: Scaffold .env ────────────────────────────────────────────────────
  send("section", "Step 2/7 — Environment configuration");
  if (!fs.existsSync(ENV_FILE) || repair) {
    if (fs.existsSync(ENV_EXAMPLE)) {
      fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
      send("ok", ".env created from .env.example");
      send("info", "Edit .env and set BROWSERLESS_API_KEY before using Browserless tools.");
    } else {
      // Write a minimal .env
      const minimal = [
        "# LLM Toolkit environment variables",
        "# Get your Browserless API key at https://browserless.io/account/",
        "BROWSERLESS_API_KEY=",
        "# BROWSERLESS_API_URL=",
      ].join(os.EOL);
      fs.writeFileSync(ENV_FILE, minimal, "utf8");
      send("ok", ".env created with defaults");
      send("info", "Set BROWSERLESS_API_KEY in .env before using Browserless tools.");
    }
  } else {
    send("ok", ".env already exists — skipping (use --repair to overwrite)");
    // Validate token is not placeholder or empty
    const envContent = fs.readFileSync(ENV_FILE, "utf8");
    const hasKey = envContent.match(/BROWSERLESS_API_KEY=\s*\S+/m) && !envContent.includes("your-browserless-api-key-here");
    const hasLegacyToken = envContent.match(/BROWSERLESS_TOKEN=\s*\S+/m);
    if (!hasKey && !hasLegacyToken) {
      send("warn", "BROWSERLESS_API_KEY is not set in .env — Browserless tools will not authenticate.");
    }
  }

  // ── Step 3: npm install ──────────────────────────────────────────────────────
  send("section", "Step 3/7 — Installing dependencies");
  try {
    send("info", "Running npm install (streaming output below)...");
    await runStreaming("npm", ["install"], { cwd: REPO_ROOT, send, label: "npm install" });
    send("ok", "Dependencies installed");
  } catch (err) {
    const msg = `npm install failed: ${err.message}`;
    send("error", msg);
    errors.push(msg);
    throw new Error(msg);
  }

  // ── Step 4: Build ────────────────────────────────────────────────────────────
  send("section", "Step 4/7 — Building all tools");
  try {
    send("info", "Running npm run build (streaming output below)...");
    await runStreaming("npm", ["run", "build"], { cwd: REPO_ROOT, send, label: "build" });
    send("ok", "All tools built successfully");
  } catch (err) {
    const msg = `Build failed: ${err.message}`;
    send("error", msg);
    errors.push(msg);
    throw new Error(msg);
  }

  // ── Step 5: Generate unified config file ───────────────────────────────────
  send("section", "Step 5/7 — Unified configuration");
  try {
    generateUnifiedConfig({ send, repair });
  } catch (err) {
    const msg = `Config generation failed: ${err.message}`;
    send("error", msg);
    errors.push(msg);
    throw new Error(msg);
  }

  // ── Step 6: Verify binaries ──────────────────────────────────────────────────
  send("section", "Step 6/7 — Verifying tool binaries");
  let allPresent = true;
  for (const tool of TOOLS) {
    let distPath;
    if (tool === "mcp/common") {
      distPath = path.join(REPO_ROOT, "mcp", "common", "dist", "mcp-server.js");
    } else {
      distPath = path.join(REPO_ROOT, tool, "dist", "mcp-server.js");
    }
    if (fs.existsSync(distPath)) {
      send("ok", `${tool} — dist/mcp-server.js`);
    } else {
      send("error", `${tool} — dist/mcp-server.js MISSING`);
      allPresent = false;
      errors.push(`Missing binary: ${tool}/dist/mcp-server.js`);
    }
  }
  if (!allPresent) {
    throw new Error("One or more tool binaries are missing. Check build output above.");
  }

  // ── Step 7: Sync LM Studio bridge configs ────────────────────────────────────
  send("section", "Step 7/7 — Syncing LM Studio bridge configs");
  const {
    OWNER_ID,
    resolvePluginRoot: resolvePluginRootOwnership,
    readJsonSafe,
    cleanOwnedPlugins,
    migrateTopLevelMcpJson,
    getOwnedPluginDirs,
  } = require("../workspace/plugin-ownership");

  const pluginRoot = resolvePluginRootOwnership();

  if (!fs.existsSync(pluginRoot)) {
    send("warn", `LM Studio plugin root not found: ${pluginRoot}`);
    send("warn", "Install LM Studio and add the MCP plugins, then re-run setup.");
    send("info", "Skipping LM Studio sync — all other steps completed.");
    return;
  }

  // One-time migration: remove toolkit entries from top-level mcp.json
  const migrationResult = migrateTopLevelMcpJson({ send });
  if (migrationResult.cleaned) {
    send("ok", `Migrated mcp.json: removed ${migrationResult.removedKeys.length} toolkit entries`);
  }

  // Pass 1: Read existing bridge configs from owned plugins (preserve user env values)
  const existingConfigs = {};
  const ownedDirs = getOwnedPluginDirs(pluginRoot);

  for (const dir of ownedDirs) {
    const dirName = path.basename(dir);
    const bridgeConfig = readJsonSafe(path.join(dir, "mcp-bridge-config.json"));
    if (bridgeConfig) {
      existingConfigs[dirName] = bridgeConfig;
    }
  }

  // Pass 2: Clean all owned plugin directories
  const cleanResult = cleanOwnedPlugins(pluginRoot, { send });
  if (cleanResult.removed.length > 0) {
    send("info", `Cleaned ${cleanResult.removed.length} previous toolkit plugin(s)`);
  }

  // Pass 3: Provision fresh plugin directories with ownership markers
  let synced = 0;
  let skipped = 0;

  for (const tool of ALL_TOOLS) {
    const serverName = toolToServerName(tool);
    const pluginDir = path.join(pluginRoot, serverName);
    const targetFile = path.join(pluginDir, "mcp-bridge-config.json");

    // Run preflight check for command-based tools before provisioning
    if (COMMAND_BASED_TOOLS.includes(tool)) {
      const preflightScript = path.join(REPO_ROOT, "Browserless", "scripts", "preflight-check.js");
      if (fs.existsSync(preflightScript)) {
        const preflight = spawnSync("node", [preflightScript], { stdio: "pipe" });
        if (preflight.status !== 0) {
          send("warn", "Browserless skipped: Node.js 24+ required");
          skipped++;
          continue;
        }
      }
    }

    // Create plugin directory
    fs.mkdirSync(pluginDir, { recursive: true });

    // Write manifest.json with ownership marker (always)
    const manifestFile = path.join(pluginDir, "manifest.json");
    const manifest = {
      type: "plugin",
      runner: "mcpBridge",
      owner: "mcp",
      name: serverName,
      _owner: OWNER_ID,
    };
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    // Write install-state.json with ownership marker (always)
    const installStateFile = path.join(pluginDir, "install-state.json");
    const installState = {
      by: "mcp-bridge-v1",
      at: Date.now(),
      _owner: OWNER_ID,
    };
    fs.writeFileSync(installStateFile, `${JSON.stringify(installState, null, 2)}\n`, "utf8");

    // Build bridge config and merge user-customized env values from previous install
    const config = buildBridgeConfig(tool);
    const existingPluginConfig = existingConfigs[serverName] || null;
    const mergedConfig = mergePluginEnv(config, existingPluginConfig);

    fs.writeFileSync(targetFile, `${JSON.stringify(mergedConfig, null, 2)}\n`, "utf8");
    send("ok", `Provisioned ${serverName}`);

    // Warn if Browserless token is empty (Req 2.5)
    if (COMMAND_BASED_TOOLS.includes(tool) && tool === "Browserless" && !mergedConfig.env.BROWSERLESS_TOKEN) {
      send("warn", "BROWSERLESS_TOKEN is empty — Browserless tools will not authenticate. Set BROWSERLESS_API_KEY in .env.");
    }

    synced++;
  }

  send("info", `LM Studio sync: ${synced} provisioned, ${skipped} skipped.`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates (or regenerates) the unified config file.
 * - First run: generates with schema defaults + any collected user values
 * - Existing file + no repair: skips
 * - Repair mode: regenerates preserving existing custom values
 */
function generateUnifiedConfig({ send, repair }) {
  const { generateConfigFile } = require("../../shared/config/dist/generate");
  const configExists = fs.existsSync(CONFIG_FILE);

  if (configExists && !repair) {
    send("ok", "Config file already exists — skipping (use --repair to regenerate)");
    return;
  }

  if (repair && configExists) {
    // Repair mode: read existing config values, regenerate with new schema defaults + preserve custom values
    send("info", "Repair mode: regenerating config with current schema defaults, preserving custom values...");
    let existingValues = {};
    try {
      const { parse: parseYaml } = require("yaml");
      const rawContent = fs.readFileSync(CONFIG_FILE, "utf-8");
      existingValues = parseYaml(rawContent) || {};
    } catch (parseErr) {
      send("warn", `Could not parse existing config (${parseErr.message}), generating fresh config`);
      existingValues = {};
    }

    try {
      generateConfigFile({
        format: "yaml",
        outputPath: CONFIG_FILE,
        envOutputPath: ENV_FILE,
        existingValues,
      });
      send("ok", "Config file regenerated with preserved custom values");
    } catch (writeErr) {
      throw new Error(`Failed to write config file to ${CONFIG_FILE}: ${writeErr.message}`);
    }
    return;
  }

  // First run: generate config with defaults + any API key values from .env
  send("info", "Generating unified config file...");
  const overrides = {};

  // Pull any API key values the user already has in .env
  const browserlessApiKey = readEnvKey("BROWSERLESS_API_KEY");
  if (browserlessApiKey) {
    overrides.browserless = { apiKey: browserlessApiKey };
  }

  const browserlessApiUrl = readEnvKey("BROWSERLESS_API_URL");
  if (browserlessApiUrl) {
    if (!overrides.browserless) overrides.browserless = {};
    overrides.browserless.apiUrl = browserlessApiUrl;
  }

  const blenderHost = readEnvKey("BLENDER_MCP_HOST");
  if (blenderHost) {
    overrides.blenderbridge = overrides.blenderbridge || {};
    overrides.blenderbridge.host = blenderHost;
  }

  const blenderPort = readEnvKey("BLENDER_MCP_PORT");
  if (blenderPort) {
    overrides.blenderbridge = overrides.blenderbridge || {};
    overrides.blenderbridge.port = Number(blenderPort) || 9876;
  }

  try {
    generateConfigFile({
      format: "yaml",
      outputPath: CONFIG_FILE,
      envOutputPath: ENV_FILE,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
    });
    send("ok", "Config file generated: llm-toolkit.config.yaml");
    send("ok", "Companion .env file generated for backward compatibility");
  } catch (writeErr) {
    throw new Error(`Failed to write config file to ${CONFIG_FILE}: ${writeErr.message}`);
  }
}

/**
 * Merge user-customized env values from an existing bridge config into a new config.
 * Non-empty, non-placeholder values from the existing config take precedence.
 */
function mergePluginEnv(config, existingConfig) {
  if (!existingConfig || typeof existingConfig !== "object") return config;

  const mergedEnv = { ...(config.env ?? {}) };
  const env = existingConfig.env;

  if (env && typeof env === "object") {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      // Skip known placeholder values
      if (key === "BROWSERLESS_API_KEY" && trimmed === "your-browserless-api-key-here") continue;
      if (key === "BROWSERLESS_TOKEN" && trimmed === "your-browserless-api-token-here") continue;
      mergedEnv[key] = value;
    }
  }

  // Remove empty-string env values
  for (const k of Object.keys(mergedEnv)) {
    if (typeof mergedEnv[k] === "string" && !mergedEnv[k].trim()) {
      delete mergedEnv[k];
    }
  }

  return { ...config, env: mergedEnv };
}

function toolToServerName(tool) {
  const map = {
    Terminal: "terminal",
    WebBrowser: "web-browser",
    "mcp/common": "common",
    Browserless: "browserless",
    RAG: "rag",
    BlenderBridge: "blender-bridge",
    "3DTool": "3dtool",
    SubAgent: "sub-agent",
  };
  return map[tool] || tool.toLowerCase();
}

function buildBridgeConfig(tool) {
  // Command-based tools (no local binary) — use schema-proxy wrapper
  if (COMMAND_BASED_TOOLS.includes(tool)) {
    if (tool === "Browserless") {
      const proxyScript = path.join(REPO_ROOT, "Browserless", "scripts", "schema-proxy.js");
      const token = readEnvKey("BROWSERLESS_API_KEY") || readEnvKey("BROWSERLESS_TOKEN");
      const apiUrl = readEnvKey("BROWSERLESS_API_URL");
      const env = { BROWSERLESS_TOKEN: token };
      if (apiUrl) {
        env.BROWSERLESS_API_URL = apiUrl;
      }
      return {
        command: "node",
        args: [proxyScript.replace(/\\/g, "/")],
        env,
      };
    }

    return {
      command: "node",
      args: [],
      env: {},
    };
  }

  // mcp/common — unified common tools plugin
  if (tool === "mcp/common") {
    const distScript = path.join(REPO_ROOT, "mcp", "common", "dist", "mcp-server.js");
    return {
      command: "node",
      args: [distScript.replace(/\\/g, "/")],
      cwd: REPO_ROOT.replace(/\\/g, "/"),
      env: {
        CALCULATOR_DEFAULT_PRECISION: "12",
        CALCULATOR_MAX_PRECISION: "20",
        DOC_SCRAPER_DEFAULT_TIMEOUT_MS: "20000",
        DOC_SCRAPER_MAX_TIMEOUT_MS: "60000",
        DOC_SCRAPER_MAX_CONTENT_BYTES: "52428800",
        DOC_SCRAPER_MAX_CONTENT_CHARS: "50000",
        DOC_SCRAPER_WORKSPACE_ROOT: REPO_ROOT,
        CLOCK_DEFAULT_TIMEZONE: "",
        CLOCK_DEFAULT_LOCALE: "en-US",
        ASK_USER_DB_PATH: path.join(REPO_ROOT, "mcp", "common", "memory.db"),
        ASK_USER_DEFAULT_EXPIRES_SECONDS: "1800",
        ASK_USER_MAX_EXPIRES_SECONDS: "86400",
        ASK_USER_MAX_QUESTIONS: "20",
      },
    };
  }

  // Node-based tools (local binary)
  const distScript = path.join(REPO_ROOT, tool, "dist", "mcp-server.js");
  const envMap = {
    Terminal: { TERMINAL_DEFAULT_TIMEOUT_MS: "60000", TERMINAL_MAX_TIMEOUT_MS: "120000" },
    WebBrowser: { BROWSER_DEFAULT_TIMEOUT_MS: "20000", BROWSER_MAX_TIMEOUT_MS: "60000", BROWSER_MAX_CONTENT_CHARS: "12000" },
    RAG: { RAG_DB_PATH: path.join(REPO_ROOT, "RAG", "rag.db"), RAG_EMBEDDINGS_MODE: "lmstudio", RAG_EMBEDDING_MODEL: "nomic-ai/nomic-embed-text-v1.5", RAG_DOC_SCRAPER_ENDPOINT: "http://localhost:3336/tools/read_document", RAG_ASK_USER_ENDPOINT: "http://localhost:3338/tools/ask_user_interview" },
    BlenderBridge: { BLENDER_MCP_HOST: readEnvKey("BLENDER_MCP_HOST") || "127.0.0.1", BLENDER_MCP_PORT: readEnvKey("BLENDER_MCP_PORT") || "9876", BLENDER_MCP_COMMAND: readEnvKey("BLENDER_MCP_COMMAND") || "blender-mcp" },
    "3DTool": { THREEDTOOL_HTTP_PORT: "3344" },
    SubAgent: { SUBAGENT_MAX_CONCURRENCY: "3", SUBAGENT_CACHE_PATH: path.join(REPO_ROOT, "SubAgent", "subagent-cache.db"), SUBAGENT_CHECKPOINT_DIR: path.join(REPO_ROOT, "SubAgent", ".subagent-checkpoints"), SUBAGENT_API_URL: "http://localhost:1234/v1/chat/completions", SUBAGENT_MODEL: "default", SUBAGENT_PROMPT_TOKEN_COST: "0", SUBAGENT_COMPLETION_TOKEN_COST: "0" },
  };

  return {
    command: "node",
    args: [distScript.replace(/\\/g, "/")],
    cwd: REPO_ROOT.replace(/\\/g, "/"),
    env: envMap[tool] || {},
  };
}

function readEnvKey(key) {
  if (!fs.existsSync(ENV_FILE)) return "";
  const match = fs.readFileSync(ENV_FILE, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  const val = match ? match[1].trim() : "";
  return val === "your-browserless-api-token-here" ? "" : val;
}

// ─── Node.js auto-installer ──────────────────────────────────────────────────

const NODE_INSTALL_VERSION = "20"; // LTS major version to install

/**
 * Downloads and installs Node.js if not present or too old.
 * Strategy per platform:
 *   - Windows: downloads the MSI installer and runs it silently
 *   - macOS: uses the .pkg installer or falls back to curl+tar
 *   - Linux: uses NodeSource setup script or falls back to prebuilt tarball
 */
async function installNode({ send }) {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x64" : os.arch() === "arm64" ? "arm64" : "x64";

  send("info", `Installing Node.js ${NODE_INSTALL_VERSION}.x for ${platform}/${arch}...`);

  // Resolve the latest LTS version in the major line
  const version = await resolveLatestNodeVersion(NODE_INSTALL_VERSION);
  send("info", `Resolved latest version: ${version}`);

  if (platform === "win32") {
    await installNodeWindows({ send, version, arch });
  } else if (platform === "darwin") {
    await installNodeMacOS({ send, version, arch });
  } else {
    await installNodeLinux({ send, version, arch });
  }

  // Refresh PATH so subsequent execSync calls find the new node
  refreshPath();
}

/**
 * Resolves the latest Node.js version for a given major line using the dist index.
 */
function resolveLatestNodeVersion(major) {
  return new Promise((resolve, reject) => {
    https.get("https://nodejs.org/dist/index.json", (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const versions = JSON.parse(data);
          const match = versions.find((v) => v.version.startsWith(`v${major}.`) && v.lts);
          if (match) {
            resolve(match.version);
          } else {
            // Fallback: first match in major line regardless of LTS
            const any = versions.find((v) => v.version.startsWith(`v${major}.`));
            resolve(any ? any.version : `v${major}.0.0`);
          }
        } catch (err) {
          reject(new Error(`Failed to parse Node.js version index: ${err.message}`));
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Downloads a file from a URL to a local path, reporting progress via send.
 */
function downloadFile(url, destPath, send) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (reqUrl) => {
      https.get(reqUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode} for ${reqUrl}`));
          return;
        }
        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        let lastReport = 0;

        res.on("data", (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          // Report progress every 10% (or every 1MB if size unknown)
          if (totalBytes > 0) {
            const pct = Math.floor((downloaded / totalBytes) * 100);
            if (pct >= lastReport + 10) {
              lastReport = pct;
              if (send) send("dim", `  Download: ${pct}% (${(downloaded / 1048576).toFixed(1)} MB)`);
            }
          } else if (downloaded - lastReport > 1048576) {
            lastReport = downloaded;
            if (send) send("dim", `  Downloaded: ${(downloaded / 1048576).toFixed(1)} MB`);
          }
        });

        res.on("end", () => { file.end(resolve); });
      }).on("error", (err) => {
        fs.unlinkSync(destPath);
        reject(err);
      });
    };
    request(url);
  });
}

/**
 * Windows: download and run Node.js MSI installer silently.
 */
async function installNodeWindows({ send, version, arch }) {
  const msiArch = arch === "arm64" ? "arm64" : "x64";
  const fileName = `node-${version}-${msiArch}.msi`;
  const url = `https://nodejs.org/dist/${version}/${fileName}`;
  const tmpDir = os.tmpdir();
  const msiPath = path.join(tmpDir, fileName);

  send("info", `Downloading ${fileName}...`);
  await downloadFile(url, msiPath, send);

  send("info", "Running installer (this may request admin privileges)...");
  try {
    execSync(`msiexec /i "${msiPath}" /qn /norestart`, {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 300000, // 5 min timeout
    });
  } catch (err) {
    // msiexec may need elevation — try with Start-Process
    try {
      execSync(
        `powershell -Command "Start-Process msiexec -ArgumentList '/i','${msiPath}','/qn','/norestart' -Verb RunAs -Wait"`,
        { encoding: "utf8", stdio: "pipe", timeout: 300000 }
      );
    } catch (elevatedErr) {
      throw new Error(`Node.js MSI install failed: ${elevatedErr.message}. Download manually from https://nodejs.org`);
    }
  }

  // Clean up
  try { fs.unlinkSync(msiPath); } catch {}
  send("ok", "Node.js MSI installer completed");
}

/**
 * macOS: download and run Node.js .pkg installer.
 */
async function installNodeMacOS({ send, version, arch }) {
  const pkgArch = arch === "arm64" ? "arm64" : "x64";
  const fileName = `node-${version}.pkg`;
  const url = `https://nodejs.org/dist/${version}/node-${version}-darwin-${pkgArch}.tar.gz`;
  const tmpDir = os.tmpdir();
  const tarPath = path.join(tmpDir, `node-${version}-darwin-${pkgArch}.tar.gz`);
  const installDir = `/usr/local`;

  send("info", `Downloading Node.js ${version} for macOS/${pkgArch}...`);
  await downloadFile(url, tarPath, send);

  send("info", "Extracting to /usr/local (may require sudo)...");
  try {
    execSync(`tar -xzf "${tarPath}" --strip-components=1 -C "${installDir}"`, {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    // Try with sudo
    try {
      execSync(`sudo tar -xzf "${tarPath}" --strip-components=1 -C "${installDir}"`, {
        encoding: "utf8",
        stdio: "inherit",
      });
    } catch (err) {
      throw new Error(`Failed to extract Node.js: ${err.message}. Install manually from https://nodejs.org`);
    }
  }

  // Clean up
  try { fs.unlinkSync(tarPath); } catch {}
  send("ok", "Node.js extracted to /usr/local");
}

/**
 * Linux: download prebuilt tarball and extract to /usr/local.
 */
async function installNodeLinux({ send, version, arch }) {
  const linuxArch = arch === "arm64" ? "arm64" : "x64";
  const fileName = `node-${version}-linux-${linuxArch}.tar.xz`;
  const url = `https://nodejs.org/dist/${version}/${fileName}`;
  const tmpDir = os.tmpdir();
  const tarPath = path.join(tmpDir, fileName);
  const installDir = `/usr/local`;

  send("info", `Downloading ${fileName}...`);
  await downloadFile(url, tarPath, send);

  send("info", "Extracting to /usr/local (may require sudo)...");
  try {
    execSync(`tar -xJf "${tarPath}" --strip-components=1 -C "${installDir}"`, {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    try {
      execSync(`sudo tar -xJf "${tarPath}" --strip-components=1 -C "${installDir}"`, {
        encoding: "utf8",
        stdio: "inherit",
      });
    } catch (err) {
      throw new Error(`Failed to extract Node.js: ${err.message}. Install manually from https://nodejs.org`);
    }
  }

  // Clean up
  try { fs.unlinkSync(tarPath); } catch {}
  send("ok", "Node.js extracted to /usr/local");
}

/**
 * Refreshes the PATH environment variable so newly installed binaries are found.
 * On Windows, reads the registry to get the updated system/user PATH.
 */
function refreshPath() {
  if (os.platform() === "win32") {
    try {
      const systemPath = execSync(
        'powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'Machine\')"',
        { encoding: "utf8" }
      ).trim();
      const userPath = execSync(
        'powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"',
        { encoding: "utf8" }
      ).trim();
      process.env.PATH = `${userPath};${systemPath}`;
    } catch {
      // Best effort — add common Node install locations
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      process.env.PATH = `${programFiles}\\nodejs;${process.env.PATH}`;
    }
  } else {
    // Unix: add common locations if not already present
    const additions = ["/usr/local/bin", "/usr/local/sbin"];
    const currentPath = process.env.PATH || "";
    for (const dir of additions) {
      if (!currentPath.includes(dir)) {
        process.env.PATH = `${dir}:${currentPath}`;
      }
    }
  }
}
