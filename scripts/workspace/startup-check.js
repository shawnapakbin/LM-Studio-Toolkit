#!/usr/bin/env node
const path = require("path");
const { spawnSync } = require("child_process");
const { buildMcpServers } = require("./mcp-config");

const repoRoot = path.resolve(__dirname, "..", "..");
const strictEnv = process.argv.includes("--strict-env");

// ─── Server buckets (retire-and-gate-mcp-servers, Requirement 7.5) ────────────
// The nine Shipped servers are the only ones that may be registered/provisioned.
const SHIPPED_SERVERS = [
  "terminal",
  "web-browser",
  "common",
  "browserless",
  "python-shell",
  "skills",
  "blender-bridge",
  "3dtool",
  "lan-sub-agent",
];
// Retired servers are deleted; Unshipped servers build but are never provisioned.
// Neither bucket may appear in the registered set.
const RETIRED_SERVERS = ["rag", "csv-exporter", "file-editor", "package-manager"];
const UNSHIPPED_SERVERS = ["slash-commands", "sub-agent", "git"];

// Confirm exactly the nine Shipped servers are registered and that no Retired or
// Unshipped server is provisioned. Consumes the same authoritative source
// (mcp-config.js) that verify-mcp-sync asserts against.
function checkRegistrationBuckets() {
  let registeredNames;
  try {
    registeredNames = Object.keys(buildMcpServers().mcpServers);
  } catch (err) {
    console.error(`✗ Unable to read MCP registration source: ${err.message}`);
    return false;
  }

  const registeredSet = new Set(registeredNames);
  const expectedSet = new Set(SHIPPED_SERVERS);

  const missing = SHIPPED_SERVERS.filter((name) => !registeredSet.has(name));
  const provisionedRetired = RETIRED_SERVERS.filter((name) => registeredSet.has(name));
  const provisionedUnshipped = UNSHIPPED_SERVERS.filter((name) => registeredSet.has(name));
  const unexpected = registeredNames.filter((name) => !expectedSet.has(name));

  let ok = true;

  if (missing.length > 0) {
    console.error(`✗ Missing Shipped server registration(s): ${missing.join(", ")}`);
    ok = false;
  }
  if (provisionedRetired.length > 0) {
    console.error(`✗ Retired server(s) must not be provisioned: ${provisionedRetired.join(", ")}`);
    ok = false;
  }
  if (provisionedUnshipped.length > 0) {
    console.error(
      `✗ Unshipped server(s) must not be provisioned: ${provisionedUnshipped.join(", ")}`,
    );
    ok = false;
  }
  // Any leftover unexpected name that is not a known Retired/Unshipped bucket member.
  const unclassified = unexpected.filter(
    (name) => !RETIRED_SERVERS.includes(name) && !UNSHIPPED_SERVERS.includes(name),
  );
  if (unclassified.length > 0) {
    console.error(`✗ Unexpected server(s) registered: ${unclassified.join(", ")}`);
    ok = false;
  }

  if (ok) {
    console.log(
      `✓ Exactly the nine Shipped servers are registered; no Retired or Unshipped server provisioned`,
    );
  }
  return ok;
}

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
  const isCI = process.env.CI === "true" || process.env.CI === "1";

  if (!apiKey || apiKey.includes("your-browserless-api-token-here")) {
    const message = "Browserless API key is not configured (BROWSERLESS_API_KEY).";
    if (strictEnv && !isCI) {
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
if (!checkRegistrationBuckets()) failed = true;
if (!runNodeScript("scripts/workspace/check-python.js")) failed = true;
if (!runNodeScript("scripts/workspace/verify-tools.js")) failed = true;
if (!runNodeScript("scripts/workspace/verify-mcp-sync.js")) failed = true;
if (!runNodeScript("scripts/workspace/smoke-test-mcp.js")) failed = true;
if (!runNodeScript("scripts/workspace/check-migrate-config.js")) failed = true;

if (failed) {
  console.error("\nStartup readiness check failed.");
  process.exit(1);
}

console.log("\nStartup readiness check passed.");
