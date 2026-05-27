import { ErrorCode, type ToolResponse } from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { SessionApprovalController } from "../../shared/dist/sessionApproval";
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
const approval = new SessionApprovalController({
  toolName: "ECM",
  askUserEndpoint: process.env.ECM_ASK_USER_ENDPOINT,
  bypassEnvVarName: "ECM_BYPASS_APPROVAL",
});

const MUTATING_ACTIONS = new Set([
  "store_segment",
  "delete_segment",
  "clear_session",
  "summarize_session",
  "auto_compact_now",
  "set_continuous_compact",
]);

function getActionDetails(action: string, sessionId: string): string {
  switch (action) {
    case "store_segment":
      return `A new memory segment will be persisted for session '${sessionId || "default"}'.`;
    case "delete_segment":
      return `A memory segment will be permanently deleted from session '${sessionId || "default"}'.`;
    case "clear_session":
      return `All memory segments in session '${sessionId || "default"}' will be deleted.`;
    case "summarize_session":
      return `Session '${sessionId || "default"}' history will be compacted into summary segments.`;
    case "auto_compact_now":
      return `Immediate compaction will mutate stored memory for session '${sessionId || "default"}'.`;
    case "set_continuous_compact":
      return `Continuous compaction policy will be updated for session '${sessionId || "default"}'.`;
    default:
      return "ECM state will be modified.";
  }
}

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
        includeEmbeddings: { type: "boolean" },
        query: { type: "string" },
        topK: { type: "number" },
        maxTokens: { type: "number" },
        minScore: { type: "number" },
        limit: { type: "number" },
        offset: { type: "number" },
        segmentId: { type: "string" },
        keepNewest: { type: "number" },
        enabled: { type: "boolean" },
        approvalToken: { type: "string" },
        approvalInterviewId: { type: "string" },
        taskRunId: { type: "string" },
      },
      required: ["action"],
    },
  });
});

app.post("/tools/ecm", async (req: Request, res: Response) => {
  const {
    action,
    sessionId = "",
    approvalToken,
    approvalInterviewId,
    taskRunId,
    ...rest
  } = req.body ?? {};

  if (!action) {
    return res.status(400).json({
      success: false,
      errorCode: "INVALID_INPUT",
      error: "Missing required field: action",
    });
  }

  let response: ToolResponse<unknown>;

  try {
    if (MUTATING_ACTIONS.has(action)) {
      const gate = await approval.ensureApproved({
        action: `ecm:${action}`,
        details: getActionDetails(action, sessionId),
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        response = gate.response;
        const status = response.success
          ? 200
          : response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : response.errorCode === ErrorCode.INVALID_INPUT
              ? 400
              : response.errorCode === ErrorCode.NOT_FOUND
                ? 404
                : 500;
        return res.status(status).json({ ...response, error: response.errorMessage });
      }
    }

    switch (action) {
      case "store_segment":
        response = await storeSegment({
          sessionId,
          type: rest.type,
          content: rest.content,
          importance: rest.importance,
          metadata: rest.metadata,
          includeEmbeddings: rest.includeEmbeddings,
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
        response = await listSegments({
          sessionId,
          limit: rest.limit,
          offset: rest.offset,
          includeEmbeddings: rest.includeEmbeddings,
        });
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
    : response.errorCode === ErrorCode.POLICY_BLOCKED
      ? 403
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
