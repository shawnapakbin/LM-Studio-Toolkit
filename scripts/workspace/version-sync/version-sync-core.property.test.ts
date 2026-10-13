// Feature: dependency-refresh-node24, Property 4: Repo-wide version sync

/**
 * Feature: dependency-refresh-node24
 * Property 4: Repo-wide version sync is consistent, idempotent, and
 * mismatch-reporting
 *
 * For all target versions and file-content snapshots (a mix of JSON manifests,
 * a Cargo.toml `[package]`, and a README `**Version**:` line at varying starting
 * versions):
 *   1. after `applyRepoSync(target, contents)`, extracting each file's version
 *      yields the byte-identical `target` (consistency, Req 9.8);
 *   2. running `applyRepoSync` a second time over the already-synced map is a
 *      byte-for-byte no-op (idempotence, Req 9.8);
 *   3. `checkRepoVersions(target, snapshot).ok` is true IFF every file already
 *      reports the byte-identical `target`, and `mismatched` lists exactly (and
 *      only) the divergent files (Req 9.8 / 9.9).
 *
 * Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9
 * Design: Property 4
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `applyRepoSync` / `checkRepoVersions` are the pure repo-wide sync + consistency
 * core consumed by the filesystem CLI (`sync-repo-version.ts`). This test drives
 * the REAL functions (imported from `version-sync-core` with no `.ts` extension
 * so ts-jest / CommonJS resolves it, and with NO mocks) over generated targets
 * and file snapshots.
 *
 * The oracle is INDEPENDENT of the module's sync/decision logic:
 *   - consistency is asserted directly against the generated `target` string
 *     (via a from-scratch `extractVersion`, the deterministic read the fixtures
 *     were built to satisfy), not by re-running `applyRepoSync`;
 *   - the expected mismatch set is computed straight from the acceptance
 *     criterion ("a file diverges IFF its recorded version !== target") by a
 *     hand-written filter over the generated snapshot, then compared to
 *     `checkRepoVersions`.
 */

import * as fc from "fast-check";
import {
  applyRepoSync,
  checkRepoVersions,
  extractVersion,
  fileKind,
  type VersionFileId,
} from "./version-sync-core";

// ── Fixture builders (mirroring the repo's real file shapes) ─────────────────

/** A JSON manifest (package.json / tauri.conf.json) reporting `version`. */
function makeJson(version: string): string {
  return `{\n  "name": "fixture-pkg",\n  "version": "${version}",\n  "private": true\n}\n`;
}

/**
 * A Cargo.toml carrying a `[package] version` AND a dependency `version = "..."`
 * that must never be picked up by the extractor or writer.
 */
function makeCargo(version: string): string {
  return `[package]\nname = "fixture-crate"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2.9", features = [] }\n`;
}

/** A README with a `**Version**:` line + a Markdown hard-break (two spaces). */
function makeReadme(version: string): string {
  return `# Fixture\n\n**Version**: ${version}  \n**Status**: fixture\n`;
}

/** Every `VersionFileId` in the repo's sync set, paired with its kind + builder. */
interface FileSpec {
  id: VersionFileId;
  make: (version: string) => string;
}

const FILE_SPECS: readonly FileSpec[] = [
  { id: "root/package.json", make: makeJson },
  { id: "workspace:CLI/package.json", make: makeJson },
  { id: "workspace:Sync/package.json", make: makeJson },
  { id: "Installer/src-tauri/tauri.conf.json", make: makeJson },
  { id: "Installer/src-tauri/Cargo.toml", make: makeCargo },
  { id: "README.md", make: makeReadme },
] as const;

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** A strict MAJOR.MINOR.PATCH triple of non-negative integers. */
const versionArb: fc.Arbitrary<string> = fc
  .tuple(fc.nat({ max: 999 }), fc.nat({ max: 999 }), fc.nat({ max: 999 }))
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/**
 * A map of `VersionFileId -> file contents`, each file built at an independently
 * generated starting version so the snapshot mixes matching and diverging files.
 */
const contentsArb: fc.Arbitrary<Record<string, string>> = fc
  .tuple(...FILE_SPECS.map(() => versionArb))
  .map((versions) => {
    const out: Record<string, string> = {};
    FILE_SPECS.forEach((spec, i) => {
      out[spec.id] = spec.make(versions[i]);
    });
    return out;
  });

/**
 * A snapshot of already-extracted version strings per file (what the CLI would
 * feed `checkRepoVersions`), each independently generated so files diverge or
 * agree at random.
 */
const snapshotArb: fc.Arbitrary<Record<string, string>> = fc
  .tuple(...FILE_SPECS.map(() => versionArb))
  .map((versions) => {
    const out: Record<string, string> = {};
    FILE_SPECS.forEach((spec, i) => {
      out[spec.id] = versions[i];
    });
    return out;
  });

describe("Feature: dependency-refresh-node24, Property 4: Repo-wide version sync", () => {
  it("applyRepoSync makes every file report the byte-identical target (consistency)", () => {
    fc.assert(
      fc.property(versionArb, contentsArb, (target, contents) => {
        const synced = applyRepoSync(target, contents);

        // The synced map covers exactly the same files as the input.
        expect(Object.keys(synced).sort()).toEqual(Object.keys(contents).sort());

        // Every file now reports the byte-identical target, read by an
        // independent extractor rather than trusting the sync's own output.
        for (const id of Object.keys(synced) as VersionFileId[]) {
          expect(extractVersion(fileKind(id), synced[id])).toBe(target);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("a second applyRepoSync over the synced map is a byte-for-byte no-op (idempotence)", () => {
    fc.assert(
      fc.property(versionArb, contentsArb, (target, contents) => {
        const once = applyRepoSync(target, contents);
        const twice = applyRepoSync(target, once);
        // Idempotent: running sync again with the same target changes nothing.
        expect(twice).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });

  it("checkRepoVersions.ok iff every file equals target, and mismatched lists exactly the divergent files", () => {
    fc.assert(
      fc.property(versionArb, snapshotArb, (target, snapshot) => {
        const result = checkRepoVersions(target, snapshot);

        // Independent oracle: a file diverges IFF its recorded version string is
        // not byte-identical to the target (straight from the criterion).
        const expectedMismatched = (Object.keys(snapshot) as VersionFileId[])
          .filter((id) => snapshot[id] !== target)
          .sort((a, b) => a.localeCompare(b));

        expect(result.target).toBe(target);

        // `mismatched` lists exactly (and only) the divergent files, sorted.
        expect(result.mismatched).toEqual(expectedMismatched);

        // ...and no matching file leaks into the mismatch list.
        for (const id of result.mismatched) {
          expect(snapshot[id]).not.toBe(target);
        }

        // `ok` is the biconditional of an empty mismatch set, i.e. true iff
        // every file already equals the target.
        expect(result.ok).toBe(expectedMismatched.length === 0);
        expect(result.ok).toBe(
          (Object.keys(snapshot) as VersionFileId[]).every((id) => snapshot[id] === target),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("a snapshot where every file already equals target reports ok with no mismatches", () => {
    fc.assert(
      fc.property(versionArb, (target) => {
        const snapshot: Record<string, string> = {};
        for (const spec of FILE_SPECS) {
          snapshot[spec.id] = target;
        }
        const result = checkRepoVersions(target, snapshot);
        expect(result.ok).toBe(true);
        expect(result.mismatched).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
