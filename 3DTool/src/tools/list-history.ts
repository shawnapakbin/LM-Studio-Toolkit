import path from "path";
import { HistoryManager } from "../history-manager";

/**
 * list_history tool handler.
 * Returns backup entries for a given model file, ordered by timestamp descending.
 *
 * Validates: Requirements 7.1, 7.5
 */
export function listHistory(args: {
  filePath: string;
  workspaceRoot: string;
  limit?: number;
}): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  const { filePath, workspaceRoot, limit } = args;

  const historyManager = new HistoryManager(workspaceRoot);
  const absolutePath = path.resolve(workspaceRoot, filePath);
  const entries = historyManager.listHistory(absolutePath, limit);

  return {
    content: [{ type: "text", text: JSON.stringify(entries) }],
  };
}
