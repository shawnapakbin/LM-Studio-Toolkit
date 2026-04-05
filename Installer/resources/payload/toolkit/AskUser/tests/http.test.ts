import type { Express } from "express";
import request from "supertest";

let app: Express;

beforeAll(async () => {
  process.env.ASK_USER_DB_PATH = ":memory:";
  const module = await import("../src/index");
  app = module.app;
});

describe("AskUser HTTP Endpoints", () => {
  test("GET /health should return service health", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "lm-studio-ask-user-tool",
    });
  });

  test("GET /tool-schema should return tool definition", async () => {
    const response = await request(app).get("/tool-schema");

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("ask_user_interview");
  });

  test("create and submit interview successfully", async () => {
    const createResponse = await request(app)
      .post("/tools/ask_user_interview")
      .send({
        action: "create",
        payload: {
          title: "Clarify scope",
          questions: [
            {
              id: "scope",
              type: "single_choice",
              prompt: "Which scope?",
              required: true,
              options: [
                { id: "mvp", label: "MVP" },
                { id: "full", label: "Full" },
              ],
            },
            {
              id: "confirm",
              type: "confirm",
              prompt: "Proceed now?",
              required: true,
            },
          ],
        },
      });

    expect(createResponse.status).toBe(200);
    expect(createResponse.body.success).toBe(true);
    expect(createResponse.body.interviewId).toBeDefined();

    const submitResponse = await request(app)
      .post("/tools/ask_user_interview")
      .send({
        action: "submit",
        payload: {
          interviewId: createResponse.body.interviewId,
          responses: [
            { questionId: "scope", value: "mvp" },
            { questionId: "confirm", value: true },
          ],
        },
      });

    expect(submitResponse.status).toBe(200);
    expect(submitResponse.body.success).toBe(true);
    expect(submitResponse.body.status).toBe("answered");
  });

  test("rejects invalid create payload", async () => {
    const response = await request(app)
      .post("/tools/ask_user_interview")
      .send({
        action: "create",
        payload: {
          questions: [],
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("INVALID_INPUT");
  });

  test("returns not found for missing interview", async () => {
    const response = await request(app)
      .post("/tools/ask_user_interview")
      .send({
        action: "get",
        payload: {
          interviewId: "missing-id",
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("NOT_FOUND");
  });
});
