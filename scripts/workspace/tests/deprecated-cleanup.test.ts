// Cleanup assertion tests for the removal of the deprecated/ directory.
// Feature: codebase-cleanup-plugin-registration
// **Validates: Requirements 3.1, 3.2, 3.3**
//
// These tests lock in the outcome of tasks 7.1 (delete `deprecated/`) and 7.2
// (scrub references). They assert that:
//   (3.1) the `deprecated/` directory does not exist on disk at the repo root; and
//   (3.2 / 3.3) a repo-wide text search for the literal string `deprecated/`
//         returns zero matches across retained configuration and documentation
//         files.
//
// Search scope notes:
//   - `.kiro/specs/` is EXCLUDED: the cleanup spec itself legitimately documents
//     the removal of `deprecated/` and must be allowed to mention the path.
//   - `node_modules/` and `.git/` are EXCLUDED (dependencies / VCS internals).
//   - Bundled third-party trees (e.g. `.blender-mcp/`) are EXCLUDED: they are
//     vendored upstream data, not retained toolkit configs/docs, and may contain
//     the substring in unrelated content.
//   - Build output (`dist/`) and this test file are EXCLUDED to avoid matching
//     the assertion strings themselves.

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEPRECATED_DIR = path.join(REPO_ROOT, "deprecated");

// Directories that are never part of the "retained configs/docs" search space.
const EXCLUDED_DIRS = new Set<string>([
  "node_modules",
  ".git",
  ".blender-mcp",
  ".husky",
  "dist",
  "coverage",
  ".vs",
  ".vscode",
]);

// Path prefixes (relative to the repo root, using forward slashes) that are
// excluded from the search. `.kiro/specs/` legitimately documents this cleanup.
const EXCLUDED_PATH_PREFIXES = [".kiro/specs/"];

// The literal search string.
const NEEDLE = "deprecated/";

// Sibling assertion test files for this same feature that legitimately contain
// the NEEDLE as part of their own scrub/absence assertions (not as a residual
// reference in a retained config/doc). These are excluded for the same reason
// this test file excludes itself: their inclusion of the literal string is the
// point of the assertion, not a leftover dependency on `deprecated/`.
const EXCLUDED_ASSERTION_TEST_FILES = new Set<string>([
  "scripts/workspace/tests/deprecated-cleanup.test.ts",
  "scripts/workspace/tests/documentation-accuracy.test.ts",
]);

// File extensions considered "config or documentation" for the repo-wide scrub
// assertion (Requirements 3.2, 3.3).
const CONFIG_DOC_EXTENSIONS = new Set<string>([
  ".md",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".ts",
  ".js",
  ".cjs",
  ".mjs",
  ".txt",
  ".toml",
]);

function toRepoRelative(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function isExcludedByPrefix(relPath: string): boolean {
  return EXCLUDED_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/**
 * Recursively collect config/doc files under the repo root, skipping excluded
 * directories and path prefixes, and excluding this test file itself (which
 * necessarily contains the search string).
 */
function collectConfigDocFiles(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = toRepoRelative(abs);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (isExcludedByPrefix(`${rel}/`)) continue;
      collectConfigDocFiles(abs, acc);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isExcludedByPrefix(rel)) continue;

    // Skip this test file and sibling assertion test files: they reference the
    // search string on purpose (as assertion literals, not residual references).
    if (abs === __filename || EXCLUDED_ASSERTION_TEST_FILES.has(rel)) continue;

    if (CONFIG_DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      acc.push(abs);
    }
  }

  return acc;
}

describe("Feature: codebase-cleanup-plugin-registration — deprecated/ cleanup assertions", () => {
  // Requirement 3.1 — the deprecated/ directory must not exist on disk.
  describe("deprecated/ directory removal (Requirement 3.1)", () => {
    it("does not exist at the repository root", () => {
      expect(fs.existsSync(DEPRECATED_DIR)).toBe(false);
    });

    it("is not present as a directory (defense against a stray file/symlink of the same name)", () => {
      if (fs.existsSync(DEPRECATED_DIR)) {
        // If something named `deprecated` exists, it must at least not be a directory.
        expect(fs.statSync(DEPRECATED_DIR).isDirectory()).toBe(false);
      } else {
        expect(fs.existsSync(DEPRECATED_DIR)).toBe(false);
      }
    });
  });

  // Requirements 3.2 / 3.3 — repo-wide search for `deprecated/` returns zero
  // matches in retained config and documentation files.
  describe("no residual `deprecated/` references (Requirements 3.2, 3.3)", () => {
    let configDocFiles: string[];

    beforeAll(() => {
      configDocFiles = collectConfigDocFiles(REPO_ROOT);
    });

    it("scans a non-empty set of retained config/doc files", () => {
      // Sanity check: if this is empty, the traversal is broken and the
      // zero-match assertion below would be vacuously true.
      expect(configDocFiles.length).toBeGreaterThan(0);
    });

    it("finds zero files containing the literal string `deprecated/`", () => {
      const offenders: string[] = [];

      for (const file of configDocFiles) {
        let content: string;
        try {
          content = fs.readFileSync(file, "utf-8");
        } catch {
          continue;
        }
        if (content.includes(NEEDLE)) {
          offenders.push(toRepoRelative(file));
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});
