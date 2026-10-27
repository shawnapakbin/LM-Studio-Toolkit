/**
 * Manifest-sync verify check (drift prevention) for the flat production npm
 * manifest + lockfile (Option B2) shipped in the LLM Toolkit installer.
 *
 * Bugfix: runtimes-npm-install-nonzero-exit — task 3.7 (Part B / B2)
 * Requirements: 2.1, 2.2
 *
 * WHY THIS EXISTS
 * ---------------
 * `generate-production-manifest.ts` (task 3.3) is the single source of truth
 * for the flat production `package.json` + resolved `package-lock.json` staged
 * into `install_dir` (from the committed source artifacts at
 * `Installer/src-tauri/runtime-manifest/`). If a tool's runtime `dependencies`
 * change and the committed manifest is NOT regenerated, the staged manifest
 * drifts from the source tool manifests and the installer's Runtimes step can
 * silently reintroduce root cause H1
 * (`noResolvableManifestInInstallDir`) — the exact defect this bugfix closes.
 *
 * This check re-runs the generator into an ISOLATED temp dir and asserts the
 * committed artifacts are BYTE-IDENTICAL to the freshly generated output. It
 * exits non-zero with an actionable "run npm run generate:runtime-manifest"
 * message on any drift, and additionally re-runs the generator's own
 * production-safety gate so a committed manifest that somehow lost the
 * safety invariants (scripts/engines/unresolvable specifier) also fails.
 *
 * It does NOT modify the generator (task 3.3) and never generates or copies a
 * `node_modules`, so the Lean_Payload invariant (Req 3.6) is unaffected.
 *
 * Run with: `npm run verify:runtime-manifest`
 *   (i.e. `tsx scripts/verify-production-manifest.ts`).
 * Flags:
 *   --no-lockfile    verify only package.json; skip the (slower, network-
 *                    dependent) temp-dir lockfile resolve + comparison. Useful
 *                    for a fast, offline manifest-only drift check.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  generateProductionManifest,
  productionSafetyProblems,
} from "./generate-production-manifest.ts";

/** Absolute path to the invoked entry script, or "" when unavailable. */
function invokedScriptPath(): string {
  return process.argv[1] ? resolve(process.argv[1]) : "";
}

/** True iff this file is the invoked entry script (run as CLI, not imported). */
function runningAsMain(): boolean {
  const invoked = invokedScriptPath();
  if (!invoked) {
    return false;
  }
  const base = invoked.replaceAll("\\", "/").split("/").pop() ?? "";
  return base === "verify-production-manifest.ts" || base === "verify-production-manifest.js";
}

/** A single drift/coverage problem discovered by the verify check. */
export interface DriftProblem {
  /** The artifact this problem concerns. */
  artifact: "package.json" | "package-lock.json" | "manifest-safety";
  /** A human-readable description of the drift/problem. */
  message: string;
}

/** The outcome of a verify run, for programmatic use + CLI reporting. */
export interface VerifyResult {
  /** True iff the committed artifacts match the freshly generated output. */
  ok: boolean;
  /** Zero or more drift/safety problems; empty == in sync. */
  problems: DriftProblem[];
  /** The committed artifacts dir that was checked. */
  committedDir: string;
  /** Whether the lockfile was compared (false under --no-lockfile). */
  lockfileChecked: boolean;
}

/** Options for {@link verifyProductionManifest}. */
export interface VerifyOptions {
  /**
   * Directory holding the committed artifacts to check. Defaults to the
   * generator's own default output dir
   * (`Installer/src-tauri/runtime-manifest`).
   */
  committedDir?: string;
  /** When false, only package.json is regenerated + compared (no lockfile). */
  checkLockfile?: boolean;
  /**
   * Repo root forwarded to the generator. Defaults to the generator's own
   * argv-anchored root, which is correct for the CLI. Callers whose entry
   * script is not this file (e.g. the jest test runner, whose `argv[1]` is the
   * jest binary) MUST pass an explicit `repoRoot` so the generator reads the
   * real source manifests rather than resolving an empty flat manifest.
   */
  repoRoot?: string;
}

/**
 * Read a committed artifact's exact bytes as UTF-8 text, or `undefined` if it
 * is absent (a missing committed artifact is itself a drift problem).
 */
