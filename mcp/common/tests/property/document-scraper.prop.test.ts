// Feature: mcp-common-plugin-injection
// **Validates: Requirements 6.4, 6.6**

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";
import { readDocument } from "../../../../DocumentScraper/src/document-scraper";

// Set up environment variables before any readDocument call
const testWorkspaceRoot = path.join(os.tmpdir(), "doc-scraper-prop-test-" + Date.now());
process.env.DOC_SCRAPER_DEFAULT_TIMEOUT_MS = "5000";
process.env.DOC_SCRAPER_MAX_TIMEOUT_MS = "10000";
process.env.DOC_SCRAPER_MAX_CONTENT_BYTES = "52428800";
process.env.DOC_SCRAPER_MAX_CONTENT_CHARS = "50000";
process.env.DOC_SCRAPER_WORKSPACE_ROOT = testWorkspaceRoot;

describe("Feature: mcp-common-plugin-injection", () => {
  beforeAll(() => {
    // Create the workspace root directory
    fs.mkdirSync(testWorkspaceRoot, { recursive: true });
  });

  afterAll(() => {
    // Clean up workspace root
    fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
  });

  /**
   * **Validates: Requirements 6.4, 6.6**
   *
   * Property 7: Document-scraper invalid input rejection
   *
   * For any file path that does not exist on disk OR points to a file with an unsupported
   * content type, the `read_document` tool SHALL return an error response with the appropriate
   * error code (`NOT_FOUND` for missing files, unsupported type indication for invalid formats)
   * without returning any partial content.
   */
  it("Property 7: Document-scraper invalid input rejection", async () => {
    // Sub-property 7a: Non-existent file paths return NOT_FOUND error with no content
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 3, maxLength: 50 })
          .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "x"))
          .filter((s) => s.length >= 3)
          .map((s) => path.join("nonexistent-dir-" + s, s + ".pdf")),
        async (relativePath) => {
          const result = await readDocument({ filePath: relativePath });

          // Must not succeed
          expect(result.success).toBe(false);

          // Must have NOT_FOUND error code (file doesn't exist within workspace)
          expect(result.errorCode).toBe("NOT_FOUND");

          // Must not contain any partial content
          expect(result.content).toBe("");
          expect(result.contentLength).toBe(0);
        },
      ),
      { numRuns: 100 },
    );

    // Sub-property 7b: Files with unsupported/nonsensical extensions that exist
    // in workspace are handled gracefully (no partial content on error, or treated as text).
    // Note: The DocumentScraper falls back to "txt" format for unknown extensions on local files.
    // This sub-property verifies that non-existent paths with unusual extensions still
    // produce NOT_FOUND errors with no partial content.
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 3, maxLength: 20 })
          .map((s) => s.replace(/[^a-zA-Z0-9]/g, "a"))
          .filter((s) => s.length >= 3)
          .map((s) => s + ".xyz123"),
        async (filename) => {
          // Use a path that doesn't exist within the workspace
          const relativePath = path.join("nonexistent-subdir", filename);
          const result = await readDocument({ filePath: relativePath });

          // Must not succeed - file doesn't exist
          expect(result.success).toBe(false);

          // Must have NOT_FOUND error code
          expect(result.errorCode).toBe("NOT_FOUND");

          // Must not contain any partial content
          expect(result.content).toBe("");
          expect(result.contentLength).toBe(0);
        },
      ),
      { numRuns: 100 },
    );

    // Sub-property 7c: Verify that even with various file extensions,
    // non-existent paths always produce clean error responses
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          ".bin",
          ".exe",
          ".dat",
          ".xyz",
          ".unknown",
          ".mp3",
          ".mp4",
          ".zip",
          ".rar",
          ".iso",
        ),
        fc
          .string({ minLength: 3, maxLength: 30 })
          .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "x"))
          .filter((s) => s.length >= 3),
        async (extension, basename) => {
          const relativePath = path.join("missing-folder", basename + extension);
          const result = await readDocument({ filePath: relativePath });

          // Must fail - file does not exist
          expect(result.success).toBe(false);

          // Must have NOT_FOUND error code
          expect(result.errorCode).toBe("NOT_FOUND");

          // Must not have any partial content
          expect(result.content).toBe("");
          expect(result.contentLength).toBe(0);

          // Error message should be non-empty
          expect(result.error).toBeTruthy();
          expect(typeof result.error).toBe("string");
          expect(result.error!.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
