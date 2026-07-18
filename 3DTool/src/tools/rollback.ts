import path from "path";
import { HistoryManager } from "../history-manager";
import { sceneManager } from "../shared-state";

/**
 * rollback tool handler.
 * Restores a model file from a backup entry and triggers a viewer reload.
 *
 * Validates: Requirements 7.2, 7.3, 7.4
 */
export function rollback(args: {
  backupId: string;
  filePath: string;
  workspaceRoot: string;
}): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  const { backupId, filePath, workspaceRoot } = args;

  const historyManager = new HistoryManager(workspaceRoot);
  const absolutePath = path.resolve(workspaceRoot, filePath);
  const result = historyManager.rollback(backupId, absolutePath);

  if (!result.success) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${result.error}` }],
    };
  }

  // Trigger viewer reload after successful rollback
  sceneManager.triggerReload();

  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, backupId, filePath }) }],
  };
}
