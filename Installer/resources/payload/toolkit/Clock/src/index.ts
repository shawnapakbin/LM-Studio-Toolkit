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
import { getClockSnapshot } from "./clock";
import { isLocaleTooLong, isTimeZoneTooLong } from "./policy";

dotenv.config();

// Setup observability metrics
const metrics = getRegistry();
const executionCounter = metrics.counter("clock_queries_total", "Total clock/datetime queries");
const durationHistogram = metrics.histogram(
  "clock_query_duration_ms",
  "Clock query duration in milliseconds",
);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3337);

type ClockRequestBody = {
  timeZone?: string;
  locale?: string;
};

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-clock-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "get_current_datetime",
    description:
      "Returns the current date, time, and timezone details. Optionally converts to a requested IANA timezone.",
    parameters: {
      type: "object",
      properties: {
        timeZone: {
          type: "string",
          description:
            "Optional IANA timezone, e.g. 'UTC', 'America/New_York', 'Asia/Kolkata'. Defaults to system timezone.",
        },
        locale: {
          type: "string",
          description: "Optional locale used for weekday/timezone naming, e.g. 'en-US'.",
        },
      },
      required: [],
    },
  });
});

app.post(
  "/tools/get_current_datetime",
  (req: Request<unknown, unknown, ClockRequestBody>, res: Response) => {
    const timer = new OperationTimer();
    const traceId = generateTraceId();

    const timeZone = req.body.timeZone?.trim();
    const locale = req.body.locale?.trim();

    // Validate input lengths to prevent DoS
    if (timeZone && isTimeZoneTooLong(timeZone)) {
      const errorResponse = createErrorResponse(
        ErrorCode.INVALID_INPUT,
        "Timezone string is too long.",
        timer.elapsed(),
        traceId,
      );
      res.status(400).json({ ...errorResponse, error: errorResponse.errorMessage });
      return;
    }

    if (locale && isLocaleTooLong(locale)) {
      const errorResponse = createErrorResponse(
        ErrorCode.INVALID_INPUT,
        "Locale string is too long.",
        timer.elapsed(),
        traceId,
      );
      res.status(400).json({ ...errorResponse, error: errorResponse.errorMessage });
      return;
    }

    const result = getClockSnapshot({
      timeZone,
      locale,
    });

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
          errorMessage: result.error || "Failed to get clock snapshot",
          data: result,
          timingMs,
          traceId,
        };

    const responseData =
      response.data && typeof response.data === "object"
        ? (response.data as Record<string, unknown>)
        : {};

    // Backward compatibility: expose data fields at root + keep "error" field
    res.status(result.success ? 200 : 400).json({
      ...response,
      ...responseData,
      error: response.errorMessage,
    });
  },
);

// Export app for testing
export { app };

// Only start server if this is the main module
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio Clock Tool listening on http://localhost:${PORT}`);
  });
}
