import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import {
  clearSession,
  deleteSegment,
  listSegments,
  retrieveContext,
  storeSegment,
  summarizeSession,
} from "./ecm";

dotenv.config();

const ecmInputShape = {
  action: z
    .enum([
      "store_segment",
      "retrieve_context",
      "list_segments",
      "delete_segment",
      "clear_session",
      "summarize_session",
    ])
    .describe("The operation to perform."),
  // shared
  sessionId: z.string().optional().describe("(all actions) Session namespace."),
  // store_segment
  type: z
    .enum(["conversation_turn", "tool_output", "document", "reasoning", "summary"])
    .optional()
    .describe("(store_segment) Segment type."),
  content: z.string().optional().describe("(store_segment) Text content to store."),
  importance: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("(store_segment) Importance weight 0–1 (default 0.5)."),
  metadata: z.record(z.unknown()).optional().describe("(store_segment) Arbitrary metadata JSON."),
  // retrieve_context
  query: z.string().optional().describe("(retrieve_context) Query text for semantic search."),
  topK: z
    .number()
    .optional()
    .describe("(retrieve_context) Max segments to consider before budget (default 10)."),
  maxTokens: z
    .number()
    .optional()
    .describe("(retrieve_context) Token budget for returned segments (default 4096)."),
  minScore: z
    .number()
    .optional()
    .describe("(retrieve_context) Minimum composite score filter 0–1."),
  // list_segments
  limit: z.number().optional().describe("(list_segments) Max results (default 20)."),
  offset: z.number().optional().describe("(list_segments) Pagination offset (default 0)."),
  // delete_segment
  segmentId: z.string().optional().describe("(delete_segment) UUID of the segment to delete."),
  // summarize_session
  keepNewest: z
    .number()
    .optional()
    .describe("(summarize_session) Number of newest segments to keep untouched (default 10)."),
} as const;

type EcmInput = {
  action:
    | "store_segment"
    | "retrieve_context"
    | "list_segments"
    | "delete_segment"
    | "clear_session"
    | "summarize_session";
  sessionId?: string;
  type?: "conversation_turn" | "tool_output" | "document" | "reasoning" | "summary";
  content?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  query?: string;
  topK?: number;
  maxTokens?: number;
  minScore?: number;
  limit?: number;
  offset?: number;
  segmentId?: string;
  keepNewest?: number;
};

export function createECMMcpServer(): McpServer {
  const server = new McpServer({ name: "lm-studio-ecm-tool", version: "2.1.0" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    "ecm",
    {
      description:
        "Extended Context Memory tool. Enables effective 1M token context by storing and retrieving memory segments via vector search. Actions: store_segment, retrieve_context, list_segments, delete_segment, clear_session, summarize_session.",
      inputSchema: ecmInputShape,
    },
    async (input: EcmInput): Promise<CallToolResult> => {
      const { action, sessionId = "", ...rest } = input;
      let result: unknown;

      switch (action) {
        case "store_segment":
          result = await storeSegment({
            sessionId,
            type: rest.type!,
            content: rest.content!,
            importance: rest.importance,
            metadata: rest.metadata,
          });
          break;
        case "retrieve_context":
          result = await retrieveContext({
            sessionId,
            query: rest.query!,
            topK: rest.topK,
            maxTokens: rest.maxTokens,
            minScore: rest.minScore,
          });
          break;
        case "list_segments":
          result = await listSegments({ sessionId, limit: rest.limit, offset: rest.offset });
          break;
        case "delete_segment":
          result = await deleteSegment({ sessionId, segmentId: rest.segmentId! });
          break;
        case "clear_session":
          result = await clearSession({ sessionId });
          break;
        case "summarize_session":
          result = await summarizeSession({ sessionId, keepNewest: rest.keepNewest });
          break;
        default: {
          const _e: never = action;
          result = {
            success: false,
            errorCode: "INVALID_INPUT",
            errorMessage: `Unknown action: ${_e}`,
          };
        }
      }

      const res = result as { success: boolean };
      return {
        isError: !res.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

async function main() {
  const server = createECMMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio ECM MCP server running on stdio");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("MCP server startup failed:", err);
    process.exit(1);
  });
}
