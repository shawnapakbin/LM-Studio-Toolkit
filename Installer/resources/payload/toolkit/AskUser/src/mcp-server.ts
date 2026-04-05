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
    "ask_user_interview",
    {
      description:
        "Creates approval interviews, submits responses, or checks approval status. Only use for user approval workflows—NOT for general questions or data retrieval. Supports: create (new interview), submit (answers to questions), get (fetch results).",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          payload: z
            .object({
              title: z
                .string()
                .optional()
                .describe("Interview title (e.g., 'Approve document deletion')"),
              taskRunId: z.string().optional().describe("Associated task ID"),
              expiresInSeconds: z
                .number()
                .int()
                .min(60)
                .max(86400)
                .optional()
                .describe("Expiration time in seconds (60–86400, default 3600)"),
              questions: z
                .array(z.record(z.unknown()))
                .describe(
                  "Array of question objects with id, type (text/single_choice/confirm), prompt, required",
                ),
            })
            .strict(),
        }),
        z.object({
          action: z.literal("submit"),
          payload: z
            .object({
              interviewId: z.string().describe("Interview ID from create action"),
              responses: z
                .array(
                  z.object({
                    questionId: z.string(),
                    value: z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]),
                  }),
                )
                .describe("Array of answers: questionId and value"),
            })
            .strict(),
        }),
        z.object({
          action: z.literal("get"),
          payload: z
            .object({
              interviewId: z.string().describe("Interview ID to fetch results"),
            })
            .strict(),
        }),
      ]),
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
      const { action, payload } = normalized as {
        action: AskUserRequest["action"];
        payload: AskUserRequest["payload"];
      };
      const request: AskUserRequest = { action, payload };
      const result = handleAskUserRequest(request, timer.elapsed(), traceId);

      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
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
