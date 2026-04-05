import { LMStudioClient } from "@lmstudio/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

type ToolResult = {
  success: boolean;
  status?: string;
  results?: unknown[];
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

async function unloadAllLoadedModels(client: LMStudioClient): Promise<void> {
  const loadedEmbeddings = await client.embedding.listLoaded();
  for (const model of loadedEmbeddings) {
    await model.unload();
  }

  const loadedLlms = await client.llm.listLoaded();
  for (const model of loadedLlms) {
    await model.unload();
  }

  const remainingEmbeddings = await client.embedding.listLoaded();
  const remainingLlms = await client.llm.listLoaded();
  expect(remainingEmbeddings.length).toBe(0);
  expect(remainingLlms.length).toBe(0);
}

const runLive = process.env.LMSTUDIO_LIVE_TEST === "true";
const describeIfLive = runLive ? describe : describe.skip;

describeIfLive("RAG MCP live integration", () => {
  const embeddingModelKey = process.env.LMSTUDIO_EMBED_MODEL;
  let lmstudio: LMStudioClient;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    if (!embeddingModelKey) {
      throw new Error("LMSTUDIO_EMBED_MODEL is required when LMSTUDIO_LIVE_TEST=true");
    }

    process.env.RAG_DB_PATH = ":memory:";
    process.env.RAG_EMBEDDINGS_MODE = "lmstudio";
    process.env.RAG_EMBEDDING_MODEL = embeddingModelKey;

    const fetchMock = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("ask_user_interview")) {
        return jsonResponse({
          success: true,
          status: "answered",
          responses: [{ questionId: "approve", value: true }],
        });
      }

      if (originalFetch) {
        return originalFetch(input as never, init as never);
      }

      return jsonResponse({ success: false, error: "unexpected url" }, false);
    });

    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    lmstudio = new LMStudioClient();
    await unloadAllLoadedModels(lmstudio);
    await lmstudio.embedding.load(embeddingModelKey, { identifier: "rag-live-embed" });

    const module = await import("../src/mcp-server");
    const server = module.createRAGMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "rag-mcp-live-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }, 120000);

  afterAll(async () => {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
    await unloadAllLoadedModels(lmstudio);
  });

  test("ingests and queries with live embedding model", async () => {
    const ingestRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "ingest_documents",
        payload: {
          approvalInterviewId: "approved-live-1",
          documents: [
            {
              sourceKey: "rag-live-doc-1",
              text: "Integration-level MCP tests help validate production readiness before release.",
            },
          ],
        },
      },
    });

    const ingest = parseToolResult(ingestRaw);
    expect(ingest.success).toBe(true);
    expect(ingest.status).toBe("ingested");

    const queryRaw = await client.callTool({
      name: "rag_knowledge",
      arguments: {
        action: "query_knowledge",
        payload: {
          query: "What do integration-level MCP tests validate?",
          topK: 3,
        },
      },
    });

    const query = parseToolResult(queryRaw);
    expect(query.success).toBe(true);
    expect((query.results?.length ?? 0) > 0).toBe(true);
  }, 120000);
});
