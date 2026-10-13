// Feature: dependency-refresh-node24
// Task 2.6 — Unit tests parsing `.github/workflows/installer-release.yml`
//
// **Validates: Requirements 2.1, 2.3**
//
// Phase B reverted the installer release runner from the `windows-2022`
// node-gyp/VS-2026 workaround back to `windows-latest` (task 2.3). These unit
// tests lock in that outcome by parsing the real workflow file:
//
//   Req 2.1 — the installer build job (`build-installer`) SHALL specify a
//             `runs-on` value that resolves to `windows-latest`.
//   Req 2.3 — the workflow definition file SHALL contain no reference to the
//             `windows-2022` runner anywhere.
//
// ── Parsing approach (dependency-free line scan) ─────────────────────────────
// Matching the style of the sibling node-compliance scanner (check-node-24.ts),
// which deliberately avoids a YAML dependency, these tests parse the workflow
// with a narrow, well-commented line scan rather than importing a YAML library.
// The two facts under test are simple and local: the `runs-on:` value that
// belongs to the `build-installer` job, and the absence of any `windows-2022`
// token in the file.

import * as fs from "node:fs";
import * as path from "node:path";

// scripts/workspace/node-compliance -> repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "installer-release.yml");

/** Read the workflow file once for the whole suite. */
function readWorkflow(): string {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

/**
 * Extract the `runs-on` value declared for a named job.
 *
 * A GitHub Actions job is introduced by a key indented under `jobs:` (two
 * spaces in this file), e.g. `  build-installer:`. Its `runs-on:` appears more
 * deeply indented before the next job key at the same indent level. We locate
 * the job line, then scan forward for the first `runs-on:` that occurs before
 * the next sibling job (a line at the job-key indent that is not more-indented
 * and not blank/comment), skipping blank lines and `#` comments.
 *
 * Returns the raw `runs-on` value with any surrounding quotes and trailing
 * inline comment stripped, or `null` when the job or its `runs-on` is absent.
 */
function runsOnForJob(content: string, jobName: string): string | null {
  const lines = content.split(/\r?\n/);

  // Find the job header line: `  <jobName>:` (indented under `jobs:`).
  const jobHeader = new RegExp(`^(\\s+)${escapeRegExp(jobName)}:\\s*$`);
  let jobLine = -1;
  let jobIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = jobHeader.exec(lines[i]);
    if (m) {
      jobLine = i;
      jobIndent = m[1].length;
      break;
    }
  }
  if (jobLine === -1) return null;

  for (let i = jobLine + 1; i < lines.length; i++) {
    const line = lines[i];

    // Skip blank lines and comment-only lines — they do not end the job block.
    if (line.trim().length === 0 || /^\s*#/.test(line)) continue;

    const indent = line.length - line.trimStart().length;

    // A line at or below the job-key indent starts the next sibling job (or a
    // top-level key), ending this job's block without a `runs-on`.
    if (indent <= jobIndent) break;

    const m = /^\s*runs-on:\s*(\S.*)$/.exec(line);
    if (m) {
      // Strip trailing inline comment (first `#`), then surrounding quotes.
      let value = m[1].split("#")[0].trim();
      value = value.replace(/^['"]/, "").replace(/['"]$/, "").trim();
      return value;
    }
  }

  return null;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("installer-release.yml runner (Feature: dependency-refresh-node24, Req 2.1, 2.3)", () => {
  it("build-installer job runs-on resolves to windows-latest (Req 2.1)", () => {
    const content = readWorkflow();
    const runsOn = runsOnForJob(content, "build-installer");
    expect(runsOn).toBe("windows-latest");
  });

  it("contains no windows-2022 reference anywhere (Req 2.3)", () => {
    const content = readWorkflow();
    expect(content).not.toContain("windows-2022");
  });

  it("does not use a matrix runner indirection for the build job (Req 2.1)", () => {
    // The revert removed the matrix pin, so `runs-on` targets windows-latest
    // directly rather than `${{ matrix.os }}`. Guard against a regression that
    // reintroduces an indirection which could resolve away from windows-latest.
    const content = readWorkflow();
    const runsOn = runsOnForJob(content, "build-installer");
    expect(runsOn).not.toContain("matrix.");
  });
});
