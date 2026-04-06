import type { Express } from "express";
import request from "supertest";
import { closeService } from "../src/rag";

let app: Express;
let originalRagBypassApproval: string | undefined;

function jsonResponse(body: unknown, ok = true): Pick<Response, "ok" | "json"> {
  return {
    ok,
    json: async () => body,
  };
}

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
          content:
            "LM Studio RAG allows persistent retrieval when you store embeddings and chunks.",
          title: "RAG Notes",
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

  const module = await import("../src/index");
  app = module.app;
});

afterAll(() => {
  closeService();
  if (originalRagBypassApproval === undefined) {
    delete process.env.RAG_BYPASS_APPROVAL;
  } else {
    process.env.RAG_BYPASS_APPROVAL = originalRagBypassApproval;
  }
});

describe("RAG HTTP Endpoints", () => {
  test("GET /health should return service health", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "lm-studio-rag-tool",
    });
  });

  test("GET /tool-schema should return tool definition", async () => {
    const response = await request(app).get("/tool-schema");

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("rag_knowledge");
  });

  test("ingest/query/list flow works with approved write", async () => {
    const ingestResponse = await request(app)
      .post("/tools/rag_knowledge")
      .send({
        action: "ingest_documents",
        payload: {
          approvalInterviewId: "approved-1",
          documents: [{ sourceKey: "rag-doc-1", filePath: "docs/rag.md" }],
        },
      });

    expect(ingestResponse.status).toBe(200);
    expect(ingestResponse.body.success).toBe(true);
    expect(ingestResponse.body.status).toBe("ingested");
    expect(ingestResponse.body.results[0].chunkCount).toBeGreaterThan(0);

    const queryResponse = await request(app)
      .post("/tools/rag_knowledge")
      .send({
        action: "query_knowledge",
        payload: {
          query: "How does persistent retrieval work?",
          topK: 3,
        },
      });

    expect(queryResponse.status).toBe(200);
    expect(queryResponse.body.success).toBe(true);
    expect(queryResponse.body.results.length).toBeGreaterThan(0);

    const listResponse = await request(app)
      .post("/tools/rag_knowledge")
      .send({
        action: "list_sources",
        payload: {
          limit: 10,
          offset: 0,
        },
      });

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.success).toBe(true);
    expect(listResponse.body.totalReturned).toBeGreaterThan(0);
  });

  test("write action without approval id returns approval_required", async () => {
    const response = await request(app)
      .post("/tools/rag_knowledge")
      .send({
        action: "ingest_documents",
        payload: {
          documents: [{ text: "knowledge" }],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("approval_required");
  });
});
