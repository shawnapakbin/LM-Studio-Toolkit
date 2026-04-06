import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { type BrowseInput, browseWeb } from "./browser";

dotenv.config();

const DEFAULT_TIMEOUT_MS = Number(process.env.BROWSER_DEFAULT_TIMEOUT_MS ?? 20000);
const MAX_TIMEOUT_MS = Number(process.env.BROWSER_MAX_TIMEOUT_MS ?? 60000);
const MAX_CONTENT_CHARS = Number(process.env.BROWSER_MAX_CONTENT_CHARS ?? 12000);

const server = new McpServer({
  name: "lm-studio-web-browser-tool",
  version: "2.1.0",
});

const browseWebInputSchema: Record<string, z.ZodTypeAny> = {
  url: z.string().url().describe("The full URL to fetch, including http:// or https://."),
  timeoutMs: z.number().int().positive().optional().describe("Request timeout in milliseconds."),
  maxContentChars: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum returned content length in characters."),
  // v2.1.0 additions
  waitForSelector: z
    .string()
    .optional()
    .describe("CSS selector to wait for before extracting content (useful for SPAs)."),
  waitForNetworkIdle: z
    .boolean()
    .optional()
    .describe("Wait for network to be idle before extracting content."),
  screenshot: z.boolean().optional().describe("Capture a screenshot and return it as base64 PNG."),
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
      }),
    )
    .optional()
    .describe("Cookies to inject before navigation (for authenticated pages)."),
  outputFormat: z
    .enum(["text", "markdown"])
    .optional()
    .describe(
      "Content extraction format: 'text' (default) or 'markdown' (preserves headings, links, lists).",
    ),
};

// Cast to bypass Zod v3/v4 compat type depth issue in SDK generics (same pattern as RAG)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(server.registerTool as any)(
  "browse_web",
  {
    description:
      "Fetches a web page using a full headless Chromium browser and returns title and extracted content. Supports JavaScript-rendered pages, SPAs, cookie injection, screenshots, and markdown output.",
    inputSchema: browseWebInputSchema,
  },
  async (input: BrowseInput): Promise<CallToolResult> => {
    const effectiveTimeoutMs = Number.isFinite(input.timeoutMs)
      ? Math.min(Math.max(Number(input.timeoutMs), 1), MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

    const effectiveMaxContentChars = Number.isFinite(input.maxContentChars)
      ? Math.min(Math.max(Number(input.maxContentChars), 200), MAX_CONTENT_CHARS)
      : MAX_CONTENT_CHARS;

    const result = await browseWeb({
      ...input,
      timeoutMs: effectiveTimeoutMs,
      maxContentChars: effectiveMaxContentChars,
    });

    return {
      isError: !result.success,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio Web Browser MCP server running on stdio (v2.1.0 — Playwright headless)");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});
