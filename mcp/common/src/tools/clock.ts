import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getClockSnapshot } from "llm-toolkit-clock/dist/clock";
import { z } from "zod";

const getCurrentDatetimeInputSchema: Record<string, z.ZodTypeAny> = {
  timeZone: z
    .string()
    .optional()
    .describe("Optional IANA timezone such as 'UTC', 'America/New_York', or 'Asia/Kolkata'."),
  locale: z.string().optional().describe("Optional locale for readable names, e.g. 'en-US'."),
};

export function registerClockTool(server: McpServer): void {
  const defaultTimeZone = process.env.CLOCK_DEFAULT_TIMEZONE?.trim() || undefined;
  const defaultLocale = process.env.CLOCK_DEFAULT_LOCALE?.trim() || "en-US";

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

      const resolvedTimeZone = timeZone || defaultTimeZone;
      const resolvedLocale = locale || defaultLocale;

      const result = getClockSnapshot({
        timeZone: resolvedTimeZone,
        locale: resolvedLocale,
      });

      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
}
