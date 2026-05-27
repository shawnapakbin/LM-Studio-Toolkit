import { ErrorCode, OperationTimer, createErrorResponse, generateTraceId } from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
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

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3338);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-ask-user-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "interview_user",
    description:
      "Creates and manages interview/clarification forms: create, submit, get. Purpose: clarification_only. Do NOT use this tool for permissioning execution of other tools. Tool-use approval must use each target tool's native approval token/session approval flow.",
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

app.get("/tools/approve/:interviewId", (req: Request, res: Response) => {
  const interviewId = req.params.interviewId;
  const timer = new OperationTimer();
  const traceId = generateTraceId();

  const successHtml = `<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #1e1e1e; color: #fff;">
          <div style="text-align: center; background: #2d2d2d; padding: 2rem 4rem; border-radius: 8px; border: 1px solid #4ade80;">
            <h1 style="color: #4ade80; margin-top: 0">✅ Approved</h1>
            <p style="font-size: 1.1rem; color: #ccc;">The action was approved successfully.</p>
            <p style="font-size: 1.1rem; margin-bottom: 0;">You may close this tab, return to LM Studio, and reply <strong>"proceed"</strong></p>
          </div>
        </body></html>`;

  try {
    // Check whether the interview already exists; if it was already answered, return success immediately.
    // If it doesn't exist yet, auto-create it so the submit below can succeed.
    const getResponse = handleAskUserRequest(
      { action: "get", payload: { interviewId } },
      timer.elapsed(),
      traceId,
    );

    if (getResponse.success) {
      const data = getResponse.data as { status?: string } | undefined;
      if (data?.status === "answered") {
        res.send(successHtml);
        return;
      }
    } else {
      // Interview doesn't exist yet — create it on-the-fly for this approval signature.
      const createResponse = handleAskUserRequest(
        {
          action: "create",
          payload: {
            id: interviewId,
            title: "Action Approval",
            questions: [{ id: "approve", type: "confirm", prompt: "Confirm this action?" }],
            expiresInSeconds: 900,
          },
        },
        timer.elapsed(),
        traceId,
      );

      if (!createResponse.success) {
        res.status(400).send(
          `<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #1e1e1e; color: #fff;">
          <div style="text-align: center; background: #2d2d2d; padding: 2rem 4rem; border-radius: 8px; border: 1px solid #ef4444;">
            <h1 style="color: #ef4444; margin-top: 0">❌ Approval Failed</h1>
            <p style="font-size: 1.1rem; color: #ccc;">${createResponse.errorMessage}</p>
          </div>
        </body></html>`,
        );
        return;
      }
    }

    const response = handleAskUserRequest(
      {
        action: "submit",
        payload: {
          interviewId,
          responses: [{ questionId: "approve", value: true }],
        },
      },
      timer.elapsed(),
      traceId,
    );

    if (response.success || response.errorMessage?.includes("no longer accepts responses")) {
      res.send(successHtml);
    } else {
      res.status(400).send(
        `<html><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #1e1e1e; color: #fff;">
          <div style="text-align: center; background: #2d2d2d; padding: 2rem 4rem; border-radius: 8px; border: 1px solid #ef4444;">
            <h1 style="color: #ef4444; margin-top: 0">❌ Approval Failed</h1>
            <p style="font-size: 1.1rem; color: #ccc;">${response.errorMessage}</p>
          </div>
        </body></html>`,
      );
    }
  } catch {
    res.status(500).send("Execution failed.");
  }
});

app.post(
  "/tools/interview_user",
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
        toolName: "interview_user",
        purpose: "clarification_only",
      });
    } catch {
      const error = createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        "Unexpected interview-user execution error.",
        timer.elapsed(),
        traceId,
      );

      res.status(500).json({
        ...error,
        error: error.errorMessage,
        toolName: "interview_user",
        purpose: "clarification_only",
      });
    }
  },
);

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio AskUser Tool listening on http://localhost:${PORT}`);
  });
}
