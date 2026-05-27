import {
  ErrorCode,
  OperationTimer,
  type ToolResponse,
  createErrorResponse,
  generateTraceId,
} from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { SessionApprovalController } from "../../shared/dist/sessionApproval";
import { defineSkill, deleteSkill, executeSkill, getSkill, listSkills } from "./skills";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3341);
const approval = new SessionApprovalController({
  toolName: "Skills",
  askUserEndpoint: process.env.SKILLS_ASK_USER_ENDPOINT,
  bypassEnvVarName: "SKILLS_BYPASS_APPROVAL",
});

const MUTATING_ACTIONS = new Set(["define_skill", "delete_skill", "execute_skill"]);

function getActionDetails(action: string, name?: string): string {
  switch (action) {
    case "define_skill":
      return `Skill '${name || "(unnamed)"}' will be created or updated.`;
    case "delete_skill":
      return `Skill '${name || "(by id)"}' will be permanently deleted.`;
    case "execute_skill":
      return `Skill '${name || "(unnamed)"}' will be executed, potentially producing side effects.`;
    default:
      return "Skill state may be modified.";
  }
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-skills-tool", version: "2.1.0" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "skills",
    description:
      "Persistent skill/playbook system. Define named skills with parameterized step templates, then execute them by name to get resolved step sequences.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["define_skill", "execute_skill", "get_skill", "list_skills", "delete_skill"],
          description: "The operation to perform.",
        },
        name: {
          type: "string",
          description:
            "(define_skill / get_skill / delete_skill / execute_skill) Kebab-case skill name.",
        },
        description: {
          type: "string",
          description: "(define_skill) Human-readable description.",
        },
        paramSchema: {
          type: "object",
          description: "(define_skill) JSON Schema for skill parameters.",
        },
        steps: {
          type: "array",
          description: "(define_skill) Ordered step sequence.",
        },
        params: {
          type: "object",
          description: "(execute_skill) Parameter values for interpolation.",
        },
        id: {
          type: "string",
          description: "(get_skill / delete_skill) Skill UUID (alternative to name).",
        },
        limit: {
          type: "number",
          description: "(list_skills) Max results (default 20).",
        },
        offset: {
          type: "number",
          description: "(list_skills) Pagination offset (default 0).",
        },
        approvalToken: {
          type: "string",
          description:
            "(mutating actions) Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
        },
        approvalInterviewId: {
          type: "string",
          description: "(mutating actions) AskUser interview ID for explicit approval.",
        },
        sessionId: {
          type: "string",
          description: "(mutating actions) Session identifier for allow-in-session approvals.",
        },
        taskRunId: {
          type: "string",
          description: "(mutating actions) Alternate session identity when sessionId is absent.",
        },
      },
      required: ["action"],
    },
  });
});

app.post("/tools/skills", async (req: Request, res: Response) => {
  const timer = new OperationTimer();
  const traceId = generateTraceId();

  const { action, approvalToken, approvalInterviewId, sessionId, taskRunId, ...fields } =
    req.body ?? {};

  if (!action) {
    const error = createErrorResponse(ErrorCode.INVALID_INPUT, "Missing required field: action");
    return res.status(400).json({ ...error, error: error.errorMessage });
  }

  try {
    // Route to the correct handler; use ToolResponse<unknown> to avoid generic variance issues
    let response: ToolResponse<unknown>;

    if (MUTATING_ACTIONS.has(action)) {
      const gate = await approval.ensureApproved({
        action: `skills:${action}`,
        details: getActionDetails(action, fields.name),
        approvalToken,
        approvalInterviewId,
        sessionId,
        taskRunId,
      });
      if (!gate.ok) {
        response = gate.response;
        const gateCode = response.success
          ? 200
          : response.errorCode === ErrorCode.POLICY_BLOCKED
            ? 403
            : response.errorCode === ErrorCode.NOT_FOUND
              ? 404
              : response.errorCode === ErrorCode.INVALID_INPUT
                ? 400
                : response.errorCode === ErrorCode.EXECUTION_FAILED
                  ? 500
                  : 400;
        return res.status(gateCode).json({
          ...response,
          timingMs: response.timingMs ?? timer.elapsed(),
          traceId: response.traceId ?? traceId,
          error: response.errorMessage,
        });
      }
    }

    switch (action) {
      case "define_skill":
        response = await defineSkill(fields);
        break;
      case "execute_skill":
        response = await executeSkill(fields);
        break;
      case "get_skill":
        response = await getSkill(fields);
        break;
      case "list_skills":
        response = await listSkills(fields);
        break;
      case "delete_skill":
        response = await deleteSkill(fields);
        break;
      default: {
        const error = createErrorResponse(ErrorCode.INVALID_INPUT, `Unknown action: ${action}`);
        return res.status(400).json({ ...error, error: error.errorMessage });
      }
    }

    const statusCode = response.success
      ? 200
      : response.errorCode === ErrorCode.NOT_FOUND
        ? 404
        : response.errorCode === ErrorCode.INVALID_INPUT
          ? 400
          : response.errorCode === ErrorCode.EXECUTION_FAILED
            ? 500
            : 400;

    return res.status(statusCode).json({
      ...response,
      timingMs: response.timingMs ?? timer.elapsed(),
      traceId: response.traceId ?? traceId,
      error: response.errorMessage,
    });
  } catch {
    const error = createErrorResponse(
      ErrorCode.EXECUTION_FAILED,
      "Unexpected skills tool execution error.",
      timer.elapsed(),
      traceId,
    );
    return res.status(500).json({ ...error, error: error.errorMessage });
  }
});

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio Skills Tool listening on http://localhost:${PORT}`);
  });
}
