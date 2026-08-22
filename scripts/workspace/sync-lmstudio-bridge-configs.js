#!/usr/bin/env node
/**
 * LM Studio MCP Bridge Config Sync
 *
 * Provisions per-plugin directories under ~/.lmstudio/extensions/plugins/mcp/
 * with bridge configs, manifests, and install-state files.
 *
 * Developed by: revDigit.link | Shawna Pakbin
 *
 * Key behaviors:
 * - Writes exclusively to per-plugin directories (never to top-level mcp.json)
 * - Tags all plugin directories with _owner: "llm-toolkit" for safe identification
 * - Clears all previously-owned toolkit plugins before re-provisioning
 * - Preserves user-customized env values from existing bridge configs across re-syncs
 * - Never touches plugin directories belonging to other applications
 * - Removes legacy toolkit entries from top-level mcp.json (one-time migration)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { buildMcpServers } = require("./mcp-config");
const {
  OWNER_ID,
  resolvePluginRoot,
  readJsonSafe,
  cleanOwnedPlugins,
  migrateTopLevelMcpJson,
  isOwnedByToolkit,
  getOwnedPluginDirs,
} = require("./plugin-ownership");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeUtf8NoBom(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

function isPlaceholderEnvValue(key, value) {
  if (typeof value !== "string") return false;

  const normalized = value.trim();
  if (!normalized) return false;

  if (key === "BROWSERLESS_API_KEY" && normalized === "your-browserless-api-key-here") return true;
  if (key === "BROWSERLESS_TOKEN" && normalized === "your-browserless-api-token-here") return true;

  return false;
}

/**
 * Merge env values from an existing plugin bridge config into the new config.
 * Non-empty, non-placeholder values from the existing config take precedence.
 */
function mergeServerConfig(serverConfig, existingPluginConfig) {
  const mergedEnv = { ...(serverConfig.env ?? {}) };

  if (existingPluginConfig && typeof existingPluginConfig === "object") {
    const env = existingPluginConfig.env;
    if (env && typeof env === "object") {
      for (const [key, value] of Object.entries(env)) {
        if (typeof value !== "string") continue;

        const trimmed = value.trim();
        if (!trimmed || isPlaceholderEnvValue(key, trimmed)) continue;

        mergedEnv[key] = value;
      }
    }
  }

  // Remove empty-string env values — passing them to child processes
  // can override package defaults (e.g. BROWSERLESS_API_URL="" breaks URL parsing)
  for (const key of Object.keys(mergedEnv)) {
    if (typeof mergedEnv[key] === "string" && !mergedEnv[key].trim()) {
      delete mergedEnv[key];
    }
  }

  return {
    ...serverConfig,
    env: mergedEnv,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const pluginRoot = resolvePluginRoot();
  const { mcpServers, missingBuilds } = buildMcpServers();

  if (!fs.existsSync(pluginRoot)) {
    console.error(`LM Studio plugin root not found: ${pluginRoot}`);
    console.error("Set LMSTUDIO_MCP_PLUGIN_ROOT if LM Studio uses a custom location.");
    process.exit(1);
  }

  // ── One-time migration: remove toolkit entries from top-level mcp.json ──
  migrateTopLevelMcpJson({
    knownServerNames: [...Object.keys(mcpServers)],
  });

  // ── Pass 1: Read existing bridge configs from owned plugins (preserve user env values) ──
  const existingConfigs = {};
  const ownedDirs = getOwnedPluginDirs(pluginRoot);

  for (const dir of ownedDirs) {
    const dirName = path.basename(dir);
    const bridgeConfig = readJsonSafe(path.join(dir, "mcp-bridge-config.json"));
    if (bridgeConfig) {
      existingConfigs[dirName] = bridgeConfig;
    }
  }

  // ── Pass 2: Clean all owned plugin directories ──
  const cleanResult = cleanOwnedPlugins(pluginRoot);
  if (cleanResult.removed.length > 0) {
    console.log(`\n→ Cleaned ${cleanResult.removed.length} previous toolkit plugin(s).`);
  }

  // ── Pass 3: Provision fresh plugin directories with ownership markers ──
  let updated = 0;

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const pluginDir = path.join(pluginRoot, serverName);
    const targetFile = path.join(pluginDir, "mcp-bridge-config.json");

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
    writeUtf8NoBom(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    // Write install-state.json with ownership marker (always)
    const installStateFile = path.join(pluginDir, "install-state.json");
    const installState = {
      by: "mcp-bridge-v1",
      at: Date.now(),
      _owner: OWNER_ID,
    };
    writeUtf8NoBom(installStateFile, `${JSON.stringify(installState, null, 2)}\n`);

    // Merge user-customized env values from previously-saved bridge config
    const existingPluginConfig = existingConfigs[serverName] || null;
    const mergedConfig = mergeServerConfig(serverConfig, existingPluginConfig);

    // Write bridge config
    writeUtf8NoBom(targetFile, `${JSON.stringify(mergedConfig, null, 2)}\n`);
    updated += 1;
    console.log(`✓ provisioned ${serverName}`);
  }

  if (missingBuilds.length > 0) {
    console.warn("\nWarning: some MCP binaries are missing. Run `npm run build` first.");
    for (const missing of missingBuilds) {
      console.warn(` - ${missing}`);
    }
  }

  console.log(`\nLM Studio bridge sync complete: ${updated} plugin(s) provisioned.`);
}

main();
