// Must be set before any import that triggers singletons
process.env.ECM_DB_PATH = ":memory:";
process.env.ECM_EMBEDDINGS_MODE = "mock";
process.env.ECM_COMPACTOR_MODE = "mock";
// Disable threshold auto-compact so it doesn't interfere with continuous-mode tests
process.env.ECM_AUTO_COMPACT_ENABLED = "false";
process.env.ECM_MODEL_CONTEXT_LIMIT = "8192";

import request from "supertest";
import { app } from "../src/index";

const SESSION = "continuous-compact-session";
const SESSION2 = "continuous-compact-session-2";

// ─── set_continuous_compact ──────────────────────────────────────────────────

describe("set_continuous_compact", () => {
  test("enables continuous compaction for a session", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      sessionId: SESSION,
      enabled: true,
      keepNewest: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBe(SESSION);
    expect(res.body.data.continuousCompactEnabled).toBe(true);
    expect(res.body.data.continuousKeepNewest).toBe(1);
    expect(res.body.data.policySource).toBe("session");
    expect(res.body.data.effectiveEnabled).toBe(true);
    expect(res.body.data.updatedAt).toBeDefined();
  });

  test("disables continuous compaction for a session", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      sessionId: SESSION,
      enabled: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.continuousCompactEnabled).toBe(false);
    expect(res.body.data.effectiveEnabled).toBe(false);
  });

  test("returns 400 when enabled field is missing", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      sessionId: SESSION,
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("returns 400 when sessionId is missing", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      enabled: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("upsert: re-enabling updates the existing row", async () => {
    // disable first
    await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      sessionId: SESSION,
      enabled: false,
    });
    // now re-enable with different keepNewest
    const res = await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      sessionId: SESSION,
      enabled: true,
      keepNewest: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.continuousCompactEnabled).toBe(true);
    expect(res.body.data.continuousKeepNewest).toBe(2);
  });
});

// ─── get_session_policy ──────────────────────────────────────────────────────

describe("get_session_policy", () => {
  test("returns session row when a policy has been set", async () => {
    await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      sessionId: SESSION,
      enabled: true,
      keepNewest: 1,
    });
    const res = await request(app).post("/tools/ecm").send({
      action: "get_session_policy",
      sessionId: SESSION,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.policySource).toBe("session");
    expect(res.body.data.continuousCompactEnabled).toBe(true);
    expect(res.body.data.continuousKeepNewest).toBe(1);
  });

  test("returns env_default when no session policy exists", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "get_session_policy",
      sessionId: "no-policy-session",
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.policySource).toBe("env_default");
  });

  test("returns 400 when sessionId is missing", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "get_session_policy",
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── Continuous compaction execution ─────────────────────────────────────────

describe("continuous compaction execution", () => {
  const EXEC_SESSION = "continuous-exec-session";

  beforeEach(async () => {
    // Enable continuous compact with keepNewest=1 for the execution session
    await request(app).post("/tools/ecm").send({
      action: "set_continuous_compact",
      sessionId: EXEC_SESSION,
      enabled: true,
      keepNewest: 1,
    });
    // Clear any leftover segments from previous runs
    await request(app).post("/tools/ecm").send({
      action: "clear_session",
      sessionId: EXEC_SESSION,
    });
  });

  test("compacts after every store_segment once 2+ non-summary segments exist", async () => {
    // First segment: no compaction yet (only 1)
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: EXEC_SESSION,
      type: "conversation_turn",
      content: "First response: we decided to use PostgreSQL for the database.",
    });

    let listRes = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: EXEC_SESSION,
      limit: 20,
    });
    // Still 1 segment, no summary yet
    expect(listRes.body.data.total).toBe(1);

    // Second segment triggers compaction (keepNewest=1 means 1 is kept, first gets summarized)
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: EXEC_SESSION,
      type: "conversation_turn",
      content: "Second response: we also chose Redis for caching.",
    });

    listRes = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: EXEC_SESSION,
      limit: 20,
    });

    expect(listRes.body.success).toBe(true);
    // After compaction: 1 summary + 1 newest kept = 2
    expect(listRes.body.data.total).toBe(2);

    const segments = listRes.body.data.segments as Array<Record<string, unknown>>;
    const summarySegment = segments.find((s) => s.type === "summary");
    expect(summarySegment).toBeDefined();

    const meta = JSON.parse(String(summarySegment?.metadata_json ?? "{}")) as Record<
      string,
      unknown
    >;
    expect(meta.triggeredByContinuousCompact).toBe(true);
    expect(meta.triggeredByAutoPolicy).toBe(true);
  });

  test("continuous compaction only fires from store_segment, not retrieve_context", async () => {
    // Seed exactly 2 segments so a second store would trigger compaction
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: EXEC_SESSION,
      type: "conversation_turn",
      content: "Seg A — first decision.",
    });
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: EXEC_SESSION,
      type: "conversation_turn",
      content: "Seg B — second decision.",
    });

    // At this point compaction fired once. Now check retrieve_context doesn't re-compact
    const beforeList = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: EXEC_SESSION,
      limit: 20,
    });
    const countBefore = beforeList.body.data.total as number;

    await request(app).post("/tools/ecm").send({
      action: "retrieve_context",
      sessionId: EXEC_SESSION,
      query: "What decisions were made?",
    });

    const afterList = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: EXEC_SESSION,
      limit: 20,
    });
    // Segment count must not have changed — no extra compaction from retrieve_context
    expect(afterList.body.data.total).toBe(countBefore);
  });

  test("session without policy falls back to env default (disabled)", async () => {
    // SESSION2 has no policy row; env default is disabled (set at top of file)
    const SESSION_NO_POLICY = "no-continuous-policy-env-default";

    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION_NO_POLICY,
      type: "conversation_turn",
      content: "Segment 1 — some context.",
    });
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION_NO_POLICY,
      type: "conversation_turn",
      content: "Segment 2 — more context.",
    });

    const listRes = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: SESSION_NO_POLICY,
      limit: 20,
    });

    // No compaction should have happened since env default is disabled
    const segments = listRes.body.data.segments as Array<Record<string, unknown>>;
    const hasSummary = segments.some((s) => s.type === "summary");
    expect(hasSummary).toBe(false);
    expect(listRes.body.data.total).toBe(2);
  });
});
