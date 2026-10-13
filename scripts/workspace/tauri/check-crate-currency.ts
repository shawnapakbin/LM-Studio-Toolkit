/**
 * Tauri crate/CLI major-currency check — a Phase E gate for
 * dependency-refresh-node24.
 *
 * Feature: dependency-refresh-node24 (Requirement 5.2)
 *
 * Thin I/O wrapper around the pure `crate-currency-core` match decision. It
 * reads the declared `@tauri-apps/cli` version from a `package.json`
 * (`Installer/package.json` by default) and the declared `tauri` crate version
 * from `Installer/src-tauri/Cargo.toml`, runs the pure `checkCrateMatchesCli`
 * decision, prints the result, and exits 0 when the majors match or non-zero
 * when they diverge (Req 5.2 / Property 8).
 *
 * Parsers are intentionally dependency-free (matching the dependency-free style
 * of the other `scripts/workspace` checks):
 *   - `@tauri-apps/cli` is a string field under `devDependencies` (or
 *     `dependencies`) in `package.json`.
 *   - the `tauri` crate is declared in `Cargo.toml`'s `[dependencies]` table as
 *     either `tauri = "2"` or `tauri = { version = "2", ... }`; a narrow parser
 *     extracts the `version` value for the `tauri` key only.
 *
 * Run with: `tsx scripts/workspace/tauri/check-crate-currency.ts`.
 * Flags:
 *   --json   emit the full `CrateMatchResult` as JSON instead of text.
 *
 * Exit code: 0 when the majors match; 1 when they diverge (pair flagged); 2 when
 * either version cannot be located/read.
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type CrateMatchResult, checkCrateMatchesCli } from "./crate-currency-core.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/workspace/tauri -> repo root is three levels up.
const repoRoot = resolve(scriptDir, "..", "..", "..");

/** Repo-relative, forward-slash path for stable reporting. */
function repoRelative(absPath: string): string {
  return relative(repoRoot, absPath).replaceAll("\\", "/");
}

/**
 * Read the `@tauri-apps/cli` version string from a parsed `package.json`,
 * checking `devDependencies` first (where the CLI conventionally lives) then
 * `dependencies`. Returns `null` when the field is absent.
 */
function readCliVersion(pkg: Record<string, unknown>): string | null {
  for (const section of ["devDependencies", "dependencies"] as const) {
    const deps = pkg[section];
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      const value = (deps as Record<string, unknown>)["@tauri-apps/cli"];
      if (typeof value === "string" && value.trim().length > 0) return value;
    }
  }
  return null;
}

/**
 * Extract the `tauri` crate version from `Cargo.toml` text without a TOML
 * dependency. Two shapes appear in `[dependencies]`:
 *   - `tauri = "2"`                        (bare version string)
 *   - `tauri = { version = "2", ... }`     (inline table with a `version` key)
 *
 * We match the `tauri` key at the start of a line (so `tauri-build` / other
 * `tauri-*` keys are not mistaken for it) and read the first quoted value, or
 * the `version = "..."` inside an inline table. Returns `null` when the crate is
 * not declared.
 */
function readCrateVersion(cargoToml: string): string | null {
  for (const rawLine of cargoToml.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Split the `key = value` pairing on the first `=`, then match the `tauri`
    // dependency key EXACTLY (so `tauri-build` / other `tauri-*` keys are not
    // mistaken for it). Doing the key comparison with a plain string equality
    // (rather than a regex spanning the whole line) keeps the patterns linear.
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== "tauri") continue;

    const rhs = line.slice(eq + 1).trim();
    // Inline table: `{ version = "2", features = [...] }`.
    const inlineVersion = /version[ \t]*=[ \t]*"([^"]*)"/.exec(rhs);
    if (inlineVersion) return inlineVersion[1];

    // Bare string: `"2"`.
    const bareVersion = /^"([^"]*)"/.exec(rhs);
    if (bareVersion) return bareVersion[1];
  }
  return null;
}

/** Read + parse a JSON file, throwing a descriptive error on failure. */
function readJson(absPath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(absPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`could not read/parse ${repoRelative(absPath)}: ${String(err)}`);
  }
}

/**
 * Read both versions from disk and run the pure match decision.
 *
 * `packageJsonPath` and `cargoTomlPath` default to the Installer's manifests but
 * are overridable to keep this wrapper test-friendly.
 */
export function runCheck(
  packageJsonPath = resolve(repoRoot, "Installer", "package.json"),
  cargoTomlPath = resolve(repoRoot, "Installer", "src-tauri", "Cargo.toml"),
): CrateMatchResult {
  const pkg = readJson(packageJsonPath);
  const cliVersion = readCliVersion(pkg);
  if (cliVersion === null) {
    throw new Error(`@tauri-apps/cli not declared in ${repoRelative(packageJsonPath)}`);
  }

  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const crateVersion = readCrateVersion(cargoToml);
  if (crateVersion === null) {
    throw new Error(`tauri crate not declared in ${repoRelative(cargoTomlPath)}`);
  }

  return checkCrateMatchesCli(cliVersion, crateVersion);
}

function main(): void {
  const asJson = process.argv.slice(2).includes("--json");
  let result: CrateMatchResult;
  try {
    result = runCheck();
  } catch (err) {
    console.error(`[tauri-crate] check failed: ${String(err)}`);
    process.exit(2);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const cliMajor = result.cliMajor === null ? "unparseable" : `major ${result.cliMajor}`;
    const crateMajor = result.crateMajor === null ? "unparseable" : `major ${result.crateMajor}`;
    console.log(`[tauri-crate] @tauri-apps/cli "${result.cliVersion}" (${cliMajor})`);
    console.log(`[tauri-crate] tauri crate    "${result.crateVersion}" (${crateMajor})`);
  }

  if (result.ok) {
    console.log(
      `[tauri-crate] OK: tauri crate major matches @tauri-apps/cli major (${result.cliMajor}).`,
    );
    process.exit(0);
  }

  console.error(
    `[tauri-crate] FAILED: tauri crate major (${result.crateMajor ?? "unparseable"}) does not match ` +
      `@tauri-apps/cli major (${result.cliMajor ?? "unparseable"}); ` +
      `cli="${result.cliVersion}", crate="${result.crateVersion}" (Req 5.2).`,
  );
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
