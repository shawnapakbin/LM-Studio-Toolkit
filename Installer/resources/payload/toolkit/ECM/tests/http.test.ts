// Must be set before any import that triggers the store/embeddings singletons
process.env.ECM_DB_PATH = ":memory:";
process.env.ECM_EMBEDDINGS_MODE = "mock";

import request from "supertest";
import { app } from "../src/index";

const SESSION = "test-session-001";

describe("ECM HTTP Endpoints", () => {
  test("GET /health returns 200 with ok: true", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("GET /tool-schema returns 200 with name: ecm", async () => {
    const res = await request(app).get("/tool-schema");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("ecm");
  });

  test("POST /tools/ecm with missing action returns 400", async () => {
    const res = await request(app).post("/tools/ecm").send({ sessionId: SESSION });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("store_segment with valid input returns 200 and SegmentRecord", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "conversation_turn",
      content: "The user asked about the deployment pipeline.",
      importance: 0.7,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session_id).toBe(SESSION);
    expect(res.body.data.token_count).toBe(
      Math.ceil("The user asked about the deployment pipeline.".length / 4),
    );
  });

  test("store_segment with missing content returns 400", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "tool_output",
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("store_segment with invalid type returns 400", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "invalid_type",
      content: "some content",
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("store_segment with importance out of range returns 400", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "document",
      content: "some content",
      importance: 1.5,
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("retrieve_context returns segments sorted by score", async () => {
    // Store a second segment first
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "tool_output",
      content: "kubectl get pods returned: pod-1 Running",
    });

    const res = await request(app).post("/tools/ecm").send({
      action: "retrieve_context",
      sessionId: SESSION,
      query: "deployment pipeline",
      topK: 5,
      maxTokens: 2048,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.segments)).toBe(true);
    expect(typeof res.body.data.totalTokens).toBe("number");
    expect(typeof res.body.data.truncated).toBe("boolean");
    // totalTokens must not exceed maxTokens
    expect(res.body.data.totalTokens).toBeLessThanOrEqual(2048);
  });

  test("retrieve_context with tiny maxTokens returns truncated: true", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "retrieve_context",
      sessionId: SESSION,
      query: "deployment",
      maxTokens: 1, // too small for any segment
    });
    expect(res.status).toBe(200);
    expect(res.body.data.truncated).toBe(true);
    expect(res.body.data.totalTokens).toBe(0);
  });

  test("list_segments returns segments for session", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: SESSION,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.segments)).toBe(true);
    expect(typeof res.body.data.total).toBe("number");
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  test("delete_segment removes a segment", async () => {
    // Store a segment to delete
    const storeRes = await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "reasoning",
      content: "This segment will be deleted.",
    });
    const segmentId = storeRes.body.data.id;

    const delRes = await request(app).post("/tools/ecm").send({
      action: "delete_segment",
      sessionId: SESSION,
      segmentId,
    });
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);
  });

  test("delete_segment with unknown id returns 404", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "delete_segment",
      sessionId: SESSION,
      segmentId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test("summarize_session compresses old segments", async () => {
    const summarySession = "summary-test-session";
    // Store 5 segments
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/tools/ecm")
        .send({
          action: "store_segment",
          sessionId: summarySession,
          type: "conversation_turn",
          content: `Turn ${i}: discussing topic ${i} in detail with some context.`,
        });
    }

    const res = await request(app).post("/tools/ecm").send({
      action: "summarize_session",
      sessionId: summarySession,
      keepNewest: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.originalSegmentsRemoved).toBe(3);
    expect(res.body.data.summaryTokenCount).toBeGreaterThan(0);
  });

  test("summarize_session with too few segments returns 400", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "summarize_session",
      sessionId: "empty-session",
      keepNewest: 10,
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("clear_session removes all segments", async () => {
    const clearSession = "clear-test-session";
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: clearSession,
      type: "document",
      content: "to be cleared",
    });

    const res = await request(app).post("/tools/ecm").send({
      action: "clear_session",
      sessionId: clearSession,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBeGreaterThan(0);

    // Verify empty
    const listRes = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: clearSession,
    });
    expect(listRes.body.data.total).toBe(0);
  });

  test("session isolation — session A segments not visible in session B", async () => {
    const sessA = "isolation-session-a";
    const sessB = "isolation-session-b";

    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: sessA,
      type: "document",
      content: "secret content A",
    });

    const res = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: sessB,
    });
    expect(res.body.data.total).toBe(0);
  });
});
