import { ErrorCode, OperationTimer, createErrorResponse, generateTraceId } from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { handleAskUserRequest } from "./ask-user";
import type { AskUserRequest } from "./types";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3338);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-ask-user-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "ask_user_interview",
    description: "Creates and collects interview responses for planning and clarification.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "submit", "get"],
          description: "Operation to perform.",
        },
        payload: {
          type: "object",
          description: "Action-specific payload.",
        },
      },
      required: ["action", "payload"],
    },
  });
});

app.post(
  "/tools/ask_user_interview",
  (req: Request<unknown, unknown, AskUserRequest>, res: Response) => {
    const timer = new OperationTimer();
    const traceId = generateTraceId();

    try {
      const response = handleAskUserRequest(req.body, timer.elapsed(), traceId);
      const responseData =
        response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : {};
      res.status(response.success ? 200 : 400).json({
        ...response,
        ...responseData,
        error: response.errorMessage,
      });
    } catch {
      const error = createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        "Unexpected ask-user execution error.",
        timer.elapsed(),
        traceId,
      );

      res.status(500).json({ ...error, error: error.errorMessage });
    }
  },
);

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio AskUser Tool listening on http://localhost:${PORT}`);
  });
}
