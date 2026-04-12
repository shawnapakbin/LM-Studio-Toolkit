/**
 * python — execute Python code or launch Python shells via the PythonShell tool
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

export function registerPythonCommands(program: Command): void {
  const python = program
    .command("python")
    .alias("py")
    .description("Run Python code or launch Python shells via the PythonShell tool");

  python
    .command("run <code>")
    .description("Run non-interactive Python code")
    .option("-d, --cwd <dir>", "Working directory for Python execution")
    .option("--timeout <ms>", "Timeout in milliseconds", parseInt)
    .action(async (code: string, opts: { cwd?: string; timeout?: number }) => {
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.pythonshell}/tools/python_run_code`, {
          code,
          ...(opts.cwd && { cwd: opts.cwd }),
          ...(opts.timeout !== undefined && { timeoutMs: opts.timeout }),
        });
        printResult(result);
      } catch (err) {
        handleError(err);
      }
    });

  python
    .command("repl")
    .description("Open an interactive Python REPL in a visible shell")
    .option("-d, --cwd <dir>", "Working directory")
    .action(async (opts: { cwd?: string }) => {
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.pythonshell}/tools/python_open_repl`, {
          ...(opts.cwd && { cwd: opts.cwd }),
        });
        printResult(result);
      } catch (err) {
        handleError(err);
      }
    });

  python
    .command("idle")
    .description("Launch Python IDLE shell")
    .option("-d, --cwd <dir>", "Working directory")
    .action(async (opts: { cwd?: string }) => {
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.pythonshell}/tools/python_open_idle`, {
          ...(opts.cwd && { cwd: opts.cwd }),
        });
        printResult(result);
      } catch (err) {
        handleError(err);
      }
    });
}
