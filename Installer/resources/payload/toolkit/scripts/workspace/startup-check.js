#!/usr/bin/env node
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const strictEnv = process.argv.includes("--strict-env");

function runNodeScript(relativeScript) {
  const full = path.join(repoRoot, relativeScript);
  const result = spawnSync(process.execPath, [full], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  return result.status === 0;
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    console.error(`✗ Node ${process.versions.node} detected. Node 18+ required.`);
    return false;
  }
  console.log(`✓ Node ${process.versions.node}`);
  return true;
}

function checkEnv() {
  const rawApiKey = process.env.BROWSERLESS_API_KEY;
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";

  if (!apiKey || apiKey.includes("your-browserless-api-token-here")) {
    const message = "Browserless API key is not configured (BROWSERLESS_API_KEY).";
    if (strictEnv) {
      console.error(`✗ ${message}`);
      return false;
    }
    console.warn(`⚠ ${message} Browserless MCP calls may fail until set.`);
  } else {
    console.log("✓ BROWSERLESS_API_KEY configured");
  }

  return true;
}

let failed = false;

if (!checkNodeVersion()) failed = true;
if (!checkEnv()) failed = true;
if (!runNodeScript("scripts/workspace/verify-tools.js")) failed = true;
if (!runNodeScript("scripts/workspace/verify-mcp-sync.js")) failed = true;
if (!runNodeScript("scripts/workspace/smoke-test-mcp.js")) failed = true;

if (failed) {
  console.error("\nStartup readiness check failed.");
  process.exit(1);
}

console.log("\nStartup readiness check passed.");
