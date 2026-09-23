/**
 * Repo-integration assertion tests.
 *
 * Feature: windows-installer-setup-exe (Requirements 10.1, 10.2, 2.4)
 *
 * These tests read the real repository files from disk — which live OUTSIDE
 * the Installer/ directory, one level up at the repo root — and assert the
 * re-integration invariants that keep the installer a first-class, tracked,
 * buildable member of the monorepo:
 *
 *   - Root package.json `workspaces` includes "Installer" (10.1), so the
 *     installer participates in the npm workspace (install, scripts, CI -w).
 *   - The root .gitignore does NOT blanket-ignore the installer sources
 *     (10.2): there is no bare `Installer/` line, while the specific
 *     build/runtime artifact excludes (e.g. Installer/src-tauri/payload/,
 *     Installer/dist/) remain present.
 *   - The installer-release workflow references the NSIS output path
 *     (bundle/nsis) and the .exe artifact path (2.4).
 *
 * The Tauri package.json / tauri.conf.json invariants (incl. 2.2
 * installMode == perMachine) are covered by package-manifest.test.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Installer/ root, resolved from this test file's location. */
const installerRoot = resolve(__dirname, "..", "..");

/** Repository root: one level up from Installer/. */
const repoRoot = resolve(installerRoot, "..");

const ROOT_PACKAGE_JSON_PATH = resolve(repoRoot, "package.json");
const ROOT_GITIGNORE_PATH = resolve(repoRoot, ".gitignore");
const INSTALLER_RELEASE_WORKFLOW_PATH = resolve(
  repoRoot,
  ".github",
  "workflows",
  "installer-release.yml",
);

/**
 * Read a required file from disk, failing with a clear message that names the
 * path if it is missing. Guards against silent false-passes when a target file
 * has moved or been deleted.
 */
function readRequiredFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Expected repo-integration target file to exist but it was not found: ${path}`);
  }
  return readFileSync(path, "utf8");
}

describe("Root package.json — workspaces includes Installer (10.1)", () => {
  it('lists "Installer" in the workspaces array', () => {
    const raw = readRequiredFile(ROOT_PACKAGE_JSON_PATH);
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    const workspaces = pkg.workspaces;
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces as string[]).toContain("Installer");
  });
});

describe("Root .gitignore — installer sources are tracked (10.2)", () => {
  const raw = readRequiredFile(ROOT_GITIGNORE_PATH);
  // Non-comment, trimmed lines only, so a `# Installer/` comment never
  // registers as a blanket ignore.
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  it("does NOT contain a blanket `Installer/` ignore line", () => {
    // A blanket ignore would be the bare directory pattern, with or without a
    // leading slash and with or without a trailing slash.
    const blanketPatterns = new Set(["Installer", "Installer/", "/Installer", "/Installer/"]);
    const blanketMatches = lines.filter((line) => blanketPatterns.has(line));
    expect(blanketMatches).toEqual([]);
  });

  it("still contains specific installer artifact excludes", () => {
    // At least one representative build/runtime artifact exclude must remain so
    // regenerable outputs are not committed. These are directory-scoped, not a
    // blanket source ignore.
    const representativeExcludes = ["Installer/src-tauri/payload/", "Installer/dist/"];
    for (const exclude of representativeExcludes) {
      expect(lines).toContain(exclude);
    }
  });
});

describe("installer-release workflow — references the NSIS output path (2.4)", () => {
  const raw = readRequiredFile(INSTALLER_RELEASE_WORKFLOW_PATH);

  it("references the `bundle/nsis` NSIS output directory", () => {
    expect(raw).toMatch(/bundle\/nsis/);
  });

  it("references the `.exe` NSIS artifact path", () => {
    // The NSIS bundler emits the setup.exe under bundle/nsis/; the workflow
    // must point at that .exe (e.g. nsis/*.exe) to locate/upload it.
    expect(raw).toMatch(/nsis\/\*\.exe/);
  });
});
