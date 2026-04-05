import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import type { ToolDescriptor } from "./types";

export function getToolScriptCandidates(installRoot: string, tool: ToolDescriptor): string[] {
  const expectedPath = join(installRoot, tool.relativeScript);
  const [toolRoot] = tool.relativeScript.split("/");
  const scriptFile = basename(tool.relativeScript);

  const candidates = [
    expectedPath,
    join(installRoot, toolRoot, "dist", "src", scriptFile),
    join(installRoot, toolRoot, "dist", toolRoot, "src", scriptFile),
  ];

  return Array.from(new Set(candidates));
}

export function resolveToolScriptPath(installRoot: string, tool: ToolDescriptor) {
  const checkedPaths = getToolScriptCandidates(installRoot, tool);
  const resolvedPath = checkedPaths.find((candidate) => existsSync(candidate)) ?? checkedPaths[0];
  const binaryExists = existsSync(resolvedPath);

  return {
    resolvedPath,
    binaryExists,
    checkedPaths,
  };
}
