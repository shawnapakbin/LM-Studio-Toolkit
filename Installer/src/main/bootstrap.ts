import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

export function getPackagedPayloadRoot() {
  const basePath = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
  return join(basePath, "payload");
}

export function inspectPayload() {
  const payloadRoot = getPackagedPayloadRoot();
  const exists = existsSync(payloadRoot);
  const entries = exists ? readdirSync(payloadRoot) : [];

  return {
    payloadRoot,
    exists,
    entries,
  };
}

export function ensureInstallRoot(installRoot: string) {
  mkdirSync(installRoot, { recursive: true });
  return {
    installRoot,
    exists: existsSync(installRoot),
  };
}

interface ExtractHandlers {
  onProgress: (message: string) => void;
  onLog: (line: string) => void;
}

function tryExtractArchive(archivePath: string, installRoot: string, handlers: ExtractHandlers) {
  if (process.platform === "win32") {
    const command = [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${installRoot.replace(/'/g, "''")}' -Force`,
    ];
    const result = spawnSync("powershell", command, { encoding: "utf8" });
    if (result.stdout) {
      handlers.onLog(result.stdout);
    }
    if (result.stderr) {
      handlers.onLog(result.stderr);
    }
    return result.status === 0;
  }

  const result = spawnSync("tar", ["-xf", archivePath, "-C", installRoot], { encoding: "utf8" });
  if (result.stdout) {
    handlers.onLog(result.stdout);
  }
  if (result.stderr) {
    handlers.onLog(result.stderr);
  }
  return result.status === 0;
}

export function extractPayloadToInstallRoot(installRoot: string, handlers: ExtractHandlers) {
  const payloadRoot = getPackagedPayloadRoot();
  const toolkitDir = join(payloadRoot, "toolkit");
  const zipArchive = join(payloadRoot, "toolkit-payload.zip");
  const tarArchive = join(payloadRoot, "toolkit-payload.tar");
  const targzArchive = join(payloadRoot, "toolkit-payload.tar.gz");

  if (!existsSync(payloadRoot)) {
    handlers.onProgress("No packaged payload found. Using install root as-is.");
    return;
  }

  if (existsSync(toolkitDir)) {
    handlers.onProgress("Copying packaged toolkit payload.");
    cpSync(toolkitDir, installRoot, { recursive: true, force: true });
    return;
  }

  if (existsSync(zipArchive)) {
    handlers.onProgress("Extracting toolkit payload archive (zip).");
    if (!tryExtractArchive(zipArchive, installRoot, handlers)) {
      throw new Error("Failed to extract toolkit-payload.zip.");
    }
    return;
  }

  if (existsSync(targzArchive)) {
    handlers.onProgress("Extracting toolkit payload archive (tar.gz).");
    if (!tryExtractArchive(targzArchive, installRoot, handlers)) {
      throw new Error("Failed to extract toolkit-payload.tar.gz.");
    }
    return;
  }

  if (existsSync(tarArchive)) {
    handlers.onProgress("Extracting toolkit payload archive (tar).");
    if (!tryExtractArchive(tarArchive, installRoot, handlers)) {
      throw new Error("Failed to extract toolkit-payload.tar.");
    }
    return;
  }

  handlers.onProgress(
    "Packaged payload directory exists, but no recognized payload artifact was found.",
  );
}
