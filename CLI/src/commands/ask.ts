/**
 * ask — trigger an AskUser interview workflow
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

export function registerAskCommand(program: Command): void {
  program
    .command("ask <prompt>")
    .description("Trigger an AskUser clarification interview")
    .option("--title <title>", "Interview title")
    .option("--expires <seconds>", "Expiry in seconds", parseInt)
    .action(async (prompt: string, opts: { title?: string; expires?: number }) => {
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.askuser}/tools/ask_user`, {
          action: "create_interview",
          prompt,
          ...(opts.title && { title: opts.title }),
          ...(opts.expires !== undefined && { expiresInSeconds: opts.expires }),
        });
        printResult(result);
      } catch (err) {
        handleError(err);
      }
    });
}
