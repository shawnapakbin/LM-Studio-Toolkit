import { exec } from "child_process";
import { platform } from "os";
import {
  ErrorCode,
  OperationTimer,
  type ToolResponse,
  createErrorResponse,
  createSuccessResponse,
  generateTraceId,
} from "@shared/types";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { getRegistry } from "llm-toolkit-observability";
import {
  DEFAULT_MAX_OUTPUT_CHARS,
  WORKSPACE_ROOT,
  isCommandBlocked,
  resolveSafeCwd,
  truncateOutput,
} from "./policy";
import { runPunchout } from "./punchout";

dotenv.config();

// Setup observability metrics
const metrics = getRegistry();
const executionCounter = metrics.counter(
  "terminal_command_executions_total",
  "Total terminal command executions",
);
const durationHistogram = metrics.histogram(
  "terminal_command_duration_ms",
  "Terminal command execution duration in milliseconds",
);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3333);
const DEFAULT_TIMEOUT_MS = Number(process.env.TERMINAL_DEFAULT_TIMEOUT_MS ?? 60000);
const MAX_TIMEOUT_MS = Number(process.env.TERMINAL_MAX_TIMEOUT_MS ?? 120000);
const MAX_OUTPUT_CHARS = DEFAULT_MAX_OUTPUT_CHARS;

// Auto-detect operating system
const OPERATING_SYSTEM = (() => {
  const p = platform();
  if (p === "win32") return "Windows";
  if (p === "darwin") return "macOS";
  if (p === "linux") return "Linux";
  return "Unknown";
})();

const OS_SPECIFIC_COMMANDS = (() => {
  if (OPERATING_SYSTEM === "Windows") {
    return {
      list_files: "dir",
      list_files_detailed: "dir /s",
      current_dir: "cd",
      change_dir: "cd path\\to\\dir",
      copy_file: "copy source dest",
      delete_file: "del file",
      find_files: "findstr /S pattern .",
      view_file: "type file.txt",
    };
  }
  if (OPERATING_SYSTEM === "macOS" || OPERATING_SYSTEM === "Linux") {
    return {
      list_files: "ls -la",
      list_files_detailed: "find . -type f",
      current_dir: "pwd",
      change_dir: "cd path/to/dir",
      copy_file: "cp source dest",
      delete_file: "rm file",
      find_files: "find . -name '*.ts'",
      view_file: "cat file.txt",
    };
  }
  return {};
})();

type ExecuteRequest = {
  command?: string;
  timeoutMs?: number;
  cwd?: string;
  punchout?: boolean;
};

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "lm-studio-terminal-tool" });
});

app.get("/tool-schema", (_req: Request, res: Response) => {
  res.json({
    name: "run_terminal_command",
    operating_system: OPERATING_SYSTEM,
    description: `Executes a terminal command on the local machine (${OPERATING_SYSTEM}) and returns stdout/stderr. Use this to run build tools, tests, scripts, and system utilities. IMPORTANT: Use only ${OPERATING_SYSTEM} commands—do NOT use commands from other operating systems (e.g., do NOT use 'ls' on Windows; use 'dir' instead).`,
    usage_guide: {
      step1: "Decide what task to accomplish (e.g., list files, compile code, run tests).",
      step2:
        "Write the exact terminal command for that task USING COMMANDS APPROPRIATE FOR THIS OPERATING SYSTEM.",
      step3: "Call this tool with 'command' parameter (timeoutMs is optional; default 60 seconds).",
      step4: "Check 'success' flag. If false, read 'stderr' and 'code' to understand the failure.",
      step5: "If stdout is large, it is truncated; use piping or redirection to filter output.",
    },
    os_specific_commands: OS_SPECIFIC_COMMANDS,
    examples: {
      ok_list_files: { command: OS_SPECIFIC_COMMANDS.list_files || "ls -la" },
      ok_run_test: { command: "npm test", timeoutMs: 30000 },
      ok_current_dir: { command: OS_SPECIFIC_COMMANDS.current_dir || "pwd" },
      ok_run_script: { command: "npm run build", cwd: "/path/to/project" },
      warning_os_mismatch: `This ${OPERATING_SYSTEM} terminal CANNOT run commands from other OSs. E.g., 'ls' works on Linux/macOS but NOT on Windows. Use 'dir' on Windows instead.`,
      bad_interactive:
        "Do NOT use interactive commands (e.g., 'node' repl, 'python' shell, 'vim'). They will hang.",
      bad_wrong_os:
        "Do NOT use Linux commands on Windows or vice versa. Match the operating system.",
      bad_no_validation:
        "Do NOT assume a command works without checking success/stderr. Always read feedback.",
    },
    response_fields: {
      success: "true if exit code was 0, false otherwise.",
      code: "Exit code from the command (0 = success, non-zero = error).",
      signal: "Signal name if process was killed (e.g., SIGTERM, SIGKILL).",
      stdout: "Standard output text (may be truncated if very large).",
      stderr: "Standard error text (check this first if success=false).",
      timeoutMs: "Actual timeout used (capped at 120 seconds max).",
    },
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: `The shell command to execute for ${OPERATING_SYSTEM}. Use ONLY commands that work on ${OPERATING_SYSTEM}. For example: on Windows use 'dir', 'type', 'findstr'; on Mac/Linux use 'ls', 'cat', 'grep'. Do NOT use interactive commands (vim, node repl, python shell).`,
        },
        timeoutMs: {
          type: "number",
          description:
            "Timeout in milliseconds (1–120000). Default is 60000 (60 seconds). Increase for slow builds/tests.",
        },
        cwd: {
          type: "string",
          description:
            "Working directory for the command. Defaults to current directory. Use absolute paths to be explicit.",
        },
        punchout: {
          type: "boolean",
          description:
            "When true, opens a visible terminal window so the user can watch the command run. The terminal is reused if still open; otherwise a new window is launched. stdout/stderr are NOT captured—output appears only in the terminal window.",
        },
      },
      required: ["command"],
    },
  });
});

