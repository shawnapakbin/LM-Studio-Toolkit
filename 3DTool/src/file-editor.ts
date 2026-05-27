import fs from "fs";
import path from "path";
import { stateManager } from "./state";

export function backupAndEditFile(
  filePath: string,
  workspaceRoot: string,
  newContent: string,
): { success: boolean; backupPath?: string; error?: string } {
  try {
    const absoluteWorkspace = path.resolve(workspaceRoot);
    const absolutePath = path.resolve(absoluteWorkspace, filePath);
    // Ensure absolutePath is inside the workspace (add sep to prevent prefix attacks)
    if (!absolutePath.startsWith(absoluteWorkspace + path.sep) && absolutePath !== absoluteWorkspace) {
      return { success: false, error: "Path out of workspace bounds" };
    }

    if (fs.existsSync(absolutePath)) {
      // Create backup
      const historyDir = path.join(absoluteWorkspace, ".history");
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }
      const timestamp = Date.now();
      const backupFileName = `${path.basename(absolutePath)}.${timestamp}.bak`;
      const backupPath = path.join(historyDir, backupFileName);
      fs.copyFileSync(absolutePath, backupPath);

      fs.writeFileSync(absolutePath, newContent, "utf-8");
      stateManager.triggerReload();
      return { success: true, backupPath };
    } else {
      // File doesn't exist yet, just write
      fs.writeFileSync(absolutePath, newContent, "utf-8");
      stateManager.triggerReload();
      return { success: true };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function getObjMetadata(filePath: string, workspaceRoot: string): any {
  try {
    const absoluteWorkspace = path.resolve(workspaceRoot);
    const absolutePath = path.resolve(absoluteWorkspace, filePath);
    if (
      (!absolutePath.startsWith(absoluteWorkspace + path.sep) && absolutePath !== absoluteWorkspace) ||
      !fs.existsSync(absolutePath)
    ) {
      return { success: false, error: "File not found or out of bounds" };
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const content = fs.readFileSync(absolutePath, "utf-8");

    if (ext === ".obj") {
      const lines = content.split("\n");
      let vCount = 0;
      let fCount = 0;
      const groups = new Set<string>();
      const materials = new Set<string>();

      for (const line of lines) {
        const l = line.trim();
        if (l.startsWith("v ")) vCount++;
        else if (l.startsWith("f ")) fCount++;
        else if (l.startsWith("g ") || l.startsWith("o ")) {
          groups.add(l.substring(2).trim());
        } else if (l.startsWith("usemtl ")) {
          materials.add(l.substring(7).trim());
        }
      }

      return {
        success: true,
        data: {
          format: "obj",
          vertices: vCount,
          faces: fCount,
          groups: Array.from(groups),
          materials: Array.from(materials),
          fileSize: content.length,
        },
      };
    }

    // Generic fallback for other formats
    return {
      success: true,
      data: {
        format: ext.replace(".", ""),
        fileSize: content.length,
        note: "Detailed metadata parsing currently supports .obj in this implementation.",
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
