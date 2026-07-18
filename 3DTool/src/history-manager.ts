import fs from "fs";
import path from "path";
import { BackupEntry } from "./types";

/**
 * Manages the `.history/` backup directory for model files.
 * Provides backup creation, history listing, and rollback functionality.
 */
export class HistoryManager {
  private historyDir: string;

  constructor(private workspaceRoot: string) {
    this.historyDir = path.join(workspaceRoot, ".history");
  }

  /**
   * Creates a timestamped backup of the given file in the .history/ directory.
   * Creates the .history/ directory if it doesn't exist.
   * @param filePath - Absolute path to the file to back up
   * @returns The backup filename, or null if the source file doesn't exist
   */
  createBackup(filePath: string): string | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }

    const basename = path.basename(filePath);
    const timestamp = Date.now();
    const backupFilename = `${basename}.${timestamp}.bak`;
    const backupPath = path.join(this.historyDir, backupFilename);

    fs.copyFileSync(filePath, backupPath);

    return backupFilename;
  }

  /**
   * Lists backup entries for a given file, sorted by timestamp descending.
   * @param filePath - Absolute path to the original file
   * @param limit - Maximum number of entries to return (default 50)
   * @returns Array of BackupEntry sorted by timestamp descending
   */
  listHistory(filePath: string, limit = 50): BackupEntry[] {
    if (!fs.existsSync(this.historyDir)) {
      return [];
    }

    const basename = path.basename(filePath);
    const prefix = `${basename}.`;
    const suffix = ".bak";

    let files: string[];
    try {
      files = fs.readdirSync(this.historyDir);
    } catch {
      return [];
    }

    const entries: BackupEntry[] = [];

    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith(suffix)) {
        continue;
      }

      // Extract timestamp from filename: {basename}.{timestamp}.bak
      const timestampStr = file.slice(prefix.length, -suffix.length);
      const timestamp = Number(timestampStr);

      if (Number.isNaN(timestamp) || timestamp <= 0) {
        continue;
      }

      entries.push({
        id: file,
        timestamp,
      });
    }

    // Sort by timestamp descending (most recent first)
    entries.sort((a, b) => b.timestamp - a.timestamp);

    // Return up to the limit
    return entries.slice(0, limit);
  }

  /**
   * Rolls back a file to a previous backup state.
   * 1. Verifies the backup file exists in .history/
   * 2. Creates a backup of the current file (pre-rollback safety net)
   * 3. Copies backup content over the current file
   * @param backupId - The backup filename (e.g., "model.obj.1700000000000.bak")
   * @param filePath - Absolute path to the file to restore
   * @returns Object indicating success or failure with error message
   */
  rollback(backupId: string, filePath: string): { success: boolean; error?: string } {
    const backupPath = path.join(this.historyDir, backupId);

    // Step 1: Verify backup exists
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: "backup not found" };
    }

    // Step 2: Create backup of current file (pre-rollback safety net)
    if (fs.existsSync(filePath)) {
      this.createBackup(filePath);
    }

    // Step 3: Copy backup content over current file
    try {
      fs.copyFileSync(backupPath, filePath);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error during rollback";
      return { success: false, error: message };
    }
  }
}
