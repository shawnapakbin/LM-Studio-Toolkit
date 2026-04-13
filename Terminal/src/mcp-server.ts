import { execFile } from "child_process";
import { platform } from "os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import {
  DEFAULT_MAX_OUTPUT_CHARS,
  WORKSPACE_ROOT,
  isCommandBlocked,
  resolveSafeCwd,
  truncateOutput,
} from "./policy";
import { runPunchout } from "./punchout";

dotenv.config();

const DEFAULT_TIMEOUT_MS = Number(process.env.TERMINAL_DEFAULT_TIMEOUT_MS ?? 60000);
const MAX_TIMEOUT_MS = Number(process.env.TERMINAL_MAX_TIMEOUT_MS ?? 120000);
const MAX_OUTPUT_CHARS = DEFAULT_MAX_OUTPUT_CHARS;

type RunTerminalCommandInput = {
  command: string;
  timeoutMs?: number;
  cwd?: string;
  punchout?: boolean;
};

// Auto-detect operating system
const OPERATING_SYSTEM = (() => {
  const p = platform();
  if (p === "win32") return "Windows";
  if (p === "darwin") return "macOS";
  if (p === "linux") return "Linux";
  return "Unknown";
})();

const runTerminalCommandInputSchema: Record<string, z.ZodTypeAny> = {
  command: z
    .string()
    .min(1)
    .describe(
      `The ${OPERATING_SYSTEM} shell command to execute (e.g., 'npm test', '${OPERATING_SYSTEM === "Windows" ? "dir" : "ls -la"}', 'python script.py'). MUST be appropriate for ${OPERATING_SYSTEM}. Non-interactive commands only.`,
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Timeout in milliseconds (1–120000, default 60000). Increase for slow tasks like full builds.",
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      "Working directory for command (absolute path recommended). Defaults to current dir.",
    ),
  punchout: z
    .boolean()
    .optional()
    .describe(
      "When true, opens a visible terminal window so the user can watch the command run. The terminal is reused if still open; otherwise a new window is launched. Output is NOT captured—it appears only in the terminal window.",
    ),
};

export function createTerminalMcpServer(): McpServer {
  const server = new McpServer({
    name: "lm-studio-terminal-tool",
    version: "1.0.0",
  });

  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (input: unknown) => Promise<CallToolResult>,
  ) => void;

  registerTool(
    "run_terminal_command",
    {
      description: `TERMINAL EXECUTION ONLY: Run ${OPERATING_SYSTEM} commands for build/test automation, NOT for reasoning or data processing. Allowed: npm test, npm run build, npm run [script], listing files. Do NOT attempt to use for language analysis, text processing, or non-shell operations. Use ONLY ${OPERATING_SYSTEM}-native commands (${OPERATING_SYSTEM === "Windows" ? 'PowerShell (dir/Get-ChildItem, cd/Set-Location, npm, Set-Content, Out-File, here-strings @"..."@)' : "bash like ls, cd, npm, sh"}). Non-interactive only. Always check success flag in response.`,
      inputSchema: runTerminalCommandInputSchema,
    },
    async (input): Promise<CallToolResult> => {
      const { command, timeoutMs, cwd, punchout } = input as RunTerminalCommandInput;
      if (isCommandBlocked(command)) {
        const blockedResult = {
          success: false,
          errorCode: "POLICY_BLOCKED",
          errorMessage: "Command blocked by terminal safety policy.",
          timeoutMs: DEFAULT_TIMEOUT_MS,
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(blockedResult, null, 2) }],
          structuredContent: blockedResult,
        };
      }

      const safeCwd = resolveSafeCwd(WORKSPACE_ROOT, cwd);
      if (!safeCwd.ok) {
        const blockedResult = {
          success: false,
          errorCode: "POLICY_BLOCKED",
          errorMessage: safeCwd.message,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(blockedResult, null, 2) }],
          structuredContent: blockedResult,
        };
      }

      const effectiveTimeoutMs = Number.isFinite(timeoutMs)
        ? Math.min(Math.max(Number(timeoutMs), 1), MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

      // -------------------------------------------------------------------
      // Punchout mode: open a visible terminal and return immediately.
      // -------------------------------------------------------------------
      if (punchout) {
        try {
          const result = runPunchout(command, safeCwd.cwd);
          const data = {
            success: true,
            punchout: true,
            reused: result.reused,
            pid: result.pid,
            message: result.message,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
          };
        } catch (err) {
          const errResult = {
            success: false,
            errorCode: "EXECUTION_FAILED",
            errorMessage: err instanceof Error ? err.message : "Punchout failed.",
          };
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(errResult, null, 2) }],
            structuredContent: errResult,
          };
        }
      }

      const [shellBin, shellArgs] =
        process.platform === "win32"
          ? (["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]] as const)
          : (["/bin/sh", ["-c", command]] as const);

      return new Promise<CallToolResult>((resolve) => {
        execFile(
          shellBin,
          shellArgs,
          {
            timeout: effectiveTimeoutMs,
            cwd: safeCwd.cwd,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            const truncatedStdout = truncateOutput(stdout, MAX_OUTPUT_CHARS);
            const truncatedStderr = truncateOutput(stderr, MAX_OUTPUT_CHARS);
            const result = {
              success: !error,
              code: error && "code" in error ? error.code : 0,
              signal: error && "signal" in error ? error.signal : null,
              stdout: truncatedStdout,
              stderr: truncatedStderr,
              errorCode: error ? "EXECUTION_FAILED" : undefined,
              errorMessage: error ? "Command execution failed." : undefined,
              policy: {
                workspaceRoot: WORKSPACE_ROOT,
                maxOutputChars: MAX_OUTPUT_CHARS,
              },
              timeoutMs: effectiveTimeoutMs,
            };

            resolve({
              isError: Boolean(error),
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              structuredContent: result,
            });
          },
        );
      });
    },
  );

  return server;
}

async function main() {
  const server = createTerminalMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Terminal MCP server running on stdio");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("MCP server startup failed:", error);
    process.exit(1);
  });
}
