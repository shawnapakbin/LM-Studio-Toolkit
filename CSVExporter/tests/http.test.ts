/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import os from "os";
import path from "path";
import fs from "fs/promises";
import request from "supertest";
import { app } from "../src/index";

describe("CSV Exporter HTTP endpoints", () => {
  const tempRoot = path.join(os.tmpdir(), "csv-exporter-http-tests");

  beforeAll(async () => {
    process.env.CSV_EXPORT_ROOT = tempRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    delete process.env.CSV_EXPORT_ROOT;
  });

  it("returns health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("returns schema", async () => {
    const response = await request(app).get("/tool-schema");
    expect(response.status).toBe(200);
    expect(response.body.name).toBe("save_parsed_data_csv");
  });

  it("creates csv and appends rows on second call", async () => {
    const first = await request(app)
      .post("/tools/save_parsed_data_csv")
      .send({
        filename: "team-metrics",
        subfolder: "exports",
        headers: ["name", "score"],
        rows: [["alice", 91]],
      });

    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    const second = await request(app)
      .post("/tools/save_parsed_data_csv")
      .send({
        filename: "team-metrics",
        subfolder: "exports",
        headers: ["name", "score"],
        rows: [["bob", 95]],
        append: true,
      });

    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.appended).toBe(true);

    const filePath = path.join(tempRoot, "exports", "team-metrics.csv");
    const content = await fs.readFile(filePath, "utf8");

    expect(content).toContain("name,score");
    expect(content).toContain("alice,91");
    expect(content).toContain("bob,95");
  });

  it("rejects invalid rows", async () => {
    const response = await request(app)
      .post("/tools/save_parsed_data_csv")
      .send({
        filename: "bad",
        headers: ["name", "score"],
        rows: [["alice"]],
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain("expected");
  });
});
