import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRAGMcpServer } from "../src/mcp-server";
import { closeService } from "../src/rag";

type ToolResult = {
  success: boolean;
  errorCode?: string;
  status?: string;
  totalReturned?: number;
  sources?: Array<{ id: string; source_key: string }>;
  processed?: number;
  results?: Array<{ chunkCount?: number }>;
};

function jsonResponse(body: unknown, ok = true): Pick<Response, "ok" | "json"> {
  return {
    ok,
    json: async () => body,
  };
}

function parseToolResult(response: unknown): ToolResult {
  const normalize = (value: unknown): ToolResult => {
    const result = value as { data?: unknown; structuredContent?: unknown };
    if (result?.structuredContent && typeof result.structuredContent === "object") {
      return normalize(result.structuredContent);
    }
    if (result?.data && typeof result.data === "object") {
      return {
        ...(result as Record<string, unknown>),
        ...(result.data as Record<string, unknown>),
      } as ToolResult;
    }
    return value as ToolResult;
  };

  const callResult = response as {
    content?: Array<{ type: string; text?: string }>;
    toolResult?: unknown;
  };

  if (callResult.toolResult && typeof callResult.toolResult === "object") {
    return normalize(callResult.toolResult);
  }

  const textContent = callResult.content?.find((item) => item.type === "text")?.text;
  if (!textContent) {
    throw new Error("Missing text content in MCP response");
  }

  return normalize(JSON.parse(textContent));
}

