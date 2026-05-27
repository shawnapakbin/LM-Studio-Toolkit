#!/usr/bin/env node
import cors from "cors";
import "dotenv/config";
import type { ToolResponse } from "@shared/types";
import express, { type Request, type Response } from "express";
import { clearSession, getStatus, onUserTurn, storeSegment } from "./ecm";

const PORT = Number(process.env.ECM_PORT ?? 3342);

type EcmAction = "on_user_turn" | "store_segment" | "clear_session" | "get_status";

const VALID_ACTIONS: readonly EcmAction[] = [
  "on_user_turn",
  "store_segment",
  "clear_session",
  "get_status",
];

async function dispatch(
  action: EcmAction,
  body: Record<string, unknown>,
): Promise<ToolResponse<unknown>> {
  switch (action) {
    case "on_user_turn":
      return onUserTurn(body);
    case "store_segment":
      return storeSegment(body);
    case "clear_session":
      return clearSession(body);
    case "get_status":
      return getStatus(body);
  }
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", tool: "ecm", version: "3.0.0" });
  });

  app.get("/tool-schema", (_req: Request, res: Response) => {
    res.json({
      name: "ecm",
      description:
        "Enhanced Context Memory. Compacts older conversation segments into a highlights summary when context approaches the model's limit.",
      actions: VALID_ACTIONS,
    });
  });

  app.post("/tools/ecm", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = body.action;
    if (typeof action !== "string" || !VALID_ACTIONS.includes(action as EcmAction)) {
      res.status(400).json({
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: `action must be one of: ${VALID_ACTIONS.join(", ")}`,
      });
      return;
    }
    try {
      const result = await dispatch(action as EcmAction, body);
      const status = result.success ? 200 : result.errorCode === "INVALID_INPUT" ? 400 : 500;
      res.status(status).json(result);
    } catch (err) {
      res.status(500).json({
        success: false,
        errorCode: "EXECUTION_FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    process.stderr.write(`[ECM] HTTP server listening on http://localhost:${PORT}\n`);
  });
}
