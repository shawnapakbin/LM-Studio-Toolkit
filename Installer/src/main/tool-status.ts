import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { TOOL_DESCRIPTORS } from "./mcp-config";
import type { ToolStatus } from "./types";

export function getToolStatuses(installRoot: string): ToolStatus[] {
  return TOOL_DESCRIPTORS.map((tool) => {
    const scriptPath = join(installRoot, tool.relativeScript);
    const binaryExists = existsSync(scriptPath);
    const lastModifiedAt = binaryExists ? statSync(scriptPath).mtime.toISOString() : null;

    return {
      toolId: tool.id,
      displayName: tool.displayName,
      scriptPath,
      binaryExists,
      lastModifiedAt,
    };
  });
}