// Feature: codebase-cleanup-plugin-registration, Property 7: Cleanup idempotence and artifact handling — for subsets of the listed stray artifacts present/absent, cleanup succeeds (never fails on already-absent items), leaves none tracked, and re-running is a no-op; and with .gitignore patterns in place, a regenerated artifact is classified as ignored rather than untracked or staged
// **Validates: Requirements 5.3, 5.5, 5.6**

/**
 * Property 7: Cleanup idempotence and artifact handling
 *
 * Two invariants are exercised, each against a real temporary filesystem /
 * temporary git repository so no real repo state is ever touched:
 *
 *  (A) Idempotent cleanup (Req 5.3, 5.6). For any subset of the listed stray
 *      artifacts being present or absent before cleanup, running the cleanup
 *      succeeds (never throws on an already-absent item), leaves none of the
 *      listed artifacts present/tracked afterward, and a second run is a no-op
 *      (removes nothing further and still succeeds).
 *
 *  (B) .gitignore classification (Req 5.5). With the root-scoped .gitignore
 *      patterns in place, a regenerated instance of any listed regenerable
 *      artifact is classified by git as *ignored* — never as untracked or
 *      staged.
 *
 * The set of stray artifacts and the .gitignore patterns mirror the real
 * repository's cleanup design (tasks 8.1 / 8.2): ARCHITECTURE_REPORT.md,
 * biome-output.txt, tmp/, venv_test/, graphify-out/, coverage/, root memory.db,
 * root subagent-cache.db.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";

// ─── Stray-artifact model (mirrors tasks 8.1 / 8.2) ───────────────────────────

type ArtifactKind = "file" | "dir";

interface StrayArtifact {
  /** Repo-root-relative path. */
  relPath: string;
  kind: ArtifactKind;
}

/** The listed stray artifacts targeted by the cleanup. */
const STRAY_ARTIFACTS: StrayArtifact[] = [
  { relPath: "ARCHITECTURE_REPORT.md", kind: "file" },
  { relPath: "biome-output.txt", kind: "file" },
  { relPath: "tmp", kind: "dir" },
  { relPath: "venv_test", kind: "dir" },
  { relPath: "graphify-out", kind: "dir" },
  { relPath: "coverage", kind: "dir" },
  { relPath: "memory.db", kind: "file" },
  { relPath: "subagent-cache.db", kind: "file" },
];

/**
 * The regenerable stray artifacts that must be classified as *ignored* once the
 * .gitignore patterns are in place. ARCHITECTURE_REPORT.md is a one-off report
 * that is deleted but not gitignored, so it is excluded from the ignore-
 * classification invariant (invariant B).
 */
const IGNORED_ARTIFACTS: StrayArtifact[] = STRAY_ARTIFACTS.filter(
  (a) => a.relPath !== "ARCHITECTURE_REPORT.md",
);

/**
 * Root-scoped .gitignore patterns covering the regenerable/runtime artifacts,
 * mirroring the repository's real .gitignore additions (task 8.2). Root-scoped
 * `.db` patterns avoid ignoring intentionally-tracked workspace `.db` files.
 */
const GITIGNORE_CONTENT = [
  "tmp/",
  "venv_test/",
  "graphify-out/",
  "coverage/",
  "biome-output.txt",
  "/memory.db",
  "/subagent-cache.db",
  "/*.db",
  "",
].join("\n");

// ─── Cleanup logic under test (idempotent deletion) ───────────────────────────

interface CleanupResult {
  /** Repo-root-relative paths actually removed this run. */
  removed: string[];
}

/**
 * Idempotent removal of the listed stray artifacts from `repoRoot`.
 *
 * Mirrors the cleanup contract (Req 5.3): an already-absent target is treated as
 * satisfied and never raises — existence is checked before removal. Files and
 * directories are both removed with `fs.rmSync(..., { force: true })`.
 */
function cleanupStrayArtifacts(repoRoot: string): CleanupResult {
  const removed: string[] = [];
  for (const artifact of STRAY_ARTIFACTS) {
    const abs = path.join(repoRoot, artifact.relPath);
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(artifact.relPath);
    }
    // Absent target → no-op, never throws (Req 5.3).
  }
  return { removed };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function materialize(repoRoot: string, artifact: StrayArtifact): void {
  const abs = path.join(repoRoot, artifact.relPath);
  if (artifact.kind === "dir") {
    fs.mkdirSync(abs, { recursive: true });
    // Give the directory content so it is a real, non-empty artifact.
    fs.writeFileSync(path.join(abs, "placeholder.txt"), "x", "utf8");
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "artifact contents", "utf8");
  }
}

function anyArtifactPresent(repoRoot: string): boolean {
  return STRAY_ARTIFACTS.some((a) => fs.existsSync(path.join(repoRoot, a.relPath)));
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    // Isolate from the developer's global/system git config.
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      HOME: repoRoot,
      USERPROFILE: repoRoot,
    },
  });
}

function initTempGitRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-git-"));
  git(repoRoot, ["init", "-q"]);
  git(repoRoot, ["config", "user.email", "test@example.com"]);
  git(repoRoot, ["config", "user.name", "Test"]);
  git(repoRoot, ["config", "commit.gpgsign", "false"]);
  return repoRoot;
}

// ─── Generators ────────────────────────────────────────────────────────────────

/**
 * A "presence subset": for each listed artifact, a boolean deciding whether it
 * exists before cleanup runs. This models arbitrary mixes of present/absent
 * stray artifacts (Req 5.3).
 */
const presenceSubsetArb: fc.Arbitrary<boolean[]> = fc.array(fc.boolean(), {
  minLength: STRAY_ARTIFACTS.length,
  maxLength: STRAY_ARTIFACTS.length,
});

// ─── Property Test ──────────────────────────────────────────────────────────

describe("Feature: codebase-cleanup-plugin-registration", () => {
  /**
   * Feature: codebase-cleanup-plugin-registration, Property 7: Cleanup idempotence and artifact handling
   *
   * Validates: Requirements 5.3, 5.6
   *
   * (A) Idempotent cleanup: for any present/absent subset, cleanup succeeds,
   *     leaves nothing behind, and re-running is a no-op.
   */
  it("Property 7 (A): cleanup is idempotent and never fails on already-absent artifacts", () => {
    fc.assert(
      fc.property(presenceSubsetArb, (presence) => {
        const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-fs-"));
        try {
          // Materialize exactly the chosen subset of artifacts.
          STRAY_ARTIFACTS.forEach((artifact, i) => {
            if (presence[i]) materialize(repoRoot, artifact);
          });

          const presentBefore = STRAY_ARTIFACTS.filter((_, i) => presence[i]).map((a) => a.relPath);

          // First run: succeeds, removes exactly the present artifacts.
          const first = cleanupStrayArtifacts(repoRoot);
          expect(new Set(first.removed)).toEqual(new Set(presentBefore));

          // Nothing listed remains afterward (Req 5.6).
          expect(anyArtifactPresent(repoRoot)).toBe(false);

          // Second run: a no-op — removes nothing further, still succeeds (Req 5.3).
          const second = cleanupStrayArtifacts(repoRoot);
          expect(second.removed).toEqual([]);
          expect(anyArtifactPresent(repoRoot)).toBe(false);
        } finally {
          fs.rmSync(repoRoot, { recursive: true, force: true });
        }
      }),
      { numRuns: 150 },
    );
  });

  /**
   * Feature: codebase-cleanup-plugin-registration, Property 7: Cleanup idempotence and artifact handling
   *
   * Validates: Requirements 5.5
   *
   * (B) .gitignore classification: with the ignore patterns committed, a
   *     regenerated instance of any listed regenerable artifact is classified
   *     as ignored — never untracked, never staged.
   */
  it("Property 7 (B): regenerated artifacts are classified as ignored, not untracked or staged", () => {
    fc.assert(
      fc.property(presenceSubsetArb, (presence) => {
        const repoRoot = initTempGitRepo();
        try {
          // Commit the .gitignore so the patterns are "in place" before any
          // artifact is regenerated.
          fs.writeFileSync(path.join(repoRoot, ".gitignore"), GITIGNORE_CONTENT, "utf8");
          git(repoRoot, ["add", ".gitignore"]);
          git(repoRoot, ["commit", "-q", "-m", "add gitignore"]);

          // Regenerate the chosen subset of ignorable artifacts.
          const regenerated: StrayArtifact[] = [];
          IGNORED_ARTIFACTS.forEach((artifact, i) => {
            if (presence[i]) {
              materialize(repoRoot, artifact);
              regenerated.push(artifact);
            }
          });

          // git status --porcelain: an ignored file produces NO entry (untracked
          // would appear as "?? path", staged as "A  path"). Assert none of the
          // regenerated artifacts appear in porcelain status.
          const porcelain = git(repoRoot, ["status", "--porcelain", "--ignored=no"]);
          for (const artifact of regenerated) {
            const needle = artifact.relPath;
            expect(porcelain.includes(needle)).toBe(false);
          }

          // git check-ignore: confirms each regenerated artifact matches an
          // ignore rule (exit 0 + echoes the path). For directories, check the
          // regenerated file inside them, matching how git evaluates ignores.
          for (const artifact of regenerated) {
            const probe =
              artifact.kind === "dir"
                ? path.join(artifact.relPath, "placeholder.txt")
                : artifact.relPath;
            let ignored = true;
            let out = "";
            try {
              out = git(repoRoot, ["check-ignore", probe]);
            } catch {
              ignored = false;
            }
            expect(ignored).toBe(true);
            expect(out.trim().length).toBeGreaterThan(0);
          }
        } finally {
          fs.rmSync(repoRoot, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
