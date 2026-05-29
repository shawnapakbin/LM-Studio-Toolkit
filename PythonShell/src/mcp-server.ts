import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { SessionApprovalController } from "../../shared/dist/sessionApproval";
import { openPythonIde, openPythonRepl, runPythonCode } from "./python-shell";

dotenv.config();

const approval = new SessionApprovalController({
  toolName: "PythonShell",
  askUserEndpoint: process.env.PYTHON_SHELL_ASK_USER_ENDPOINT,
  bypassEnvVarName: "PYTHON_SHELL_BYPASS_APPROVAL",
});

export function createPythonShellMcpServer(): McpServer {
  const server = new McpServer({
    name: "lm-studio-python-shell-tool",
    version: "1.0.0",
  });

  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (input: unknown) => Promise<CallToolResult>,
  ) => void;

  registerTool(
    "python_run_code",
    {
      description: "Run non-interactive Python 3 code with python -c and return stdout/stderr.",
      inputSchema: {
        code: z.string().min(1).describe("Python code string to execute with -c."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout in milliseconds (default 60000, max 120000)."),
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory inside the workspace root."),
        approvalToken: z
          .string()
          .optional()
          .describe(
            "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
          ),
        approvalInterviewId: z
          .string()
          .optional()
          .describe("AskUser interview ID used to verify explicit approval."),
        sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
        taskRunId: z
          .string()
          .optional()
          .describe("Alternate session identity when sessionId is unavailable."),
      },
    },
    async (input): Promise<CallToolResult> => {
      const typedInput = input as {
        code: string;
        timeoutMs?: number;
        cwd?: string;
        approvalToken?: string;
        approvalInterviewId?: string;
        sessionId?: string;
        taskRunId?: string;
      };
      const gate = await approval.ensureApproved({
        action: "python_shell:python_run_code",
        details: `Python code will be executed in cwd '${typedInput.cwd || "workspace root"}'.`,
        approvalToken: typedInput.approvalToken,
        approvalInterviewId: typedInput.approvalInterviewId,
        sessionId: typedInput.sessionId,
        taskRunId: typedInput.taskRunId,
      });
      if (!gate.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
          structuredContent: gate.response as unknown as Record<string, unknown>,
        };
      }

      const result = runPythonCode({
        code: typedInput.code,
        timeoutMs: typedInput.timeoutMs,
        cwd: typedInput.cwd,
      });
      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  registerTool(
    "python_open_repl",
    {
      description:
        "Launches the plain Python interactive terminal REPL in a visible shell window. This is terminal-based stdin/stdout Python (not IDLE GUI). Use this for command-line interactive experimentation.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory inside the workspace root."),
        approvalToken: z
          .string()
          .optional()
          .describe(
            "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
          ),
        approvalInterviewId: z
          .string()
          .optional()
          .describe("AskUser interview ID used to verify explicit approval."),
        sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
        taskRunId: z
          .string()
          .optional()
          .describe("Alternate session identity when sessionId is unavailable."),
      },
    },
    async (input): Promise<CallToolResult> => {
      const typedInput = input as {
        cwd?: string;
        approvalToken?: string;
        approvalInterviewId?: string;
        sessionId?: string;
        taskRunId?: string;
      };
      const gate = await approval.ensureApproved({
        action: "python_shell:python_open_repl",
        details: `A visible Python REPL will be launched in cwd '${typedInput.cwd || "workspace root"}'.`,
        approvalToken: typedInput.approvalToken,
        approvalInterviewId: typedInput.approvalInterviewId,
        sessionId: typedInput.sessionId,
        taskRunId: typedInput.taskRunId,
      });
      if (!gate.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
          structuredContent: gate.response as unknown as Record<string, unknown>,
        };
      }

      const result = openPythonRepl({ cwd: typedInput.cwd });
      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  registerTool(
    "python_open_idle",
    {
      description:
        "Launches Python IDLE via python -m idlelib, opening the IDLE GUI shell/editor (not the plain terminal REPL). Use this when a GUI Python shell/editor is needed.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory inside the workspace root."),
        approvalToken: z
          .string()
          .optional()
          .describe(
            "Approval token from a prior approval_required response. For allow-once: use the approvalToken value. For allow-in-session: put the sessionApprovalToken value here (same field) and include sessionId or taskRunId.",
          ),
        approvalInterviewId: z
          .string()
          .optional()
          .describe("AskUser interview ID used to verify explicit approval."),
        sessionId: z.string().optional().describe("Session ID for allow-in-session approvals."),
        taskRunId: z
          .string()
          .optional()
          .describe("Alternate session identity when sessionId is unavailable."),
      },
    },
    async (input): Promise<CallToolResult> => {
      const typedInput = input as {
        cwd?: string;
        approvalToken?: string;
        approvalInterviewId?: string;
        sessionId?: string;
        taskRunId?: string;
      };
      const gate = await approval.ensureApproved({
        action: "python_shell:python_open_idle",
        details: `Python IDLE will be launched in cwd '${typedInput.cwd || "workspace root"}'.`,
        approvalToken: typedInput.approvalToken,
        approvalInterviewId: typedInput.approvalInterviewId,
        sessionId: typedInput.sessionId,
        taskRunId: typedInput.taskRunId,
      });
      if (!gate.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(gate.response, null, 2) }],
          structuredContent: gate.response as unknown as Record<string, unknown>,
        };
      }

      const result = openPythonIde({ cwd: typedInput.cwd });
      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

async function main() {
  const server = createPythonShellMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio PythonShell MCP server running on stdio");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("MCP server startup failed:", error);
    process.exit(1);
  });
}
