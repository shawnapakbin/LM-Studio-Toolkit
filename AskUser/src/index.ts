import { ErrorCode, OperationTimer, createErrorResponse, generateTraceId } from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { handleAskUserRequest } from "./ask-user";
import { AskUserStore } from "./store";
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

const DB_PATH = process.env.ASK_USER_DB_PATH ?? "./memory.db";
const store = new AskUserStore(
  DB_PATH === ":memory:" || path.isAbsolute(DB_PATH) ? DB_PATH : path.resolve(__dirname, DB_PATH),
);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve the interview UI static files
app.use("/ui", express.static(path.resolve(__dirname, "..", "ui")));

const PORT = Number(process.env.PORT ?? 3338);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-ask-user-tool", version: "2.2.6" });
});

// Returns all pending interviews for the UI to render
app.get("/api/interviews/pending", (_req: Request, res: Response) => {
  try {
    const pending = store.listPending();
    const interviews = pending.map((record) => ({
      id: record.id,
      title: record.title,
      status: record.status,
      questions: JSON.parse(record.questions_json),
      createdAt: record.created_at,
      expiresAt: record.expires_at,
    }));
    res.json({ interviews });
  } catch {
    res.status(500).json({ error: "Failed to fetch pending interviews" });
  }
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
      const response = handleAskUserRequest(
        normalizeAskUserRequest(req.body),
        timer.elapsed(),
        traceId,
      );
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
