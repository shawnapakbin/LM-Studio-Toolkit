import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type ReadDocumentInput,
  readDocument,
} from "llm-toolkit-document-scraper/dist/document-scraper";
import { z } from "zod";

/**
 * Registers the `read_document` tool on the provided MCP server.
 *
 * Environment variables consumed by the underlying document-scraper module:
 * - DOC_SCRAPER_DEFAULT_TIMEOUT_MS
 * - DOC_SCRAPER_MAX_TIMEOUT_MS
 * - DOC_SCRAPER_MAX_CONTENT_BYTES
 * - DOC_SCRAPER_MAX_CONTENT_CHARS
 * - DOC_SCRAPER_WORKSPACE_ROOT
 */
export function registerDocumentScraperTool(server: McpServer): void {
  const readDocumentInputSchema: Record<string, z.ZodTypeAny> = {
    url: z.string().url().optional().describe("Remote URL to fetch."),
    filePath: z.string().optional().describe("Workspace-relative local file path."),
    headers: z.record(z.string()).optional(),
    cookies: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxContentChars: z.number().int().positive().optional(),
    formatHint: z.string().optional(),
    profile: z.enum(["mvp", "premium"]).optional(),
    pdfPassword: z.string().optional().describe("Premium mode only."),
  };

  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: unknown },
    handler: (input: unknown) => Promise<CallToolResult>,
  ) => void;

  registerTool(
    "read_document",
    {
      description:
        "Reads local or remote documents with structured extraction and encrypted PDF notifications.",
      inputSchema: readDocumentInputSchema,
    },
    async (input): Promise<CallToolResult> => {
      const result = await readDocument(input as ReadDocumentInput);
      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
}
