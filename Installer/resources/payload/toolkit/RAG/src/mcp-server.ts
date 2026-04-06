import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { z } from "zod";
import { handleRAGRequest } from "./rag";
import type { RagAction, RagRequest } from "./types";

dotenv.config();

// Flat input shape — all fields optional except action.
// The SDK serializes this to JSON Schema for the model.
const ragInputShape = {
  action: z
    .enum([
      "ingest_documents",
      "query_knowledge",
      "list_sources",
      "delete_source",
      "reindex_source",
    ])
    .describe("The operation to perform."),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("(legacy) Optional nested payload object accepted for backward compatibility."),
  documents: z
    .array(
      z.object({
        text: z.string().optional().describe("Raw text content to ingest."),
        filePath: z.string().optional().describe("Local file path to ingest."),
        url: z.string().optional().describe("Remote URL to fetch and ingest."),
        title: z.string().optional(),
        sourceKey: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .optional()
    .describe(
      "(ingest_documents) Array of documents. Each needs at least one of: text, filePath, url.",
    ),
  chunkSizeTokens: z
    .number()
    .optional()
    .describe("(ingest_documents / reindex_source) Chunk size in tokens (default 512)."),
  overlapTokens: z
    .number()
    .optional()
    .describe("(ingest_documents / reindex_source) Overlap between chunks (default 50)."),
  approvalToken: z
    .string()
    .optional()
    .describe(
      "(ingest_documents / delete_source / reindex_source) One-time approval token from a prior approval_required response.",
    ),
  approvalInterviewId: z
    .string()
    .optional()
    .describe(
      "(ingest_documents / delete_source / reindex_source) AskUser interview ID used to verify explicit approval.",
    ),
  query: z.string().optional().describe("(query_knowledge) Search query text."),
  topK: z
    .number()
    .optional()
    .describe("(query_knowledge) Number of results to return (default 5)."),
  sourceIds: z
    .array(z.string())
    .optional()
    .describe("(query_knowledge) Filter results by source IDs."),
  sourceKeys: z
    .array(z.string())
    .optional()
    .describe("(query_knowledge) Filter results by source keys."),
  minScore: z.number().optional().describe("(query_knowledge) Minimum relevance score 0–1."),
  limit: z.number().optional().describe("(list_sources) Max results (default 20)."),
  offset: z.number().optional().describe("(list_sources) Pagination offset (default 0)."),
  sourceId: z.string().optional().describe("(delete_source / reindex_source) Source ID to target."),
} as const;

type RagInput = {
  action:
    | "ingest_documents"
    | "query_knowledge"
    | "list_sources"
    | "delete_source"
    | "reindex_source";
  payload?: Record<string, unknown>;
  documents?: Array<{
    text?: string;
    filePath?: string;
    url?: string;
    title?: string;
    sourceKey?: string;
    metadata?: Record<string, unknown>;
  }>;
  chunkSizeTokens?: number;
  overlapTokens?: number;
  approvalToken?: string;
  approvalInterviewId?: string;
  query?: string;
  topK?: number;
  sourceIds?: string[];
  sourceKeys?: string[];
  minScore?: number;
  limit?: number;
  offset?: number;
  sourceId?: string;
};

export function createRAGMcpServer(): McpServer {
  const server = new McpServer({
    name: "lm-studio-rag-tool",
    version: "1.0.0",
  });

  // Cast to any to avoid Zod v3/v4 compat type depth errors in the SDK generics.
  // Runtime behaviour is unaffected — Zod v3 validation still runs correctly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(
    "rag_knowledge",
    {
      description:
        "Knowledge base RAG tool. Set action to one of: 'ingest_documents' (add files/URLs/text to KB), 'query_knowledge' (search KB), 'list_sources' (list indexed sources), 'delete_source' (remove a source), 'reindex_source' (reprocess a source). Then populate the relevant payload fields for that action.",
      inputSchema: ragInputShape,
    },
    async (input: RagInput): Promise<CallToolResult> => {
      const { action } = input;

      // Backward compatibility: accept both flat args and legacy nested `payload`.
      const legacyPayload =
        input.payload && typeof input.payload === "object"
          ? input.payload
          : ({} as Record<string, unknown>);
      const pick = <T>(key: string): T | undefined =>
        ((input as Record<string, unknown>)[key] ?? legacyPayload[key]) as T | undefined;

      const documents = pick<RagInput["documents"]>("documents");
      const chunkSizeTokens = pick<number>("chunkSizeTokens");
      const overlapTokens = pick<number>("overlapTokens");
      const approvalToken = pick<string>("approvalToken");
      const approvalInterviewId = pick<string>("approvalInterviewId");
      const query = pick<string>("query");
      const topK = pick<number>("topK");
      const sourceIds = pick<string[]>("sourceIds");
      const sourceKeys = pick<string[]>("sourceKeys");
      const minScore = pick<number>("minScore");
      const limit = pick<number>("limit");
      const offset = pick<number>("offset");
      const sourceId = pick<string>("sourceId");

      const payloadMap: Record<string, unknown> = {
        ingest_documents: {
          documents,
          chunkSizeTokens,
          overlapTokens,
          approvalToken,
          approvalInterviewId,
        },
        query_knowledge: { query, topK, sourceIds, sourceKeys, minScore },
        list_sources: { limit, offset },
        delete_source: { sourceId, approvalToken, approvalInterviewId },
        reindex_source: {
          sourceId,
          chunkSizeTokens,
          overlapTokens,
          approvalToken,
          approvalInterviewId,
        },
      };

      const result = await handleRAGRequest({
        action: action as RagAction,
        payload: payloadMap[action] as RagRequest["payload"],
      });

      return {
        isError: !result.success,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}

async function main() {
  const server = createRAGMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LM Studio RAG MCP server running on stdio");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("MCP server startup failed:", error);
    process.exit(1);
  });
}
