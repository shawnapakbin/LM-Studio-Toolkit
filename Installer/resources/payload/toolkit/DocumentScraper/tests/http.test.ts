import os from "os";
import path from "path";
import fs from "fs/promises";
import request from "supertest";
import { app } from "../src/index";

describe("DocumentScraper HTTP endpoints", () => {
  const tempRoot = path.join(os.tmpdir(), "document-scraper-http-tests");

  beforeAll(async () => {
    process.env.DOC_SCRAPER_WORKSPACE_ROOT = tempRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    delete process.env.DOC_SCRAPER_WORKSPACE_ROOT;
  });

  test("returns health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  test("reads local markdown file", async () => {
    await fs.writeFile(
      path.join(tempRoot, "sample.md"),
      "# Title\n\nThis is a sample markdown document.",
      "utf8",
    );

    const response = await request(app)
      .post("/tools/read_document")
      .send({ filePath: "sample.md" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.format).toBe("markdown");
    expect(response.body.data.description.text.length).toBeGreaterThan(0);
  });

  test("notifies user when PDF appears encrypted", async () => {
    const encryptedPdfLike = "%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\n";
    await fs.writeFile(path.join(tempRoot, "encrypted.pdf"), encryptedPdfLike, "latin1");

    const response = await request(app)
      .post("/tools/read_document")
      .send({ filePath: "encrypted.pdf", profile: "mvp" });

    expect(response.status).toBe(423);
    expect(response.body.success).toBe(false);
    expect(response.body.data.isEncrypted).toBe(true);
    expect(response.body.data.encryptionStatusCode).toBe("PDF_ENCRYPTED");
    expect(response.body.data.encryptionUserMessage).toContain("encrypted");
  });

  test("returns 400 for missing input", async () => {
    const response = await request(app).post("/tools/read_document").send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
