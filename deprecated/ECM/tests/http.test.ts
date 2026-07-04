/**
 * ECM HTTP — single-tool surface tests.
 */
import request from "supertest";
import { resetEcmState } from "../src/ecm";
import { createApp } from "../src/index";

const app = createApp();
const SESSION = "http-test";

afterEach(() => {
  resetEcmState();
});

describe("POST /tools/ecm — store_segment", () => {
  test("returns 200 and segment record", async () => {
    const res = await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "conversation_turn",
      content: "hello world",
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      session_id: SESSION,
      type: "conversation_turn",
      content: "hello world",
    });
  });

  test("missing content returns 400", async () => {
    const res = await request(app)
      .post("/tools/ecm")
      .send({ action: "store_segment", sessionId: SESSION, type: "conversation_turn" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("INVALID_INPUT");
  });
});

describe("POST /tools/ecm — get_status", () => {
  test("reports counts after store", async () => {
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "conversation_turn",
      content: "hi",
    });
    const res = await request(app)
      .post("/tools/ecm")
      .send({ action: "get_status", sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.data.segmentCount).toBe(1);
    expect(res.body.data.estimatedUsedTokens).toBeGreaterThan(0);
  });
});

describe("POST /tools/ecm — clear_session", () => {
  test("removes all segments", async () => {
    await request(app).post("/tools/ecm").send({
      action: "store_segment",
      sessionId: SESSION,
      type: "conversation_turn",
      content: "hi",
    });
    const res = await request(app)
      .post("/tools/ecm")
      .send({ action: "clear_session", sessionId: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBe(1);
  });
});

describe("POST /tools/ecm — invalid action", () => {
  test("returns 400 for unknown action", async () => {
    const res = await request(app)
      .post("/tools/ecm")
      .send({ action: "retrieve_context", sessionId: SESSION });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_INPUT");
  });
});

describe("GET /tool-schema", () => {
  test("lists exactly the four supported actions", async () => {
    const res = await request(app).get("/tool-schema");
    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual([
      "on_user_turn",
      "store_segment",
      "clear_session",
      "get_status",
    ]);
  });
});
