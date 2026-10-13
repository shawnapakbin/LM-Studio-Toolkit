/**
 * Repo-wide version-sync + consistency tool — the Phase I surface for
 * dependency-refresh-node24.
 *
 * Feature: dependency-refresh-node24 (Requirements 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9)
 *
 * Thin I/O wrapper around the pure `version-sync-core`. It has two modes:
 *
 *   `sync`  — reads the target version from the single source of truth (the
 *             root `package.json` `version` field) and writes it byte-identically
 *             into every target file: the root `package.json`, EVERY workspace
 *             `package.json` (discovered from the root `workspaces` array),
 *             `Installer/src-tauri/Cargo.toml`, `Installer/src-tauri/tauri.conf.json`,
 *             and `README.md`. Idempotent: running it twice writes no new bytes
 *             (Req 9.3–9.8).
 *
 *   `check` — reads every target file, asserts a byte-identical version string
 *             across them (against the root `package.json` target), and on
 *             mismatch reports each file whose version differs (Req 9.9). Exits
 *             non-zero on mismatch. The Installer-scoped `check:versions`
 *             (the three-manifest sub-check) is run first as a sub-check and its
 *             result folded into the overall outcome.
 *
 * This mirrors the pure-core + wrapper split used across `scripts/workspace/`
 * (e.g. `check-node-24-core.ts` / `check-node-24.ts`): the extraction + decision
 * logic is pure and lives in `version-sync-core.ts`; only the filesystem scan,
 * writes, and process exit live here. The scan is dependency-free — files are
 * read as text and parsed by the pure core.
 *
 * Run with:
 *   tsx scripts/workspace/version-sync/sync-repo-version.ts check   (default)
 *   tsx scripts/workspace/version-sync/sync-repo-version.ts sync
 * Flags:
 *   --json   emit the machine-readable result as JSON instead of text.
 *
 * Exit code: 0 on success; 1 on mismatch (`check`) or verification failure
 * (`sync`); 2 when the scan itself cannot run.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readManifestVersions } from "../../../Installer/scripts/check-version-consistency.ts";
import { checkVersionConsistency } from "../../../Installer/scripts/version-consistency.ts";
import {
  applyRepoSync,
  checkRepoVersions,
  extractVersion,
  fileKind,
  type SyncResult,
  type VersionFileId,
} from "./version-sync-core.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/workspace/version-sync -> repo root is three levels up.
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
 * The full set of version-carrying files, mapping each `VersionFileId` to its
 * absolute path. Discovered from the root `package.json` `workspaces` array
 * (single source of truth) so the set tracks the real workspaces — every
 * workspace `package.json` is included (Req 9.4).
 */
export function resolveTargetFiles(
  rootPackageJsonPath = resolve(repoRoot, "package.json"),
): Map<VersionFileId, string> {
  const rootPkg = readJson(rootPackageJsonPath);
  const files = new Map<VersionFileId, string>();

  files.set("root/package.json", rootPackageJsonPath);

  for (const dir of readWorkspaceDirs(rootPkg)) {
    const id = `workspace:${dir}/package.json` as VersionFileId;
    files.set(id, resolve(repoRoot, dir, "package.json"));
  }

  files.set(
    "Installer/src-tauri/Cargo.toml",
    resolve(repoRoot, "Installer", "src-tauri", "Cargo.toml"),
  );
  files.set(
    "Installer/src-tauri/tauri.conf.json",
    resolve(repoRoot, "Installer", "src-tauri", "tauri.conf.json"),
  );
  files.set("README.md", resolve(repoRoot, "README.md"));

  return files;
}

/** Read the target version — the single source of truth (root package.json). */
export function readTargetVersion(rootPackageJsonPath = resolve(repoRoot, "package.json")): string {
  return extractVersion("json", readFileSync(rootPackageJsonPath, "utf8"));
}

/** Read the current version reported by every target file, keyed by id. */
function readSnapshot(files: Map<VersionFileId, string>): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [id, absPath] of files) {
    snapshot[id] = extractVersion(fileKind(id), readFileSync(absPath, "utf8"));
  }
  return snapshot;
}

/**
 * `check` mode: read every target file's version and assert byte-identity with
 * the root-`package.json` target, returning the pure `SyncResult`.
 */
export function runRepoCheck(files = resolveTargetFiles()): SyncResult {
  const target = readTargetVersion();
  return checkRepoVersions(target, readSnapshot(files));
}

/**
 * `sync` mode: read the target from the root `package.json`, write it into every
 * target file (byte-identical, idempotent), then re-read and return the
 * post-sync `SyncResult` so the caller can confirm consistency (Req 9.8/9.9).
 */
export function runRepoSync(files = resolveTargetFiles()): SyncResult {
  const target = readTargetVersion();

  // Read all contents, apply the target with the pure sync, and write back only
  // the files whose bytes actually change (so a no-op sync touches no file's
  // mtime and stays a true no-op).
  const contents: Record<string, string> = {};
  for (const [id, absPath] of files) {
    contents[id] = readFileSync(absPath, "utf8");
  }

  const updated = applyRepoSync(target, contents);
  for (const [id, absPath] of files) {
    if (updated[id] !== contents[id]) {
      writeFileSync(absPath, updated[id]);
    }
  }

  // Verify by re-reading from disk.
  return checkRepoVersions(target, readSnapshot(files));
}

/** Print a `SyncResult` in human-readable form. */
function reportResult(mode: "check" | "sync", result: SyncResult): void {
  if (result.ok) {
    console.log(
      `[version-sync] ${mode} OK — all target files report version ${result.target} (byte-identical).`,
    );
    return;
  }
  console.error(
    `[version-sync] ${mode} FAILED — ${result.mismatched.length} file(s) differ from target ${result.target} (Req 9.9):`,
  );
  for (const id of result.mismatched) {
    console.error(`  - ${id}`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const mode: "check" | "sync" = args.includes("sync") ? "sync" : "check";

  // Retain the Installer-triple check:versions as a sub-check: run it first and
  // fold its outcome into the overall result. It validates the tighter
  // installer-scoped invariant (three manifests agree AND follow 5.minor.patch).
  let installerOk = true;
  try {
    const installerResult = checkVersionConsistency(readManifestVersions());
    installerOk = installerResult.ok;
    if (!asJson) {
      if (installerResult.ok) {
        console.log(`[version-sync] installer-triple sub-check OK — ${installerResult.reason}`);
      } else {
        console.error(
          `[version-sync] installer-triple sub-check FAILED — ${installerResult.reason}`,
        );
      }
    }
  } catch (err) {
    installerOk = false;
    console.error(`[version-sync] installer-triple sub-check errored: ${String(err)}`);
  }

  let result: SyncResult;
  try {
    result = mode === "sync" ? runRepoSync() : runRepoCheck();
  } catch (err) {
    console.error(`[version-sync] ${mode} failed: ${String(err)}`);
    process.exit(2);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify({ mode, installerOk, ...result }, null, 2));
  } else {
    reportResult(mode, result);
  }

  process.exit(result.ok && installerOk ? 0 : 1);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
