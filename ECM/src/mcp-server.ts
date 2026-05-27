#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolResponse } from "@shared/types";
import { z } from "zod";
import { clearSession, getStatus, onUserTurn, storeSegment } from "./ecm";

type EcmAction = "on_user_turn" | "store_segment" | "clear_session" | "get_status";

const ACTIONS: readonly EcmAction[] = [
  "on_user_turn",
  "store_segment",
  "clear_session",
  "get_status",
] as const;

const ecmInputShape = {
  action: z
    .enum(ACTIONS as unknown as [EcmAction, ...EcmAction[]])
    .describe(
      "ECM action. on_user_turn = (call this every user turn) compact when context >= threshold; store_segment = persist a conversation/tool turn; clear_session = drop all segments; get_status = report counts and token usage.",
    ),
  sessionId: z.string().describe("Session namespace (e.g. chat session id)."),

  // on_user_turn
  currentUsedTokens: z
    .number()
    .optional()
    .describe(
      "(on_user_turn) Authoritative current context-window token usage from the chat client. Falls back to the internal session token estimate if omitted.",
    ),
  contextLimit: z
    .number()
    .optional()
    .describe(
      "(on_user_turn) Authoritative model context-window size. Falls back to ECM_MODEL_CONTEXT_LIMIT (default 8192).",
    ),
  threshold: z.number().optional().describe("(on_user_turn) Trigger ratio in (0, 1]. Default 0.5."),
  keepNewest: z
    .number()
    .optional()
    .describe("(on_user_turn) Newest segments to preserve verbatim. Default 4."),

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
} as const;

interface EcmInput {
  action: EcmAction;
  sessionId: string;
  currentUsedTokens?: number;
  contextLimit?: number;
  threshold?: number;
  keepNewest?: number;
  type?: "conversation_turn" | "tool_output" | "document" | "reasoning" | "summary";
  content?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

function toCallToolResult(result: ToolResponse<unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
}

export function createEcmMcpServer(): McpServer {
  const server = new McpServer({ name: "ecm", version: "3.0.0" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    "ecm",
    {
      description:
        "Enhanced Context Memory. Single purpose: compact older conversation segments into a highlights summary when the context window approaches its limit. Call action=on_user_turn at the start of every user turn so it can decide whether to compact. Other actions: store_segment (persist a turn), clear_session, get_status.",
      inputSchema: ecmInputShape,
    },
    async (raw: EcmInput): Promise<CallToolResult> => {
      const { action, sessionId, ...rest } = raw;
      let result: ToolResponse<unknown>;
      switch (action) {
        case "on_user_turn":
          result = await onUserTurn({
            sessionId,
            currentUsedTokens: rest.currentUsedTokens,
            contextLimit: rest.contextLimit,
            threshold: rest.threshold,
            keepNewest: rest.keepNewest,
          });
          break;
        case "store_segment":
          result = await storeSegment({
            sessionId,
            type: rest.type ?? "conversation_turn",
            content: rest.content ?? "",
            importance: rest.importance,
            metadata: rest.metadata,
          });
          break;
        case "clear_session":
          result = await clearSession({ sessionId });
          break;
        case "get_status":
          result = await getStatus({ sessionId });
          break;
        default: {
          const _e: never = action;
          result = {
            success: false,
            errorCode: "INVALID_INPUT" as never,
            errorMessage: `Unknown action: ${_e as string}`,
          } as ToolResponse<unknown>;
        }
      }
      return toCallToolResult(result);
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createEcmMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[ECM] MCP server ready on stdio.\n");
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[ECM] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
