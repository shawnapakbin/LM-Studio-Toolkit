// Must be set before any import that triggers the store singleton
process.env.SKILLS_DB_PATH = ":memory:";

import type { Express } from "express";
import request from "supertest";

let app: Express;

const sampleSkill = {
  name: "test-skill",
  description: "A test skill",
  paramSchema: {
    type: "object",
    properties: { target: { type: "string" } },
    required: ["target"],
  },
  steps: [
    { type: "prompt", template: "Hello {{target}}" },
    { type: "tool_call", tool: "terminal", args: { command: "echo {{target}}" } },
  ],
};

beforeAll(async () => {
  const module = await import("../src/index");
  app = module.app;
});

describe("Skills HTTP Endpoints", () => {
  // 1. GET /health
  test("GET /health returns 200 with ok: true", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // 2. GET /tool-schema
  test("GET /tool-schema returns 200 with name: skills", async () => {
    const res = await request(app).get("/tool-schema");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("skills");
  });

  // 3. POST /tools/skills with missing action → 400
  test("POST /tools/skills with missing action returns 400", async () => {
    const res = await request(app).post("/tools/skills").send({ name: "test-skill" });
    expect(res.status).toBe(400);
  });

  // 4. define_skill valid payload → 200, success: true, version: 1
  test("define_skill with valid payload returns 200 and version 1", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "define_skill", ...sampleSkill });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("test-skill");
    expect(res.body.data.version).toBe(1);
  });

  // 5. define_skill same name again → 200, version: 2
  test("define_skill same name again returns version 2 (upsert)", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "define_skill", ...sampleSkill, description: "Updated description" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe(2);
  });

  // 6. define_skill with invalid name (not kebab-case) → 400, success: false
  test("define_skill with invalid name returns 400", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "define_skill", ...sampleSkill, name: "Invalid Name!" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // 7. define_skill with empty steps → 400, success: false
  test("define_skill with empty steps returns 400", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "define_skill", ...sampleSkill, name: "empty-steps-skill", steps: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // 8. execute_skill with valid params → 200, success: true, correct interpolation
  test("execute_skill with valid params returns resolved steps", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "execute_skill", name: "test-skill", params: { target: "world" } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const steps = res.body.data.resolvedSteps;
    expect(steps[0].text).toBe("Hello world");
    expect(steps[1].args.command).toBe("echo world");
  });

  // 9. execute_skill with missing required param → 400, success: false
  test("execute_skill with missing required param returns 400", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "execute_skill", name: "test-skill", params: {} });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // 10. execute_skill with unknown skill name → 404, success: false
  test("execute_skill with unknown skill name returns 404", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "execute_skill", name: "no-such-skill", params: { target: "x" } });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // 11. get_skill by name → 200, success: true
  test("get_skill by name returns 200", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "get_skill", name: "test-skill" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("test-skill");
  });

  // 12. get_skill unknown name → 404
  test("get_skill unknown name returns 404", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "get_skill", name: "ghost-skill" });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // 13. list_skills → 200, success: true, returns array
  test("list_skills returns 200 with skills array", async () => {
    const res = await request(app).post("/tools/skills").send({ action: "list_skills" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.skills)).toBe(true);
  });

  // 14. delete_skill by name → 200, success: true, deleted: true
  test("delete_skill by name returns 200 with deleted: true", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "delete_skill", name: "test-skill" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);
  });

  // 15. delete_skill unknown name → 404
  test("delete_skill unknown name returns 404", async () => {
    const res = await request(app)
      .post("/tools/skills")
      .send({ action: "delete_skill", name: "test-skill" });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
