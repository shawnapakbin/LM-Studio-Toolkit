import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import {
  autoCompactNow,
  clearSession,
  deleteSegment,
  getSessionPolicy,
  listSegments,
  retrieveContext,
  setContinuousCompact,
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
      "auto_compact_now",
      "set_continuous_compact",
      "get_session_policy",
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
  includeEmbeddings: z
    .boolean()
    .optional()
    .describe(
      "(store_segment/list_segments) Include raw embedding vectors in response. Defaults to false to keep payloads small.",
    ),
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
    .describe("(summarize_session / auto_compact_now / set_continuous_compact) Number of newest segments to keep untouched (default 10 / 10 / 1)."),
  enabled: z
    .boolean()
    .optional()
    .describe("(set_continuous_compact) Enable or disable continuous compaction for this session."),
} as const;

type EcmInput = {
  action:
    | "store_segment"
    | "retrieve_context"
    | "list_segments"
    | "delete_segment"
    | "clear_session"
    | "summarize_session"
    | "auto_compact_now"
    | "set_continuous_compact"
    | "get_session_policy";
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
  includeEmbeddings?: boolean;
  segmentId?: string;
  keepNewest?: number;
  enabled?: boolean;
};

export function createECMMcpServer(): McpServer {
  const server = new McpServer({ name: "lm-studio-ecm-tool", version: "2.1.0" });

  const toCallToolResult = (result: unknown): CallToolResult => {
    const res = result as { success: boolean };
    return {
      isError: !res.success,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    "ecm",
    {
      description:
        "Extended Context Memory tool. Enables effective 1M token context by storing and retrieving memory segments via vector search. Actions: store_segment, retrieve_context, list_segments, delete_segment, clear_session, summarize_session, auto_compact_now, set_continuous_compact, get_session_policy.",
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
            includeEmbeddings: rest.includeEmbeddings,
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
          result = await listSegments({
            sessionId,
            limit: rest.limit,
            offset: rest.offset,
            includeEmbeddings: rest.includeEmbeddings,
          });
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
        case "auto_compact_now":
          result = await autoCompactNow({ sessionId, keepNewest: rest.keepNewest });
          break;
        case "set_continuous_compact":
          result = await setContinuousCompact({
            sessionId,
            enabled: rest.enabled!,
            keepNewest: rest.keepNewest,
          });
          break;
        case "get_session_policy":
          result = await getSessionPolicy({ sessionId });
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

      return toCallToolResult(result);
    },
  );

  // Alias tool: explicit manual toggle for continuous compact mode.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    "ecm_set_continuous_compact",
    {
      description:
        "Enable or disable continuous compaction for a session. Equivalent to ecm action=set_continuous_compact.",
      inputSchema: {
        sessionId: z.string().describe("Session namespace."),
        enabled: z
          .boolean()
          .describe("True to enable continuous compact mode, false to disable it."),
        keepNewest: z
          .number()
          .optional()
          .describe("Optional keepNewest override when enabling continuous mode."),
      },
    },
    async ({
      sessionId,
      enabled,
      keepNewest,
    }: {
      sessionId: string;
      enabled: boolean;
      keepNewest?: number;
    }): Promise<CallToolResult> => {
      const result = await setContinuousCompact({ sessionId, enabled, keepNewest });
      return toCallToolResult(result);
    },
  );

  // Alias tool: explicit policy check endpoint for tool pickers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    "ecm_get_session_policy",
    {
      description:
        "Get the effective compaction policy for a session. Equivalent to ecm action=get_session_policy.",
      inputSchema: {
        sessionId: z.string().describe("Session namespace."),
      },
    },
    async ({ sessionId }: { sessionId: string }): Promise<CallToolResult> => {
      const result = await getSessionPolicy({ sessionId });
      return toCallToolResult(result);
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
