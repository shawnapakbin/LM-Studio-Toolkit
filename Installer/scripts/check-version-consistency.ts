/**
 * CI / build-time version-consistency check for the LLM Toolkit installer.
 *
 * Feature: windows-installer-setup-exe (Requirements 11.1, 11.2, 11.5)
 *
 * Thin I/O wrapper around the pure `checkVersionConsistency` core: it reads the
 * three installer manifests, extracts their version strings, runs the pure
 * check, prints a result, and exits non-zero on failure while naming exactly
 * the manifests whose version differs.
 *
 * Run with: `npm run check:versions` (i.e. `tsx scripts/check-version-consistency.ts`).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ManifestId,
  type ManifestVersions,
  checkVersionConsistency,
  extractCargoVersion,
  extractJsonVersion,
} from "./version-consistency.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const installerRoot = resolve(scriptDir, "..");

/** Absolute paths to the three manifests, relative to the Installer/ root. */
const MANIFEST_PATHS: Record<ManifestId, string> = {
  "package.json": resolve(installerRoot, "package.json"),
  "tauri.conf.json": resolve(installerRoot, "src-tauri", "tauri.conf.json"),
  "Cargo.toml": resolve(installerRoot, "src-tauri", "Cargo.toml"),
};

/** Read all three manifests and return their extracted version strings. */
export function readManifestVersions(): ManifestVersions {
  return {
    "package.json": extractJsonVersion(readFileSync(MANIFEST_PATHS["package.json"], "utf8")),
    "tauri.conf.json": extractJsonVersion(readFileSync(MANIFEST_PATHS["tauri.conf.json"], "utf8")),
    "Cargo.toml": extractCargoVersion(readFileSync(MANIFEST_PATHS["Cargo.toml"], "utf8")),
  };
}

function main(): void {
  const versions = readManifestVersions();
  const result = checkVersionConsistency(versions);

  if (result.ok) {
    console.log(`[version-consistency] OK — ${result.reason}`);
    process.exit(0);
  }

  console.error(`[version-consistency] FAILED — ${result.reason}`);
  console.error(`[version-consistency] Manifests to fix: ${result.mismatchedManifests.join(", ")}`);
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
