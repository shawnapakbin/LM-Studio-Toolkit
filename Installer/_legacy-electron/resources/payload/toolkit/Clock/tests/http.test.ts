/**
 * Clock HTTP Endpoint Integration Tests
 *
 * Tests the Clock HTTP API endpoint behavior.
 */

import request from "supertest";
import { app } from "../src/index";

describe("Clock HTTP Endpoints", () => {
  describe("GET /health", () => {
    it("should return health status", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        service: "lm-studio-clock-tool",
      });
    });
  });

  describe("GET /tool-schema", () => {
    it("should return tool schema", async () => {
      const response = await request(app).get("/tool-schema");

      expect(response.status).toBe(200);
      expect(response.body.name).toBe("get_current_datetime");
      expect(response.body.parameters.type).toBe("object");
    });
  });

  describe("POST /tools/get_current_datetime", () => {
    it("should return current datetime without parameters", async () => {
      const response = await request(app).post("/tools/get_current_datetime").send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.nowUtcIso).toBeDefined();
      expect(response.body.data.unixMs).toBeGreaterThan(0);
    });

    it("should accept valid IANA timezone", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ timeZone: "America/New_York" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.requestedTimeZone).toBe("America/New_York");
      expect(response.body.data.resolvedTimeZone).toBe("America/New_York");
    });

    it("should accept UTC timezone", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ timeZone: "UTC" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.requestedTimeZone).toBe("UTC");
    });

    it("should reject invalid timezone", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ timeZone: "Invalid/Timezone" });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Invalid IANA timezone");
    });

    it("should reject excessively long timezone", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ timeZone: "a".repeat(101) });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("too long");
    });

    it("should reject excessively long locale", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ locale: "a".repeat(21) });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("too long");
    });

    it("should accept valid locale", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ locale: "fr-FR" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.locale).toBe("fr-FR");
    });

    it("should normalize invalid locale to en-US", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ locale: "invalid-locale" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.locale).toBe("en-US");
    });

    it("should return correct date structure", async () => {
      const response = await request(app).post("/tools/get_current_datetime").send({});

      expect(response.status).toBe(200);
      expect(response.body.data.date).toBeDefined();
      expect(response.body.data.date.year).toBeGreaterThan(2020);
      expect(response.body.data.date.month).toBeGreaterThanOrEqual(1);
      expect(response.body.data.date.month).toBeLessThanOrEqual(12);
      expect(response.body.data.date.day).toBeGreaterThanOrEqual(1);
      expect(response.body.data.date.day).toBeLessThanOrEqual(31);
      expect(response.body.data.date.weekday).toBeDefined();
    });

    it("should return correct time structure", async () => {
      const response = await request(app).post("/tools/get_current_datetime").send({});

      expect(response.status).toBe(200);
      expect(response.body.data.time).toBeDefined();
      expect(response.body.data.time.hour).toBeGreaterThanOrEqual(0);
      expect(response.body.data.time.hour).toBeLessThanOrEqual(23);
      expect(response.body.data.time.minute).toBeGreaterThanOrEqual(0);
      expect(response.body.data.time.minute).toBeLessThanOrEqual(59);
      expect(response.body.data.time.second).toBeGreaterThanOrEqual(0);
      expect(response.body.data.time.second).toBeLessThanOrEqual(59);
    });

    it("should return timezone offset information", async () => {
      const response = await request(app)
        .post("/tools/get_current_datetime")
        .send({ timeZone: "America/New_York" });

      expect(response.status).toBe(200);
      expect(response.body.data.timezoneOffsetMinutes).toBeDefined();
      expect(response.body.data.timezoneNameShort).toBeDefined();
      expect(response.body.data.timezoneNameLong).toBeDefined();
    });

    it("should handle both timezone and locale together", async () => {
      const response = await request(app).post("/tools/get_current_datetime").send({
        timeZone: "Asia/Tokyo",
        locale: "ja-JP",
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.requestedTimeZone).toBe("Asia/Tokyo");
      expect(response.body.data.locale).toBe("ja-JP");
    });
  });
});
