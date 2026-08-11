import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { evaluateExpression } from "llm-toolkit-calculator/dist/calculator";
import { z } from "zod";

type CalculateEngineeringInput = {
  expression: string;
  precision?: number;
};

const UNSAFE_PATTERN = /\b(import|require|eval)\b|Function\s*\(/;

export function registerCalculatorTool(server: McpServer): void {
  const DEFAULT_PRECISION = Number(process.env.CALCULATOR_DEFAULT_PRECISION ?? 12);
  const MAX_PRECISION = Number(process.env.CALCULATOR_MAX_PRECISION ?? 20);

  const calculateEngineeringInputSchema: Record<string, z.ZodTypeAny> = {
    expression: z
      .string()
      .min(1)
      .max(1000)
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

      // Input validation: expression length
      if (expression.length > 1000) {
        const errorResult = {
          success: false,
          expression,
          error: "Expression exceeds maximum length of 1000 characters",
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
          structuredContent: errorResult,
        };
      }

      // Input validation: unsafe patterns
      if (UNSAFE_PATTERN.test(expression)) {
        const errorResult = {
          success: false,
          expression,
          error: "Expression contains unsafe patterns",
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
          structuredContent: errorResult,
        };
      }

      // Precision clamping [2, 20]
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
}
