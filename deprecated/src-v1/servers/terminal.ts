/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { execSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startServer } from "../shared/mcp-helpers.js";

const CAPTURE_MAX_BYTES = 1024 * 1024;
const DEFAULT_PUNCHOUT_WAIT_TIMEOUT_MS = 180000;
const MAX_PUNCHOUT_WAIT_TIMEOUT_MS = 600000;

const commandArgs = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(30000).optional().default(10000)
});

function getAllowedCommands(): Set<string> {
  const raw = process.env.ALLOWED_TERMINAL_COMMANDS ?? "ls,pwd,cat,head,tail,rg,find,echo,date";
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function allowAllCommands(allowedCommands: Set<string>): boolean {
  return allowedCommands.has("*");
}

function getCommandHead(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function commandExists(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveTerminalLauncher(): string {
  const custom = process.env.TERMINAL_PUNCHOUT_CMD?.trim();
  if (custom) {
    return custom;
  }

  const candidates = [
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "xterm"
  ];

  for (const candidate of candidates) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Terminal punchout requested but no supported terminal launcher was found. " +
      "Set TERMINAL_PUNCHOUT_CMD to a valid executable."
  );
}

function launchPunchedOutTerminal(command: string, env: NodeJS.ProcessEnv | undefined, cwd?: string): string {
  const launcher = resolveTerminalLauncher();
  const interactiveCommand = `${command}; echo; echo '[mcp-terminal] command finished'; exec bash`;

  let args: string[];
  if (launcher === "gnome-terminal") {
    args = ["--", "bash", "-lc", interactiveCommand];
  } else if (launcher === "konsole") {
    args = ["-e", "bash", "-lc", interactiveCommand];
  } else {
    args = ["-e", "bash", "-lc", interactiveCommand];
  }

  const child = spawn(launcher, args, {
    cwd,
    env,
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  return `Punched out terminal window via '${launcher}' (pid: ${child.pid ?? "unknown"}).`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parsePositiveInt(
  rawValue: string | undefined,
  fallback: number,
  maxValue: number
): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maxValue);
}

function getPunchoutWaitTimeoutMs(): number {
  return parsePositiveInt(
    process.env.TERMINAL_PUNCHOUT_WAIT_TIMEOUT_MS,
    DEFAULT_PUNCHOUT_WAIT_TIMEOUT_MS,
    MAX_PUNCHOUT_WAIT_TIMEOUT_MS
  );
}

function shouldWaitForPunchoutExit(): boolean {
  return isTruthy(process.env.TERMINAL_PUNCHOUT_WAIT_FOR_EXIT);
}

function shouldKeepTerminalOpenAfterTrackedPunchout(): boolean {
  return isTruthy(process.env.TERMINAL_PUNCHOUT_WAIT_KEEP_OPEN);
}

function shouldRequireAskpassForSudo(): boolean {
  return isTruthy(process.env.TERMINAL_REQUIRE_ASKPASS_FOR_SUDO);
}

function getSudoAskpassPath(): string | undefined {
  const explicit = process.env.TERMINAL_SUDO_ASKPASS?.trim();
  if (explicit) {
    return explicit;
  }

  const inherited = process.env.SUDO_ASKPASS?.trim();
  if (inherited) {
    return inherited;
  }

  return undefined;
}

function ensureSudoUsesAskpass(command: string): string {
  if (!/^\s*sudo\b/.test(command)) {
    return command;
  }

  if (/^\s*sudo\s+(?:-A\b|--askpass\b)/.test(command)) {
    return command;
  }

  return command.replace(/^\s*sudo\b/, "sudo -A");
}

function buildExecutionContext(command: string): {
  command: string;
  env: NodeJS.ProcessEnv | undefined;
  notes: string[];
} {
  const notes: string[] = [];

  if (shouldRequireAskpassForSudo() && getCommandHead(command) === "sudo") {
    const askpassPath = getSudoAskpassPath();
    if (!askpassPath) {
      throw new Error(
        "sudo command requires askpass, but no helper was configured. " +
          "Set TERMINAL_SUDO_ASKPASS or SUDO_ASKPASS."
      );
    }

    notes.push("SECURITY: sudo command forced to askpass mode.");
    return {
      command: ensureSudoUsesAskpass(command),
      env: {
        ...process.env,
        SUDO_ASKPASS: askpassPath
      },
      notes
    };
  }

  return {
    command,
    env: undefined,
    notes
  };
}

function launchTrackedPunchedOutTerminal(
  command: string,
  exitCodePath: string,
  keepOpen: boolean,
  env: NodeJS.ProcessEnv | undefined,
  cwd?: string
): string {
  const launcher = resolveTerminalLauncher();
  const interactiveCommand = [
    "set +e",
    command,
    "ec=$?",
    `printf '%s' \"$ec\" > ${shellQuote(exitCodePath)}`,
    "echo",
    "echo '[mcp-terminal] command finished'",
    "echo \"[mcp-terminal] exit code: $ec\"",
    keepOpen ? "exec bash" : "exit $ec"
  ].join("; ");

  let args: string[];
  if (launcher === "gnome-terminal") {
    args = ["--", "bash", "-lc", interactiveCommand];
  } else if (launcher === "konsole") {
    args = ["-e", "bash", "-lc", interactiveCommand];
  } else {
    args = ["-e", "bash", "-lc", interactiveCommand];
  }

  const child = spawn(launcher, args, {
    cwd,
    env,
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  return `Punched out terminal window via '${launcher}' (pid: ${child.pid ?? "unknown"}).`;
}

async function waitForExitCodeFile(
  exitCodePath: string,
  timeoutMs: number
): Promise<{ timedOut: boolean; exitCode: number | null }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = (await readFile(exitCodePath)).toString("utf8").trim();
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        return { timedOut: false, exitCode: parsed };
      }

      return { timedOut: false, exitCode: null };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return { timedOut: true, exitCode: null };
}

function launchTrackedPunchedOutTerminalWithCapture(
  command: string,
  stdoutPath: string,
  stderrPath: string,
  exitCodePath: string,
  keepOpen: boolean,
  env: NodeJS.ProcessEnv | undefined,
  cwd?: string
): string {
  const launcher = resolveTerminalLauncher();
  // Redirect stdout/stderr via shell so the TTY stays interactive for sudo prompts.
  // sudo writes its password prompt directly to /dev/tty, bypassing these redirects.
  const interactiveCommand = [
    "set +e",
    `{ ${command}; } > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`,
    "ec=$?",
    `printf '%s' "$ec" > ${shellQuote(exitCodePath)}`,
    "echo",
    "echo '[mcp-terminal] command finished'",
    "echo \"[mcp-terminal] exit code: $ec\"",
    keepOpen ? "exec bash" : "exit $ec"
  ].join("; ");

  let args: string[];
  if (launcher === "gnome-terminal") {
    args = ["--", "bash", "-lc", interactiveCommand];
  } else if (launcher === "konsole") {
    args = ["-e", "bash", "-lc", interactiveCommand];
  } else {
    args = ["-e", "bash", "-lc", interactiveCommand];
  }

  const child = spawn(launcher, args, {
    cwd,
    env,
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  return `Punched out terminal window via '${launcher}' (pid: ${child.pid ?? "unknown"}).`;
}

function launchPunchedOutLogViewer(stdoutPath: string, stderrPath: string, cwd?: string): string {
  const launcher = resolveTerminalLauncher();
  const interactiveCommand = [
    `echo '[mcp-terminal] live output for current tool call'`,
    `echo '[mcp-terminal] stdout: ${stdoutPath}'`,
    `echo '[mcp-terminal] stderr: ${stderrPath}'`,
    `echo`,
    `tail -n +1 -f ${shellQuote(stdoutPath)} ${shellQuote(stderrPath)}`,
    `echo`,
    `echo '[mcp-terminal] command finished'; exec bash`
  ].join("; ");

  let args: string[];
  if (launcher === "gnome-terminal") {
    args = ["--", "bash", "-lc", interactiveCommand];
  } else if (launcher === "konsole") {
    args = ["-e", "bash", "-lc", interactiveCommand];
  } else {
    args = ["-e", "bash", "-lc", interactiveCommand];
  }

  const child = spawn(launcher, args, {
    cwd,
    detached: true,
    stdio: "ignore"
  });

  child.unref();

  return `Punched out terminal window via '${launcher}' (pid: ${child.pid ?? "unknown"}).`;
}

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const source = Buffer.from(text, "utf8");
  if (source.length <= maxBytes) {
    return { text, truncated: false };
  }

  return {
    text: source.subarray(0, maxBytes).toString("utf8"),
    truncated: true
  };
}

async function executeWithCapturedLogs(
  command: string,
  env: NodeJS.ProcessEnv | undefined,
  cwd: string | undefined,
  timeoutMs: number,
  stdoutPath: string,
  stderrPath: string
): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
    const stderrStream = createWriteStream(stderrPath, { flags: "a" });
    let timedOut = false;

    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 500);
    }, timeoutMs);

    const finalize = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timeoutId);

      const onSettled = (): void => {
        resolve({ exitCode, signal, timedOut });
      };

      let pending = 2;
      const done = (): void => {
        pending -= 1;
        if (pending === 0) {
          onSettled();
        }
      };

      stdoutStream.end(done);
      stderrStream.end(done);
    };

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      stdoutStream.end();
      stderrStream.end();
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      finalize(exitCode, signal);
    });
  });
}

