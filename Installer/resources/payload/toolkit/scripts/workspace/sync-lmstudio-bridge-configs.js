#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildMcpServers } = require("./mcp-config");

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

function writeUtf8NoBom(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

function main() {
  const pluginRoot = resolvePluginRoot();
  const { mcpServers, missingBuilds } = buildMcpServers();

  if (!fs.existsSync(pluginRoot)) {
    console.error(`LM Studio plugin root not found: ${pluginRoot}`);
    console.error("Set LMSTUDIO_MCP_PLUGIN_ROOT if LM Studio uses a custom location.");
    process.exit(1);
  }

  let updated = 0;

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const pluginDir = path.join(pluginRoot, serverName);
    const targetFile = path.join(pluginDir, "mcp-bridge-config.json");

    let provisioned = false;
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
      provisioned = true;
    }

    const manifestFile = path.join(pluginDir, "manifest.json");
    if (!fs.existsSync(manifestFile)) {
      const manifest = { type: "plugin", runner: "mcpBridge", owner: "mcp", name: serverName };
      writeUtf8NoBom(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    const installStateFile = path.join(pluginDir, "install-state.json");
    if (!fs.existsSync(installStateFile)) {
      writeUtf8NoBom(
        installStateFile,
        `${JSON.stringify({ by: "mcp-bridge-v1", at: Date.now() })}\n`,
      );
    }

    const json = `${JSON.stringify(serverConfig, null, 2)}\n`;
    writeUtf8NoBom(targetFile, json);
    updated += 1;
    console.log(`${provisioned ? "✓ provisioned" : "+"} wrote ${targetFile}`);
  }

  if (missingBuilds.length > 0) {
    console.warn("\nWarning: some MCP binaries are missing. Run `npm run build` first.");
    for (const missing of missingBuilds) {
      console.warn(` - ${missing}`);
    }
  }

  console.log(`\nLM Studio bridge sync complete: ${updated} updated.`);
}

main();
