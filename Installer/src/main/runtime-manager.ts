import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { app } from "electron";

import type { RuntimeStatus } from "./types";

const MIN_NODE_MAJOR = 18;
const MIN_NPM_MAJOR = 8;

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
  const systemNodePath = isBundledRuntimeReady ? null : resolveSystemNodePath();
  const systemNodeVersion = systemNodePath ? getCommandVersion(systemNodePath, ["--version"]) : null;
  const systemNpmVersion = systemNodePath ? getCommandVersion("npm", ["--version"]) : null;

  const mode: RuntimeStatus["mode"] = isBundledRuntimeReady
    ? "bundled"
    : systemNodePath && isNodeVersionSupported(systemNodeVersion) && isNpmVersionSupported(systemNpmVersion)
      ? "system"
      : "missing";

  return {
    bundledNodePath: isBundledRuntimeReady ? bundledNodePath : null,
    bundledNpmCliPath: isBundledRuntimeReady ? bundledNpmCliPath : null,
    systemNodePath: systemNodePath ?? null,
    systemNodeVersion,
    systemNpmVersion,
    isBundledRuntimeReady,
    mode,
  };
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
    shell: process.platform === "win32",
    windowsHide: true,
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    ok: result.status === 0,
    output,
    code: result.status,
  };
}

export function ensureRuntimeReady(onLog: (line: string) => void) {
  const current = getRuntimeStatus();
  if (current.mode === "bundled" || current.mode === "system") {
    return getRuntimeStatus();
  }

  const attempts: Array<{ command: string; args: string[]; label: string }> = [];

  if (process.platform === "win32") {
    attempts.push({
      command: "winget",
      args: ["install", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements"],
      label: "winget Node.js LTS",
    });
    attempts.push({
      command: "choco",
      args: ["install", "nodejs-lts", "-y"],
      label: "choco nodejs-lts",
    });
  } else if (process.platform === "darwin") {
    attempts.push({ command: "brew", args: ["install", "node@20"], label: "brew node@20" });
  } else {
    attempts.push({ command: "apt-get", args: ["update"], label: "apt-get update" });
    attempts.push({ command: "apt-get", args: ["install", "-y", "nodejs", "npm"], label: "apt-get install nodejs npm" });
  }

  for (const attempt of attempts) {
    onLog(`Attempting to install runtime dependencies via ${attempt.label}...`);
    const result = runInstallAttempt(attempt.command, attempt.args);
    if (result.output) {
      onLog(result.output);
    }
    if (result.ok) {
      const refreshed = getRuntimeStatus();
      if (refreshed.mode === "system" || refreshed.mode === "bundled") {
        onLog("Runtime dependencies are now available.");
        return refreshed;
      }
    }
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

  if (runtimeStatus.bundledNodePath && runtimeStatus.bundledNpmCliPath) {
    const child = spawn(runtimeStatus.bundledNodePath, [runtimeStatus.bundledNpmCliPath, ...args], {
      cwd,
      env: process.env,
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
    env: process.env,
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
