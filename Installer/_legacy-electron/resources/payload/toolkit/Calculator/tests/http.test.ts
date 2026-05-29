/**
 * Calculator HTTP Endpoint Integration Tests
 *
 * Tests the Calculator HTTP API endpoint behavior.
 */

import request from "supertest";
import { app } from "../src/index";

describe("Calculator HTTP Endpoints", () => {
  describe("GET /health", () => {
    it("should return health status", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        service: "lm-studio-calculator-tool",
      });
    });
  });

  describe("GET /tool-schema", () => {
    it("should return tool schema", async () => {
      const response = await request(app).get("/tool-schema");

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("calculate_engineering");
      expect(response.body.parameters.required).toContain("expression");
    });
  });

  describe("POST /tools/calculate_engineering", () => {
    it("should reject request without expression", async () => {
      const response = await request(app).post("/tools/calculate_engineering").send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("required");
    });

    it("should reject empty expression", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "   " });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("required");
    });

    it("should reject expressions that are too long", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "a".repeat(1001) });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("too long");
    });

    it("should reject expressions with unsafe patterns (import)", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "import fs" });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("unsafe patterns");
    });

    it("should reject expressions with unsafe patterns (require)", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "require('fs')" });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("unsafe patterns");
    });

    it("should reject expressions with unsafe patterns (eval)", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "eval('2+2')" });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("unsafe patterns");
    });

    it("should reject expressions with arrow functions", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "() => 42" });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain("unsafe patterns");
    });

    it("should evaluate simple arithmetic expressions", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "2 + 2" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.value).toBe("4");
    });

    it("should evaluate trigonometric expressions", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "sin(30°)" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Number.parseFloat(response.body.value)).toBeCloseTo(0.5, 5);
    });

    it("should handle precision parameter", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "pi", precision: 5 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.precision).toBe(5);
    });

    it("should clamp precision to maximum", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "pi", precision: 100 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.precision).toBe(20); // MAX_PRECISION
    });

    it("should clamp precision to minimum", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "pi", precision: 0 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.precision).toBe(2); // MIN_PRECISION
    });

    it("should return error for invalid expressions", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "invalid$$expression" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it("should evaluate engineering notation", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "10k" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.value).toBe("10000");
    });

    it("should handle square root symbol", async () => {
      const response = await request(app)
        .post("/tools/calculate_engineering")
        .send({ expression: "sqrt(16)" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.value).toBe("4");
    });
  });
});
