import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { app } from "electron";

import type { RuntimeStatus } from "./types";

const MIN_NODE_MAJOR = 18;
const MIN_NPM_MAJOR = 8;
const PORTABLE_NODE_VERSION = "20.17.0";

function toPowerShellLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function resolvePortableRuntimeDir() {
  return join(app.getPath("userData"), "runtime-cache", `node-v${PORTABLE_NODE_VERSION}-${process.platform}-${process.arch}`);
}

function resolveDownloadedNodePath() {
  const base = resolvePortableRuntimeDir();
  if (process.platform === "win32") {
    return join(base, "node.exe");
  }

  return join(base, "bin", "node");
}

function resolveDownloadedNpmCliPath() {
  const base = resolvePortableRuntimeDir();
  return join(base, "node_modules", "npm", "bin", "npm-cli.js");
}

function resolveBundledNodePath() {
  const basePath = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
  const runtimeRoot = join(basePath, "runtime");

  if (process.platform === "win32") {
    return join(runtimeRoot, "win32", "node.exe");
  }

  return join(runtimeRoot, process.platform, "bin", "node");
}

function resolveBundledNpmCliPath() {
  const basePath = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
  return join(basePath, "runtime", "npm", "bin", "npm-cli.js");
}

export function getRuntimeStatus(): RuntimeStatus {
  const bundledNodePath = resolveBundledNodePath();
  const bundledNpmCliPath = resolveBundledNpmCliPath();
  const isBundledRuntimeReady = existsSync(bundledNodePath) && existsSync(bundledNpmCliPath);
  const downloadedNodePath = resolveDownloadedNodePath();
  const downloadedNpmCliPath = resolveDownloadedNpmCliPath();
  const isDownloadedRuntimeReady = existsSync(downloadedNodePath) && existsSync(downloadedNpmCliPath);
  const systemNodePath = isBundledRuntimeReady || isDownloadedRuntimeReady ? null : resolveSystemNodePath();
  const systemNodeVersion = systemNodePath ? getCommandVersion(systemNodePath, ["--version"]) : null;
  const systemNpmVersion = systemNodePath ? getCommandVersion("npm", ["--version"]) : null;

  const mode: RuntimeStatus["mode"] = isBundledRuntimeReady
    ? "bundled"
    : isDownloadedRuntimeReady
      ? "downloaded"
    : systemNodePath && isNodeVersionSupported(systemNodeVersion) && isNpmVersionSupported(systemNpmVersion)
      ? "system"
      : "missing";

  return {
    bundledNodePath: isBundledRuntimeReady ? bundledNodePath : null,
    bundledNpmCliPath: isBundledRuntimeReady ? bundledNpmCliPath : null,
    downloadedNodePath: isDownloadedRuntimeReady ? downloadedNodePath : null,
    downloadedNpmCliPath: isDownloadedRuntimeReady ? downloadedNpmCliPath : null,
    systemNodePath: systemNodePath ?? null,
    systemNodeVersion,
    systemNpmVersion,
    isBundledRuntimeReady,
    isDownloadedRuntimeReady,
    mode,
  };
}

function resolvePortableArchiveName() {
  if (process.platform === "win32") {
    return `node-v${PORTABLE_NODE_VERSION}-win-${process.arch}.zip`;
  }

  if (process.platform === "darwin") {
    return `node-v${PORTABLE_NODE_VERSION}-darwin-${process.arch}.tar.gz`;
  }

  return `node-v${PORTABLE_NODE_VERSION}-linux-${process.arch}.tar.xz`;
}

