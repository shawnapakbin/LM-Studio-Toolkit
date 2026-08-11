import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationTimer, generateTraceId } from "@shared/types";
import { handleAskUserRequest } from "llm-toolkit-ask-user/dist/ask-user";
import type { AskUserRequest } from "llm-toolkit-ask-user/dist/types";
import { z } from "zod";

const interviewUserInputSchema: Record<string, z.ZodTypeAny> = {
  action: z
    .enum(["create", "submit", "get"])
    .describe(
      "The operation to perform: 'create' (new interview), 'submit' (answers), 'get' (check status)",
    ),
  title: z.string().optional().describe("(create) Interview title"),
  taskRunId: z.string().optional().describe("(create) Associated task ID"),
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
        id: z.string(),
        type: z.enum(["text", "single_choice", "multi_choice", "number", "confirm"]),
        prompt: z.string(),
        required: z.boolean().optional(),
        options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
      }),
    )
    .optional()
    .describe("(create) Array of question objects"),
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
};

export function registerAskUserTool(server: McpServer): void {
  // Read env vars (used internally by ask-user module via process.env)
  // These are documented here for clarity on what the tool depends on:
  // ASK_USER_DB_PATH, ASK_USER_DEFAULT_EXPIRES_SECONDS,
  // ASK_USER_MAX_EXPIRES_SECONDS, ASK_USER_MAX_QUESTIONS

  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (input: unknown) => Promise<CallToolResult>,
  ) => void;

  registerTool(
    "interview_user",
    {
      description:
        "Structured interview tool for collecting human input/approval. Actions: 'create' (new interview with questions), 'submit' (provide answers), 'get' (check status/responses). Interview lifecycle: pending → answered | expired | cancelled.",
      inputSchema: interviewUserInputSchema,
    },
    async (input): Promise<CallToolResult> => {
      const timer = new OperationTimer();
      const traceId = generateTraceId();

      const raw = (input ?? {}) as Record<string, unknown>;
      const action = raw.action as string;

      let request: AskUserRequest;
      if (action === "create") {
        request = {
          action: "create",
          payload: {
            title: raw.title,
            taskRunId: raw.taskRunId,
            expiresInSeconds: raw.expiresInSeconds,
            questions: raw.questions,
          },
        } as AskUserRequest;
      } else if (action === "submit") {
        request = {
          action: "submit",
          payload: {
            interviewId: raw.interviewId,
            responses: raw.responses,
          },
        } as AskUserRequest;
      } else if (action === "get") {
        request = {
          action: "get",
          payload: {
            interviewId: raw.interviewId,
          },
        } as AskUserRequest;
      } else {
        request = { action, payload: {} } as AskUserRequest;
      }

      const result = handleAskUserRequest(request, timer.elapsed(), traceId);

      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
