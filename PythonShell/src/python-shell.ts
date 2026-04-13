import { type SpawnSyncReturns, spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { detectPythonEnvironment, getPythonInstallInstructions } from "./python-env";

const WORKSPACE_ROOT = path.resolve(process.env.PYTHON_SHELL_WORKSPACE_ROOT ?? process.cwd());
const DEFAULT_TIMEOUT_MS = Number(process.env.PYTHON_SHELL_DEFAULT_TIMEOUT_MS ?? 60000);
const MAX_TIMEOUT_MS = Number(process.env.PYTHON_SHELL_MAX_TIMEOUT_MS ?? 120000);
const MAX_OUTPUT_CHARS = Number(process.env.PYTHON_SHELL_MAX_OUTPUT_CHARS ?? 50000);

type SafeCwdResult = { ok: true; cwd: string } | { ok: false; message: string };

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n--- OUTPUT TRUNCATED (${text.length - MAX_OUTPUT_CHARS} chars omitted) ---`;
}

function resolveSafeCwd(inputCwd?: string): SafeCwdResult {
  if (!inputCwd) {
    return { ok: true, cwd: WORKSPACE_ROOT };
  }

  const resolved = path.resolve(WORKSPACE_ROOT, inputCwd);
  const relative = path.relative(WORKSPACE_ROOT, resolved);
  const outsideRoot = relative.startsWith("..") || path.isAbsolute(relative);

  if (outsideRoot) {
    return {
      ok: false,
      message: `cwd must stay within workspace root: ${WORKSPACE_ROOT}`,
    };
  }

  return { ok: true, cwd: resolved };
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quoteForPowershell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildWindowsLaunchCommand(cwd: string, command: string): string {
  return `Set-Location -LiteralPath ${quoteForPowershell(cwd)}; ${command}`;
}

function buildUnixLaunchCommand(cwd: string, command: string): string {
  return `cd ${quoteForShell(cwd)} && ${command}`;
}

function buildPythonCommand(launcherCommand: string, baseArgs: string[]): string {
  return [launcherCommand, ...baseArgs].join(" ").trim();
}

function openVisibleTerminal(command: string, cwd: string): { pid: number; message: string } {
  if (process.platform === "win32") {
    const proc = spawn(
      "powershell.exe",
      ["-NoExit", "-Command", buildWindowsLaunchCommand(cwd, command)],
      {
        detached: true,
        windowsHide: false,
        stdio: "ignore",
      },
    );
    proc.unref();
    return { pid: proc.pid ?? -1, message: "Opened Python REPL in a visible PowerShell window." };
  }

  if (process.platform === "darwin") {
    const escaped = buildUnixLaunchCommand(cwd, command)
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, '\\"');
    const script = `tell application \"Terminal\" to do script \"${escaped}\"`;
    const proc = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    return { pid: proc.pid ?? -1, message: "Opened Python REPL in Terminal.app." };
  }

  const shellCommand = `${buildUnixLaunchCommand(cwd, command)}; exec bash`;
  const candidates: Array<{ bin: string; args: string[] }> = [
    { bin: "x-terminal-emulator", args: ["-e", `bash -lc ${quoteForShell(shellCommand)}`] },
    { bin: "gnome-terminal", args: ["--", "bash", "-lc", shellCommand] },
    { bin: "xterm", args: ["-e", `bash -lc ${quoteForShell(shellCommand)}`] },
    { bin: "konsole", args: ["-e", `bash -lc ${quoteForShell(shellCommand)}`] },
  ];

  for (const candidate of candidates) {
    try {
      const proc = spawn(candidate.bin, candidate.args, { detached: true, stdio: "ignore" });
      proc.unref();
      return { pid: proc.pid ?? -1, message: `Opened Python REPL in ${candidate.bin}.` };
    } catch {
      // Try next emulator.
    }
  }

  throw new Error("No supported terminal emulator found to launch Python REPL.");
}

