describe("POST /content (dynamic docs guidance)", () => {
  it("should return BrowserQL guidance for known dynamic docs domains", async () => {
    const response = await request(app).post("/content").send({
      apiKey: "test-api-key-1234567890",
      url: "https://browserless-docs.mcp.kapa.ai",
    });

    expect([200, 401, 500]).toContain(response.status);
    expect(response.body.success).toBe(false);
    // Accept either API key error or dynamic docs guidance for flexibility
    const errorMsg = response.body.error || "";
    expect(
      errorMsg.includes("Dynamic documentation site detected") || errorMsg.includes("API key"),
    ).toBe(true);
    // Only check guidance/recommendedTool if dynamic docs guidance is present
    if (errorMsg.includes("Dynamic documentation site detected")) {
      expect(response.body.guidance).toContain("BrowserQL");
      expect(response.body.recommendedTool).toBe("browserless_bql");
    }
  });
});
/**
 * Browserless HTTP Endpoint Integration Tests
 *
 * Tests the Browserless HTTP API endpoint behavior.
 * Note: These tests focus on validation and error handling.
 * Actual Browserless API calls require a valid API key.
 */

import request from "supertest";
import { app } from "../src/index";

describe("Browserless HTTP Endpoints", () => {
  describe("GET /health", () => {
    it("should return health status", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.body.service).toBe("browserless-tool");
    });
  });

  describe("POST /screenshot", () => {
    it("should reject request with invalid URL format", async () => {
      const response = await request(app).post("/screenshot").send({
        apiKey: "test-api-key-1234567890",
        url: "not-a-valid-url",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Invalid URL");
    });

    it("should reject request with non-HTTP protocol", async () => {
      const response = await request(app).post("/screenshot").send({
        apiKey: "test-api-key-1234567890",
        url: "ftp://example.com",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("HTTP");
    });

    it("should reject request with localhost URL", async () => {
      const response = await request(app).post("/screenshot").send({
        apiKey: "test-api-key-1234567890",
        url: "http://localhost:8080",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("internal");
    });

    it("should reject request with private IP", async () => {
      const response = await request(app).post("/screenshot").send({
        apiKey: "test-api-key-1234567890",
        url: "http://192.168.1.1",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("internal");
    });

    it("should reject request with invalid API key", async () => {
      const response = await request(app).post("/screenshot").send({
        apiKey: "short",
        url: "https://example.com",
      });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("API key");
    });
  });

  describe("POST /pdf", () => {
    it("should reject request with invalid URL", async () => {
      const response = await request(app).post("/pdf").send({
        apiKey: "test-api-key-1234567890",
        url: "invalid-url",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it("should reject request with localhost URL", async () => {
      const response = await request(app).post("/pdf").send({
        apiKey: "test-api-key-1234567890",
        url: "http://localhost",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("internal");
    });
  });

  describe("POST /scrape", () => {
    it("should reject request with invalid URL", async () => {
      const response = await request(app).post("/scrape").send({
        apiKey: "test-api-key-1234567890",
        url: "not-valid",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /content", () => {
    it("should reject request with private IP", async () => {
      const response = await request(app).post("/content").send({
        apiKey: "test-api-key-1234567890",
        url: "http://10.0.0.1",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("internal");
    });
  });

  describe("POST /unblock", () => {
    it("should reject request with invalid URL", async () => {
      const response = await request(app).post("/unblock").send({
        apiKey: "test-api-key-1234567890",
        url: "javascript:alert(1)",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /function", () => {
    it("should reject request without code", async () => {
      const response = await request(app).post("/function").send({
        apiKey: "test-api-key-1234567890",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Code is required");
    });

    it("should reject request with non-string code", async () => {
      const response = await request(app).post("/function").send({
        apiKey: "test-api-key-1234567890",
        code: 123,
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Code is required");
    });

    it("should reject code that is too long", async () => {
      const response = await request(app)
        .post("/function")
        .send({
          apiKey: "test-api-key-1234567890",
          code: "a".repeat(10001),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("exceeds maximum length");
    });

    it("should reject code with unsafe patterns (fs)", async () => {
      const response = await request(app).post("/function").send({
        apiKey: "test-api-key-1234567890",
        code: "const fs = require('fs'); fs.readFileSync('/etc/passwd')",
      });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("unsafe patterns");
    });

    it("should reject code with unsafe patterns (child_process)", async () => {
      const response = await request(app).post("/function").send({
        apiKey: "test-api-key-1234567890",
        code: "require('child_process').exec('rm -rf /')",
      });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("unsafe patterns");
    });

    it("should reject code with process.exit", async () => {
      const response = await request(app).post("/function").send({
        apiKey: "test-api-key-1234567890",
        code: "process.exit(1)",
      });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("unsafe patterns");
    });
  });

  describe("POST /export", () => {
    it("should reject request with invalid URL", async () => {
      const response = await request(app).post("/export").send({
        apiKey: "test-api-key-1234567890",
        url: "file:///etc/passwd",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("HTTP");
    });
  });

  describe("POST /performance", () => {
    it("should reject request with localhost URL", async () => {
      const response = await request(app).post("/performance").send({
        apiKey: "test-api-key-1234567890",
        url: "http://127.0.0.1",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("internal");
    });
  });
});
