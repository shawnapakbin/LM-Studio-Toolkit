/**
 * Bugfix: mcp-shared-module-resolution-fix — Task 8.1
 * (Follow-up Design → Fix → Changes Required step 1; Requirements 5.1, 5.2).
 *
 * The generalized Option B fix provisions the five workspace-internal
 * `llm-toolkit-*` packages via local `file:` tarballs. The pack step (task 8.2)
 * depends on all five being compiled to `dist/` first. This suite locks the
 * generalized pre-pack guard that makes `stage-payload` fail loudly — naming
 * each missing package — when any of the five `<PackageDir>/dist` trees is
 * absent or empty, mirroring the 5.4.3 `@shared/*` build gate and the nine-tool
 * dist-completeness abort.
 *
 * Covered seams (`scripts/stage-payload`):
 *   - `LLM_TOOLKIT_PACKAGE_PAYLOADS` — the five canonical `llm-toolkit-*` descriptors.
 *   - `observeLlmToolkitDistBlockers(repoRoot)` — the pure guard (returns
 *     blockers rather than exiting) that `assertLlmToolkitDistsPresentOrExit`
 *     reports from.
 *
 * Validates: Requirements 5.1, 5.2
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  LLM_TOOLKIT_PACKAGE_PAYLOADS,
  observeLlmToolkitDistBlockers,
} from "../../scripts/stage-payload";

/** Create a fresh temp repo-root fixture and return its absolute path. */
function makeTempRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), "llm-toolkit-dist-guard-"));
}

/** Write a non-empty `dist/` tree for a package under `repoRoot`. */
function seedDist(repoRoot: string, distRoot: string): void {
  const abs = resolve(repoRoot, distRoot);
  mkdirSync(abs, { recursive: true });
  writeFileSync(resolve(abs, "index.js"), "module.exports = {};\n", "utf8");
}

describe("Task 8.1: llm-toolkit-* pre-pack dist guard", () => {
  it("describes exactly the five canonical llm-toolkit-* packages", () => {
    expect(LLM_TOOLKIT_PACKAGE_PAYLOADS).toHaveLength(5);
    const byName = new Map(LLM_TOOLKIT_PACKAGE_PAYLOADS.map((p) => [p.packageName, p]));

    expect(byName.get("llm-toolkit-ask-user")).toMatchObject({
      packageDir: "AskUser",
      distRoot: "AskUser/dist",
    });
    expect(byName.get("llm-toolkit-calculator")).toMatchObject({
      packageDir: "Calculator",
      distRoot: "Calculator/dist",
    });
    expect(byName.get("llm-toolkit-clock")).toMatchObject({
      packageDir: "Clock",
      distRoot: "Clock/dist",
    });
    expect(byName.get("llm-toolkit-document-scraper")).toMatchObject({
      packageDir: "DocumentScraper",
      distRoot: "DocumentScraper/dist",
    });
    expect(byName.get("llm-toolkit-observability")).toMatchObject({
      packageDir: "Observability",
      distRoot: "Observability/dist",
    });
  });

  it("returns no blockers when all five llm-toolkit-* dist trees exist and are non-empty", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      for (const pkg of LLM_TOOLKIT_PACKAGE_PAYLOADS) {
        seedDist(repoRoot, pkg.distRoot);
      }
      expect(observeLlmToolkitDistBlockers(repoRoot)).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("names every llm-toolkit-* package whose dist tree is absent, in order", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      // Nothing seeded → all five are blockers, named in descriptor order.
      const blockers = observeLlmToolkitDistBlockers(repoRoot);
      expect(blockers.map((b) => b.packageName)).toEqual([
        "llm-toolkit-ask-user",
        "llm-toolkit-calculator",
        "llm-toolkit-clock",
        "llm-toolkit-document-scraper",
        "llm-toolkit-observability",
      ]);
      expect(blockers.map((b) => b.distRoot)).toEqual([
        "AskUser/dist",
        "Calculator/dist",
        "Clock/dist",
        "DocumentScraper/dist",
        "Observability/dist",
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("flags a package whose dist tree exists but is EMPTY", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      // Four built; observability dist exists but is empty.
      seedDist(repoRoot, "AskUser/dist");
      seedDist(repoRoot, "Calculator/dist");
      seedDist(repoRoot, "Clock/dist");
      seedDist(repoRoot, "DocumentScraper/dist");
      mkdirSync(resolve(repoRoot, "Observability/dist"), { recursive: true });

      const blockers = observeLlmToolkitDistBlockers(repoRoot);
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toMatchObject({
        packageName: "llm-toolkit-observability",
        distRoot: "Observability/dist",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("flags a single missing package while the others are present", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      // Everything except llm-toolkit-clock is built.
      seedDist(repoRoot, "AskUser/dist");
      seedDist(repoRoot, "Calculator/dist");
      seedDist(repoRoot, "DocumentScraper/dist");
      seedDist(repoRoot, "Observability/dist");

      const blockers = observeLlmToolkitDistBlockers(repoRoot);
      expect(blockers.map((b) => b.packageName)).toEqual(["llm-toolkit-clock"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
