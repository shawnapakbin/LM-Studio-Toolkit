import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { exportParsedDataToCsv } from "./csv-exporter";

type SaveParsedDataCsvInput = {
  filename?: string;
  subfolder?: string;
  headers: string[];
  rows: unknown[][];
  append?: boolean;
};

dotenv.config();

const server = new McpServer({
  name: "lm-studio-csv-exporter-tool",
  version: "1.0.0",
});

const inputSchema = z.object({
  filename: z
    .string()
    .min(1)
    .optional()
    .describe("Output filename. .csv will be added automatically when missing."),
  subfolder: z.string().min(1).optional().describe("Optional subfolder inside Documents."),
  headers: z.array(z.string().min(1)).min(1).describe("Column headers in output order."),
  rows: z.array(z.array(z.any())).describe("Table rows matching header column count."),
  append: z
    .boolean()
    .optional()
    .describe("Append rows to existing CSV when true. Defaults to true."),
});

server.registerTool(
  "save_parsed_data_csv",
  {
    description:
      "Saves parsed tabular data as a clean CSV file in the user Documents folder. Supports appending rows and optional Documents subfolder.",
    inputSchema,
  },
  // @ts-expect-error -- MCP SDK Zod type recursion limit with nested arrays
  async ({
    filename,
    subfolder,
    headers,
    rows,
    append,
  }: SaveParsedDataCsvInput): Promise<CallToolResult> => {
    const result = await exportParsedDataToCsv({
      filename,
      subfolder,
      headers,
      rows,
      append,
    });

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
  console.error("LM Studio CSV Exporter MCP server running on stdio");
}

main().catch((error) => {
  console.error("MCP server startup failed:", error);
  process.exit(1);
});
