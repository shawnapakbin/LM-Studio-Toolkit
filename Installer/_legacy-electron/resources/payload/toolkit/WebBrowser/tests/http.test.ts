import request from "supertest";
import { app } from "../src/index";

describe("WebBrowser HTTP endpoint hardening", () => {
  test("rejects missing url", async () => {
    const response = await request(app).post("/tools/browse_web").send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("INVALID_INPUT");
  });

  test("rejects non-http(s) url", async () => {
    const response = await request(app)
      .post("/tools/browse_web")
      .send({ url: "file:///etc/passwd" });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("INVALID_INPUT");
  });

  test("blocks localhost SSRF target", async () => {
    const response = await request(app)
      .post("/tools/browse_web")
      .send({ url: "http://localhost:3000" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("POLICY_BLOCKED");
  });

  test("blocks private network SSRF target", async () => {
    const response = await request(app)
      .post("/tools/browse_web")
      .send({ url: "http://192.168.1.10" });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.errorCode).toBe("POLICY_BLOCKED");
  });
});
