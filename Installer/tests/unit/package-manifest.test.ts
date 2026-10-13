/**
 * Package-manifest assertion tests.
 *
 * Feature: windows-installer-setup-exe (Requirements 1.1, 1.3, 1.4, 1.5, 2.2)
 *
 * These tests read the real installer manifests from disk and assert the
 * Tauri-toolchain invariants so a regression back toward the retired Electron
 * stack (or away from the NSIS perMachine bundle) is caught:
 *
 *   - Installer/package.json declares `@tauri-apps/cli` as the sole Tauri dev
 *     dependency (1.1); contains no Electron/electron-vite/electron-builder
 *     entry in ANY dependency section (1.3); contains no electron-builder
 *     `build` block, no `extraResources`, and no `main` field (1.4, 1.5).
 *   - Installer/src-tauri/tauri.conf.json declares `bundle.targets` including
 *     "nsis" and `nsis.installMode == "perMachine"` (2.2).
 *
 * The repo-integration invariants (root workspaces, .gitignore, workflow nsis/
 * path) are covered separately by task 14.5.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Installer/ root, resolved from this test file's location. */
const installerRoot = resolve(__dirname, "..", "..");

const PACKAGE_JSON_PATH = resolve(installerRoot, "package.json");
const TAURI_CONF_PATH = resolve(installerRoot, "src-tauri", "tauri.conf.json");
const APP_MANIFEST_PATH = resolve(installerRoot, "src-tauri", "llm-toolkit-installer.exe.manifest");

/** Read + parse a JSON manifest from disk. */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** The dependency-section keys a package.json may carry. */
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "bundleDependencies",
] as const;

/** Package names that indicate a residual Electron toolchain. */
const ELECTRON_PACKAGES = ["electron", "electron-vite", "electron-builder"];

describe("Installer/package.json — Tauri toolchain invariants", () => {
  const pkg = readJson(PACKAGE_JSON_PATH);

  /** Collect every dependency name declared across all sections. */
  function allDependencyNames(): string[] {
    const names: string[] = [];
    for (const section of DEPENDENCY_SECTIONS) {
      const value = pkg[section];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        names.push(...Object.keys(value as Record<string, unknown>));
      } else if (Array.isArray(value)) {
        // bundledDependencies is an array of names.
        names.push(...(value as string[]));
      }
    }
    return names;
  }

  it("declares @tauri-apps/cli as a dev dependency (1.1)", () => {
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, unknown>;
    expect(devDeps).toHaveProperty("@tauri-apps/cli");
    expect(typeof devDeps["@tauri-apps/cli"]).toBe("string");
  });

  it("declares @tauri-apps/cli as the sole Tauri CLI dev dependency (1.1)", () => {
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, unknown>;
    // Any dependency that is a Tauri CLI package (name mentions both "tauri"
    // and "cli"). There must be exactly one: the canonical @tauri-apps/cli.
    const tauriCliDeps = Object.keys(devDeps).filter(
      (name) => /tauri/i.test(name) && /cli/i.test(name),
    );
    expect(tauriCliDeps).toEqual(["@tauri-apps/cli"]);
  });

  it("contains no Electron, electron-vite, or electron-builder entry in any dependency section (1.3)", () => {
    const names = allDependencyNames();
    for (const banned of ELECTRON_PACKAGES) {
      expect(names).not.toContain(banned);
    }
    // Defense in depth: nothing electron-prefixed at all.
    const electronish = names.filter((n) => /^electron(-|$)/.test(n));
    expect(electronish).toEqual([]);
  });

  it("contains no electron-builder `build` configuration block (1.4)", () => {
    expect(pkg).not.toHaveProperty("build");
  });

  it("contains no `extraResources` reference to the deleted payload tree (1.4)", () => {
    // `extraResources` is an electron-builder concept and would live under a
    // `build` block; assert it appears nowhere in the manifest text either.
    expect(pkg).not.toHaveProperty("extraResources");
    const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
    expect(raw).not.toMatch(/extraResources/);
  });

  it("contains no `main` field referencing an Electron entry point (1.5)", () => {
    expect(pkg).not.toHaveProperty("main");
  });
});

describe("Installer/src-tauri/tauri.conf.json — NSIS bundle invariants", () => {
  const conf = readJson(TAURI_CONF_PATH);

  function bundle(): Record<string, unknown> {
    const b = conf.bundle;
    expect(b && typeof b === "object" && !Array.isArray(b)).toBe(true);
    return b as Record<string, unknown>;
  }

  it('declares `bundle.targets` including "nsis" (2.2)', () => {
    const targets = bundle().targets;
    expect(Array.isArray(targets)).toBe(true);
    expect(targets as string[]).toContain("nsis");
  });

  it('sets `nsis.installMode` to "perMachine" (2.2)', () => {
    const windows = bundle().windows as Record<string, unknown> | undefined;
    expect(windows && typeof windows === "object").toBe(true);
    const nsis = (windows as Record<string, unknown>).nsis as Record<string, unknown> | undefined;
    expect(nsis && typeof nsis === "object").toBe(true);
    expect((nsis as Record<string, unknown>).installMode).toBe("perMachine");
  });
});