export function runPythonCode(input: { code: string; timeoutMs?: number; cwd?: string }) {
  const detection = detectPythonEnvironment();
  if (!detection.installed || !detection.launcher) {
    return {
      success: false,
      errorCode: "PYTHON_NOT_FOUND",
      errorMessage: detection.message,
      instructions: detection.instructions || getPythonInstallInstructions(),
      checked: detection.checked,
    };
  }

  const safeCwd = resolveSafeCwd(input.cwd);
  if (!safeCwd.ok) {
    return {
      success: false,
      errorCode: "POLICY_BLOCKED",
      errorMessage: safeCwd.message,
    };
  }

  const effectiveTimeoutMs = Number.isFinite(input.timeoutMs)
    ? Math.min(Math.max(Number(input.timeoutMs), 1), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  const tmpFile = path.join(
    os.tmpdir(),
    `python-shell-${Date.now()}-${Math.random().toString(36).slice(2)}.py`,
  );
  fs.writeFileSync(tmpFile, input.code, "utf8");

  let result: SpawnSyncReturns<string>;
  try {
    const args = [...detection.launcher.baseArgs, tmpFile];
    result = spawnSync(detection.launcher.command, args, {
      cwd: safeCwd.cwd,
      encoding: "utf8",
      timeout: effectiveTimeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore cleanup errors */
    }
  }

  return {
    success: result.status === 0,
    code: result.status ?? 1,
    signal: result.signal ?? null,
    stdout: truncateOutput(result.stdout ?? ""),
    stderr: truncateOutput(result.stderr ?? ""),
    timeoutMs: effectiveTimeoutMs,
    executable: detection.launcher.source,
    version: detection.version,
    errorCode: result.status === 0 ? undefined : "EXECUTION_FAILED",
    errorMessage: result.status === 0 ? undefined : "Python code execution failed.",
  };
}

export function openPythonRepl(input: { cwd?: string }) {
  const detection = detectPythonEnvironment();
  if (!detection.installed || !detection.launcher) {
    return {
      success: false,
      errorCode: "PYTHON_NOT_FOUND",
      errorMessage: detection.message,
      instructions: detection.instructions || getPythonInstallInstructions(),
      checked: detection.checked,
    };
  }

  const safeCwd = resolveSafeCwd(input.cwd);
  if (!safeCwd.ok) {
    return {
      success: false,
      errorCode: "POLICY_BLOCKED",
      errorMessage: safeCwd.message,
    };
  }

  const replCommand = buildPythonCommand(detection.launcher.command, detection.launcher.baseArgs);
  const launch = openVisibleTerminal(replCommand, safeCwd.cwd);

  return {
    success: true,
    action: "repl",
    pid: launch.pid,
    message: launch.message,
    executable: detection.launcher.source,
    version: detection.version,
  };
}

export function openPythonIde(input: { cwd?: string }) {
  const detection = detectPythonEnvironment();
  if (!detection.installed || !detection.launcher) {
    return {
      success: false,
      errorCode: "PYTHON_NOT_FOUND",
      errorMessage: detection.message,
      instructions: detection.instructions || getPythonInstallInstructions(),
      checked: detection.checked,
    };
  }

  const safeCwd = resolveSafeCwd(input.cwd);
  if (!safeCwd.ok) {
    return {
      success: false,
      errorCode: "POLICY_BLOCKED",
      errorMessage: safeCwd.message,
    };
  }

  const args = [...detection.launcher.baseArgs, "-m", "idlelib"];
  const proc = spawn(detection.launcher.command, args, {
    cwd: safeCwd.cwd,
    detached: true,
    windowsHide: false,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  proc.unref();

  return {
    success: true,
    action: "idle",
    pid: proc.pid ?? -1,
    message: "Requested Python IDLE launch.",
    executable: detection.launcher.source,
    version: detection.version,
  };
}
