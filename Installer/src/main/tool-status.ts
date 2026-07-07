/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { statSync } from "node:fs";

import { TOOL_DESCRIPTORS } from "./mcp-config";
import { resolveToolScriptPath } from "./script-path";
import type { ToolStatus } from "./types";

export function getToolStatuses(installRoot: string): ToolStatus[] {
  return TOOL_DESCRIPTORS.map((tool) => {
    const { resolvedPath, binaryExists, checkedPaths } = resolveToolScriptPath(installRoot, tool);
    const scriptPath = resolvedPath;
    const lastModifiedAt = binaryExists ? statSync(scriptPath).mtime.toISOString() : null;

    return {
      toolId: tool.id,
      displayName: tool.displayName,
      scriptPath,
      checkedPaths,
      binaryExists,
      lastModifiedAt,
    };
  });
}
