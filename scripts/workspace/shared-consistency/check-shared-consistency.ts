/**
 * Shared-dependency version-consistency check — a Phase F gate for
 * dependency-refresh-node24.
 *
 * Feature: dependency-refresh-node24 (Requirements 3.3, 6.5, 6.6)
 *
 * Thin I/O wrapper around the pure `shared-consistency-core` decision. It
 * discovers every workspace from the root `package.json` `workspaces` array,
 * reads each workspace's `dependencies` + `devDependencies` ranges, builds the
 * per-dependency `(workspace, range)` table, runs the pure
 * `checkSharedConsistency` decision, prints the result, and exits 0 when every
 * shared dependency is aligned or non-zero listing each divergent dependency +
 * its declaring workspaces otherwise (Req 6.5 / 6.6, Property 2).
 *
 * This mirrors the `check-node-24-core.ts` / `check-node-24.ts` and
 * `crate-currency-core.ts` / `check-crate-currency.ts` splits already used in
 * `scripts/workspace/` — the consistency DECISION is pure and lives in the core
 * module; only the filesystem scan lives here.
 *
 * The scan is dependency-free (matching the other `scripts/workspace` checks):
 * `package.json` files are read as JSON and their `dependencies` /
 * `devDependencies` objects walked directly.
 *
 * NOTE (per task 6.2): actually ALIGNING divergent ranges is task 6.1's job
 * (which edits the workspace `package.json` files). This CLI only REPORTS
 * divergence; running it against the live repo before 6.1 completes may surface
 * still-misaligned shared deps, which is expected. The Phase F gate (task 6.6)
 * validates final alignment.
 *
 * Run with: `tsx scripts/workspace/shared-consistency/check-shared-consistency.ts`.
 * Flags:
 *   --json   emit the full `SharedConsistencyReport` as JSON instead of text.
 *
 * Exit code: 0 when every shared dependency is consistent; 1 when one or more
 * shared dependencies diverge (each listed); 2 when the scan itself cannot run.
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkSharedConsistency,
  type Declaration,
  type DependencyTable,
  type SharedConsistencyReport,
} from "./shared-consistency-core.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/workspace/shared-consistency -> repo root is three levels up.
const repoRoot = resolve(scriptDir, "..", "..", "..");

/** Repo-relative, forward-slash path for stable reporting. */
function repoRelative(absPath: string): string {
  return relative(repoRoot, absPath).replaceAll("\\", "/");
}

/** Read + parse a JSON file, throwing a descriptive error on failure. */
function readJson(absPath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(absPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`could not read/parse ${repoRelative(absPath)}: ${String(err)}`);
  }
}

/** Read the `workspaces` array from the root `package.json`. */
function readWorkspaceDirs(rootPkg: Record<string, unknown>): string[] {
  const workspaces = rootPkg.workspaces;
  if (!Array.isArray(workspaces)) return [];
  return workspaces.filter((w): w is string => typeof w === "string");
}

/**
 * Collect the `(dependency -> range)` pairs from a parsed `package.json`,
 * merging its `dependencies` and `devDependencies` sections. When a dependency
 * appears in both sections of the same manifest, the `dependencies` value wins
 * (runtime declaration is authoritative); this cannot itself create a
 * divergence report since it is a single workspace.
 */
function collectRanges(pkg: Record<string, unknown>): Map<string, string> {
  const ranges = new Map<string, string>();
  // devDependencies first so a runtime `dependencies` entry overrides it.
  for (const section of ["devDependencies", "dependencies"] as const) {
    const deps = pkg[section];
    if (deps && typeof deps === "object" && !Array.isArray(deps)) {
      for (const [name, value] of Object.entries(deps as Record<string, unknown>)) {
        if (typeof value === "string") ranges.set(name, value);
      }
    }
  }
  return ranges;
}

/**
 * Build the per-dependency declaration table by scanning every workspace's
 * `package.json`. The workspace name used in the report is the workspace
 * directory path (as declared in the root `workspaces` array), which uniquely
 * identifies the declarer.
 */
export function buildTable(
  rootPackageJsonPath = resolve(repoRoot, "package.json"),
): DependencyTable {
  const rootPkg = readJson(rootPackageJsonPath);
  const workspaceDirs = readWorkspaceDirs(rootPkg);

  const table: Record<string, Declaration[]> = {};

  for (const dir of workspaceDirs) {
    const pkgPath = resolve(repoRoot, dir, "package.json");
    let pkg: Record<string, unknown>;
    try {
      pkg = readJson(pkgPath);
    } catch {
      // A workspace directory without a readable package.json is skipped rather
      // than aborting the whole scan.
      continue;
    }

    for (const [dependency, range] of collectRanges(pkg)) {
      const declarers = (table[dependency] ??= []);
      declarers.push({ workspace: dir, range });
    }
  }

  return table;
}

/** Read the table from disk and run the pure consistency decision. */
export function runCheck(
  rootPackageJsonPath = resolve(repoRoot, "package.json"),
): SharedConsistencyReport {
  return checkSharedConsistency(buildTable(rootPackageJsonPath));
}

function main(): void {
  const asJson = process.argv.slice(2).includes("--json");
  let result: SharedConsistencyReport;
  try {
    result = runCheck();
  } catch (err) {
    console.error(`[shared-consistency] check failed: ${String(err)}`);
    process.exit(2);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  }

  if (result.ok) {
    if (!asJson) {
      console.log(
        "[shared-consistency] OK: every dependency shared across 2+ workspaces declares an identical range.",
      );
    }
    process.exit(0);
  }

  if (!asJson) {
    console.error(
      `[shared-consistency] FAILED: ${result.inconsistent.length} shared dependency/dependencies diverge across workspaces (Req 6.5/6.6):`,
    );
    for (const dep of result.inconsistent) {
      console.error(`  - ${dep.dependency}: ${dep.distinctRanges.join(" | ")}`);
      for (const { workspace, range } of dep.declarers) {
        console.error(`      ${workspace} -> ${range}`);
      }
    }
  }
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