app.post(
  "/tools/run_terminal_command",
  (req: Request<unknown, unknown, ExecuteRequest>, res: Response) => {
    try {
      const timer = new OperationTimer();
      const traceId = generateTraceId();
      const command = req.body.command?.trim();

      if (!command) {
        const response = createErrorResponse(
          ErrorCode.INVALID_INPUT,
          "'command' is required.",
          timer.elapsed(),
          traceId,
        );
        executionCounter.inc({ status: "error", errorCode: ErrorCode.INVALID_INPUT });
        res.status(400).json(response);
        return;
      }

      if (isCommandBlocked(command)) {
        const response = createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          "Command blocked by terminal safety policy.",
          timer.elapsed(),
          traceId,
        );
        executionCounter.inc({ status: "error", errorCode: ErrorCode.POLICY_BLOCKED });
        res.status(403).json(response);
        return;
      }

      const safeCwd = resolveSafeCwd(WORKSPACE_ROOT, req.body.cwd);
      if (!safeCwd.ok) {
        const response = createErrorResponse(
          ErrorCode.POLICY_BLOCKED,
          safeCwd.message,
          timer.elapsed(),
          traceId,
        );
        executionCounter.inc({ status: "error", errorCode: ErrorCode.POLICY_BLOCKED });
        res.status(403).json(response);
        return;
      }

      const timeoutFromReq = Number(req.body.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(timeoutFromReq)
        ? Math.min(Math.max(timeoutFromReq, 1), MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

      // ---------------------------------------------------------------
      // Punchout mode: launch a visible terminal window and return early.
      // The command runs asynchronously; stdout/stderr are shown in the
      // terminal window rather than captured here.
      // ---------------------------------------------------------------
      if (req.body.punchout) {
        try {
          const result = runPunchout(command, safeCwd.cwd);
          executionCounter.inc({ status: "success", code: "0" });
          res.status(200).json({
            success: true,
            punchout: true,
            reused: result.reused,
            pid: result.pid,
            message: result.message,
          });
        } catch (punchoutError) {
          const response = createErrorResponse(
            ErrorCode.EXECUTION_FAILED,
            punchoutError instanceof Error ? punchoutError.message : "Punchout failed.",
            timer.elapsed(),
            traceId,
          );
          executionCounter.inc({ status: "error", errorCode: ErrorCode.EXECUTION_FAILED });
          res.status(500).json(response);
        }
        return;
      }

      exec(
        command,
        {
          timeout: timeoutMs,
          cwd: safeCwd.cwd,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const duration = timer.elapsed();
          const truncatedStdout = truncateOutput(stdout, MAX_OUTPUT_CHARS);
          const truncatedStderr = truncateOutput(stderr, MAX_OUTPUT_CHARS);

          const data = {
            code: error && "code" in error ? error.code : 0,
            signal: error && "signal" in error ? error.signal : null,
            stdout: truncatedStdout,
            stderr: truncatedStderr,
            policy: {
              workspaceRoot: WORKSPACE_ROOT,
              maxOutputChars: MAX_OUTPUT_CHARS,
            },
            timeoutMs,
          };

          if (error) {
            executionCounter.inc({ status: "error", errorCode: ErrorCode.EXECUTION_FAILED });
          } else {
            executionCounter.inc({ status: "success", code: String(data.code) });
          }
          durationHistogram.observe(duration);

          const response: ToolResponse = error
            ? createErrorResponse(
                ErrorCode.EXECUTION_FAILED,
                "Command execution failed.",
                duration,
                traceId,
              )
            : createSuccessResponse(data, duration, traceId);

          // For backward compatibility, merge data into response at root level
          const legacyResponse = error
            ? {
                ...response,
                code: data.code,
                signal: data.signal,
                stdout: data.stdout,
                stderr: data.stderr,
              }
            : {
                ...response,
                ...data,
              };

          res.status(error ? 400 : 200).json(legacyResponse);
        },
      );
    } catch (_error) {
      const traceId = generateTraceId();
      const response = createErrorResponse(
        ErrorCode.EXECUTION_FAILED,
        "An unexpected error occurred",
        0,
        traceId,
      );
      res.status(500).json(response);
    }
  },
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LLM Toolkit - Terminal listening on http://localhost:${PORT}`);
  });
}

export { app };
