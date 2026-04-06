/**
 * ecm — Extended Context Memory operations including /compact
 */

import type { Command } from "commander";
import { DEFAULT_ECM_SESSION, TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

async function ecmPost(body: unknown): Promise<unknown> {
  return toolPost(`${TOOL_ENDPOINTS.ecm}/tools/ecm`, body);
}

export function registerEcmCommands(program: Command): void {
  const ecm = program.command("ecm").description("Extended Context Memory operations");

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
    .command("retrieve")
    .description("Retrieve relevant memory segments by query")
    .requiredOption("-q, --query <text>", "Search query")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .option("-k, --top-k <n>", "Max segments to return", parseInt)
    .option("--max-tokens <n>", "Max tokens in result", parseInt)
    .option("--min-score <n>", "Minimum relevance score 0–1", parseFloat)
    .action(
      async (opts: {
        query: string;
        session: string;
        topK?: number;
        maxTokens?: number;
        minScore?: number;
      }) => {
        try {
          printResult(
            await ecmPost({
              action: "retrieve_context",
              sessionId: opts.session,
              query: opts.query,
              ...(opts.topK !== undefined && { topK: opts.topK }),
              ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
              ...(opts.minScore !== undefined && { minScore: opts.minScore }),
            }),
          );
        } catch (err) {
          handleError(err);
        }
      },
    );

  ecm
    .command("list")
    .description("List all segments in a session")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .option("-n, --limit <n>", "Max segments to list", parseInt)
    .option("--offset <n>", "Pagination offset", parseInt)
    .action(async (opts: { session: string; limit?: number; offset?: number }) => {
      try {
        printResult(
          await ecmPost({
            action: "list_segments",
            sessionId: opts.session,
            ...(opts.limit !== undefined && { limit: opts.limit }),
            ...(opts.offset !== undefined && { offset: opts.offset }),
          }),
        );
      } catch (err) {
        handleError(err);
      }
    });

  ecm
    .command("delete <segmentId>")
    .description("Delete a specific memory segment by ID")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .action(async (segmentId: string, opts: { session: string }) => {
      try {
        printResult(
          await ecmPost({ action: "delete_segment", sessionId: opts.session, segmentId }),
        );
      } catch (err) {
        handleError(err);
      }
    });

  ecm
    .command("summarize")
    .description("Summarize a session and replace old segments with the summary")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .option("--keep-newest <n>", "Number of newest segments to keep intact", parseInt)
    .action(async (opts: { session: string; keepNewest?: number }) => {
      try {
        printResult(
          await ecmPost({
            action: "summarize_session",
            sessionId: opts.session,
            ...(opts.keepNewest !== undefined && { keepNewest: opts.keepNewest }),
          }),
        );
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

  // /compact — summarize then clear old segments to free context memory
  ecm
    .command("compact")
    .description("/compact — summarize the session and drop old segments to free context memory")
    .option("-s, --session <id>", "Session ID", DEFAULT_ECM_SESSION)
    .option("--keep-newest <n>", "Newest segments to keep after compaction (default: 5)", parseInt)
    .action(async (opts: { session: string; keepNewest?: number }) => {
      const keepNewest = opts.keepNewest ?? 5;
      console.log(
        `Compacting session "${opts.session}" (keeping ${keepNewest} newest segments)...`,
      );
      try {
        // Step 1: summarize — collapses old segments into a summary entry
        const summary = await ecmPost({
          action: "summarize_session",
          sessionId: opts.session,
          keepNewest,
        });
        console.log("\nSummary written:");
        console.log(JSON.stringify(summary, null, 2));

        // Step 2: report remaining segment count
        const list = (await ecmPost({
          action: "list_segments",
          sessionId: opts.session,
          limit: 1,
        })) as Record<string, unknown>;

        const data = list.data as Record<string, unknown> | undefined;
        const total = data?.total ?? "unknown";
        console.log(`\nContext compacted. Segments remaining: ${total}`);
      } catch (err) {
        handleError(err);
      }
    });
}
