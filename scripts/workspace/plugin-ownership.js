#!/usr/bin/env node
/**
 * Plugin Ownership Utilities
 *
 * Provides constants and helpers to identify, enumerate, and clean
 * LLM Toolkit–owned MCP plugin directories under LM Studio's plugin root.
 *
 * Ownership is determined by the presence of `_owner: "llm-toolkit"` in
 * either `manifest.json` or `install-state.json` within a plugin directory.
 *
 * Developed by: revDigit.link | Shawna Pakbin
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// ─── Constants ───────────────────────────────────────────────────────────────

/** Ownership marker value written to manifest.json and install-state.json */
const OWNER_ID = "llm-toolkit";

/** Legacy plugin directory names that predate the ownership marker system */
const LEGACY_PLUGIN_NAMES = ["basic", "calculator", "document-scraper", "clock", "ask-user"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Safely read and parse a JSON file. Returns null on any failure.
 */
function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolve the LM Studio MCP plugin root directory.
 * Respects `LMSTUDIO_MCP_PLUGIN_ROOT` env var override.
 */
function resolvePluginRoot() {
  const custom = process.env.LMSTUDIO_MCP_PLUGIN_ROOT;
  if (typeof custom === "string" && custom.trim()) {
    return path.resolve(custom.trim());
  }

  const home = os.homedir();
  if (!home) {
    throw new Error(
      "Unable to resolve home directory. Set LMSTUDIO_MCP_PLUGIN_ROOT to your LM Studio MCP plugins folder.",
    );
  }

  return path.join(home, ".lmstudio", "extensions", "plugins", "mcp");
}

/**
 * Check whether a plugin directory is owned by LLM Toolkit.
 *
 * Returns true if either `manifest.json` or `install-state.json` in the
 * directory contains `_owner: "llm-toolkit"`.
 *
 * @param {string} pluginDir - Absolute path to a plugin directory
 * @returns {boolean}
 */
function isOwnedByToolkit(pluginDir) {
  const manifestPath = path.join(pluginDir, "manifest.json");
  const installStatePath = path.join(pluginDir, "install-state.json");

  const manifest = readJsonSafe(manifestPath);
  if (manifest && manifest._owner === OWNER_ID) return true;

  const installState = readJsonSafe(installStatePath);
  if (installState && installState._owner === OWNER_ID) return true;

  return false;
}

/**
 * Check whether a directory name matches a known legacy plugin name.
 *
 * @param {string} dirName - The directory basename (not full path)
 * @returns {boolean}
 */
function isLegacyPlugin(dirName) {
  return LEGACY_PLUGIN_NAMES.includes(dirName);
}

/**
 * Scan the plugin root and return paths to all directories owned by LLM Toolkit.
 * Also includes legacy plugin directories (by name match) for cleanup.
 *
 * @param {string} pluginRoot - Absolute path to the MCP plugin root
 * @returns {string[]} Array of absolute paths to owned/legacy plugin directories
 */
function getOwnedPluginDirs(pluginRoot) {
  if (!fs.existsSync(pluginRoot)) return [];

  const entries = fs.readdirSync(pluginRoot, { withFileTypes: true });
  const owned = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(pluginRoot, entry.name);

    if (isOwnedByToolkit(fullPath) || isLegacyPlugin(entry.name)) {
      owned.push(fullPath);
    }
  }

  return owned;
}

/**
 * Remove all llm-toolkit–owned plugin directories from the given root.
 * Logs each removal via the optional `send` callback.
 *
 * @param {string} pluginRoot - Absolute path to the MCP plugin root
 * @param {object} [options]
 * @param {function} [options.send] - Logging callback: send(type, message)
 * @returns {{ removed: string[], preserved: string[], errors: string[] }}
 */
