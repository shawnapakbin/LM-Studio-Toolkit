/**
 * Payload-staging build step for the LLM Toolkit installer.
 *
 * Feature: windows-installer-setup-exe (Requirements 3.2, 3.3)
 *
 * Runs BEFORE `tauri build`. Its job:
 *
 *   1. (optionally) build all 16 MCP tools' `dist/` via the repo-root
 *      `npm run build` (skipped with `--no-build` / `STAGE_PAYLOAD_NO_BUILD=1`
 *      so CI can build once and stage separately);
 *   2. inspect each of the 16 canonical `dist` roots on disk;
 *   3. run the pure completeness planner (`planPayloadStaging`) — if ANY tool's
 *      `dist` root is absent or EMPTY, ABORT with a non-zero exit and print each
 *      missing tool BY NAME (Req 3.3), producing no staged payload;
 *   4. otherwise stage each tool's `dist` tree into the Tauri resource
 *      directory that `tauri.conf.json` `bundle.resources` embeds into the NSIS
 *      installer.
 *
 * STAGING DIRECTORY (coordinate with task 4.2):
 *   Payload is staged under `Installer/src-tauri/payload/<serverName>/`.
 *   Task 4.2 must point `tauri.conf.json` `bundle.resources` at `payload/*`
 *   (paths in `bundle.resources` are resolved relative to `src-tauri/`), so the
 *   16 `dist` trees embed into the NSIS installer.
 *
 * Run with: `npm run stage:payload` (i.e. `tsx scripts/stage-payload.ts`).
 * Flags:
 *   --no-build   skip the root `npm run build` and only stage existing dist/.
 *   --dry-run    plan and report, but do not copy or run the build.
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_TOOL_PAYLOADS,
  type DistPresence,
  canonicalPayloads,
  isComplete,
  planPayloadStaging,
} from "./payload-manifest.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const installerRoot = resolve(scriptDir, "..");
/** Repository root: two levels up from Installer/scripts/. */
const repoRoot = resolve(installerRoot, "..");

/**
 * The staging root that Tauri embeds. `tauri.conf.json` `bundle.resources`
 * (task 4.2) points at `payload/*` relative to `src-tauri/`, so this is where
 * the 16 dist trees are collected.
 */
export const STAGING_ROOT = resolve(installerRoot, "src-tauri", "payload");

/**
 * Determine whether a `dist` root directory exists and is non-empty.
 *
 * "Non-empty" (Req 3.3) means the directory contains at least one entry. A
 * regular (non-directory) file at that path counts as absent — a `dist` root is
 * expected to be a directory tree.
 */
export function observeDistPresence(
  repoRootDir: string,
  serverName: string,
  distRoot: string,
): DistPresence {
  const abs = resolve(repoRootDir, distRoot);
  if (!existsSync(abs)) {
    return { serverName, exists: false, nonEmpty: false };
  }
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return { serverName, exists: false, nonEmpty: false };
  }
  let entryCount = 0;
  try {
    entryCount = readdirSync(abs).length;
  } catch {
    entryCount = 0;
  }
  return { serverName, exists: true, nonEmpty: entryCount > 0 };
}

/** Observe on-disk presence for all 16 canonical tools. */
export function observeAllPresence(repoRootDir: string): DistPresence[] {
  return canonicalPayloads().map((t) => observeDistPresence(repoRootDir, t.serverName, t.distRoot));
}

interface CliOptions {
  build: boolean;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const noBuild = argv.includes("--no-build") || process.env.STAGE_PAYLOAD_NO_BUILD === "1";
  const dryRun = argv.includes("--dry-run");
  return { build: !noBuild && !dryRun, dryRun };
}

function buildAllTools(): void {
  console.log("[stage-payload] Building all 16 tools via root `npm run build`…");
  execSync("npm run build", {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

/**
 * Copy every staged tool's `dist` tree into a fresh staging root.
 *
 * The staging root is cleared first so a stale payload from a previous build
 * never leaks into the installer. Each tool is copied to
 * `payload/<serverName>/` so install-time verification can key off server name.
 */
export function stagePayload(repoRootDir: string, stagingRoot: string): void {
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  for (const tool of CANONICAL_TOOL_PAYLOADS) {
    const src = resolve(repoRootDir, tool.distRoot);
    const dest = resolve(stagingRoot, tool.serverName);
    cpSync(src, dest, { recursive: true });
    console.log(
      `[stage-payload]   staged ${tool.serverName}  (${tool.distRoot} -> payload/${tool.serverName})`,
    );
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.build) {
    buildAllTools();
  } else {
    console.log(
      "[stage-payload] Skipping tool build (--no-build/--dry-run); staging existing dist/ trees.",
    );
  }

  const presence = observeAllPresence(repoRoot);
  const plan = planPayloadStaging(presence);

  if (!isComplete(plan)) {
    console.error(
      `[stage-payload] ABORT — ${plan.missing.length} of ${plan.required.length} tool dist trees are missing or empty:`,
    );
    for (const name of plan.missing) {
      const tool = CANONICAL_TOOL_PAYLOADS.find((t) => t.serverName === name);
      console.error(`[stage-payload]   - ${name}  (${tool?.distRoot ?? "?"})`);
    }
    console.error(
      "[stage-payload] Build the tools first (root `npm run build`) so every dist/ exists and is non-empty. No payload was staged.",
    );
    process.exit(1);
  }

  console.log(`[stage-payload] All ${plan.present.length} tool dist trees present and non-empty.`);

  if (opts.dryRun) {
    console.log("[stage-payload] --dry-run: not staging. Would stage into:");
    console.log(`[stage-payload]   ${STAGING_ROOT}`);
    process.exit(0);
  }

  stagePayload(repoRoot, STAGING_ROOT);
  console.log(
    `[stage-payload] OK — staged ${plan.present.length} tool dist trees into ${STAGING_ROOT}`,
  );
  process.exit(0);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
