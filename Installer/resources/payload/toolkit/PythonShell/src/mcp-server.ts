import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { openPythonIde, openPythonRepl, runPythonCode } from "./python-shell";

dotenv.config();

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
      description:
        "Run non-interactive Python 3 code with python -c and return stdout/stderr.",
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
      },
    },
    async (input): Promise<CallToolResult> => {
      const result = runPythonCode(input as { code: string; timeoutMs?: number; cwd?: string });
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
      description: "Open an interactive Python 3 REPL in a visible terminal window.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory inside the workspace root."),
      },
    },
    async (input): Promise<CallToolResult> => {
      const result = openPythonRepl(input as { cwd?: string });
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
      description: "Launch Python IDLE shell (python -m idlelib).",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory inside the workspace root."),
      },
    },
    async (input): Promise<CallToolResult> => {
      const result = openPythonIde(input as { cwd?: string });
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
