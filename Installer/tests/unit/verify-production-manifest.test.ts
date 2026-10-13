/**
 * Unit tests for the manifest-sync drift check.
 *
 * Bugfix: runtimes-npm-install-nonzero-exit — task 3.7 (Part B / B2)
 * Requirements: 2.1, 2.2
 *
 * The verify check (`verify-production-manifest.ts`) re-runs the generator
 * (task 3.3, the single source of truth) into a temp dir and byte-compares the
 * committed `package.json` (+ `package-lock.json`) against the fresh output.
 * These tests exercise the pure `verifyProductionManifest` seam WITHOUT the
 * network by running in `--no-lockfile` mode (manifest-only) so no npm resolve
 * is spawned:
 *
 *   - Against the real committed artifacts the check reports NO drift.
 *   - Against a perturbed committed dir (a package.json byte-changed / missing)
 *     the check reports drift and names the offending artifact.
 *
 * The lockfile comparison path (network-dependent) is exercised end-to-end by
 * `npm run verify:runtime-manifest` in CI, not here.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { generateProductionManifest } from "../../scripts/generate-production-manifest";
import { verifyProductionManifest } from "../../scripts/verify-production-manifest";

/** `Installer/` root, from this test file's location (`Installer/tests/unit`). */
const installerRoot = resolve(__dirname, "..", "..");
/** Repo root: one level above `Installer/`. */
const repoRoot = resolve(installerRoot, "..");
/** The real committed artifacts dir the installer ships. */
const committedDir = resolve(installerRoot, "src-tauri", "payload", "runtime-manifest");

describe("verify-production-manifest — drift check (manifest-only)", () => {
  it("reports NO drift against the real committed package.json", () => {
    const result = verifyProductionManifest({ committedDir, checkLockfile: false, repoRoot });

    // The manifest-only comparison must be in sync. (The lockfile is verified
    // by the CI `npm run verify:runtime-manifest` command, which does a network
    // resolve; we intentionally skip it here to keep the unit test offline.)
    const manifestProblems = result.problems.filter((p) => p.artifact !== "package-lock.json");
    expect(manifestProblems).toEqual([]);
  });

  it("detects drift when a committed package.json byte-differs and names the artifact", () => {
    const perturbedDir = mkdtempSync(resolve(tmpdir(), "verify-manifest-drift-"));
    try {
      // Seed the perturbed dir with a package.json that differs from the
      // generator output by a single byte (a bumped version), simulating a
      // tool-dependency change that was NOT regenerated.
      const committedManifest = readFileSync(resolve(committedDir, "package.json"), "utf8");
      const perturbed = committedManifest.replace(
        /"@modelcontextprotocol\/sdk":\s*"[^"]*"/,
        '"@modelcontextprotocol/sdk": "^999.0.0"',
      );
      expect(perturbed).not.toBe(committedManifest); // sanity: the perturbation applied
      writeFileSync(resolve(perturbedDir, "package.json"), perturbed, "utf8");

      const result = verifyProductionManifest({
        committedDir: perturbedDir,
        checkLockfile: false,
        repoRoot,
      });

      expect(result.ok).toBe(false);
      const driftedArtifacts = result.problems.map((p) => p.artifact);
      expect(driftedArtifacts).toContain("package.json");
    } finally {
      rmSync(perturbedDir, { recursive: true, force: true });
    }
  });

  it("reports drift when the committed package.json is missing entirely", () => {
    const emptyDir = mkdtempSync(resolve(tmpdir(), "verify-manifest-empty-"));
    try {
      const result = verifyProductionManifest({
        committedDir: emptyDir,
        checkLockfile: false,
        repoRoot,
      });

      expect(result.ok).toBe(false);
      const missing = result.problems.find(
        (p) => p.artifact === "package.json" && /missing/i.test(p.message),
      );
      expect(missing).toBeDefined();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("regeneration is byte-identical: a fresh manifest matches the committed one", () => {
    // Directly assert the single-source-of-truth invariant: regenerating the
    // manifest (no lockfile) into a temp dir yields the exact committed bytes.
    const tempOut = mkdtempSync(resolve(tmpdir(), "verify-manifest-regen-"));
    try {
      const result = generateProductionManifest({
        outDir: tempOut,
        writeLockfile: false,
        repoRoot,
      });
      const committedManifest = readFileSync(resolve(committedDir, "package.json"), "utf8");
      expect(result.manifestText).toBe(committedManifest);
      // Sanity: the generator wrote the manifest to the temp dir, not the real one.
      expect(existsSync(resolve(tempOut, "package.json"))).toBe(true);
    } finally {
      rmSync(tempOut, { recursive: true, force: true });
    }
  });
});