function downloadAndExtractPortableRuntime(onLog: (line: string) => void) {
  const runtimeRoot = resolvePortableRuntimeDir();
  const archiveName = resolvePortableArchiveName();
  const archivePath = join(app.getPath("userData"), "runtime-cache", archiveName);
  const url = `https://nodejs.org/dist/v${PORTABLE_NODE_VERSION}/${archiveName}`;
  const escapedUrl = toPowerShellLiteral(url);
  const escapedArchivePath = toPowerShellLiteral(archivePath);
  const escapedRuntimeRoot = toPowerShellLiteral(runtimeRoot);

  mkdirSync(runtimeRoot, { recursive: true });

  const downloadResult =
    process.platform === "win32"
      ? runInstallAttempt("powershell", [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '${escapedUrl}' -OutFile '${escapedArchivePath}'`,
        ])
      : runInstallAttempt("curl", ["-L", url, "-o", archivePath]);

  if (!downloadResult.ok) {
    if (downloadResult.output) {
      onLog(downloadResult.output);
    }
    return false;
  }

  const extractResult =
    process.platform === "win32"
      ? runInstallAttempt("powershell", [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Expand-Archive -LiteralPath '${escapedArchivePath}' -DestinationPath '${escapedRuntimeRoot}' -Force`,
        ])
      : runInstallAttempt("tar", ["-xf", archivePath, "-C", runtimeRoot]);

  if (!extractResult.ok) {
    if (extractResult.output) {
      onLog(extractResult.output);
    }
    return false;
  }

  const extractedBase = join(runtimeRoot, `node-v${PORTABLE_NODE_VERSION}-${process.platform === "win32" ? "win" : process.platform}-${process.arch}`);
  const escapedExtractedBase = toPowerShellLiteral(extractedBase);
  const moveResult =
    process.platform === "win32"
      ? runInstallAttempt("powershell", [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Get-ChildItem -LiteralPath '${escapedExtractedBase}' | ForEach-Object { Move-Item -Force -LiteralPath $_.FullName -Destination '${escapedRuntimeRoot}' }`,
        ])
      : runInstallAttempt("bash", ["-lc", `cp -R \"${extractedBase}\"/* \"${runtimeRoot}\"/`]);

  if (!moveResult.ok && moveResult.output) {
    onLog(moveResult.output);
  }

  return existsSync(resolveDownloadedNodePath()) && existsSync(resolveDownloadedNpmCliPath());
}

function getCommandVersion(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    return null;
  }

  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (!text) {
    return null;
  }

  return text.replace(/^v/i, "");
}

function resolveSystemNodePath() {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["node"], { encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) {
    return null;
  }

  return (result.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function parseMajor(version: string | null) {
  if (!version) {
    return null;
  }

  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? null : major;
}

function isNodeVersionSupported(version: string | null) {
  const major = parseMajor(version);
  return major !== null && major >= MIN_NODE_MAJOR;
}

function isNpmVersionSupported(version: string | null) {
  const major = parseMajor(version);
  return major !== null && major >= MIN_NPM_MAJOR;
}

function runInstallAttempt(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    ok: result.status === 0,
    output,
    code: result.status,
  };
}

export function ensureRuntimeReady(onLog: (line: string) => void, options?: { allowDownload?: boolean }) {
  const current = getRuntimeStatus();
  if (current.mode === "bundled" || current.mode === "downloaded" || current.mode === "system") {
    return getRuntimeStatus();
  }

  if (!options?.allowDownload) {
    onLog("Runtime download was required but user permission was not granted.");
    return getRuntimeStatus();
  }

  onLog("Attempting to download portable Node runtime for compact installer mode...");
  if (downloadAndExtractPortableRuntime(onLog)) {
    onLog("Portable runtime downloaded successfully.");
    return getRuntimeStatus();
  }

  return getRuntimeStatus();
}

export function spawnNpmCommand(
  args: string[],
  cwd: string,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
) {
  const runtimeStatus = getRuntimeStatus();
  const env = { ...process.env };

  const prependNodePath = (nodeExecutablePath: string) => {
    const nodeDir = dirname(nodeExecutablePath);
    const existingPath = env.PATH ?? env.Path ?? "";
    const separator = process.platform === "win32" ? ";" : ":";
    env.PATH = existingPath ? `${nodeDir}${separator}${existingPath}` : nodeDir;
    env.Path = env.PATH;
  };

  if (runtimeStatus.bundledNodePath && runtimeStatus.bundledNpmCliPath) {
    prependNodePath(runtimeStatus.bundledNodePath);
    const child = spawn(runtimeStatus.bundledNodePath, [runtimeStatus.bundledNpmCliPath, ...args], {
      cwd,
      env,
    });

    child.stdout.on("data", (chunk) => {
      onStdout(chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      onStderr(chunk.toString());
    });

    return child;
  }

  if (runtimeStatus.downloadedNodePath && runtimeStatus.downloadedNpmCliPath) {
    prependNodePath(runtimeStatus.downloadedNodePath);
    const child = spawn(runtimeStatus.downloadedNodePath, [runtimeStatus.downloadedNpmCliPath, ...args], {
      cwd,
      env,
    });

    child.stdout.on("data", (chunk) => {
      onStdout(chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      onStderr(chunk.toString());
    });

    return child;
  }

  const child = spawn("npm", args, {
    cwd,
    env,
    shell: process.platform === "win32",
  });

  child.stdout.on("data", (chunk) => {
    onStdout(chunk.toString());
  });

  child.stderr.on("data", (chunk) => {
    onStderr(chunk.toString());
  });

  return child;
}
