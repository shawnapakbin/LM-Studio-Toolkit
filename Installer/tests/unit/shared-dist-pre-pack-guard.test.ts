/**
 * Bugfix: mcp-shared-module-resolution-fix — Task 3.1
 * (Fix → Changes Required step 1; Requirements 2.1, 2.2).
 *
 * The Option B fix provisions `@shared/types` and `@shared/config` via local
 * `file:` tarballs. The pack step (task 3.2) depends on BOTH shared packages
 * being compiled to `dist/` first. This suite locks the pre-pack guard that
 * makes `stage-payload` fail loudly — naming each missing package — when either
 * `shared/dist` or `shared/config/dist` is absent or empty, mirroring the
 * existing nine-tool dist-completeness abort.
 *
 * Covered seams (`scripts/stage-payload`):
 *   - `SHARED_PACKAGE_PAYLOADS` — the two canonical `@shared/*` descriptors.
 *   - `observeSharedDistBlockers(repoRoot)` — the pure guard (returns blockers
 *     rather than exiting) that `assertSharedDistsPresentOrExit` reports from.
 *
 * Validates: Requirements 2.1, 2.2
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { observeSharedDistBlockers, SHARED_PACKAGE_PAYLOADS } from "../../scripts/stage-payload";

/** Create a fresh temp repo-root fixture and return its absolute path. */
function makeTempRepoRoot(): string {
  return mkdtempSync(join(tmpdir(), "shared-dist-guard-"));
}

/** Write a non-empty `dist/` tree for a shared package under `repoRoot`. */
function seedDist(repoRoot: string, distRoot: string): void {
  const abs = resolve(repoRoot, distRoot);
  mkdirSync(abs, { recursive: true });
  writeFileSync(resolve(abs, "index.js"), "module.exports = {};\n", "utf8");
}

describe("Task 3.1: @shared/* pre-pack dist guard", () => {
  it("describes exactly the two canonical @shared/* packages", () => {
    expect(SHARED_PACKAGE_PAYLOADS).toHaveLength(2);
    const byName = new Map(SHARED_PACKAGE_PAYLOADS.map((p) => [p.packageName, p]));

    expect(byName.get("@shared/types")).toMatchObject({
      packageDir: "shared",
      distRoot: "shared/dist",
    });
    expect(byName.get("@shared/config")).toMatchObject({
      packageDir: "shared/config",
      distRoot: "shared/config/dist",
    });
  });

  it("returns no blockers when both @shared/* dist trees exist and are non-empty", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      for (const pkg of SHARED_PACKAGE_PAYLOADS) {
        seedDist(repoRoot, pkg.distRoot);
      }
      expect(observeSharedDistBlockers(repoRoot)).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("names every @shared/* package whose dist tree is absent", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      // Neither dist is seeded → both are blockers, named in order.
      const blockers = observeSharedDistBlockers(repoRoot);
      expect(blockers.map((b) => b.packageName)).toEqual(["@shared/types", "@shared/config"]);
      expect(blockers.map((b) => b.distRoot)).toEqual(["shared/dist", "shared/config/dist"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("flags a shared package whose dist tree exists but is EMPTY", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      // @shared/types built; @shared/config dist exists but is empty.
      seedDist(repoRoot, "shared/dist");
      mkdirSync(resolve(repoRoot, "shared/config/dist"), { recursive: true });

      const blockers = observeSharedDistBlockers(repoRoot);
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toMatchObject({
        packageName: "@shared/config",
        distRoot: "shared/config/dist",
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("flags a single missing package while the other is present", () => {
    const repoRoot = makeTempRepoRoot();
    try {
      // Only @shared/config is built.
      seedDist(repoRoot, "shared/config/dist");

      const blockers = observeSharedDistBlockers(repoRoot);
      expect(blockers.map((b) => b.packageName)).toEqual(["@shared/types"]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
