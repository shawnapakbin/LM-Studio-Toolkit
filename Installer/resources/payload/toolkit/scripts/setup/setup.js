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
const { execSync, spawnSync } = require("child_process");

// ─── Constants ───────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ENV_FILE = path.join(REPO_ROOT, ".env");
const ENV_EXAMPLE = path.join(REPO_ROOT, ".env.example");
const MIN_NODE_MAJOR = 18;
const MIN_NPM_MAJOR = 8;

const TOOLS = [
  "Terminal",
  "WebBrowser",
  "Calculator",
  "DocumentScraper",
  "Clock",
  "Browserless",
  "AskUser",
  "RAG",
];

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

async function runSetup({ send, repair }) {
  const errors = [];

  // ── Step 1: Check Node version ──────────────────────────────────────────────
  send("section", "Step 1/6 — Checking prerequisites");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < MIN_NODE_MAJOR) {
    const msg = `Node ${process.versions.node} detected. Node ${MIN_NODE_MAJOR}+ required. Download: https://nodejs.org`;
    send("error", msg);
    throw new Error(msg);
  }
  send("ok", `Node ${process.versions.node}`);

  // ── Check npm version ────────────────────────────────────────────────────────
  try {
    const npmVersion = execSync("npm --version", { encoding: "utf8" }).trim();
    const npmMajor = Number(npmVersion.split(".")[0]);
    if (npmMajor < MIN_NPM_MAJOR) {
      send("warn", `npm ${npmVersion} detected. npm ${MIN_NPM_MAJOR}+ recommended. Run: npm install -g npm`);
    } else {
      send("ok", `npm ${npmVersion}`);
    }
  } catch {
    send("warn", "Could not detect npm version.");
  }

  // ── Check git ────────────────────────────────────────────────────────────────
  try {
    const gitVersion = execSync("git --version", { encoding: "utf8" }).trim();
    send("ok", gitVersion);
  } catch {
    send("warn", "git not found. Not required for setup but needed for contributions.");
  }

  // ── Step 2: Scaffold .env ────────────────────────────────────────────────────
  send("section", "Step 2/6 — Environment configuration");
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
        "BROWSERLESS_DEFAULT_REGION=production-sfo",
        "BROWSERLESS_DEFAULT_TIMEOUT_MS=30000",
      ].join(os.EOL);
      fs.writeFileSync(ENV_FILE, minimal, "utf8");
      send("ok", ".env created with defaults");
      send("info", "Set BROWSERLESS_API_KEY in .env before using Browserless tools.");
    }
  } else {
    send("ok", ".env already exists — skipping (use --repair to overwrite)");
    // Validate key is not placeholder
    const envContent = fs.readFileSync(ENV_FILE, "utf8");
    if (envContent.includes("your-browserless-api-token-here") || envContent.match(/BROWSERLESS_API_KEY=\s*$/m)) {
      send("warn", "BROWSERLESS_API_KEY is not set in .env — Browserless tools will not work.");
    }
  }

  // ── Step 3: npm install ──────────────────────────────────────────────────────
  send("section", "Step 3/6 — Installing dependencies");
  try {
    send("info", "Running npm install (this may take a minute)...");
    execSync("npm install", { cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8" });
    send("ok", "Dependencies installed");
  } catch (err) {
    const msg = `npm install failed: ${err.stderr || err.message}`;
    send("error", msg);
    errors.push(msg);
    throw new Error(msg);
  }

  // ── Step 4: Build ────────────────────────────────────────────────────────────
  send("section", "Step 4/6 — Building all tools");
  try {
    send("info", "Running npm run build...");
    execSync("npm run build", { cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8" });
    send("ok", "All tools built successfully");
  } catch (err) {
    const msg = `Build failed: ${err.stderr || err.message}`;
    send("error", msg);
    errors.push(msg);
    throw new Error(msg);
  }

  // ── Step 5: Verify binaries ──────────────────────────────────────────────────
  send("section", "Step 5/6 — Verifying tool binaries");
  let allPresent = true;
  for (const tool of TOOLS) {
    const distPath = path.join(REPO_ROOT, tool, "dist", "mcp-server.js");
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

  // ── Step 6: Sync LM Studio bridge configs ────────────────────────────────────
  send("section", "Step 6/6 — Syncing LM Studio bridge configs");
  const pluginRoot = resolvePluginRoot();

  if (!fs.existsSync(pluginRoot)) {
    send("warn", `LM Studio plugin root not found: ${pluginRoot}`);
    send("warn", "Install LM Studio and add the MCP plugins, then re-run setup.");
    send("info", "Skipping LM Studio sync — all other steps completed.");
    return;
  }

  let synced = 0;
  let skipped = 0;

  for (const tool of TOOLS) {
    const serverName = toolToServerName(tool);
    const pluginDir = path.join(pluginRoot, serverName);
    const targetFile = path.join(pluginDir, "mcp-bridge-config.json");

    if (!fs.existsSync(pluginDir)) {
      send("dim", `  skipped ${serverName} (plugin not installed in LM Studio)`);
      skipped++;
      continue;
    }

    const distScript = path.join(REPO_ROOT, tool, "dist", "mcp-server.js");
    const config = buildBridgeConfig(tool, distScript);
    fs.writeFileSync(targetFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    send("ok", `Synced ${serverName}`);
    synced++;
  }

  send("info", `LM Studio sync: ${synced} updated, ${skipped} skipped (not installed).`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePluginRoot() {
  const custom = process.env.LMSTUDIO_MCP_PLUGIN_ROOT;
  if (typeof custom === "string" && custom.trim()) return path.resolve(custom.trim());
  return path.join(os.homedir(), ".lmstudio", "extensions", "plugins", "mcp");
}

function toolToServerName(tool) {
  const map = {
    Terminal: "terminal",
    WebBrowser: "web-browser",
    Calculator: "calculator",
    DocumentScraper: "document-scraper",
    Clock: "clock",
    Browserless: "browserless",
    AskUser: "ask-user",
    RAG: "rag",
  };
  return map[tool] || tool.toLowerCase();
}

function buildBridgeConfig(tool, distScript) {
  const envMap = {
    Terminal: { TERMINAL_DEFAULT_TIMEOUT_MS: "60000", TERMINAL_MAX_TIMEOUT_MS: "120000" },
    WebBrowser: { BROWSER_DEFAULT_TIMEOUT_MS: "20000", BROWSER_MAX_TIMEOUT_MS: "60000", BROWSER_MAX_CONTENT_CHARS: "12000" },
    Calculator: { CALCULATOR_DEFAULT_PRECISION: "12", CALCULATOR_MAX_PRECISION: "20" },
    DocumentScraper: { DOC_SCRAPER_DEFAULT_TIMEOUT_MS: "20000", DOC_SCRAPER_MAX_TIMEOUT_MS: "60000", DOC_SCRAPER_MAX_CONTENT_BYTES: "52428800", DOC_SCRAPER_MAX_CONTENT_CHARS: "50000", DOC_SCRAPER_WORKSPACE_ROOT: REPO_ROOT },
    Clock: { CLOCK_DEFAULT_TIMEZONE: "", CLOCK_DEFAULT_LOCALE: "en-US" },
    Browserless: { BROWSERLESS_API_KEY: readEnvKey("BROWSERLESS_API_KEY"), BROWSERLESS_DEFAULT_REGION: "production-sfo", BROWSERLESS_DEFAULT_TIMEOUT_MS: "30000", BROWSERLESS_MAX_TIMEOUT_MS: "120000", BROWSERLESS_CONCURRENCY_LIMIT: "5" },
    AskUser: { ASK_USER_DB_PATH: path.join(REPO_ROOT, "AskUser", "memory.db"), ASK_USER_DEFAULT_EXPIRES_SECONDS: "1800", ASK_USER_MAX_EXPIRES_SECONDS: "86400", ASK_USER_MAX_QUESTIONS: "20" },
    RAG: { RAG_DB_PATH: path.join(REPO_ROOT, "RAG", "rag.db"), RAG_EMBEDDINGS_MODE: "lmstudio", RAG_EMBEDDING_MODEL: "nomic-ai/nomic-embed-text-v1.5", RAG_DOC_SCRAPER_ENDPOINT: "http://localhost:3336/tools/read_document", RAG_ASK_USER_ENDPOINT: "http://localhost:3338/tools/ask_user_interview" },
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
