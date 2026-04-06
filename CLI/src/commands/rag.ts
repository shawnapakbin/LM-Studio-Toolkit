/**
 * rag — Retrieval Augmented Generation operations
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

async function ragPost(body: unknown): Promise<unknown> {
  return toolPost(`${TOOL_ENDPOINTS.rag}/tools/rag`, body);
}

export function registerRagCommands(program: Command): void {
  const rag = program.command("rag").description("Retrieval Augmented Generation operations");

  rag
    .command("query <text>")
    .description("Query the RAG knowledge base")
    .option("-k, --top-k <n>", "Max results to return", parseInt)
    .action(async (text: string, opts: { topK?: number }) => {
      try {
        printResult(
          await ragPost({
            action: "query",
            query: text,
            ...(opts.topK !== undefined && { topK: opts.topK }),
          }),
        );
      } catch (err) {
        handleError(err);
      }
    });

  rag
    .command("ingest <text>")
    .description("Ingest a document or text into the RAG knowledge base")
    .option("--source <name>", "Source label for the document")
    .action(async (text: string, opts: { source?: string }) => {
      try {
        printResult(
          await ragPost({
            action: "ingest",
            content: text,
            ...(opts.source && { source: opts.source }),
          }),
        );
      } catch (err) {
        handleError(err);
      }
    });

  rag
    .command("list")
    .description("List all ingested sources")
    .action(async () => {
      try {
        printResult(await ragPost({ action: "list_sources" }));
      } catch (err) {
        handleError(err);
      }
    });

  rag
    .command("delete <sourceId>")
    .description("Delete a source from the knowledge base")
    .action(async (sourceId: string) => {
      try {
        printResult(await ragPost({ action: "delete_source", sourceId }));
      } catch (err) {
        handleError(err);
      }
    });
}
