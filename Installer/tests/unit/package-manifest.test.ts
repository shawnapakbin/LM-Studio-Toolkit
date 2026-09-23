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
