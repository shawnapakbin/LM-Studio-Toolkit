// Cleanup assertion tests for stray artifacts and .gitignore
// Feature: codebase-cleanup-plugin-registration
// **Validates: Requirements 5.1, 5.2, 5.4, 5.6**
//
// These assertions confirm the results of tasks 8.1 (delete/untrack stray
// artifacts) and 8.2 (extend .gitignore) against the live repository state:
//
//   • Requirement 5.1 — the one-off report artifacts ARCHITECTURE_REPORT.md and
//     biome-output.txt are absent from disk.
//   • Requirement 5.2 / 5.6 — the regenerable/runtime artifacts (tmp/,
//     venv_test/, graphify-out/, coverage/, root memory.db, root
//     subagent-cache.db) are untracked by git and there are zero of the listed
//     stray artifacts tracked.
//   • Requirement 5.4 — .gitignore contains patterns covering the regenerable
//     and runtime artifacts, including the root-scoped .db patterns.

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// scripts/workspace/tests -> repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return the git ls-files entries matching the given pathspecs (repo-relative). */
function gitTrackedMatches(pathspecs: string[]): string[] {
  const output = execFileSync("git", ["ls-files", "--", ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** True if a repo-relative path exists on disk. */
function existsOnDisk(relativePath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

/**
 * True if git classifies the given repo-relative path as ignored.
 * `git check-ignore` exits 0 (and echoes the path) when a path is ignored,
 * exits 1 (no output) when it is not; any other exit is a genuine error.
 */
function isGitIgnored(relativePath: string): boolean {
  try {
    const output = execFileSync("git", ["check-ignore", "--", relativePath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return output.trim().length > 0;
  } catch (err) {
    const status = (err as { status?: number }).status;
    // Exit 1 = path is not ignored; treat any other failure as an error.
    if (status === 1) return false;
    throw err;
  }
}

// ─── Test data ───────────────────────────────────────────────────────────────

// One-off report artifacts that must be deleted (Requirement 5.1).
const REPORT_ARTIFACTS = ["ARCHITECTURE_REPORT.md", "biome-output.txt"];

// Regenerable/runtime artifacts that must be untracked (Requirements 5.2, 5.6).
// Directory artifacts are matched recursively; file artifacts are root-scoped.
const RUNTIME_DIR_ARTIFACTS = ["tmp", "venv_test", "graphify-out", "coverage"];
const RUNTIME_DB_ARTIFACTS = ["memory.db", "subagent-cache.db"];

describe("stray-artifact cleanup assertions", () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  const gitignoreLines = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  // ─── Requirement 5.1 — one-off report artifacts deleted ─────────────────────
  describe("report artifacts are absent (Requirement 5.1)", () => {
    it.each(REPORT_ARTIFACTS)("%s does not exist on disk", (artifact) => {
      expect(existsOnDisk(artifact)).toBe(false);
    });

    it("no report artifact is tracked by git", () => {
      expect(gitTrackedMatches(REPORT_ARTIFACTS)).toEqual([]);
    });
  });

  // ─── Requirements 5.2 / 5.6 — runtime artifacts untracked ───────────────────
  describe("runtime/regenerable artifacts are untracked (Requirements 5.2, 5.6)", () => {
    it.each(RUNTIME_DIR_ARTIFACTS)("%s/ is not tracked by git", (dir) => {
      // Match the directory itself and anything nested beneath it.
      expect(gitTrackedMatches([`${dir}/`, `${dir}/**`])).toEqual([]);
    });

    it.each(RUNTIME_DB_ARTIFACTS)("root %s is not tracked by git", (db) => {
      // Root-scoped pathspec (leading ./) so nested/workspace .db files are
      // never accidentally counted against the root artifact.
      expect(gitTrackedMatches([`:(top)${db}`])).toEqual([]);
    });

    it("root memory.db and subagent-cache.db are untracked (absent or git-ignored)", () => {
      // Requirement 5.5 explicitly allows these runtime databases to be
      // regenerated after cleanup (e.g. by a test run). The invariant is that a
      // regenerated instance is never tracked/untracked-and-staged: it must be
      // either absent from disk or classified as ignored by git — not merely
      // absent. Tracking is separately asserted above via `git ls-files`.
      for (const db of RUNTIME_DB_ARTIFACTS) {
        if (existsOnDisk(db)) {
          expect(isGitIgnored(db)).toBe(true);
        } else {
          expect(existsOnDisk(db)).toBe(false);
        }
      }
    });

    it("zero of the listed stray artifacts are tracked (Requirement 5.6)", () => {
      const pathspecs = [
        ...REPORT_ARTIFACTS,
        ...RUNTIME_DIR_ARTIFACTS.flatMap((dir) => [`${dir}/`, `${dir}/**`]),
        ...RUNTIME_DB_ARTIFACTS.map((db) => `:(top)${db}`),
      ];
      expect(gitTrackedMatches(pathspecs)).toEqual([]);
    });
  });

  // ─── Requirement 5.4 — .gitignore covers the artifacts ──────────────────────
  describe(".gitignore covers regenerable/runtime artifacts (Requirement 5.4)", () => {
    it.each(["tmp/", "venv_test/", "graphify-out/", "coverage/"])(
      "ignores directory pattern %s",
      (pattern) => {
        expect(gitignoreLines).toContain(pattern);
      },
    );

    it("ignores root-scoped memory.db", () => {
      expect(gitignoreLines).toContain("/memory.db");
    });

    it("ignores root subagent-cache.db (explicit or via /*.db)", () => {
      const hasExplicit = gitignoreLines.includes("/subagent-cache.db");
      const hasWildcard = gitignoreLines.includes("/*.db");
      expect(hasExplicit || hasWildcard).toBe(true);
    });

    it("scopes the broad .db pattern to the repo root (no unscoped *.db)", () => {
      // A root-scoped pattern (/*.db) avoids ignoring intentionally-tracked
      // workspace .db files; an unscoped `*.db` would be too broad.
      expect(gitignoreLines).not.toContain("*.db");
    });
  });
});
