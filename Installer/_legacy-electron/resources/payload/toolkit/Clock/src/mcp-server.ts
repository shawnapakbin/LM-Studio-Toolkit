import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { getClockSnapshot } from "./clock";

dotenv.config();

const server = new McpServer({
  name: "lm-studio-clock-tool",
  version: "1.0.0",
});

const getCurrentDatetimeInputSchema: Record<string, z.ZodTypeAny> = {
  timeZone: z
    .string()
    .optional()
    .describe("Optional IANA timezone such as 'UTC', 'America/New_York', or 'Asia/Kolkata'."),
  locale: z.string().optional().describe("Optional locale for readable names, e.g. 'en-US'."),
};

const registerTool = server.registerTool.bind(server) as unknown as (
  name: string,
  config: { description: string; inputSchema: unknown },
  handler: (input: unknown) => Promise<CallToolResult>,
) => void;

registerTool(
  "get_current_datetime",
  {
    description:
      "Returns current date/time/timezone information, optionally for a specific IANA timezone.",
    inputSchema: getCurrentDatetimeInputSchema,
  },
  async (input): Promise<CallToolResult> => {
    const { timeZone, locale } = input as { timeZone?: string; locale?: string };
    const result = getClockSnapshot({ timeZone, locale });

    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Clock MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});
