import fs from "fs";
import path from "path";
import { HistoryManager } from "./history-manager";
import { triggerReload } from "./http-server";
import { validateObj } from "./obj-validator";
import type { ValidationReport } from "./types";

/**
 * Result of an editFile operation.
 */
export interface EditResult {
  success: boolean;
  backupPath?: string;
  error?: string;
  validation?: ValidationReport;
}

/**
 * Writes content to a 3D model file with validation (OBJ) and backup support.
 *
 * Algorithm:
 * 1. Resolve absolute path from filePath + workspaceRoot
 * 2. If the file already exists, create a backup via HistoryManager
 * 3. If format is 'obj': validate content, then write regardless of validation result
 * 4. If format is 'glb': write the Buffer directly (no validation)
 * 5. Trigger SSE reload to notify the viewer
 * 6. Return EditResult with success, backupPath, and validation report
 *
 * @param filePath - Relative path to the model file
 * @param workspaceRoot - Absolute workspace root directory
 * @param content - String for OBJ, Buffer (base64-decoded) for GLB
 * @param format - 'obj' or 'glb'
 */
export function editFile(
  filePath: string,
  workspaceRoot: string,
  content: string | Buffer,
  format: "obj" | "glb",
): EditResult {
  try {
    const absolutePath = path.resolve(workspaceRoot, filePath);

    // Ensure the target directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create backup if file already exists
    let backupPath: string | undefined;
    if (fs.existsSync(absolutePath)) {
      const historyManager = new HistoryManager(workspaceRoot);
      const backupFilename = historyManager.createBackup(absolutePath);
      if (backupFilename) {
        backupPath = backupFilename;
      }
    }

    let validation: ValidationReport | undefined;

    if (format === "obj") {
      // Validate OBJ content
      const objContent = content as string;
      validation = validateObj(objContent);

      // Write the file regardless of validation result (per Requirement 3.4)
      fs.writeFileSync(absolutePath, objContent, "utf-8");
    } else {
      // GLB: write buffer directly, no validation
      const bufferContent = content as Buffer;
      fs.writeFileSync(absolutePath, bufferContent);
    }

    // Trigger viewer reload via SSE
    triggerReload();

    const result: EditResult = {
      success: true,
    };

    if (backupPath) {
      result.backupPath = backupPath;
    }

    if (validation) {
      result.validation = validation;
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during file edit";
    return { success: false, error: message };
  }
}