async function executeAndCapture(
  command: string,
  env: NodeJS.ProcessEnv | undefined,
  cwd: string | undefined,
  timeoutMs: number
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= CAPTURE_MAX_BYTES) {
        return;
      }
      const remaining = CAPTURE_MAX_BYTES - stdoutBytes;
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stdoutChunks.push(kept);
      stdoutBytes += kept.length;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes >= CAPTURE_MAX_BYTES) {
        return;
      }
      const remaining = CAPTURE_MAX_BYTES - stderrBytes;
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 500);
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        exitCode,
        signal,
        timedOut
      });
    });
  });
}

async function main(): Promise<void> {
  const allowedCommands = getAllowedCommands();

  await startServer("terminal-mcp-server", "0.1.0", [
    {
      tool: {
        name: "run_command",
        description: "Run a shell command with timeout and allow-list restrictions.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
            cwd: { type: "string" },
            timeoutMs: { type: "number", minimum: 1, maximum: 30000 }
          },
          required: ["command"]
        }
      },
      handler: async (args: unknown) => {
        const parsed = commandArgs.parse(args);
        const execution = buildExecutionContext(parsed.command);
        const head = getCommandHead(execution.command);

        if (!allowAllCommands(allowedCommands) && !allowedCommands.has(head)) {
          throw new Error(`Command not allowed: ${head}`);
        }

        const shouldPunchout = isTruthy(process.env.TERMINAL_PUNCHOUT);
        const shouldCaptureWithPunchout = isTruthy(process.env.TERMINAL_CAPTURE_WITH_PUNCHOUT);
        const shouldWaitForExit = shouldWaitForPunchoutExit();

        if (shouldPunchout && shouldCaptureWithPunchout && shouldWaitForExit) {
          // Combined mode: interactive terminal (sudo-friendly) + file capture + tracked wait.
          // The command is run in a real TTY so sudo password prompts work, but stdout/stderr
          // are redirected at the shell level to tmp files that the MCP process reads after exit.
          const waitTimeoutMs = getPunchoutWaitTimeoutMs();
          const keepOpen = shouldKeepTerminalOpenAfterTrackedPunchout();
          const sessionDir = await mkdtemp(join(tmpdir(), "mcp-terminal-tracked-cap-"));
          const stdoutPath = join(sessionDir, "stdout.log");
          const stderrPath = join(sessionDir, "stderr.log");
          const exitCodePath = join(sessionDir, "exit-code.txt");

          await writeFile(stdoutPath, "", "utf8");
          await writeFile(stderrPath, "", "utf8");

          try {
            const launchMessage = launchTrackedPunchedOutTerminalWithCapture(
              execution.command,
              stdoutPath,
              stderrPath,
              exitCodePath,
              keepOpen,
              execution.env,
              parsed.cwd
            );

            const waitResult = await waitForExitCodeFile(exitCodePath, waitTimeoutMs);

            if (waitResult.timedOut) {
              return [
                `Command: ${execution.command}`,
                launchMessage,
                `STATUS: timed out waiting for punchout completion after ${waitTimeoutMs}ms.`,
                execution.notes.length > 0 ? execution.notes.join("\n") : "",
                "The terminal window remains under user control."
              ].filter(Boolean).join("\n\n");
            }

            const rawStdout = (await readFile(stdoutPath)).toString("utf8").trim();
            const rawStderr = (await readFile(stderrPath)).toString("utf8").trim();
            const stdout = truncateUtf8(rawStdout, CAPTURE_MAX_BYTES);
            const stderr = truncateUtf8(rawStderr, CAPTURE_MAX_BYTES);

            const capNotes: string[] = [...execution.notes];
            if (stdout.truncated || stderr.truncated) {
              capNotes.push(`NOTE: output was truncated to ${CAPTURE_MAX_BYTES} bytes per stream.`);
            }

            return [
              `Command: ${execution.command}`,
              launchMessage,
              `EXIT: code=${waitResult.exitCode ?? "null"}`,
              capNotes.length > 0 ? capNotes.join("\n") : "STATUS: completed",
              stdout.text ? `STDOUT:\n${stdout.text}` : "STDOUT: <empty>",
              stderr.text ? `STDERR:\n${stderr.text}` : "STDERR: <empty>"
            ].join("\n\n");
          } finally {
            await rm(sessionDir, { recursive: true, force: true });
          }
        }

        if (shouldPunchout && shouldCaptureWithPunchout) {
          const sessionDir = await mkdtemp(join(tmpdir(), "mcp-terminal-"));
          const stdoutPath = join(sessionDir, "stdout.log");
          const stderrPath = join(sessionDir, "stderr.log");

          await writeFile(stdoutPath, "", "utf8");
          await writeFile(stderrPath, "", "utf8");

          const message = launchPunchedOutLogViewer(stdoutPath, stderrPath, parsed.cwd);

          try {
            const result = await executeWithCapturedLogs(
              execution.command,
              execution.env,
              parsed.cwd,
              parsed.timeoutMs,
              stdoutPath,
              stderrPath
            );

            const rawStdout = (await readFile(stdoutPath)).toString("utf8").trim();
            const rawStderr = (await readFile(stderrPath)).toString("utf8").trim();
            const stdout = truncateUtf8(rawStdout, CAPTURE_MAX_BYTES);
            const stderr = truncateUtf8(rawStderr, CAPTURE_MAX_BYTES);

            const notes: string[] = [];
            if (result.timedOut) {
              notes.push(`TIMEOUT: command exceeded ${parsed.timeoutMs}ms and was terminated.`);
            }
            if (stdout.truncated || stderr.truncated) {
              notes.push(`NOTE: output was truncated to ${CAPTURE_MAX_BYTES} bytes per stream.`);
            }

            return [
              `Command: ${execution.command}`,
              message,
              `EXIT: code=${result.exitCode ?? "null"}${result.signal ? ` signal=${result.signal}` : ""}`,
              notes.length > 0 ? [...execution.notes, ...notes].join("\n") : [...execution.notes, "STATUS: completed"].join("\n"),
              stdout.text ? `STDOUT:\n${stdout.text}` : "STDOUT: <empty>",
              stderr.text ? `STDERR:\n${stderr.text}` : "STDERR: <empty>"
            ].join("\n\n");
          } finally {
            await rm(sessionDir, { recursive: true, force: true });
          }
        }

        if (shouldPunchout) {
          if (shouldWaitForExit) {
            const waitTimeoutMs = getPunchoutWaitTimeoutMs();
            const keepOpen = shouldKeepTerminalOpenAfterTrackedPunchout();
            const sessionDir = await mkdtemp(join(tmpdir(), "mcp-terminal-punchout-"));
            const exitCodePath = join(sessionDir, "exit-code.txt");

            try {
              const launchMessage = launchTrackedPunchedOutTerminal(
                execution.command,
                exitCodePath,
                keepOpen,
                execution.env,
                parsed.cwd
              );
              const waitResult = await waitForExitCodeFile(exitCodePath, waitTimeoutMs);

              if (waitResult.timedOut) {
                return [
                  `Command: ${execution.command}`,
                  launchMessage,
                  `STATUS: timed out waiting for punchout completion after ${waitTimeoutMs}ms.`,
                  execution.notes.length > 0 ? execution.notes.join("\n") : "STATUS: waiting aborted",
                  "The terminal window remains under user control."
                ].join("\n\n");
              }

              return [
                `Command: ${execution.command}`,
                launchMessage,
                `EXIT: code=${waitResult.exitCode ?? "null"}`,
                [...execution.notes, "STATUS: completed via tracked punchout mode."].join("\n"),
                "Output capture is disabled in punchout mode; view output in the opened terminal window."
              ].join("\n\n");
            } finally {
              await rm(sessionDir, { recursive: true, force: true });
            }
          }

          const message = launchPunchedOutTerminal(execution.command, execution.env, parsed.cwd);
          return [
            `Command: ${execution.command}`,
            message,
            execution.notes.length > 0 ? execution.notes.join("\n") : "STATUS: launched",
            "Output capture is disabled in punchout mode; view output in the opened terminal window."
          ].join("\n\n");
        }

          const result = await executeAndCapture(
            execution.command,
            execution.env,
            parsed.cwd,
            parsed.timeoutMs
          );

          const notes: string[] = [];
          if (result.timedOut) {
            notes.push(`TIMEOUT: command exceeded ${parsed.timeoutMs}ms and was terminated.`);
          }
          if (result.exitCode !== 0) {
            notes.push("STATUS: non-zero exit code returned by command.");
          } else {
            notes.push("STATUS: completed");
          }

          const stdoutTruncated = result.stdout.length > 0 && Buffer.byteLength(result.stdout, "utf8") >= CAPTURE_MAX_BYTES;
          const stderrTruncated = result.stderr.length > 0 && Buffer.byteLength(result.stderr, "utf8") >= CAPTURE_MAX_BYTES;
          if (stdoutTruncated || stderrTruncated) {
            notes.push(`NOTE: output was truncated to ${CAPTURE_MAX_BYTES} bytes per stream.`);
          }

        return [
          `Command: ${execution.command}`,
            `EXIT: code=${result.exitCode ?? "null"}${result.signal ? ` signal=${result.signal}` : ""}`,
            [...execution.notes, ...notes].join("\n"),
            result.stdout ? `STDOUT:\n${result.stdout}` : "STDOUT: <empty>",
            result.stderr ? `STDERR:\n${result.stderr}` : "STDERR: <empty>"
        ].join("\n\n");
      }
    }
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
