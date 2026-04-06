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
import { defineSkill, deleteSkill, executeSkill, getSkill, listSkills } from "./skills";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3341);

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
      },
      required: ["action"],
    },
  });
});

app.post("/tools/skills", async (req: Request, res: Response) => {
  const timer = new OperationTimer();
  const traceId = generateTraceId();

  const { action, ...fields } = req.body ?? {};

  if (!action) {
    const error = createErrorResponse(ErrorCode.INVALID_INPUT, "Missing required field: action");
    return res.status(400).json({ ...error, error: error.errorMessage });
  }

  try {
    // Route to the correct handler; use ToolResponse<unknown> to avoid generic variance issues
    let response: ToolResponse<unknown>;

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
