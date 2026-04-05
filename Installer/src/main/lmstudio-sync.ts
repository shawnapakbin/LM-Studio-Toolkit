import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { buildBridgeConfig, TOOL_DESCRIPTORS } from "./mcp-config";
import type { LmStudioStatus } from "./types";

function resolvePluginRoot(override?: string) {
  if (override && override.trim()) {
    return resolve(override.trim());
  }

  return join(homedir(), ".lmstudio", "extensions", "plugins", "mcp");
}

export function verifyLmStudio(installRoot: string, override?: string): LmStudioStatus {
  const pluginRoot = resolvePluginRoot(override);

  if (!existsSync(pluginRoot)) {
    return {
      pluginRoot,
      exists: false,
      mode: "skipped",
      updated: 0,
      skipped: TOOL_DESCRIPTORS.length,
      message: "LM Studio plugin root not found. Sync can be retried later from the dashboard.",
    };
  }

  let updated = 0;
  let skipped = 0;

  for (const tool of TOOL_DESCRIPTORS) {
    const pluginDir = join(pluginRoot, tool.id);
    if (!existsSync(pluginDir)) {
      skipped += 1;
      continue;
    }

    mkdirSync(pluginDir, { recursive: true });
    const targetFile = join(pluginDir, "mcp-bridge-config.json");
    writeFileSync(
      targetFile,
      `${JSON.stringify(buildBridgeConfig(installRoot, tool), null, 2)}\n`,
      "utf8",
    );
    updated += 1;
  }

  return {
    pluginRoot,
    exists: true,
    mode: "ready",
    updated,
    skipped,
    message:
      updated > 0
        ? `LM Studio sync complete: ${updated} updated, ${skipped} skipped.`
        : "LM Studio plugin root found, but matching plugins are not installed yet.",
  };
}