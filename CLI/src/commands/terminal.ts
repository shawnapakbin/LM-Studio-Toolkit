/**
 * terminal — execute a shell command via the Terminal tool
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

export function registerTerminalCommand(program: Command): void {
  program
    .command("terminal <command>")
    .alias("run")
    .description("Execute a shell command via the Terminal tool")
    .option("-d, --cwd <dir>", "Working directory for the command")
    .option("--timeout <ms>", "Timeout in milliseconds", parseInt)
    .action(async (command: string, opts: { cwd?: string; timeout?: number }) => {
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.terminal}/tools/run_terminal_command`, {
          command,
          ...(opts.cwd && { cwd: opts.cwd }),
          ...(opts.timeout !== undefined && { timeoutMs: opts.timeout }),
        });
        printResult(result);
      } catch (err) {
        handleError(err);
      }
    });
}
