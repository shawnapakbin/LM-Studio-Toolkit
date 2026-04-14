process.env.ECM_DB_PATH = ":memory:";
process.env.ECM_EMBEDDINGS_MODE = "mock";
process.env.ECM_COMPACTOR_MODE = "mock";
process.env.ECM_AUTO_COMPACT_ENABLED = "true";
process.env.ECM_AUTO_COMPACT_THRESHOLD = "0.7";
process.env.ECM_MODEL_CONTEXT_LIMIT = "80";
process.env.ECM_AUTO_COMPACT_KEEP_NEWEST = "2";
process.env.ECM_AUTO_COMPACT_COOLDOWN_MS = "600000";
process.env.ECM_AUTO_COMPACT_FORCE_LLM = "true";

import request from "supertest";
import { app } from "../src/index";

const SESSION = "auto-compact-session";

describe("ECM auto-compaction", () => {
  test("auto compacts when context ratio crosses threshold", async () => {
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/tools/ecm")
        .send({
          action: "store_segment",
          sessionId: SESSION,
          type: "conversation_turn",
          content: `Turn ${i}: this is a long context segment with enough words to consume memory budget quickly and force automatic compaction.`,
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }

    const listRes = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId: SESSION,
      limit: 20,
    });

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data.total).toBe(3);

    const segments = listRes.body.data.segments as Array<Record<string, unknown>>;
    const summary = segments.find((s) => s.type === "summary");
    expect(summary).toBeDefined();

    const metadata = JSON.parse(String(summary?.metadata_json ?? "{}")) as Record<string, unknown>;
    expect(metadata.triggeredByAutoPolicy).toBe(true);
    expect(metadata.strategy).toBe("llm_highlights");
    expect(metadata.fallbackUsed).toBe(true);
  });

  test("retrieve_context returns auto compaction telemetry", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "retrieve_context",
      sessionId: SESSION,
      query: "What did we decide?",
      topK: 5,
      maxTokens: 200,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.autoCompaction).toBeDefined();
    expect(res.body.data.autoCompaction.checked).toBe(true);
    expect(typeof res.body.data.autoCompaction.triggerRatio).toBe("number");
  });
});
