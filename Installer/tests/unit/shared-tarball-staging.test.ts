/**
 * Bugfix: mcp-shared-module-resolution-fix — task 3.2.
 *
 * Unit coverage for the `@shared/*` tarball staging seam (Option B, design →
 * Fix → Changes Required step 2):
 *
 *   - `sharedTarballFileName` / `sharedTarballFileNames` derive the staged
 *     tarball names from the SUPPLIED root version (never hardcoded), so the
 *     names track the repo-wide version bump (5.4.2 → 5.4.3) with zero drift.
 *   - `SANCTIONED_PAYLOAD_ROOT_FILES` carries the two version-derived tarball
 *     filenames (derived from the REAL root `package.json`) in addition to the
 *     flat `package.json` / `package-lock.json`.
 *   - `assertLeanPayload` accepts the two tarballs ONLY as top-level REGULAR
 *     FILES, and still rejects a directory sharing a tarball name, a stray
 *     `node_modules` at any depth, and an oversize total — the single, minimal
 *     relaxation leaves every other Lean_Payload invariant intact (Req 3.4).
 *
 * Validates: Requirements 2.1, 2.2, 3.2, 3.4
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CANONICAL_TOOL_PAYLOADS,
  SANCTIONED_PAYLOAD_ROOT_FILES,
  SHARED_TARBALL_SPECS,
  sharedTarballFileName,
  sharedTarballFileNames,
  stagingDestDirName,
} from "../../scripts/payload-manifest";
import {
  assertLeanPayload,
  MAX_STAGED_PAYLOAD_BYTES,
  resolveRootVersion,
} from "../../scripts/stage-payload";

/** `Installer/` root, from this test file's location (`Installer/tests/unit`). */
const installerRoot = path.resolve(__dirname, "..", "..");
/** Repository root: one level up from `Installer/`. */
const repoRoot = path.resolve(installerRoot, "..");

/** The canonical nine server dir names (single source of truth). */
const CANONICAL_DIR_NAMES: readonly string[] = CANONICAL_TOOL_PAYLOADS.map((t) =>
  stagingDestDirName(t),
);

/** Seed a lean baseline: the nine canonical dirs, one small file each. */
function seedNineDirs(root: string): void {
  for (const name of CANONICAL_DIR_NAMES) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mcp-server.js"), "// entry\n");
  }
}

describe("task 3.2 / 8.2 — version-derived workspace-internal tarball naming", () => {
  it("has the generalized workspace-internal tarball specs in a stable order", () => {
    // 5.4.3 started with the two @shared/* packages; the 5.4.4 follow-up (task
    // 8.2) generalizes the SAME seam to the five llm-toolkit-* packages.
    expect(SHARED_TARBALL_SPECS.map((s) => s.packageDir)).toEqual([
      "shared",
      "shared/config",
      "AskUser",
      "Calculator",
      "Clock",
      "DocumentScraper",
      "Observability",
    ]);
    expect(SHARED_TARBALL_SPECS.map((s) => s.stem)).toEqual([
      "shared-types",
      "shared-config",
      "llm-toolkit-ask-user",
      "llm-toolkit-calculator",
      "llm-toolkit-clock",
      "llm-toolkit-document-scraper",
      "llm-toolkit-observability",
    ]);
  });

  it("derives the filename from the supplied version, not a hardcoded one", () => {
    // Arbitrary versions must flow straight through — proving nothing is pinned.
    expect(sharedTarballFileName("shared-types", "5.4.3")).toBe("shared-types-5.4.3.tgz");
    expect(sharedTarballFileName("shared-config", "5.4.3")).toBe("shared-config-5.4.3.tgz");
    expect(sharedTarballFileName("shared-types", "9.9.9-rc.1")).toBe("shared-types-9.9.9-rc.1.tgz");
    expect(sharedTarballFileName("shared-config", "0.0.0")).toBe("shared-config-0.0.0.tgz");
    expect(sharedTarballFileName("llm-toolkit-ask-user", "5.4.4")).toBe(
      "llm-toolkit-ask-user-5.4.4.tgz",
    );
    expect(sharedTarballFileName("llm-toolkit-observability", "5.4.4")).toBe(
      "llm-toolkit-observability-5.4.4.tgz",
    );
  });

  it("sharedTarballFileNames returns every spec's name in spec order for a given version", () => {
    // Derive the expected names straight from the spec list so this assertion
    // tracks any future SHARED_TARBALL_SPECS addition with no hardcoded drift.
    const expectedFor = (v: string) => SHARED_TARBALL_SPECS.map((s) => `${s.stem}-${v}.tgz`);
    expect(sharedTarballFileNames("5.4.4")).toEqual(expectedFor("5.4.4"));
    // A different version changes EVERY name — confirming version-derivation.
    expect(sharedTarballFileNames("7.0.1")).toEqual(expectedFor("7.0.1"));
  });

  it("names track the REAL resolved root version (no hardcoded drift)", () => {
    const version = resolveRootVersion(repoRoot);
    expect(version.length).toBeGreaterThan(0);
    // The names derived from the real root version must equal what the helper
    // produces for that exact version — so staging + sanction cannot disagree.
    expect(sharedTarballFileNames(version)).toEqual(
      SHARED_TARBALL_SPECS.map((s) => `${s.stem}-${version}.tgz`),
    );
  });
});

