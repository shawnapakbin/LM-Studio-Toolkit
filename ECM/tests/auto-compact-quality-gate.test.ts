process.env.ECM_DB_PATH = ":memory:";
process.env.ECM_EMBEDDINGS_MODE = "mock";
process.env.ECM_COMPACTOR_MODE = "mock";
process.env.ECM_AUTO_COMPACT_ENABLED = "true";
process.env.ECM_AUTO_COMPACT_THRESHOLD = "0.7";
process.env.ECM_MODEL_CONTEXT_LIMIT = "80";
process.env.ECM_AUTO_COMPACT_KEEP_NEWEST = "2";
process.env.ECM_AUTO_COMPACT_COOLDOWN_MS = "600000";
process.env.ECM_AUTO_COMPACT_FORCE_LLM = "true";
process.env.ECM_COMPACTOR_MIN_CONFIDENCE = "0.95";

import request from "supertest";
import { app } from "../src/index";

describe("ECM compactor quality gate", () => {
  test("rejects low-confidence LLM compactor output and falls back to extractive summary", async () => {
    const sessionId = "quality-gate-session";

    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/tools/ecm")
        .send({
          action: "store_segment",
          sessionId,
          type: "conversation_turn",
          content: `Quality gate turn ${i} with enough context detail for auto compaction fallback behavior validation.`,
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }

    const listRes = await request(app).post("/tools/ecm").send({
      action: "list_segments",
      sessionId,
      limit: 20,
    });

    expect(listRes.status).toBe(200);
    const summary = (listRes.body.data.segments as Array<Record<string, unknown>>).find(
      (s) => s.type === "summary",
    );
    expect(summary).toBeDefined();

    const metadata = JSON.parse(String(summary?.metadata_json ?? "{}")) as Record<string, unknown>;
    expect(metadata.fallbackUsed).toBe(true);
    expect(metadata.strategy).toBe("extractive");

    const compactorMeta = metadata.compactor as Record<string, unknown>;
    expect(compactorMeta.qualityGatePassed).toBe(false);
    expect(String(compactorMeta.error)).toContain("below minimum");
  });
});
