/**
 * `npm ci` integration check — the Phase C gate for dependency-refresh-node24.
 *
 * Feature: dependency-refresh-node24 (Requirements 3.4, 3.5)
 *
 * Thin I/O wrapper around the pure `npm-ci-check-core` decision. It runs
 * `npm ci` (or its safe `--dry-run` form), times it, captures the combined
 * stdout+stderr, and hands the result to `evaluateNpmCiOutcome`, which decides:
 *
 *   PASS iff `npm ci` exited 0 within the 600s budget with NO native
 *        compilation (Req 3.4).
 *   FAIL otherwise; on a non-zero exit the printed report names the failing
 *        Native_Module extracted from the output (Req 3.5).
 *
 * ── Why this is env-gated ────────────────────────────────────────────────────
 * A full, real `npm ci` deletes and reinstalls `node_modules` and can take
 * minutes — far too heavy to run on every `jest`/gate invocation. So the pure
 * parsing/decision logic is unit- and property-tested in `npm-ci-check.test.ts`
 * (fast, no install), and the actual install run here is opt-in:
 *
 *   - By DEFAULT the runner uses `npm ci --dry-run`, which resolves and reports
 *     what would be installed WITHOUT mutating `node_modules`. This keeps the
 *     Req 3.5 invariant ("leave the pre-existing `node_modules` unchanged")
 *     trivially true for the default path and makes the check safe to run
 *     anywhere as a smoke check.
 *   - Set `RUN_NPM_CI_CHECK=full` (or pass `--full`) to perform the REAL
 *     `npm ci`. This is the Phase C integration gate proper — it exercises the
 *     ABI-137 prebuilt resolution end to end. Reserve it for CI / a deliberate
 *     local gate run on Node 24 / Windows x64.
 *
 * Run with:
 *   tsx scripts/workspace/native-modules/npm-ci-check.ts            # dry-run
 *   RUN_NPM_CI_CHECK=full tsx scripts/workspace/native-modules/npm-ci-check.ts
 *   tsx scripts/workspace/native-modules/npm-ci-check.ts --full --json
 *
 * Exit code: 0 when the outcome is a PASS; 1 when it is a FAIL (each failing
 * condition listed); 2 when the check itself cannot run.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateNpmCiOutcome,
  NPM_CI_TIME_BUDGET_MS,
  type NpmCiOutcome,
} from "./npm-ci-check-core.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/workspace/native-modules -> repo root is three levels up.
const repoRoot = resolve(scriptDir, "..", "..", "..");

interface RunnerOptions {
  /** Run the real `npm ci` (mutates node_modules) instead of `--dry-run`. */
  full: boolean;
  /** Emit the full `NpmCiOutcome` as JSON instead of text. */
  json: boolean;
}

function parseOptions(argv: string[]): RunnerOptions {
  const flagFull = argv.includes("--full");
  const envFull = /^(1|true|full|yes)$/i.test(process.env.RUN_NPM_CI_CHECK ?? "");
  return {
    full: flagFull || envFull,
    json: argv.includes("--json"),
  };
}

/**
 * Spawn `npm ci` (real or `--dry-run`), timing it and capturing combined output.
 *
 * The real form is the Phase C integration gate; the dry-run form is a safe,
 * non-mutating smoke check. We merge stdout and stderr into a single transcript
 * because npm splits progress/compile chatter across both streams, and the pure
 * evaluator scans the combined text for compile markers and error attribution.
 */
function runNpmCi(full: boolean): { exitCode: number; durationMs: number; output: string } {
  const args = full ? ["ci"] : ["ci", "--dry-run"];
  const startedAt = Date.now();
  const proc = spawnSync("npm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    // A full install can be large; give the buffer generous headroom.
    maxBuffer: 128 * 1024 * 1024,
    // Guard the process itself at slightly over the 600s budget so a genuinely
    // hung install is still surfaced (as a timeout) rather than blocking forever.
    timeout: NPM_CI_TIME_BUDGET_MS + 30_000,
  });
  const durationMs = Date.now() - startedAt;

  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  const output = `${stdout}\n${stderr}`;

  // `spawnSync` sets `status` to null when the process was killed (e.g. by the
  // timeout); treat a null exit as a non-zero failure so evaluation flags it.
  const exitCode = typeof proc.status === "number" ? proc.status : 1;

  return { exitCode, durationMs, output };
}

function printOutcome(outcome: NpmCiOutcome, full: boolean): void {
  const mode = full ? "npm ci (full)" : "npm ci --dry-run";
  const seconds = (outcome.durationMs / 1000).toFixed(1);
  console.log(
    `[npm-ci-check] ${mode}: exit ${outcome.exitCode}, ${seconds}s ` +
      `(budget ${(NPM_CI_TIME_BUDGET_MS / 1000).toFixed(0)}s), ` +
      `nativeCompilation=${outcome.nativeCompilation}`,
  );
  if (outcome.pass) {
    console.log("[npm-ci-check] OK: exit 0, within budget, no native compilation (Req 3.4).");
    return;
  }
  console.error(`[npm-ci-check] FAILED: ${outcome.reasons.join(", ")}`);
  if (outcome.reasons.includes("non-zero-exit")) {
    // Req 3.5 — surface the failing Native_Module when one was attributable.
    console.error(
      outcome.failingModule
        ? `[npm-ci-check] failing native module: ${outcome.failingModule}`
        : "[npm-ci-check] non-zero exit not attributable to a specific native module",
    );
  }
  if (!full) {
    console.error(
      "[npm-ci-check] (dry-run) node_modules was left unchanged; " +
        "re-run with RUN_NPM_CI_CHECK=full for the real Phase C install gate.",
    );
  }
}

function main(): void {
  const { full, json } = parseOptions(process.argv.slice(2));

  let run: { exitCode: number; durationMs: number; output: string };
  try {
    run = runNpmCi(full);
  } catch (err) {
    console.error(`[npm-ci-check] could not run npm ci: ${String(err)}`);
    process.exit(2);
    return;
  }

  const outcome = evaluateNpmCiOutcome(run);

  if (json) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    printOutcome(outcome, full);
  }

  process.exit(outcome.pass ? 0 : 1);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
