/**
 * Bugfix: runtimes-npm-install-nonzero-exit — task 3.8 (Part B / B2)
 * Integration (build-level): the FULL staged payload — the nine tool `dist`
 * trees PLUS the sanctioned flat runtime manifest/lockfile — is a Lean_Payload.
 *
 * Where the pure proptests in `lean-payload-staging.prop.test.ts` drive
 * `assertLeanPayload` over synthetic trees, this test runs the REAL build
 * staging path end to end:
 *
 *   1. seed a throwaway repo with a minimal `dist` tree at each of the nine
 *      canonical `distRoot`s;
 *   2. run `stagePayload(repoRoot, stagingRoot)` to copy the nine trees;
 *   3. place the sanctioned flat `package.json` + `package-lock.json` at the
 *      payload root exactly as `stageRuntimeManifest` does (sourced from the
 *      REAL committed `runtime-manifest/` artifacts so the test is network-free
 *      and deterministic — the generator's own byte-identical drift is pinned
 *      by `verify-production-manifest.test.ts`);
 *   4. assert `assertLeanPayload` finds NO `node_modules` at any depth and that
 *      the ONLY top-level entries are exactly the nine `dist` trees plus the
 *      two sanctioned flat files — no other non-tool entry.
 *
 * It also runs the REAL `stageRuntimeManifest` (which resolves a lockfile via
 * npm) when npm is available, so the committed-artifact path and the live
 * generator path are both covered; the live step is skipped (not failed) when
 * npm/network is unavailable, matching the design's "exercised at build/CI
 * level" note for the npm-dependent seams.
 *
 * Validates: Requirements 2.1, 3.6
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CANONICAL_TOOL_PAYLOADS,
  installedEntryFilename,
  SANCTIONED_PAYLOAD_ROOT_FILES,
  stagingDestDirName,
} from "../../scripts/payload-manifest";
import { assertLeanPayload, stagePayload, stageRuntimeManifest } from "../../scripts/stage-payload";

/** `Installer/` root, from this test file's location (`Installer/tests/property`). */
const installerRoot = path.resolve(__dirname, "..", "..");
/** The real committed runtime-manifest artifacts the installer ships. */
const committedRuntimeManifestDir = path.resolve(
  installerRoot,
  "src-tauri",
  "payload",
  "runtime-manifest",
);

/** The canonical nine server dir names, from the single source of truth. */
const CANONICAL_DIR_NAMES: readonly string[] = CANONICAL_TOOL_PAYLOADS.map((t) =>
  stagingDestDirName(t),
);

/** Seed a minimal, non-empty `dist` tree at each canonical source distRoot. */
function seedNineDistTrees(repoRoot: string): void {
  for (const tool of CANONICAL_TOOL_PAYLOADS) {
    const src = path.resolve(repoRoot, tool.distRoot);
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, installedEntryFilename(tool.serverName)), "// entry\n");
  }
}

/** True iff a usable `npm` is on PATH (for the live `stageRuntimeManifest` leg). */
function npmAvailable(): boolean {
  for (const bin of ["npm.cmd", "npm"]) {
    try {
      execFileSync(bin, ["--version"], {
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      return true;
    } catch {
      /* try the next candidate */
    }
  }
  return false;
}

/** `true` iff any path segment under `root` equals `node_modules` at any depth. */
function hasNodeModulesAnywhere(root: string): boolean {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return false;
  }
  for (const name of entries) {
    const full = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules") {
        return true;
      }
      if (hasNodeModulesAnywhere(full)) {
        return true;
      }
    }
  }
  return false;
}

describe("Lean_Payload integration — nine dist trees + sanctioned runtime manifest (task 3.8)", () => {
  it("stages the nine trees plus the committed manifest/lockfile with no violations and no node_modules", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lean-rt-repo-"));
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lean-rt-stage-"));
    try {
      seedNineDistTrees(repoRoot);

      // (2) Stage the nine tool dist trees.
      stagePayload(repoRoot, stagingRoot);

      // (3) Place the sanctioned flat files at the payload root exactly as
      // `stageRuntimeManifest` does — sourced from the REAL committed artifacts
      // so the integration is deterministic and network-free.
      for (const fileName of SANCTIONED_PAYLOAD_ROOT_FILES) {
        const srcPath = path.join(committedRuntimeManifestDir, fileName);
        expect(fs.existsSync(srcPath)).toBe(true); // committed artifact present
        fs.copyFileSync(srcPath, path.join(stagingRoot, fileName));
      }

      // (4a) The lean guard reports zero violations.
      const violations = assertLeanPayload(stagingRoot);
      expect(violations).toEqual([]);

      // (4b) No `node_modules` segment exists anywhere in the staged tree.
      expect(hasNodeModulesAnywhere(stagingRoot)).toBe(false);

      // (4c) The top level is EXACTLY the nine canonical dirs plus the two
      // sanctioned flat files — nothing else.
      const topLevel = fs.readdirSync(stagingRoot).sort();
      const expectedTopLevel = [...CANONICAL_DIR_NAMES, ...SANCTIONED_PAYLOAD_ROOT_FILES].sort();
      expect(topLevel).toEqual(expectedTopLevel);

      // (4d) The sanctioned entries are regular FILES (never a directory tree
      // that could smuggle a `node_modules`).
      for (const fileName of SANCTIONED_PAYLOAD_ROOT_FILES) {
        expect(fs.statSync(path.join(stagingRoot, fileName)).isFile()).toBe(true);
      }

      // (4e) The staged manifest actually pins the Required_Package so the
      // install-time `npm install --omit=dev` has the SDK to resolve.
      const stagedManifest = JSON.parse(
        fs.readFileSync(path.join(stagingRoot, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string>; scripts?: unknown; engines?: unknown };
      expect(stagedManifest.dependencies?.["@modelcontextprotocol/sdk"]).toBeDefined();
      // Production-safe shape (Req 2.2 / 2.5): no lifecycle scripts, no engines.
      expect(stagedManifest.scripts).toBeUndefined();
      expect(stagedManifest.engines).toBeUndefined();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  });

  // Live leg: run the REAL `stageRuntimeManifest` (which (re)generates the flat
  // manifest and resolves a fresh lockfile via npm). Network/npm-gated: skipped
  // (not failed) when unavailable, per the design's build/CI-level note.
  const maybe = npmAvailable() ? it : it.skip;
  maybe(
    "stageRuntimeManifest produces a lean payload with the sanctioned flat files (live npm)",
    () => {
      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lean-rt-live-repo-"));
      const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lean-rt-live-stage-"));
      try {
        seedNineDistTrees(repoRoot);
        stagePayload(repoRoot, stagingRoot);

        // Real staging: generates the manifest + resolves a lockfile, then
        // copies the two flat files to the payload root. Uses the REAL
        // installer root so the generator reads the real tool manifests.
        stageRuntimeManifest(installerRoot, stagingRoot);

        expect(assertLeanPayload(stagingRoot)).toEqual([]);
        expect(hasNodeModulesAnywhere(stagingRoot)).toBe(false);

        const topLevel = fs.readdirSync(stagingRoot).sort();
        const expectedTopLevel = [...CANONICAL_DIR_NAMES, ...SANCTIONED_PAYLOAD_ROOT_FILES].sort();
        expect(topLevel).toEqual(expectedTopLevel);
      } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
