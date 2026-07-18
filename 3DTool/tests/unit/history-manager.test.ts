import fs from "fs";
import os from "os";
import path from "path";
import { HistoryManager } from "../../src/history-manager";

describe("HistoryManager", () => {
  let tmpDir: string;
  let historyManager: HistoryManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
    historyManager = new HistoryManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createBackup", () => {
    it("should create a backup file in .history/ directory", () => {
      const filePath = path.join(tmpDir, "model.obj");
      fs.writeFileSync(filePath, "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");

      const backupFilename = historyManager.createBackup(filePath);

      expect(backupFilename).not.toBeNull();
      expect(backupFilename).toMatch(/^model\.obj\.\d+\.bak$/);

      const backupPath = path.join(tmpDir, ".history", backupFilename!);
      expect(fs.existsSync(backupPath)).toBe(true);

      const backupContent = fs.readFileSync(backupPath, "utf-8");
      expect(backupContent).toBe("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
    });

    it("should create .history/ directory if it doesn't exist", () => {
      const filePath = path.join(tmpDir, "test.obj");
      fs.writeFileSync(filePath, "content");

      const historyDir = path.join(tmpDir, ".history");
      expect(fs.existsSync(historyDir)).toBe(false);

      historyManager.createBackup(filePath);

      expect(fs.existsSync(historyDir)).toBe(true);
    });

    it("should return null if source file doesn't exist", () => {
      const filePath = path.join(tmpDir, "nonexistent.obj");

      const result = historyManager.createBackup(filePath);

      expect(result).toBeNull();
    });

    it("should use format {basename}.{timestamp}.bak", () => {
      const filePath = path.join(tmpDir, "scene.glb");
      fs.writeFileSync(filePath, "binary-data");

      const before = Date.now();
      const backupFilename = historyManager.createBackup(filePath)!;
      const after = Date.now();

      const match = backupFilename.match(/^scene\.glb\.(\d+)\.bak$/);
      expect(match).not.toBeNull();

      const timestamp = Number(match![1]);
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("listHistory", () => {
    it("should return empty array when no backups exist", () => {
      const filePath = path.join(tmpDir, "model.obj");

      const result = historyManager.listHistory(filePath);

      expect(result).toEqual([]);
    });

    it("should return empty array when .history/ directory doesn't exist", () => {
      const filePath = path.join(tmpDir, "model.obj");

      const result = historyManager.listHistory(filePath);

      expect(result).toEqual([]);
    });

    it("should return entries sorted by timestamp descending", () => {
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      // Create backups with known timestamps
      fs.writeFileSync(path.join(historyDir, "model.obj.1000.bak"), "v1");
      fs.writeFileSync(path.join(historyDir, "model.obj.3000.bak"), "v3");
      fs.writeFileSync(path.join(historyDir, "model.obj.2000.bak"), "v2");

      const filePath = path.join(tmpDir, "model.obj");
      const result = historyManager.listHistory(filePath);

      expect(result).toHaveLength(3);
      expect(result[0].timestamp).toBe(3000);
      expect(result[1].timestamp).toBe(2000);
      expect(result[2].timestamp).toBe(1000);
    });

    it("should only return entries matching the given file basename", () => {
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      fs.writeFileSync(path.join(historyDir, "model.obj.1000.bak"), "a");
      fs.writeFileSync(path.join(historyDir, "other.obj.2000.bak"), "b");
      fs.writeFileSync(path.join(historyDir, "model.obj.3000.bak"), "c");

      const filePath = path.join(tmpDir, "model.obj");
      const result = historyManager.listHistory(filePath);

      expect(result).toHaveLength(2);
      expect(result.every((e) => e.id.startsWith("model.obj."))).toBe(true);
    });

    it("should respect the limit parameter", () => {
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      for (let i = 1; i <= 10; i++) {
        fs.writeFileSync(path.join(historyDir, `model.obj.${i * 1000}.bak`), `v${i}`);
      }

      const filePath = path.join(tmpDir, "model.obj");
      const result = historyManager.listHistory(filePath, 3);

      expect(result).toHaveLength(3);
      // Should be the 3 most recent
      expect(result[0].timestamp).toBe(10000);
      expect(result[1].timestamp).toBe(9000);
      expect(result[2].timestamp).toBe(8000);
    });

    it("should default limit to 50", () => {
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      for (let i = 1; i <= 60; i++) {
        fs.writeFileSync(path.join(historyDir, `model.obj.${i * 1000}.bak`), `v${i}`);
      }

      const filePath = path.join(tmpDir, "model.obj");
      const result = historyManager.listHistory(filePath);

      expect(result).toHaveLength(50);
    });

    it("should ignore files with invalid timestamp format", () => {
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      fs.writeFileSync(path.join(historyDir, "model.obj.abc.bak"), "bad");
      fs.writeFileSync(path.join(historyDir, "model.obj.1000.bak"), "good");
      fs.writeFileSync(path.join(historyDir, "model.obj..bak"), "empty");

      const filePath = path.join(tmpDir, "model.obj");
      const result = historyManager.listHistory(filePath);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("model.obj.1000.bak");
    });
  });

  describe("rollback", () => {
    it("should restore file content from backup", () => {
      const filePath = path.join(tmpDir, "model.obj");
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      // Write original backup content
      const backupContent = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
      fs.writeFileSync(path.join(historyDir, "model.obj.1000.bak"), backupContent);

      // Write current file with different content
      fs.writeFileSync(filePath, "v 0 0 0\nv 1 1 1\nf 1 2\n");

      const result = historyManager.rollback("model.obj.1000.bak", filePath);

      expect(result).toEqual({ success: true });
      expect(fs.readFileSync(filePath, "utf-8")).toBe(backupContent);
    });

    it("should create a pre-rollback backup of current file", () => {
      const filePath = path.join(tmpDir, "model.obj");
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      const currentContent = "current content";
      fs.writeFileSync(filePath, currentContent);
      fs.writeFileSync(path.join(historyDir, "model.obj.1000.bak"), "old content");

      historyManager.rollback("model.obj.1000.bak", filePath);

      // Should have 2 files in .history/: the original backup + the pre-rollback backup
      const historyFiles = fs
        .readdirSync(historyDir)
        .filter((f) => f.startsWith("model.obj.") && f.endsWith(".bak"));
      expect(historyFiles.length).toBe(2);

      // The pre-rollback backup should contain the current content
      const preRollbackFile = historyFiles.find((f) => f !== "model.obj.1000.bak");
      expect(preRollbackFile).toBeDefined();
      const preRollbackContent = fs.readFileSync(path.join(historyDir, preRollbackFile!), "utf-8");
      expect(preRollbackContent).toBe(currentContent);
    });

    it("should return error if backup doesn't exist", () => {
      const filePath = path.join(tmpDir, "model.obj");
      fs.writeFileSync(filePath, "content");

      const result = historyManager.rollback("nonexistent.bak", filePath);

      expect(result).toEqual({ success: false, error: "backup not found" });
    });

    it("should succeed even if current file doesn't exist (skip pre-rollback backup)", () => {
      const filePath = path.join(tmpDir, "model.obj");
      const historyDir = path.join(tmpDir, ".history");
      fs.mkdirSync(historyDir);

      fs.writeFileSync(path.join(historyDir, "model.obj.1000.bak"), "backup content");

      const result = historyManager.rollback("model.obj.1000.bak", filePath);

      expect(result).toEqual({ success: true });
      expect(fs.readFileSync(filePath, "utf-8")).toBe("backup content");
    });
  });
});
