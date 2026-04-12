#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const logsDir = path.join(repoRoot, "scripts", "workspace", "logs");
const logFile = path.join(logsDir, "python-detection.json");
const isWindows = process.platform === "win32";

const installMessage = [
  "Python 3 was not detected.",
  "Install Python from the official source: https://www.python.org/downloads/",
  isWindows
    ? "During installation, enable 'Add python.exe to PATH'."
    : "After installation, ensure python3 is available on PATH.",
  "Restart LM Studio or your terminal session after install.",
].join(" ");

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: isWindows,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseVersion(output) {
  const match = output.match(/Python\s+([0-9]+(?:\.[0-9]+){1,2})/i);
  return match ? match[1] : null;
}

function detectPython() {
  const checked = [];
  const candidates = isWindows
    ? [
        { command: "py", args: ["-3"], source: "py -3" },
        { command: "python", args: [], source: "python" },
        { command: "python3", args: [], source: "python3" },
      ]
    : [
        { command: "python3", args: [], source: "python3" },
        { command: "python", args: [], source: "python" },
      ];

  for (const candidate of candidates) {
    const versionArgs = [...candidate.args, "--version"];
    checked.push(`${candidate.command} ${versionArgs.join(" ")}`.trim());
    const versionResult = run(candidate.command, versionArgs);
    if (versionResult.status !== 0) {
      continue;
    }

    const combined = `${versionResult.stdout}\n${versionResult.stderr}`.trim();
    const version = parseVersion(combined);
    if (!version || !version.startsWith("3.")) {
      continue;
    }

    const whereResult = run(isWindows ? "where" : "which", [candidate.command]);
    const executablePath = `${whereResult.stdout}\n${whereResult.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    return {
      installed: true,
      source: candidate.source,
      command: candidate.command,
      args: candidate.args,
      version,
      executablePath: executablePath || null,
      checked,
      message: `Detected Python ${version} via '${candidate.source}'.`,
    };
  }

  return {
    installed: false,
    source: null,
    command: null,
    args: [],
    version: null,
    executablePath: null,
    checked,
    message: "Python 3 executable was not found in common command locations.",
  };
}

function loadPreviousLog() {
  if (!fs.existsSync(logFile)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(logFile, "utf8"));
    return parsed;
  } catch {
    return null;
  }
}

function writeLog(entry, previous) {
  fs.mkdirSync(logsDir, { recursive: true });

  const previousHistory = Array.isArray(previous?.history) ? previous.history : [];
  const history = [...previousHistory, entry].slice(-100);

  const next = {
    schemaVersion: 1,
    lastCheckedAt: entry.checkedAt,
    latest: entry,
    history,
  };

  fs.writeFileSync(logFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function main() {
  const previous = loadPreviousLog();
  const result = detectPython();
  const checkedAt = new Date().toISOString();

  const entry = {
    checkedAt,
    ...result,
  };

  writeLog(entry, previous);

  if (result.installed) {
    console.log(`✓ ${result.message}`);
  } else {
    console.warn(`⚠ ${result.message}`);
    console.warn(`⚠ ${installMessage}`);
  }

  const previousInstalled = Boolean(previous?.latest?.installed);
  if (!previousInstalled && result.installed) {
    console.log("✓ New Python installation detected since the previous startup check.");
  }

  console.log(`✓ Python detection log updated: ${path.relative(repoRoot, logFile)}`);
}

main();
