/**
 * Structural unit tests for tool-call normalization entry points.
 *
 * Verifies the target end state of the Tool_Call_Normalization cleanup: every
 * tool-call entry point (AgentRunner, SubAgent, AskUser) imports AND calls the
 * shared `normalizeToolCall` utility, and no entry point retains a local
 * normalization stub, a "passthrough until shared normalizer integration"
 * comment, or a legacy/alternative normalization branch.
 *
 * These are source-level structural assertions (they read the entry-point
 * source files and inspect their contents) rather than behavioral tests, so
 * they hold regardless of runtime wiring.
 *
 * Requirements: 4.1, 4.2
 * Design: Testing Strategy (normalization structural checks)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

interface EntryPoint {
  /** Human-readable name for test output. */
  name: string;
  /** Path to the source file, relative to the repo root. */
  relativePath: string;
  /** Import specifier the file uses for the shared normalizer. */
  importSpecifier: string;
}

const ENTRY_POINTS: EntryPoint[] = [
  {
    name: "AgentRunner (runner.ts)",
    relativePath: join("AgentRunner", "src", "runner.ts"),
    importSpecifier: "../../shared/toolCallNormalizer",
  },
  {
    name: "SubAgent (session-pool-helpers.ts)",
    relativePath: join("SubAgent", "src", "session-pool-helpers.ts"),
    importSpecifier: "@shared/types/toolCallNormalizer",
  },
  {
    name: "AskUser (mcp-server.ts)",
    relativePath: join("AskUser", "src", "mcp-server.ts"),
    importSpecifier: "../../shared/toolCallNormalizer",
  },
];

function readEntryPointSource(entry: EntryPoint): string {
  return readFileSync(join(REPO_ROOT, entry.relativePath), "utf8");
}

describe("Tool-call normalization entry points (structural)", () => {
  describe.each(ENTRY_POINTS)("$name", (entry) => {
    let source: string;

    beforeAll(() => {
      source = readEntryPointSource(entry);
    });

    test("imports the shared normalizeToolCall utility", () => {
      // Named import of `normalizeToolCall` from the shared normalizer module.
      const importPattern = new RegExp(
        `import\\s*\\{[^}]*\\bnormalizeToolCall\\b[^}]*\\}\\s*from\\s*["']${entry.importSpecifier.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        )}["']`,
      );
      expect(source).toMatch(importPattern);
    });

    test("calls the shared normalizeToolCall utility", () => {
      expect(source).toMatch(/\bnormalizeToolCall\s*\(/);
    });

    test("does not retain a passthrough-until-integration comment", () => {
      expect(source.toLowerCase()).not.toContain("passthrough until shared normalizer integration");
    });

    test("does not describe a passthrough stub", () => {
      // The pre-cleanup SubAgent stub was a "passthrough stub"; no entry point
      // should describe itself as one anymore.
      expect(source.toLowerCase()).not.toMatch(/passthrough\s+stub/);
    });

    test("does not retain a legacy normalization branch marker", () => {
      // The pre-cleanup AskUser code referred to a "legacy path" that called
      // normalizeToolCall conditionally. No entry point should mention a
      // legacy normalization path anymore.
      expect(source.toLowerCase()).not.toMatch(/legacy\s+path/);
    });
  });

  test("every entry point both imports and calls normalizeToolCall", () => {
    for (const entry of ENTRY_POINTS) {
      const source = readEntryPointSource(entry);
      expect(source).toContain("normalizeToolCall");
      expect(source).toMatch(/\bnormalizeToolCall\s*\(/);
    }
  });
});