describe("RAG MCP integration", () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let originalRagBypassApproval: string | undefined;

  beforeAll(async () => {
    originalRagBypassApproval = process.env.RAG_BYPASS_APPROVAL;
    process.env.RAG_BYPASS_APPROVAL = "false";
    process.env.RAG_DB_PATH = ":memory:";
    process.env.RAG_EMBEDDINGS_MODE = "mock";

    const fetchMock = jest.fn(async (input: string) => {
      if (input.includes("ask_user_interview")) {
        return jsonResponse({
          success: true,
          status: "answered",
          responses: [{ questionId: "approve", value: true }],
        });
      }

      if (input.includes("read_document")) {
        return jsonResponse({
          success: true,
          data: {
            content: "RAG integration tests validate ingestion, retrieval, and lifecycle actions.",
            title: "RAG MCP Test Doc",
          },
        });
      }

      return jsonResponse({ success: false, error: "unexpected url" }, false);
    });

    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    const server = createRAGMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "rag-mcp-test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    closeService();
    if (originalRagBypassApproval === undefined) {
      delete process.env.RAG_BYPASS_APPROVAL;
    } else {
      process.env.RAG_BYPASS_APPROVAL = originalRagBypassApproval;
    }
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  });

  test("lists rag_knowledge tool", async () => {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "rag_knowledge")).toBe(true);
  });

  test("list sources returns empty state initially", async () => {
    const initialListRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "list_sources",
        payload: { limit: 10, offset: 0 },
      },
    });

    const initialList = parseToolResult(initialListRaw);
    const existingSources = initialList.sources ?? [];

    for (const source of existingSources) {
      await client.callTool({
        name: "rag_knowledge",
        arguments: {
          action: "delete_source",
          payload: {
            sourceId: source.id,
            approvalInterviewId: "cleanup-approval",
          },
        },
      });
    }

    const responseRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "list_sources",
        payload: { limit: 10, offset: 0 },
      },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(true);
    expect(response.totalReturned).toBe(0);
  });

  test("ingest, query, reindex, delete lifecycle", async () => {
    const ingestRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          approvalInterviewId: "approved-1",
          documents: [
            {
              sourceKey: "rag-mcp-doc-1",
              text: "MCP integration testing ensures stable tool contracts for production releases.",
            },
          ],
        },
      },
    });

    const ingest = parseToolResult(ingestRaw);
    expect(ingest.success).toBe(true);
    expect(ingest.status).toBe("ingested");
    expect(ingest.processed).toBe(1);
    expect((ingest.results?.[0]?.chunkCount ?? 0) > 0).toBe(true);

    const queryRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "query_knowledge",
        payload: {
          query: "What do MCP integration tests ensure?",
          topK: 3,
        },
      },
    });

    const query = parseToolResult(queryRaw);
    expect(query.success).toBe(true);
    expect((query.results?.length ?? 0) > 0).toBe(true);

    const listRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "list_sources",
        payload: { limit: 10, offset: 0 },
      },
    });

    const list = parseToolResult(listRaw);
    expect(list.success).toBe(true);
    expect((list.totalReturned ?? 0) > 0).toBe(true);

    const sourceId = list.sources?.[0]?.id;
    expect(sourceId).toBeDefined();

    const reindexRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "reindex_source",
        payload: {
          sourceId,
          approvalInterviewId: "approved-2",
        },
      },
    });

    const reindex = parseToolResult(reindexRaw);
    expect(reindex.success).toBe(true);
    expect(reindex.status).toBe("reindexed");

    const deleteRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "delete_source",
        payload: {
          sourceId,
          approvalInterviewId: "approved-3",
        },
      },
    });

    const deleted = parseToolResult(deleteRaw);
    expect(deleted.success).toBe(true);
    expect(deleted.status).toBe("deleted");
  });

  test("ingest without approval returns approval_required with approvalToken", async () => {
    const responseRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          documents: [{ text: "Approval should be required for write actions." }],
        },
      },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(true);
    expect(response.status).toBe("approval_required");
    // Token must be present so the LLM can present it back after user confirms in chat
    expect(typeof (response as Record<string, unknown>).approvalToken).toBe("string");
    expect((response as Record<string, unknown>).approvalToken).toMatch(
      /^[0-9a-f-]{36}$/i, // UUID v4 format
    );
  });

  test("ingest with approvalToken succeeds", async () => {
    // Step 1: get the approval_required response to receive an approvalToken
    const approvalRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          documents: [{ text: "Token-based approval flow for chat-first ingest." }],
        },
      },
    });

    const approvalResponse = parseToolResult(approvalRaw) as Record<string, unknown>;
    expect(approvalResponse.status).toBe("approval_required");
    const approvalToken = approvalResponse.approvalToken as string;
    expect(approvalToken).toBeTruthy();

    // Step 2: retry with the token — should succeed
    const ingestRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          approvalToken,
          documents: [{ text: "Token-based approval flow for chat-first ingest." }],
        },
      },
    });

    const ingest = parseToolResult(ingestRaw);
    expect(ingest.success).toBe(true);
    expect(ingest.status).toBe("ingested");
    expect(ingest.processed).toBe(1);
  });

  test("approvalToken is single-use", async () => {
    const approvalRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          documents: [{ text: "Single-use token test." }],
        },
      },
    });

    const approvalResponse = parseToolResult(approvalRaw) as Record<string, unknown>;
    const approvalToken = approvalResponse.approvalToken as string;

    // First use — should succeed
    await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          approvalToken,
          documents: [{ text: "Single-use token test." }],
        },
      },
    });

    // Second use of the same token — should fail
    const retryRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          approvalToken,
          documents: [{ text: "Single-use token test." }],
        },
      },
    });

    const retry = parseToolResult(retryRaw);
    expect(retry.success).toBe(false);
    expect(retry.errorCode).toBe("POLICY_BLOCKED");
  });

  test("bypass mode skips approval gate", async () => {
    const original = process.env.RAG_BYPASS_APPROVAL;
    try {
      process.env.RAG_BYPASS_APPROVAL = "true";

      const responseRaw = await client.callTool({
        name: "rag_knowledge",
        arguments: {
          action: "ingest_documents",
          payload: {
            documents: [{ text: "Bypass mode allows ingest without approval." }],
          },
        },
      });

      const response = parseToolResult(responseRaw);
      expect(response.success).toBe(true);
      expect(response.status).toBe("ingested");
    } finally {
      if (original === undefined) {
        delete process.env.RAG_BYPASS_APPROVAL;
      } else {
        process.env.RAG_BYPASS_APPROVAL = original;
      }
    }
  });
});
