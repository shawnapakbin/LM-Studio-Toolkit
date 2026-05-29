import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { SessionApprovalController } from "../../shared/dist/sessionApproval";
import { openPythonIde, openPythonRepl, runPythonCode } from "./python-shell";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3343);
const approval = new SessionApprovalController({
  toolName: "PythonShell",
  askUserEndpoint: process.env.PYTHON_SHELL_ASK_USER_ENDPOINT,
  bypassEnvVarName: "PYTHON_SHELL_BYPASS_APPROVAL",
});

type PythonRunBody = {
  code?: string;
  cwd?: string;
  timeoutMs?: number;
  approvalToken?: string;
  approvalInterviewId?: string;
  sessionId?: string;
  taskRunId?: string;
};

type PythonOpenBody = {
  cwd?: string;
  approvalToken?: string;
  approvalInterviewId?: string;
  sessionId?: string;
  taskRunId?: string;
};

function statusCodeFromResult(result: Record<string, unknown>): number {
  if (result.success === true) {
    return 200;
  }

  const code = result.errorCode;
  if (code === "POLICY_BLOCKED") {
    return 403;
  }
  if (code === "PYTHON_NOT_FOUND") {
    return 412;
  }
  return 400;
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-python-shell-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "python_shell",
    description:
      "PythonShell endpoint exposing python_run_code, python_open_repl, and python_open_idle tool routes. python_open_repl launches the plain terminal Python REPL, while python_open_idle launches the IDLE GUI via python -m idlelib.",
    tools: [
      {
        name: "python_run_code",
        method: "POST",
        path: "/tools/python_run_code",
        description: "Run non-interactive Python code with python -c and return stdout/stderr.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Python code executed with python -c" },
            cwd: { type: "string", description: "Optional working directory" },
            timeoutMs: { type: "number", description: "Optional timeout in milliseconds" },
            approvalToken: {
              type: "string",
              description:
                "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
            },
            approvalInterviewId: {
              type: "string",
              description: "AskUser interview ID used to verify explicit approval.",
            },
            sessionId: { type: "string", description: "Session ID for allow-in-session." },
            taskRunId: {
              type: "string",
              description: "Alternate session identity when sessionId is unavailable.",
            },
          },
          required: ["code"],
        },
      },
      {
        name: "python_open_repl",
        method: "POST",
        path: "/tools/python_open_repl",
        description:
          "Launch the plain terminal Python REPL in a visible shell window (not IDLE GUI).",
        parameters: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Optional working directory" },
            approvalToken: {
              type: "string",
              description:
                "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
            },
            approvalInterviewId: {
              type: "string",
              description: "AskUser interview ID used to verify explicit approval.",
            },
            sessionId: { type: "string", description: "Session ID for allow-in-session." },
            taskRunId: {
              type: "string",
              description: "Alternate session identity when sessionId is unavailable.",
            },
          },
          required: [],
        },
      },
      {
        name: "python_open_idle",
        method: "POST",
        path: "/tools/python_open_idle",
        description:
          "Launch Python IDLE GUI shell/editor via python -m idlelib (not the plain terminal REPL).",
        parameters: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Optional working directory" },
            approvalToken: {
              type: "string",
              description:
                "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
            },
            approvalInterviewId: {
              type: "string",
              description: "AskUser interview ID used to verify explicit approval.",
            },
            sessionId: { type: "string", description: "Session ID for allow-in-session." },
            taskRunId: {
              type: "string",
              description: "Alternate session identity when sessionId is unavailable.",
            },
          },
          required: [],
        },
      },
    ],
  });
});

app.post(
  "/tools/python_run_code",
  async (req: Request<unknown, unknown, PythonRunBody>, res: Response) => {
    const code = req.body.code?.trim();
    if (!code) {
      res.status(400).json({
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "'code' is required.",
      });
      return;
    }

    const gate = await approval.ensureApproved({
      action: "python_shell:python_run_code",
      details: `Python code will be executed in cwd '${req.body.cwd || "workspace root"}'.`,
      approvalToken: req.body.approvalToken,
      approvalInterviewId: req.body.approvalInterviewId,
      sessionId: req.body.sessionId,
      taskRunId: req.body.taskRunId,
    });
    if (!gate.ok) {
      const statusCode = gate.response.success
        ? 200
        : gate.response.errorCode === "POLICY_BLOCKED"
          ? 403
          : 400;
      res.status(statusCode).json(gate.response);
      return;
    }

    const result = runPythonCode({
      code,
      cwd: req.body.cwd,
      timeoutMs: req.body.timeoutMs,
    });

    res.status(statusCodeFromResult(result as Record<string, unknown>)).json(result);
  },
);

app.post(
  "/tools/python_open_repl",
  async (req: Request<unknown, unknown, PythonOpenBody>, res: Response) => {
    const gate = await approval.ensureApproved({
      action: "python_shell:python_open_repl",
      details: `A visible Python REPL will be launched in cwd '${req.body.cwd || "workspace root"}'.`,
      approvalToken: req.body.approvalToken,
      approvalInterviewId: req.body.approvalInterviewId,
      sessionId: req.body.sessionId,
      taskRunId: req.body.taskRunId,
    });
    if (!gate.ok) {
      const statusCode = gate.response.success
        ? 200
        : gate.response.errorCode === "POLICY_BLOCKED"
          ? 403
          : 400;
      res.status(statusCode).json(gate.response);
      return;
    }

    const result = openPythonRepl({ cwd: req.body.cwd });
    res.status(statusCodeFromResult(result as Record<string, unknown>)).json(result);
  },
);

app.post(
  "/tools/python_open_idle",
  async (req: Request<unknown, unknown, PythonOpenBody>, res: Response) => {
    const gate = await approval.ensureApproved({
      action: "python_shell:python_open_idle",
      details: `Python IDLE will be launched in cwd '${req.body.cwd || "workspace root"}'.`,
      approvalToken: req.body.approvalToken,
      approvalInterviewId: req.body.approvalInterviewId,
      sessionId: req.body.sessionId,
      taskRunId: req.body.taskRunId,
    });
    if (!gate.ok) {
      const statusCode = gate.response.success
        ? 200
        : gate.response.errorCode === "POLICY_BLOCKED"
          ? 403
          : 400;
      res.status(statusCode).json(gate.response);
      return;
    }

    const result = openPythonIde({ cwd: req.body.cwd });
    res.status(statusCodeFromResult(result as Record<string, unknown>)).json(result);
  },
);

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio PythonShell Tool listening on http://localhost:${PORT}`);
  });
}
