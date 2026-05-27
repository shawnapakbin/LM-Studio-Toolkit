import type { Express } from "express";
import request from "supertest";
import { clearSessionGrants, closeService } from "../src/rag";

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
    if (input.includes("interview_user")) {
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

  test("approval_required includes sessionApprovalToken when sessionId is provided", async () => {
    const response = await request(app)
      .post("/tools/rag_knowledge")
      .send({
        action: "ingest_documents",
        payload: {
          sessionId: "ses-token-test",
          documents: [{ text: "session token test" }],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("approval_required");
    expect(typeof response.body.sessionApprovalToken).toBe("string");
    expect(response.body.sessionApprovalToken).not.toBe(response.body.approvalToken);
  });

  describe("session grants via AskUser HTTP (allow_in_session)", () => {
    const SESSION_ID = "ses-http-allow";

    afterEach(() => {
      clearSessionGrants(SESSION_ID);
    });

    test("allow_in_session response grants session and second call needs no approval", async () => {
      // Override fetch to return allow_in_session for the first interview check
      Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: jest.fn(async (input: string) => {
          if (input.includes("interview_user")) {
            return jsonResponse({
              success: true,
              status: "answered",
              responses: [{ questionId: "approve", value: "allow_in_session" }],
            });
          }
          if (input.includes("read_document")) {
            return jsonResponse({
              success: true,
              data: { content: "session grant test content", title: "Session Doc" },
            });
          }
          return jsonResponse({ success: false, error: "unexpected url" }, false);
        }),
      });

      // First call with approvalInterviewId — response is allow_in_session
      const firstResponse = await request(app)
        .post("/tools/rag_knowledge")
        .send({
          action: "ingest_documents",
          payload: {
            sessionId: SESSION_ID,
            approvalInterviewId: "iv-allow-session-1",
            documents: [{ text: "session grant test content" }],
          },
        });

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body.success).toBe(true);
      expect(firstResponse.body.status).toBe("ingested");

      // Second call — same sessionId, no approval fields; should auto-approve via session grant
      const secondResponse = await request(app)
        .post("/tools/rag_knowledge")
        .send({
          action: "ingest_documents",
          payload: {
            sessionId: SESSION_ID,
            documents: [{ text: "follow-up content, no approval needed" }],
          },
        });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.success).toBe(true);
      expect(secondResponse.body.status).toBe("ingested");
    });

    test("session grant is action-scoped: ingest grant does not bypass delete", async () => {
      // Grant ingest_documents for the session
      Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: jest.fn(async (input: string) => {
          if (input.includes("interview_user")) {
            return jsonResponse({
              success: true,
              status: "answered",
              responses: [{ questionId: "approve", value: "allow_in_session" }],
            });
          }
          if (input.includes("read_document")) {
            return jsonResponse({
              success: true,
              data: { content: "action scope test", title: "Scope Doc" },
            });
          }
          return jsonResponse({ success: false, error: "unexpected url" }, false);
        }),
      });

      // Establish ingest grant
      await request(app)
        .post("/tools/rag_knowledge")
        .send({
          action: "ingest_documents",
          payload: {
            sessionId: SESSION_ID,
            approvalInterviewId: "iv-scope-test",
            documents: [{ text: "scope test content" }],
          },
        });

      // List to get a sourceId for delete
      const listRes = await request(app)
        .post("/tools/rag_knowledge")
        .send({ action: "list_sources", payload: { limit: 5 } });
      const sourceId = listRes.body.sources?.[0]?.id;
      expect(typeof sourceId).toBe("string");

      // delete_source with same sessionId — should still require approval
      const deleteRes = await request(app)
        .post("/tools/rag_knowledge")
        .send({
          action: "delete_source",
          payload: { sessionId: SESSION_ID, sourceId },
        });

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.status).toBe("approval_required");
    });
  });

  describe("session grants via chat-first sessionApprovalToken", () => {
    const SESSION_ID = "ses-chat-first";

    afterEach(() => {
      clearSessionGrants(SESSION_ID);
    });

    test("redeeming sessionApprovalToken auto-approves subsequent calls with same sessionId", async () => {
      // Step 1: call without approval to receive tokens
      const promptRes = await request(app)
        .post("/tools/rag_knowledge")
        .send({
          action: "ingest_documents",
          payload: {
            sessionId: SESSION_ID,
            documents: [{ text: "chat first session grant" }],
          },
        });

      expect(promptRes.body.status).toBe("approval_required");
      const { sessionApprovalToken } = promptRes.body;
      expect(typeof sessionApprovalToken).toBe("string");

      // Step 2: redeem the session token — establishes session grant
      const redeemRes = await request(app)
        .post("/tools/rag_knowledge")
        .send({
          action: "ingest_documents",
          payload: {
            sessionId: SESSION_ID,
            approvalToken: sessionApprovalToken,
            documents: [{ text: "chat first session grant" }],
          },
        });

      expect(redeemRes.status).toBe(200);
      expect(redeemRes.body.success).toBe(true);
      expect(redeemRes.body.status).toBe("ingested");

      // Step 3: subsequent call with same sessionId — no token needed
      const followUpRes = await request(app)
        .post("/tools/rag_knowledge")
        .send({
          action: "ingest_documents",
          payload: {
            sessionId: SESSION_ID,
            documents: [{ text: "no approval needed after session grant" }],
          },
        });

      expect(followUpRes.status).toBe(200);
      expect(followUpRes.body.success).toBe(true);
      expect(followUpRes.body.status).toBe("ingested");
    });
  });
});
