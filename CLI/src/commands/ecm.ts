/**
 * ecm — Enhanced Context Memory CLI commands.
 *
 * Surface mirrors the four ECM actions: on_user_turn, store_segment,
 * clear_session, get_status.
 */

import type { Command } from "commander";
import { DEFAULT_ECM_SESSION, TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

async function ecmPost(body: unknown): Promise<unknown> {
  return toolPost(`${TOOL_ENDPOINTS.ecm}/tools/ecm`, body);
}

export function registerEcmCommands(program: Command): void {
  const ecm = program.command("ecm").description("Enhanced Context Memory operations");

  ecm
    .command("store")
    .description("Store a memory segment")
    .requiredOption("-c, --content <text>", "Content to store")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .option(
      "-t, --type <type>",
      "Segment type: conversation_turn | tool_output | document | reasoning | summary",
      "conversation_turn",
    )
    .option("-i, --importance <n>", "Importance score 0–1", parseFloat)
    .action(
      async (opts: { content: string; session: string; type: string; importance?: number }) => {
        try {
          printResult(
            await ecmPost({
              action: "store_segment",
              sessionId: opts.session,
              type: opts.type,
              content: opts.content,
              ...(opts.importance !== undefined && { importance: opts.importance }),
            }),
          );
        } catch (err) {
          handleError(err);
        }
      },
    );

  ecm
    .command("status")
    .description("Show segment count and estimated token usage for a session")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .action(async (opts: { session: string }) => {
      try {
        printResult(await ecmPost({ action: "get_status", sessionId: opts.session }));
      } catch (err) {
        handleError(err);
      }
    });

  ecm
    .command("clear")
    .description("Clear all segments in a session")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .action(async (opts: { session: string }) => {
      try {
        printResult(await ecmPost({ action: "clear_session", sessionId: opts.session }));
      } catch (err) {
        handleError(err);
      }
    });

  // /compact — manual compaction trigger.
  ecm
    .command("compact")
    .description(
      "/compact — manually trigger compaction; pass --used and --limit to control the threshold check",
    )
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .option("--used <n>", "Current used tokens (forces compaction trigger)", parseInt)
    .option("--limit <n>", "Model context limit", parseInt)
    .option("--keep-newest <n>", "Newest segments to keep (default: 4)", parseInt)
    .option("--threshold <n>", "Trigger ratio in (0, 1] (default: 0.5)", parseFloat)
    .action(
      async (opts: {
        session: string;
        used?: number;
        limit?: number;
        keepNewest?: number;
        threshold?: number;
      }) => {
        try {
          // For a manual /compact we want to fire even at low usage; default
          // currentUsedTokens to a value that forces ratio >= threshold unless
          // the caller supplied real values.
          const limit = opts.limit ?? 8192;
          const used = opts.used ?? limit;
          printResult(
            await ecmPost({
              action: "on_user_turn",
              sessionId: opts.session,
              currentUsedTokens: used,
              contextLimit: limit,
              ...(opts.keepNewest !== undefined && { keepNewest: opts.keepNewest }),
              ...(opts.threshold !== undefined && { threshold: opts.threshold }),
            }),
          );
        } catch (err) {
          handleError(err);
        }
      },
    );
}
