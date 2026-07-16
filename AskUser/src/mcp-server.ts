import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationTimer, generateTraceId } from "@shared/types";
import dotenv from "dotenv";
import { z } from "zod";
import { normalizeToolCall } from "../../shared/toolCallNormalizer";
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

  const payload =
    raw.payload && typeof raw.payload === "object"
      ? ({ ...(raw.payload as Record<string, unknown>) } as Record<string, unknown>)
      : {};

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
    version: "2.2.6",
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
        "ask_user_interview: Structured interview tool for collecting human input/approval before agent actions.\n\nIMPORTANT: Before using this tool, read the 'ask-user-interview' skill first (action: get_skill, name: ask-user-interview) for full usage guidance and rendering instructions.\n\nActions:\n- create: Create interview with questions. Returns interviewId.\n- get: Poll interview status/responses by interviewId.\n- submit: Submit user answers to a pending interview.\n\nQuestion types: text, single_choice, multi_choice, number, confirm.\n\nInterviews expire (default 3600s). States: pending → answered | expired.\n\nUse ONLY for approval/clarification workflows. Do NOT use for general questions or data retrieval.\n\nCreate payload: { title?, taskRunId?, expiresInSeconds?, questions: [{ id, type, prompt, required?, options? }] }\nSubmit payload: { interviewId, responses: [{ questionId, value }] }\nGet payload: { interviewId }",
      inputSchema: {
        action: z
          .enum(["create", "submit", "get"])
          .describe("The operation to perform: 'create' (new interview), 'submit' (answers), 'get' (check status)"),
        // create fields
        title: z
          .string()
          .optional()
          .describe("(create) Interview title (e.g., 'Approve document deletion')"),
        taskRunId: z
          .string()
          .optional()
          .describe("(create) Associated task ID"),
        expiresInSeconds: z
          .number()
          .int()
          .min(60)
          .max(86400)
          .optional()
          .describe("(create) Expiration time in seconds (60–86400, default 3600)"),
        questions: z
          .array(
            z.object({
              id: z.string().describe("Unique kebab-case question identifier (e.g., 'confirm-delete')"),
              type: z.enum(["text", "single_choice", "multi_choice", "number", "confirm"]).describe("Question type"),
              prompt: z.string().describe("The question text shown to the user"),
              required: z.boolean().optional().describe("Whether an answer is required (default false)"),
              options: z
                .array(z.object({ id: z.string(), label: z.string() }))
                .optional()
                .describe("(single_choice/multi_choice only) Array of options: [{id, label}]"),
              minLength: z.number().optional().describe("(text only) Minimum text length"),
              maxLength: z.number().optional().describe("(text only) Maximum text length"),
              min: z.number().optional().describe("(number only) Minimum value"),
              max: z.number().optional().describe("(number only) Maximum value"),
              integerOnly: z.boolean().optional().describe("(number only) Restrict to integers"),
              minSelections: z.number().optional().describe("(multi_choice only) Minimum selections"),
              maxSelections: z.number().optional().describe("(multi_choice only) Maximum selections"),
            }),
          )
          .optional()
          .describe("(create) Array of question objects"),
        // submit fields
        interviewId: z
          .string()
          .optional()
          .describe("(submit/get) Interview ID returned from create action"),
        responses: z
          .array(
            z.object({
              questionId: z.string(),
              value: z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]),
            }),
          )
          .optional()
          .describe("(submit) Array of answers: [{questionId, value}]"),
      },
    },
    async (input): Promise<CallToolResult> => {
      const timer = new OperationTimer();
      const traceId = generateTraceId();

      // Reshape flat input into the {action, payload} format the handler expects
      const raw = (input ?? {}) as Record<string, unknown>;
      const action = raw.action as string;

      let shaped: unknown;
      if (action === "create") {
        shaped = {
          action: "create",
          payload: {
            title: raw.title,
            taskRunId: raw.taskRunId,
            expiresInSeconds: raw.expiresInSeconds,
            questions: raw.questions,
          },
        };
      } else if (action === "submit") {
        shaped = {
          action: "submit",
          payload: {
            interviewId: raw.interviewId,
            responses: raw.responses,
          },
        };
      } else if (action === "get") {
        shaped = {
          action: "get",
          payload: {
            interviewId: raw.interviewId,
          },
        };
      } else {
        shaped = raw;
      }

      // Also try legacy normalizeToolCall path
      let normalized: unknown = shaped;
      try {
        const toolCall = normalizeToolCall(input, { taskRunId: traceId });
        normalized = JSON.parse(toolCall.input_params);
      } catch {
        // fallback: use the shaped input
      }

      const request = normalizeAskUserRequest(normalized);
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
