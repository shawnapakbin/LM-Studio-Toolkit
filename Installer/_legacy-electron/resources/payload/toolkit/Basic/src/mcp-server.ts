import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationTimer, generateTraceId } from "@shared/types";
import dotenv from "dotenv";
import { z } from "zod";
import { handleAskUserRequest } from "../../AskUser/dist/ask-user";
import type { AskUserRequest } from "../../AskUser/dist/types";
import { evaluateExpression } from "../../Calculator/dist/calculator";
import { getClockSnapshot } from "../../Clock/dist/clock";
import { normalizeToolCall } from "../../shared/dist/toolCallNormalizer";

dotenv.config();

const DEFAULT_PRECISION = Number(process.env.CALCULATOR_DEFAULT_PRECISION ?? 12);
const MAX_PRECISION = Number(process.env.CALCULATOR_MAX_PRECISION ?? 20);

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

export function createBasicMcpServer() {
  const server = new McpServer({
    name: "lm-studio-basic-tools",
    version: "1.0.0",
  });

  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (input: unknown) => Promise<CallToolResult>,
  ) => void;

  // --- Clock tool ---
  const getCurrentDatetimeInputSchema: Record<string, z.ZodTypeAny> = {
    timeZone: z
      .string()
      .optional()
      .describe("Optional IANA timezone such as 'UTC', 'America/New_York', or 'Asia/Kolkata'."),
    locale: z.string().optional().describe("Optional locale for readable names, e.g. 'en-US'."),
  };

  registerTool(
    "get_current_datetime",
    {
      description:
        "Returns current date/time/timezone information, optionally for a specific IANA timezone. Always allowed — no permission prompts or approval tokens required.",
      inputSchema: getCurrentDatetimeInputSchema,
    },
    async (input): Promise<CallToolResult> => {
      const { timeZone, locale } = input as { timeZone?: string; locale?: string };
      const result = getClockSnapshot({ timeZone, locale });
      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // --- Calculator tool ---
  const calculateEngineeringInputSchema: Record<string, z.ZodTypeAny> = {
    expression: z
      .string()
      .min(1)
      .describe(
        "Math expression to evaluate, e.g. sin(30°), sin(π/6), 20×log10(5), √(2)^10, 10 Ω * 2 A.",
      ),
    precision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Significant digits for formatted output."),
  };

  registerTool(
    "calculate_engineering",
    {
      description:
        "Evaluates engineering/math expressions including trig, logs, powers, units, and symbols like °, π, ×, ÷, √, Ω. Always allowed — no permission prompts or approval tokens required.",
      inputSchema: calculateEngineeringInputSchema,
    },
    async (input): Promise<CallToolResult> => {
      const { expression, precision } = input as { expression: string; precision?: number };
      const effectivePrecision = Number.isFinite(precision)
        ? Math.min(Math.max(Math.trunc(Number(precision)), 2), MAX_PRECISION)
        : DEFAULT_PRECISION;
      const result = evaluateExpression({ expression, precision: effectivePrecision });
      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  // --- AskUser tool ---
  registerTool(
    "interview_user",
    {
      description:
        "Creates and manages interview/clarification forms: create, submit, get. Purpose: clarification_only. Do NOT use this tool for permissioning execution of other tools. Tool-use approval must use each target tool's native approval token/session approval flow. Always allowed — no permission prompts or approval tokens required.",
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
              idempotencyKey: z
                .string()
                .optional()
                .describe("Unique key for idempotent request handling on retries"),
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
      let normalized: unknown = input;
      try {
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
  const server = createBasicMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Basic MCP server running on stdio");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("MCP server startup failed:", error);
    process.exit(1);
  });
}
