/**
 * Punchout terminal support.
 *
 * Launches a visible terminal window so the user can watch commands run.
 * An active session is reused if the terminal window is still open (PID alive).
 * If closed, a new window is opened automatically.
 *
 * Windows  – PowerShell relay script (piped via a temp JSON command file)
 * macOS    – Terminal.app via osascript (front window reuse)
 * Linux    – first available x-terminal-emulator / gnome-terminal / xterm / konsole
 */

import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { platform } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Windows PowerShell relay script
// The relay is written to %TEMP% on first use and stays alive in a loop,
// reading commands from a JSON file and executing them visibly.
// ---------------------------------------------------------------------------
const WINDOWS_RELAY_PS1 = `
param([string]$CommandFile)
$host.UI.RawUI.WindowTitle = "LLM Toolkit Terminal"
Write-Host "LLM Toolkit Terminal" -ForegroundColor DarkCyan
Write-Host "Waiting for commands..." -ForegroundColor DarkGray
Write-Host ""
while ($true) {
    $raw = $null
    try { $raw = Get-Content $CommandFile -Raw -ErrorAction Stop } catch {}
    if ($raw -and $raw.Trim() -ne "" -and $raw.Trim() -ne "{}") {
        try {
            $task = $raw | ConvertFrom-Json
            if ($task.command) {
                Set-Content -Path $CommandFile -Value "{}"
                if ($task.cwd) { Set-Location $task.cwd -ErrorAction SilentlyContinue }
                Write-Host "> $($task.command)" -ForegroundColor Cyan
                Invoke-Expression $task.command
                Write-Host ""
            }
        } catch {
            Set-Content -Path $CommandFile -Value "{}"
        }
    }
    Start-Sleep -Milliseconds 100
}
`.trimStart();

// ---------------------------------------------------------------------------
// Session tracking (one active session per server process)
// ---------------------------------------------------------------------------
export interface PunchoutSession {
  pid: number;
  /** Path to the JSON command file used by the Windows relay. Empty on other OSes. */
  commandFile: string;
  os: NodeJS.Platform;
}

export interface PunchoutResult {
  reused: boolean;
  pid: number;
  message: string;
}

let activeSession: PunchoutSession | null = null;
/** Path to the written relay .ps1 file (cached after first write). */
let relayScriptPath: string | null = null;

/** Reset active session state. Intended for use in tests only. */
export function clearPunchoutSession(): void {
  activeSession = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getWindowsRelayScript(): string {
  if (relayScriptPath && existsSync(relayScriptPath)) return relayScriptPath;
  const p = join(tmpdir(), "llm-toolkit-punchout-relay.ps1");
  writeFileSync(p, WINDOWS_RELAY_PS1, "utf8");
  relayScriptPath = p;
  return p;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function runPunchout(command: string, cwd: string): PunchoutResult {
  const os = platform();
  if (os === "win32") return windowsPunchout(command, cwd);
  if (os === "darwin") return macosPunchout(command, cwd);
  return linuxPunchout(command, cwd);
}

// ---------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------
function windowsPunchout(command: string, cwd: string): PunchoutResult {
  // Reuse the existing relay if the window is still open.
  if (activeSession?.os === "win32" && isAlive(activeSession.pid)) {
    writeFileSync(activeSession.commandFile, JSON.stringify({ cwd, command }), "utf8");
    return {
      reused: true,
      pid: activeSession.pid,
      message: "Command sent to existing terminal window.",
    };
  }

  const relayScript = getWindowsRelayScript();
  const commandFile = join(tmpdir(), `llm-toolkit-cmd-${randomBytes(4).toString("hex")}.json`);

  // Write the initial command before spawning so the relay picks it up on
  // its first poll (~100 ms after PowerShell finishes starting).
  writeFileSync(commandFile, JSON.stringify({ cwd, command }), "utf8");

  const proc = spawn(
    "powershell.exe",
    ["-NoExit", "-ExecutionPolicy", "Bypass", "-File", relayScript, "-CommandFile", commandFile],
    {
      detached: true,
      windowsHide: false, // Show the new console window
      stdio: "ignore",
    },
  );
  proc.unref();

  const pid = proc.pid ?? -1;
  activeSession = { pid, commandFile, os: "win32" };

  return {
    reused: false,
    pid,
    message: "Opened new terminal window.",
  };
}

// ---------------------------------------------------------------------------
// macOS implementation (Terminal.app via osascript)
// ---------------------------------------------------------------------------
function macosPunchout(command: string, cwd: string): PunchoutResult {
  // Escape single quotes for AppleScript string literals.
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const shellCmd = `cd '${esc(cwd)}' && ${esc(command)}`;

  // Reuse the front Terminal.app window if Terminal is already running.
  const reuse = activeSession?.os === "darwin";
  const appleScript = reuse
    ? `tell application "Terminal" to activate
tell application "Terminal" to do script "${shellCmd}" in front window`
    : `tell application "Terminal" to activate
tell application "Terminal" to do script "${shellCmd}"`;

  const proc = spawn("osascript", ["-e", appleScript], {
    detached: true,
    stdio: "ignore",
  });
  proc.unref();

  const pid = proc.pid ?? -1;
  // Store a sentinel so next call attempts reuse via "front window".
  activeSession = { pid, commandFile: "", os: "darwin" };

  return {
    reused: reuse,
    pid,
    message: reuse
      ? "Command sent to existing Terminal window."
      : "Opened new Terminal.app window.",
  };
}

// ---------------------------------------------------------------------------
// Linux implementation (first available terminal emulator, no reuse)
// ---------------------------------------------------------------------------
function linuxPunchout(command: string, cwd: string): PunchoutResult {
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  const shellCmd = `cd '${esc(cwd)}' && ${command}; exec bash`;

  const candidates: Array<{ bin: string; args: string[] }> = [
    { bin: "x-terminal-emulator", args: ["-e", `bash -c '${esc(shellCmd)}'`] },
    { bin: "gnome-terminal", args: ["--", "bash", "-c", shellCmd] },
    { bin: "xterm", args: ["-e", `bash -c '${esc(shellCmd)}'`] },
    { bin: "konsole", args: ["-e", `bash -c '${esc(shellCmd)}'`] },
  ];

  for (const { bin, args } of candidates) {
    try {
      const proc = spawn(bin, args, { detached: true, stdio: "ignore" });
      proc.unref();
      const pid = proc.pid ?? -1;
      activeSession = { pid, commandFile: "", os: "linux" };
      return {
        reused: false,
        pid,
        message: `Opened new ${bin} window.`,
      };
    } catch {
      // Try next emulator.
    }
  }

  throw new Error(
    "No terminal emulator found. Install xterm, gnome-terminal, or set x-terminal-emulator.",
  );
}