function readCommitted(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * Re-run the generator into an isolated temp dir and byte-compare the committed
 * `package.json` (and, unless disabled, `package-lock.json`) against the fresh
 * output. Pure with respect to disk except for the generator's temp-dir usage;
 * writes nothing to the committed location.
 */
export function verifyProductionManifest(opts: VerifyOptions = {}): VerifyResult {
  const checkLockfile = opts.checkLockfile ?? true;
  const problems: DriftProblem[] = [];

  // Regenerate into an isolated temp dir so the committed artifacts are never
  // touched. The generator's default committedDir is used when none is given.
  const tempOut = mkdtempSync(resolve(tmpdir(), "llm-toolkit-verify-manifest-"));
  let result: ReturnType<typeof generateProductionManifest>;
  try {
    result = generateProductionManifest({
      outDir: tempOut,
      writeLockfile: checkLockfile,
      repoRoot: opts.repoRoot,
    });

    // When the caller supplied a committedDir use it; otherwise fall back to the
    // generator's real default output dir (NOT the temp dir we generated into).
    const realCommittedDir = opts.committedDir ?? defaultCommittedDir();

    // 1. Production-safety gate (reused from the generator): a committed
    //    manifest that lost the safety invariants must fail even if it happens
    //    to be byte-identical to a (broken) fresh run.
    for (const p of productionSafetyProblems(result.gen)) {
      problems.push({ artifact: "manifest-safety", message: p });
    }

    // 2. package.json byte-comparison.
    const committedManifestPath = resolve(realCommittedDir, "package.json");
    const committedManifest = readCommitted(committedManifestPath);
    if (committedManifest === undefined) {
      problems.push({
        artifact: "package.json",
        message: `committed package.json is missing at ${committedManifestPath}`,
      });
    } else if (committedManifest !== result.manifestText) {
      problems.push({
        artifact: "package.json",
        message: `committed package.json differs from freshly generated output (${committedManifestPath})`,
      });
    }

    // 3. package-lock.json byte-comparison (unless skipped).
    if (checkLockfile) {
      const committedLockPath = resolve(realCommittedDir, "package-lock.json");
      const committedLock = readCommitted(committedLockPath);
      if (result.lockfileText === undefined) {
        problems.push({
          artifact: "package-lock.json",
          message: "generator did not produce a lockfile to compare against",
        });
      } else if (committedLock === undefined) {
        problems.push({
          artifact: "package-lock.json",
          message: `committed package-lock.json is missing at ${committedLockPath}`,
        });
      } else if (committedLock !== result.lockfileText) {
        problems.push({
          artifact: "package-lock.json",
          message: `committed package-lock.json differs from freshly generated output (${committedLockPath})`,
        });
      }
    }

    return {
      ok: problems.length === 0,
      problems,
      committedDir: opts.committedDir ?? defaultCommittedDir(),
      lockfileChecked: checkLockfile,
    };
  } finally {
    rmSync(tempOut, { recursive: true, force: true });
  }
}

/**
 * The default committed-artifacts dir, resolved the same way the generator
 * anchors its default output dir: `Installer/src-tauri/runtime-manifest`.
 */
function defaultCommittedDir(): string {
  const invoked = invokedScriptPath();
  const scriptDir = invoked ? resolve(invoked, "..") : resolve(".");
  // scripts/ -> Installer/ -> Installer/src-tauri/runtime-manifest
  return resolve(scriptDir, "..", "src-tauri", "runtime-manifest");
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliOptions {
  checkLockfile: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  return {
    checkLockfile: !argv.includes("--no-lockfile"),
  };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  console.log(
    "[verify-runtime-manifest] Re-running the generator into a temp dir to detect drift…",
  );
  const result = verifyProductionManifest({ checkLockfile: opts.checkLockfile });

  if (!opts.checkLockfile) {
    console.log("[verify-runtime-manifest] --no-lockfile: comparing package.json only.");
  }

  if (result.ok) {
    console.log(
      `[verify-runtime-manifest] OK — committed runtime manifest${
        result.lockfileChecked ? " + lockfile are" : " is"
      } byte-identical to the generator output (${result.committedDir}).`,
    );
    process.exit(0);
  }

  console.error(
    "[verify-runtime-manifest] DRIFT DETECTED — committed runtime manifest is out of sync:",
  );
  for (const p of result.problems) {
    console.error(`[verify-runtime-manifest]   - [${p.artifact}] ${p.message}`);
  }
  console.error("");
  console.error(
    "[verify-runtime-manifest] The staged production manifest must be regenerated from the source tool manifests.",
  );
  console.error(
    "[verify-runtime-manifest] Fix: run `npm run generate:runtime-manifest` (in Installer/) and commit the updated",
  );
  console.error(
    "[verify-runtime-manifest]      Installer/src-tauri/runtime-manifest/package.json + package-lock.json.",
  );
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests). Under the jest
// CommonJS transform the invoked script is jest, so `runningAsMain()` is false.
if (runningAsMain()) {
  main();
}