/**
 * Elevation-gate manifest invariants.
 *
 * Feature: installer-runtime-provisioning (Requirements 1.1, 1.2, 1.5)
 *
 * The installer must always run elevated: `nsis.installMode` is "perMachine"
 * (so Tauri emits `RequestExecutionLevel admin`) AND the bundled exe embeds an
 * application manifest declaring `requireAdministrator` (embedded via
 * build.rs). These assertions guard against a regression back to a
 * `currentUser` / non-elevated installer.
 */
describe("installer-runtime-provisioning — elevation manifest invariants", () => {
  const conf = readJson(TAURI_CONF_PATH);

  it('sets nsis.installMode to "perMachine" so Tauri requests admin (1.1)', () => {
    const b = conf.bundle as Record<string, unknown>;
    const windows = b.windows as Record<string, unknown> | undefined;
    const nsis = (windows as Record<string, unknown> | undefined)?.nsis as
      | Record<string, unknown>
      | undefined;
    expect(nsis?.installMode).toBe("perMachine");
  });

  it("embeds an application manifest file for the bundled exe (1.2)", () => {
    // The manifest must exist on disk; readFileSync throws if it does not.
    const raw = readFileSync(APP_MANIFEST_PATH, "utf8");
    expect(raw.length).toBeGreaterThan(0);
  });

  it('declares requestedExecutionLevel level="requireAdministrator" (1.2, 1.5)', () => {
    const raw = readFileSync(APP_MANIFEST_PATH, "utf8");
    // Tolerant of single/double quotes and surrounding whitespace between
    // `level` and the value.
    expect(raw).toMatch(/level\s*=\s*["']requireAdministrator["']/);
  });
});

/**
 * Common-Controls v6 dependency guard.
 *
 * Feature: taskdialogindirect-entrypoint-fix (Requirements 2.1, 2.2)
 *
 * The installer uses TaskDialogIndirect, which is only exported by comctl32.dll
 * version 6. A process binds to comctl32 v6 by declaring a <dependency> on
 * Microsoft.Windows.Common-Controls 6.0.0.0 in its application manifest.
 * When that dependency is absent, the loader falls back to comctl32 v5, which
 * does not export TaskDialogIndirect, and the process fails at load with:
 * "The procedure entry point TaskDialogIndirect could not be located."
 *
 * This test asserts the manifest declares the Common-Controls v6 dependency.
 * **Validates: Requirements 2.1, 2.2**
 */
describe("taskdialogindirect-entrypoint-fix — Common-Controls v6 dependency guard", () => {
  it("declares Microsoft.Windows.Common-Controls version 6.0.0.0 dependency (2.1, 2.2)", () => {
    const raw = readFileSync(APP_MANIFEST_PATH, "utf8");

    // The manifest must contain a <dependency> block with a <dependentAssembly>
    // whose <assemblyIdentity> names Microsoft.Windows.Common-Controls at version 6.0.0.0.
    // Tolerant of single/double quotes and whitespace.
    expect(raw).toMatch(/<dependency>/);
    expect(raw).toMatch(/<dependentAssembly>/);
    expect(raw).toMatch(/name\s*=\s*["']Microsoft\.Windows\.Common-Controls["']/);
    expect(raw).toMatch(/version\s*=\s*["']6\.0\.0\.0["']/);
  });
});

/**
 * Preservation invariants for build.rs manifest routing.
 *
 * Feature: taskdialogindirect-entrypoint-fix (Requirement 3.2)
 *
 * The build.rs script routes exactly one application manifest through
 * tauri_build::WindowsAttributes::app_manifest via a single include_str! call.
 * This avoids double-manifest link conflicts where the linker would see
 * multiple manifest inputs and fail or produce undefined behavior.
 *
 * This test asserts the single-manifest routing invariant is preserved.
 * **Validates: Requirement 3.2**
 */
describe("taskdialogindirect-entrypoint-fix — build.rs single-manifest routing preservation", () => {
  const BUILD_RS_PATH = resolve(installerRoot, "src-tauri", "build.rs");

  it("routes exactly one app_manifest via include_str! - no double-manifest conflict (3.2)", () => {
    const raw = readFileSync(BUILD_RS_PATH, "utf8");

    // Count occurrences of app_manifest calls - must be exactly one.
    const appManifestMatches = raw.match(/\.app_manifest\s*\(/g);
    expect(appManifestMatches).not.toBeNull();
    expect(appManifestMatches!.length).toBe(1);

    // Count occurrences of include_str! for .manifest files - must be exactly one.
    const includeStrMatches = raw.match(/include_str!\s*\(\s*["'][^"']+\.manifest["']\s*\)/g);
    expect(includeStrMatches).not.toBeNull();
    expect(includeStrMatches!.length).toBe(1);
  });

  it("references the llm-toolkit-installer.exe.manifest file (3.2)", () => {
    const raw = readFileSync(BUILD_RS_PATH, "utf8");

    // The include_str! must reference the expected manifest file.
    expect(raw).toMatch(/include_str!\s*\(\s*["']llm-toolkit-installer\.exe\.manifest["']\s*\)/);
  });
});