describe("task 3.2 / 8.2 — SANCTIONED_PAYLOAD_ROOT_FILES includes every workspace tarball", () => {
  it("carries the flat manifest files plus every version-derived tarball name", () => {
    const version = resolveRootVersion(repoRoot);
    const expectedTarballs = sharedTarballFileNames(version);

    // The flat manifest/lockfile remain sanctioned (unchanged behavior).
    expect(SANCTIONED_PAYLOAD_ROOT_FILES).toContain("package.json");
    expect(SANCTIONED_PAYLOAD_ROOT_FILES).toContain("package-lock.json");

    // Every workspace-internal tarball is now sanctioned, derived from the
    // root version (both @shared/* and the five llm-toolkit-* follow-ups).
    for (const name of expectedTarballs) {
      expect(SANCTIONED_PAYLOAD_ROOT_FILES).toContain(name);
    }

    // Exactly the flat manifest/lockfile plus the derived tarballs — no extras.
    expect([...SANCTIONED_PAYLOAD_ROOT_FILES].sort()).toEqual(
      ["package.json", "package-lock.json", ...expectedTarballs].sort(),
    );
  });
});

describe("task 3.2 — assertLeanPayload accepts the tarballs only as regular files", () => {
  const version = resolveRootVersion(repoRoot);
  const tarballs = sharedTarballFileNames(version);

  it("accepts the two tarballs as top-level REGULAR files (no violations)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-tgz-ok-"));
    try {
      seedNineDirs(root);
      // Stage the two sanctioned tarballs as regular files alongside the flat
      // manifest + lockfile — exactly the staged top-level shape.
      fs.writeFileSync(path.join(root, "package.json"), "{}\n");
      fs.writeFileSync(path.join(root, "package-lock.json"), "{}\n");
      for (const name of tarballs) {
        fs.writeFileSync(path.join(root, name), "fake-tgz-bytes");
      }
      expect(assertLeanPayload(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags a DIRECTORY sharing a tarball name as unexpected-top-level", () => {
    for (const name of tarballs) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-tgz-dir-"));
      try {
        seedNineDirs(root);
        // A directory masquerading under a sanctioned tarball name must NOT be
        // accepted — only regular files are sanctioned, so no tree (and never a
        // node_modules) can slip in under a tarball name.
        fs.mkdirSync(path.join(root, name), { recursive: true });
        fs.writeFileSync(path.join(root, name, "smuggled.js"), "// nope\n");

        const violations = assertLeanPayload(root);
        const flagged = violations
          .filter((v) => v.kind === "unexpected-top-level")
          .map((v) => path.resolve(v.detail));
        expect(flagged).toContain(path.resolve(path.join(root, name)));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("still flags a stray node_modules even with the sanctioned tarballs present", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-tgz-nm-"));
    try {
      seedNineDirs(root);
      for (const name of tarballs) {
        fs.writeFileSync(path.join(root, name), "fake-tgz-bytes");
      }
      // A node_modules nested under a sanctioned tool dir must still be flagged.
      const nm = path.join(root, CANONICAL_DIR_NAMES[0], "node_modules");
      fs.mkdirSync(nm, { recursive: true });
      fs.writeFileSync(path.join(nm, "package.json"), "{}\n");

      const flagged = assertLeanPayload(root)
        .filter((v) => v.kind === "node-modules")
        .map((v) => path.resolve(v.detail));
      expect(flagged).toContain(path.resolve(nm));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the 500 MB oversize budget unchanged (sanctioned tarballs do not relax it)", () => {
    // The relaxation is top-level naming only — the budget constant and its
    // gate are untouched. A lean tree with the tarballs present is under budget.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-tgz-size-"));
    try {
      seedNineDirs(root);
      for (const name of tarballs) {
        fs.writeFileSync(path.join(root, name), "fake-tgz-bytes");
      }
      expect(assertLeanPayload(root).filter((v) => v.kind === "oversize")).toEqual([]);
      expect(MAX_STAGED_PAYLOAD_BYTES).toBe(500 * 1024 * 1024);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
