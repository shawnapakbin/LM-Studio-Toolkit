import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { buildBridgeConfig, TOOL_DESCRIPTORS } from "./mcp-config";
import { resolveActiveNodePath } from "./runtime-manager";
import type { LmStudioInstallationStatus, LmStudioStatus } from "./types";

function resolvePluginRoot(override?: string) {
  if (override && override.trim()) {
    return resolve(override.trim());
  }

  return join(homedir(), ".lmstudio", "extensions", "plugins", "mcp");
}

function detectLmStudioAppPath() {
  const home = homedir();

  if (process.platform === "win32") {
    const candidates = [
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "LM Studio", "LM Studio.exe") : null,
      process.env.ProgramFiles ? join(process.env.ProgramFiles, "LM Studio", "LM Studio.exe") : null,
      process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "LM Studio", "LM Studio.exe") : null,
    ].filter((value): value is string => Boolean(value));

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  if (process.platform === "darwin") {
    const candidates = [join("/Applications", "LM Studio.app"), join(home, "Applications", "LM Studio.app")];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  const commandResult = spawnSync("which", ["lmstudio"], { encoding: "utf8" });
  if (commandResult.status === 0) {
    const candidate = (commandResult.stdout ?? "").trim();
    if (candidate) {
      return candidate;
    }
  }

  const linuxCandidates = [
    join(home, "Applications", "LM-Studio.AppImage"),
    join(home, "Applications", "LM Studio.AppImage"),
    join("/opt", "LM Studio", "lmstudio"),
  ];

  return linuxCandidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function getLmStudioInstallationStatus(override?: string): LmStudioInstallationStatus {
  const pluginRoot = resolvePluginRoot(override);
  const appPath = detectLmStudioAppPath();
  const pluginRootExists = existsSync(pluginRoot);

  return {
    appInstalled: Boolean(appPath),
    appPath,
    pluginRoot,
    pluginRootExists,
    message: appPath
      ? pluginRootExists
        ? "LM Studio app and plugin directory detected."
        : "LM Studio app detected. The MCP plugin directory will be created during sync."
      : "LM Studio app was not detected on this machine.",
  };
}

export function verifyLmStudio(installRoot: string, override?: string): LmStudioStatus {
  const installation = getLmStudioInstallationStatus(override);
  const { pluginRoot } = installation;

  if (!installation.appInstalled) {
    return {
      pluginRoot,
      exists: false,
      mode: "skipped",
      updated: 0,
      skipped: TOOL_DESCRIPTORS.length,
      message: "LM Studio installation not found. Sync can be retried later from the dashboard.",
    };
  }

  // Ensure the LM Studio MCP plugin root exists so first-time installs can sync immediately.
  mkdirSync(pluginRoot, { recursive: true });

  let updated = 0;
  let skipped = 0;

  // Build the mcpServers map for the top-level mcp.json that LM Studio reads.
  const nodePath = resolveActiveNodePath();
  const mcpServers: Record<string, ReturnType<typeof buildBridgeConfig>> = {};

  for (const tool of TOOL_DESCRIPTORS) {
    const config = buildBridgeConfig(installRoot, tool, nodePath);
    mcpServers[tool.id] = config;

    // Also write per-plugin bridge config for the extension plugin loader.
    const pluginDir = join(pluginRoot, tool.id);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "mcp-bridge-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );
    updated += 1;
  }

  // Write the top-level mcp.json that LM Studio reads for MCP server registration.
  const lmStudioConfigDir = join(homedir(), ".lmstudio");
  mkdirSync(lmStudioConfigDir, { recursive: true });
  const mcpJsonPath = join(lmStudioConfigDir, "mcp.json");
  let existingConfig: Record<string, unknown> = {};
  if (existsSync(mcpJsonPath)) {
    try {
      existingConfig = JSON.parse(readFileSync(mcpJsonPath, "utf8")) as Record<string, unknown>;
    } catch {
      // If the file is malformed, overwrite it.
    }
  }
  const mcpJsonContent = { ...existingConfig, mcpServers };
  writeFileSync(mcpJsonPath, `${JSON.stringify(mcpJsonContent, null, 2)}\n`, "utf8");

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