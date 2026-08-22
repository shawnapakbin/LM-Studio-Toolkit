#!/usr/bin/env node
/**
 * LLM Toolkit Uninstall Script
 *
 * Removes all llm-toolkit MCP plugins from LM Studio and cleans up
 * any toolkit entries from the top-level mcp.json user config.
 *
 * Usage:
 *   node scripts/setup/uninstall.js
 *   npm run uninstall
 */

"use strict";

const {
  resolvePluginRoot,
  cleanOwnedPlugins,
  migrateTopLevelMcpJson,
} = require("../workspace/plugin-ownership");

// ─── Colour helpers (no deps) ─────────────────────────────────────────────────

const NO_COLOR = process.env.NO_COLOR || process.env.CI;
const c = {
  reset: NO_COLOR ? "" : "\x1b[0m",
  bold: NO_COLOR ? "" : "\x1b[1m",
  green: NO_COLOR ? "" : "\x1b[32m",
  yellow: NO_COLOR ? "" : "\x1b[33m",
  red: NO_COLOR ? "" : "\x1b[31m",
  cyan: NO_COLOR ? "" : "\x1b[36m",
};

function ok(msg) {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}
function warn(msg) {
  console.warn(`${c.yellow}⚠${c.reset}  ${msg}`);
}
function info(msg) {
  console.log(`${c.cyan}→${c.reset} ${msg}`);
}
function section(msg) {
  console.log(`\n${c.bold}${msg}${c.reset}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  section("LLM Toolkit — Uninstall MCP Plugins");

  const pluginRoot = resolvePluginRoot();
  info(`Plugin root: ${pluginRoot}`);

  // Remove all owned plugin directories
  const send = (type, msg) => {
    if (type === "ok") ok(msg);
    else if (type === "warn") warn(msg);
    else info(msg);
  };

  const cleanResult = cleanOwnedPlugins(pluginRoot, { send });

  // Clean up any toolkit entries from top-level mcp.json
  const migrateResult = migrateTopLevelMcpJson({ send });

  // Summary
  section("Summary");

  if (cleanResult.removed.length === 0 && !migrateResult.cleaned) {
    info("No LLM Toolkit plugins found. Nothing to remove.");
  } else {
    if (cleanResult.removed.length > 0) {
      ok(
        `Removed ${cleanResult.removed.length} plugin director${cleanResult.removed.length === 1 ? "y" : "ies"}.`,
      );
    }
    if (migrateResult.cleaned) {
      ok(
        `Cleaned ${migrateResult.removedKeys.length} entr${migrateResult.removedKeys.length === 1 ? "y" : "ies"} from mcp.json.`,
      );
    }
  }

  if (cleanResult.errors.length > 0) {
    warn(
      `${cleanResult.errors.length} director${cleanResult.errors.length === 1 ? "y" : "ies"} could not be removed (see warnings above).`,
    );
    process.exit(1);
  }

  console.log("");
  ok("LLM Toolkit MCP plugins have been uninstalled from LM Studio.");
}

main();
