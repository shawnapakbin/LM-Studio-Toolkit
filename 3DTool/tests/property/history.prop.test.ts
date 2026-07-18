// Feature: 3dtool-viewer-improvements, Property 14: Rollback Content Restoration
// **Validates: Requirements 7.2, 7.3**

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";
import { HistoryManager } from "../../src/history-manager";

/**
 * Property 14: Rollback Content Restoration
 *
 * For any model file with at least one backup, calling rollback with a valid
 * backup identifier SHALL restore the file content to exactly match the backup
 * content, and the pre-rollback content SHALL exist as a new backup entry.
 */

describe("Property 14: Rollback Content Restoration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "history-rollback-"));
    tempDirs.push(dir);
    return dir;
  }

  // Generator for arbitrary file content (printable ASCII to avoid encoding issues)
  const fileContent = fc.stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n\t!@#$%^&*()-_=+[]{}|;:',.<>?/".split(
        "",
      ),
    ),
    { minLength: 1, maxLength: 200 },
  );

  it("rollback restores file content to match backup and saves pre-rollback as new backup", () => {
    fc.assert(
      fc.property(fileContent, fileContent, (originalContent, modifiedContent) => {
        // Ensure contents are different so the test is meaningful
        fc.pre(originalContent !== modifiedContent);

        // Create a fresh temp directory per iteration to isolate state
        const tempDir = createTempDir();
        const historyManager = new HistoryManager(tempDir);
        const modelFile = path.join(tempDir, "model.obj");

        // Step 1: Write the original content and create a backup
        fs.writeFileSync(modelFile, originalContent, "utf-8");
        const backupId = historyManager.createBackup(modelFile);
        expect(backupId).not.toBeNull();

        // Step 2: Modify the file with different content
        fs.writeFileSync(modelFile, modifiedContent, "utf-8");

        // Verify file now has modified content
        expect(fs.readFileSync(modelFile, "utf-8")).toBe(modifiedContent);

        // Step 3: Rollback to the backup
        const result = historyManager.rollback(backupId!, modelFile);
        expect(result.success).toBe(true);

        // Assert 1: File content now matches the original (backup) content
        const restoredContent = fs.readFileSync(modelFile, "utf-8");
        expect(restoredContent).toBe(originalContent);

        // Assert 2: A new backup exists containing the modified (pre-rollback) content
        const history = historyManager.listHistory(modelFile);

        // Assert 3: listHistory now has 2 entries (the original backup + the pre-rollback backup)
        expect(history.length).toBe(2);

        // Find the pre-rollback backup (should be newer than the original backup)
        const preRollbackEntry = history.find((entry) => entry.id !== backupId);
        expect(preRollbackEntry).toBeDefined();

        // Verify the pre-rollback backup contains the modified content
        const historyDir = path.join(tempDir, ".history");
        const preRollbackPath = path.join(historyDir, preRollbackEntry!.id);
        const preRollbackContent = fs.readFileSync(preRollbackPath, "utf-8");
        expect(preRollbackContent).toBe(modifiedContent);
      }),
      { numRuns: 100 },
    );
  });
});
