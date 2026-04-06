import {
  ErrorCode,
  OperationTimer,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
  generateTraceId,
} from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { getRegistry } from "../../Observability/src/metrics";
import { evaluateExpression } from "./calculator";
import {
  DEFAULT_PRECISION,
  hasUnsafePatterns,
  isExpressionTooLong,
  isValidExpression,
  validatePrecision,
} from "./policy";

dotenv.config();

// Setup observability metrics
const metrics = getRegistry();
const executionCounter = metrics.counter(
  "calculator_evaluations_total",
  "Total calculator expression evaluations",
);
const durationHistogram = metrics.histogram(
  "calculator_duration_ms",
  "Calculator evaluation duration in milliseconds",
);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3335);

type CalculateRequest = {
  expression?: string;
  precision?: number;
};

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-calculator-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "calculate_engineering",
    description:
      "Evaluates engineering/math expressions including trig, logs, powers, units, and common symbols like °, π, ×, ÷, √, Ω.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "Math expression to evaluate, e.g. 'sin(30°)', 'sin(π/6)^2 + cos(π/6)^2', '20×log10(5)', '√2^10', '10 Ω * 2 A'.",
        },
        precision: {
          type: "number",
          description: "Significant digits for formatted output.",
        },
      },
      required: ["expression"],
    },
  });
});

app.post(
  "/tools/calculate_engineering",
  (req: Request<unknown, unknown, CalculateRequest>, res: Response) => {
    try {
      const timer = new OperationTimer();
      const traceId = generateTraceId();

      const expression = req.body.expression?.trim();

      if (!isValidExpression(expression)) {
        const errorResponse = createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "'expression' is required.",
          timer.elapsed(),
          traceId,
        );
        res.status(400).json({ ...errorResponse, error: errorResponse.errorMessage });
        return;
      }

      if (isExpressionTooLong(expression!)) {
        const errorResponse = createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "Expression is too long. Maximum 1000 characters allowed.",
          timer.elapsed(),
          traceId,
        );
        res.status(400).json({ ...errorResponse, error: errorResponse.errorMessage });
        return;
      }

      if (hasUnsafePatterns(expression!)) {
        const errorResponse = createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          "Expression contains potentially unsafe patterns.",
          timer.elapsed(),
          traceId,
        );
        res.status(403).json({ ...errorResponse, error: errorResponse.errorMessage });
        return;
      }

      const configuredDefault = Number(
        process.env.CALCULATOR_DEFAULT_PRECISION ?? DEFAULT_PRECISION,
      );
      const precision = validatePrecision(req.body.precision, configuredDefault);

      const result = evaluateExpression({ expression: expression!, precision });
      const timingMs = timer.elapsed();

      if (!result.success) {
        executionCounter.inc({ status: "error", errorCode: ErrorCode.EXECUTION_FAILED });
      } else {
        executionCounter.inc({ status: "success" });
        durationHistogram.observe(timingMs);
      }

      const response: ToolResponse = result.success
        ? createSuccessResponse(result, timingMs, traceId)
        : {
            success: false,
            errorCode: ErrorCode.EXECUTION_FAILED,
            errorMessage: result.error || "Calculation failed",
            data: result,
            timingMs,
            traceId,
          };

      // Backward compatibility: expose data fields at root + keep "error" field
      const responseData =
        response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : {};
      res.status(result.success ? 200 : 400).json({
        ...response,
        ...responseData,
        error: response.errorMessage,
      });
    } catch {
      const traceId = generateTraceId();
      const response = createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        "An unexpected error occurred",
        0,
        traceId,
      );
      res.status(500).json({ ...response, error: response.errorMessage });
    }
  },
);

// Export app for testing
export { app };

// Only start server if this is the main module
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio Calculator Tool listening on http://localhost:${PORT}`);
  });
}
