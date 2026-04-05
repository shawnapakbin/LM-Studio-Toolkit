import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { evaluateExpression } from "./calculator";

dotenv.config();

const DEFAULT_PRECISION = Number(process.env.CALCULATOR_DEFAULT_PRECISION ?? 12);
const MAX_PRECISION = Number(process.env.CALCULATOR_MAX_PRECISION ?? 20);

type CalculateEngineeringInput = {
  expression: string;
  precision?: number;
};

const server = new McpServer({
  name: "lm-studio-calculator-tool",
  version: "1.0.0",
});

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

const registerTool = server.registerTool.bind(server) as unknown as (
  name: string,
  config: { description: string; inputSchema: unknown },
  handler: (input: unknown) => Promise<CallToolResult>,
) => void;

registerTool(
  "calculate_engineering",
  {
    description:
      "Evaluates engineering/math expressions including trig, logs, powers, units, and symbols like °, π, ×, ÷, √, Ω.",
    inputSchema: calculateEngineeringInputSchema,
  },
  async (input): Promise<CallToolResult> => {
    const { expression, precision } = input as CalculateEngineeringInput;
    const effectivePrecision = Number.isFinite(precision)
      ? Math.min(Math.max(Math.trunc(Number(precision)), 2), MAX_PRECISION)
      : DEFAULT_PRECISION;

    const result = evaluateExpression({
      expression,
      precision: effectivePrecision,
    });

    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Calculator MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});
