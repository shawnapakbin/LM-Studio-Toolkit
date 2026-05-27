import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationTimer, generateTraceId } from "@shared/types";
import dotenv from "dotenv";
import { z } from "zod";
import { normalizeToolCall } from "../../shared/dist/toolCallNormalizer";
import { handleAskUserRequest } from "./ask-user";
import type { AskUserRequest } from "./types";

dotenv.config();

function normalizeAskUserRequest(input: unknown): AskUserRequest {
  const raw = (input ?? {}) as Record<string, unknown>;
  const rawAction = String(raw.action ?? "").trim();
  const legacyActionMap: Record<string, AskUserRequest["action"]> = {
    create: "create",
    create_interview: "create",
    submit: "submit",
    submit_responses: "submit",
    get: "get",
    get_interview: "get",
  };
  const action = legacyActionMap[rawAction] ?? (rawAction as AskUserRequest["action"]);

  const payload = (() => {
    if (raw.payload && typeof raw.payload === "object") {
      return { ...(raw.payload as Record<string, unknown>) } as Record<string, unknown>;
    }

    // Some model routers send payload as a stringified JSON object.
    if (typeof raw.payload === "string") {
      try {
        const parsed = JSON.parse(raw.payload) as unknown;
        if (parsed && typeof parsed === "object") {
          return { ...(parsed as Record<string, unknown>) };
        }
      } catch {
        // leave as empty payload; downstream validation will return INVALID_INPUT
      }
    }

    return {} as Record<string, unknown>;
  })();

  if (action === "create") {
    if (payload.expiresInSeconds === undefined && typeof payload.expires === "number") {
      payload.expiresInSeconds = payload.expires;
      delete payload.expires;
    }

    if (payload.questions === undefined && typeof payload.prompt === "string") {
      payload.questions = [
        {
          id: "prompt",
          type: "text",
          prompt: payload.prompt,
          required: true,
        },
      ];
      delete payload.prompt;
    }
  }

  return { action, payload } as AskUserRequest;
}

export function createAskUserMcpServer(): McpServer {
  const server = new McpServer({
    name: "lm-studio-ask-user-tool",
    version: "1.0.0",
  });

  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (input: unknown) => Promise<CallToolResult>,
  ) => void;

  registerTool(
    "interview_user",
    {
      description:
        "Creates and manages interview/clarification forms: create, submit, get. Purpose: clarification_only. Do NOT use this tool for permissioning execution of other tools. Tool-use approval must use each target tool's native approval token/session approval flow. Always allowed — no permission prompts or approval tokens required.",
      inputSchema: z.object({
        action: z.enum(["create", "submit", "get"]),
        payload: z
          .unknown()
          .describe(
            "Action-specific payload. May be an object or JSON string; server normalizes and validates it. Examples: create: {title, questions: [{id, type, prompt, ...}]}, submit: {interviewId, responses: [{questionId, value}], idempotencyKey}, get: {interviewId}",
          ),
      }),
    },
    async (input): Promise<CallToolResult> => {
      const timer = new OperationTimer();
      const traceId = generateTraceId();
      // Normalize tool call input (handles legacy and canonical formats)
      let normalized: unknown = input;
      try {
        // If input is a tool call, extract action/payload for AskUserRequest
        const toolCall = normalizeToolCall(input, { taskRunId: traceId });
        normalized = JSON.parse(toolCall.input_params);
      } catch {
        // fallback: assume input is already AskUserRequest shape
      }
      const request = normalizeAskUserRequest(normalized);
      const result = handleAskUserRequest(request, timer.elapsed(), traceId);

      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: {
          ...(result as unknown as Record<string, unknown>),
          toolName: "interview_user",
          purpose: "clarification_only",
        },
      };
    },
  );

  return server;
}

async function main() {
  const server = createAskUserMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio AskUser MCP server running on stdio");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("MCP server startup failed:", error);
    process.exit(1);
  });
}
