import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { openPythonIde, openPythonRepl, runPythonCode } from "./python-shell";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3343);

type PythonRunBody = {
  code?: string;
  cwd?: string;
  timeoutMs?: number;
};

type PythonOpenBody = {
  cwd?: string;
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
      "PythonShell endpoint exposing python_run_code, python_open_repl, and python_open_idle tool routes.",
    tools: [
      {
        name: "python_run_code",
        method: "POST",
        path: "/tools/python_run_code",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Python code executed with python -c" },
            cwd: { type: "string", description: "Optional working directory" },
            timeoutMs: { type: "number", description: "Optional timeout in milliseconds" },
          },
          required: ["code"],
        },
      },
      {
        name: "python_open_repl",
        method: "POST",
        path: "/tools/python_open_repl",
        parameters: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Optional working directory" },
          },
          required: [],
        },
      },
      {
        name: "python_open_idle",
        method: "POST",
        path: "/tools/python_open_idle",
        parameters: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Optional working directory" },
          },
          required: [],
        },
      },
    ],
  });
});

app.post("/tools/python_run_code", (req: Request<unknown, unknown, PythonRunBody>, res: Response) => {
  const code = req.body.code?.trim();
  if (!code) {
    res.status(400).json({
      success: false,
      errorCode: "INVALID_INPUT",
      errorMessage: "'code' is required.",
    });
    return;
  }

  const result = runPythonCode({
    code,
    cwd: req.body.cwd,
    timeoutMs: req.body.timeoutMs,
  });

  res.status(statusCodeFromResult(result as Record<string, unknown>)).json(result);
});

app.post("/tools/python_open_repl", (req: Request<unknown, unknown, PythonOpenBody>, res: Response) => {
  const result = openPythonRepl({ cwd: req.body.cwd });
  res.status(statusCodeFromResult(result as Record<string, unknown>)).json(result);
});

app.post("/tools/python_open_idle", (req: Request<unknown, unknown, PythonOpenBody>, res: Response) => {
  const result = openPythonIde({ cwd: req.body.cwd });
  res.status(statusCodeFromResult(result as Record<string, unknown>)).json(result);
});

export { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LM Studio PythonShell Tool listening on http://localhost:${PORT}`);
  });
}
