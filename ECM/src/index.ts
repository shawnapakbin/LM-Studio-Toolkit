import { ErrorCode, type ToolResponse } from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import {
  autoCompactNow,
  clearSession,
  deleteSegment,
  getSessionPolicy,
  listSegments,
  retrieveContext,
  setContinuousCompact,
  storeSegment,
  summarizeSession,
} from "./ecm";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3342);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-ecm-tool", version: "2.1.0" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "ecm",
    description:
      "Extended Context Memory tool. Store and retrieve memory segments via vector search to enable effective 1M token context.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "store_segment",
            "retrieve_context",
            "list_segments",
            "delete_segment",
            "clear_session",
            "summarize_session",
            "auto_compact_now",
            "set_continuous_compact",
            "get_session_policy",
          ],
        },
        sessionId: { type: "string" },
        type: {
          type: "string",
          enum: ["conversation_turn", "tool_output", "document", "reasoning", "summary"],
        },
        content: { type: "string" },
        importance: { type: "number" },
        metadata: { type: "object" },
        query: { type: "string" },
        topK: { type: "number" },
        maxTokens: { type: "number" },
        minScore: { type: "number" },
        limit: { type: "number" },
        offset: { type: "number" },
        segmentId: { type: "string" },
        keepNewest: { type: "number" },
        enabled: { type: "boolean" },
      },
      required: ["action"],
    },
  });
});

app.post("/tools/ecm", async (req: Request, res: Response) => {
  const { action, sessionId = "", ...rest } = req.body ?? {};

  if (!action) {
    return res.status(400).json({
      success: false,
      errorCode: "INVALID_INPUT",
      error: "Missing required field: action",
    });
  }

  let response: ToolResponse<unknown>;

  try {
    switch (action) {
      case "store_segment":
        response = await storeSegment({
          sessionId,
          type: rest.type,
          content: rest.content,
          importance: rest.importance,
          metadata: rest.metadata,
        });
        break;
      case "retrieve_context":
        response = await retrieveContext({
          sessionId,
          query: rest.query,
          topK: rest.topK,
          maxTokens: rest.maxTokens,
          minScore: rest.minScore,
        });
        break;
      case "list_segments":
        response = await listSegments({ sessionId, limit: rest.limit, offset: rest.offset });
        break;
      case "delete_segment":
        response = await deleteSegment({ sessionId, segmentId: rest.segmentId });
        break;
      case "clear_session":
        response = await clearSession({ sessionId });
        break;
      case "summarize_session":
        response = await summarizeSession({ sessionId, keepNewest: rest.keepNewest });
        break;
      case "auto_compact_now":
        response = await autoCompactNow({ sessionId, keepNewest: rest.keepNewest });
        break;
      case "set_continuous_compact":
        response = await setContinuousCompact({
          sessionId,
          enabled: rest.enabled,
          keepNewest: rest.keepNewest,
        });
        break;
      case "get_session_policy":
        response = await getSessionPolicy({ sessionId });
        break;
      default:
        return res
          .status(400)
          .json({ success: false, errorCode: "INVALID_INPUT", error: `Unknown action: ${action}` });
    }
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, errorCode: "EXECUTION_FAILED", error: String(err) });
  }

  const status = response.success
    ? 200
    : response.errorCode === ErrorCode.NOT_FOUND
      ? 404
      : response.errorCode === ErrorCode.INVALID_INPUT
        ? 400
        : 500;

  return res.status(status).json({ ...response, error: response.errorMessage });
});

export { app };

if (require.main === module) {
  app.listen(PORT, () => console.log(`LM Studio ECM Tool listening on http://localhost:${PORT}`));
}