function cleanOwnedPlugins(pluginRoot, { send } = {}) {
  const log =
    send ||
    ((type, msg) => {
      if (type === "warn") console.warn(`⚠  ${msg}`);
      else if (type === "ok") console.log(`✓ ${msg}`);
      else console.log(`→ ${msg}`);
    });

  const result = { removed: [], preserved: [], errors: [] };

  if (!fs.existsSync(pluginRoot)) {
    log("info", `Plugin root does not exist: ${pluginRoot}`);
    return result;
  }

  const entries = fs.readdirSync(pluginRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(pluginRoot, entry.name);

    if (isOwnedByToolkit(fullPath) || isLegacyPlugin(entry.name)) {
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        log("ok", `Removed owned plugin: ${entry.name}`);
        result.removed.push(fullPath);
      } catch (err) {
        log("warn", `Failed to remove ${entry.name}: ${err.message}`);
        result.errors.push(fullPath);
      }
    } else {
      result.preserved.push(fullPath);
    }
  }

  return result;
}

/**
 * Migrate (clean up) the top-level ~/.lmstudio/mcp.json file by removing
 * all entries that belong to LLM Toolkit. Does not add or overwrite entries.
 *
 * @param {object} [options]
 * @param {function} [options.send] - Logging callback: send(type, message)
 * @param {string[]} [options.knownServerNames] - Server names to remove (defaults to mcp-config keys + legacy)
 * @returns {{ cleaned: boolean, removedKeys: string[] }}
 */
function migrateTopLevelMcpJson({ send, knownServerNames } = {}) {
  const log =
    send ||
    ((type, msg) => {
      if (type === "warn") console.warn(`⚠  ${msg}`);
      else if (type === "ok") console.log(`✓ ${msg}`);
      else console.log(`→ ${msg}`);
    });

  // Determine server names to remove
  let serverNamesToRemove = knownServerNames;
  if (!serverNamesToRemove) {
    try {
      const { buildMcpServers } = require("./mcp-config");
      const { mcpServers } = buildMcpServers();
      serverNamesToRemove = [...Object.keys(mcpServers), ...LEGACY_PLUGIN_NAMES];
    } catch {
      // If mcp-config can't be loaded, fall back to legacy names only
      serverNamesToRemove = [...LEGACY_PLUGIN_NAMES];
    }
  }

  const mcpJsonPath = path.join(os.homedir(), ".lmstudio", "mcp.json");
  const result = { cleaned: false, removedKeys: [] };

  if (!fs.existsSync(mcpJsonPath)) {
    log("info", "No top-level mcp.json found — nothing to migrate.");
    return result;
  }

  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
  } catch {
    log("warn", "Top-level mcp.json is malformed — skipping migration.");
    return result;
  }

  if (!existing || typeof existing !== "object" || !existing.mcpServers) {
    log("info", "Top-level mcp.json has no mcpServers — nothing to migrate.");
    return result;
  }

  for (const name of serverNamesToRemove) {
    if (name in existing.mcpServers) {
      delete existing.mcpServers[name];
      result.removedKeys.push(name);
    }
  }

  if (result.removedKeys.length === 0) {
    log("info", "No toolkit entries found in top-level mcp.json.");
    return result;
  }

  // If mcpServers is now empty, remove the key
  if (Object.keys(existing.mcpServers).length === 0) {
    delete existing.mcpServers;
  }

  // Write back (or delete if file is now effectively empty)
  const isEmpty = Object.keys(existing).length === 0;
  if (isEmpty) {
    try {
      fs.unlinkSync(mcpJsonPath);
      log("ok", `Removed empty mcp.json (cleaned ${result.removedKeys.length} toolkit entries)`);
    } catch (err) {
      log("warn", `Could not delete empty mcp.json: ${err.message}`);
    }
  } else {
    fs.writeFileSync(mcpJsonPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
    log("ok", `Cleaned ${result.removedKeys.length} toolkit entries from mcp.json`);
  }

  result.cleaned = true;
  return result;
}

module.exports = {
  OWNER_ID,
  LEGACY_PLUGIN_NAMES,
  resolvePluginRoot,
  readJsonSafe,
  isOwnedByToolkit,
  isLegacyPlugin,
  getOwnedPluginDirs,
  cleanOwnedPlugins,
  migrateTopLevelMcpJson,
};
