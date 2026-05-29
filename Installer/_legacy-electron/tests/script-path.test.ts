/**
 * Regression tests for script-path.ts
 *
 * Key failure patterns caught:
 * - tool binary path emission changed (rootDir/outDir change in tsconfig)
 * - candidate list does not cover actual nested emission path
 * - relativeScript in mcp-config changed without updating fallback candidates
 */

import { join } from "node:path";
import { TOOL_DESCRIPTORS } from "../src/main/mcp-config";
import { getToolScriptCandidates } from "../src/main/script-path";

const INSTALL_ROOT = join("C:", "Users", "Demo User", "AppData", "Roaming", "llm-toolkit");

describe("getToolScriptCandidates", () => {
  test("first candidate matches the declared relativeScript path", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      const candidates = getToolScriptCandidates(INSTALL_ROOT, tool);
      const expected = join(INSTALL_ROOT, tool.relativeScript);
      expect(candidates[0]).toBe(expected);
    }
  });

  test("all known nested emission layouts are covered for each tool", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      const candidates = getToolScriptCandidates(INSTALL_ROOT, tool);
      const normalized = candidates.map((c) => c.replace(/\\/g, "/"));

      // flat layout: <installRoot>/<Tool>/dist/mcp-server.js
      expect(
        normalized.some((c) => c.endsWith(`/${tool.relativeScript.replace(/\\/g, "/")}`)),
      ).toBe(true);

      // TypeScript nested layout: dist/src/mcp-server.js
      const [toolRoot] = tool.relativeScript.split("/");
      expect(normalized.some((c) => c.includes(`/${toolRoot}/dist/src/mcp-server.js`))).toBe(true);

      // Worst-case nested layout: dist/<Tool>/src/mcp-server.js
      expect(
        normalized.some((c) => c.includes(`/${toolRoot}/dist/${toolRoot}/src/mcp-server.js`)),
      ).toBe(true);
    }
  });

  test("returns at least 3 candidate paths per tool", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      const candidates = getToolScriptCandidates(INSTALL_ROOT, tool);
      expect(candidates.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("no duplicate candidates", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      const candidates = getToolScriptCandidates(INSTALL_ROOT, tool);
      const unique = new Set(candidates);
      expect(unique.size).toBe(candidates.length);
    }
  });

  test("all candidates are absolute paths under install root", () => {
    for (const tool of TOOL_DESCRIPTORS) {
      const candidates = getToolScriptCandidates(INSTALL_ROOT, tool);
      for (const candidate of candidates) {
        expect(candidate.startsWith(INSTALL_ROOT)).toBe(true);
      }
    }
  });
});
