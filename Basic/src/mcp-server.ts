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

  const payload = (() => {
    if (raw.payload && typeof raw.payload === "object") {
      return { ...(raw.payload as Record<string, unknown>) } as Record<string, unknown>;
    }

    // Some models/tool routers send payload as a stringified JSON object.
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

  // --- AskUser tool (interview_user) ---
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
