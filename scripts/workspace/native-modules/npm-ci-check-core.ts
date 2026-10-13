/**
 * Pure `npm ci` outcome-evaluation core for the dependency-refresh (Phase C).
 *
 * Feature: dependency-refresh-node24 (Requirements 3.4, 3.5)
 *
 * This module contains ONLY pure, I/O-free functions. It turns the raw result
 * of an `npm ci` run — the process exit code, the elapsed wall-clock duration,
 * and the combined stdout+stderr text — into an `NpmCiOutcome` verdict:
 *
 *   - PASS  iff `npm ci` exited 0, completed within the 600s budget, AND no
 *           native compilation occurred (Req 3.4: a prebuilt binary resolved
 *           for Node 24 / Windows x64 with no local node-gyp compile step).
 *   - FAIL  otherwise. On a non-zero exit the verdict surfaces the name of the
 *           failing Native_Module extracted from the output (Req 3.5).
 *
 * The file-spawning / process-exit wrapper lives in `npm-ci-check.ts`, mirroring
 * the `check-node-24-core.ts` / `check-node-24.ts` and `baseline-core.ts` /
 * `capture-baseline.ts` splits already used elsewhere in `scripts/workspace/`.
 *
 * Keeping the core pure means:
 *   - the spawning CLI (`npm-ci-check.ts`) reuses the exact decision, and
 *   - the behaviour test can import these functions and exercise them over many
 *     synthetic `npm ci` transcripts without ever running a real install.
 *
 * Why parse text? A real `npm ci` on Node 24 / Windows x64 with an ABI-137
 * prebuilt for `better-sqlite3` installs from the downloaded prebuilt and prints
 * no compilation markers. If the prebuilt is missing/wrong, npm falls back to a
 * local node-gyp build which emits recognisable markers (node-gyp invocation,
 * MSBuild, `prebuild-install`/`node-gyp-build` reporting a compile, `.vcxproj`
 * or `cl.exe` activity). Detecting those markers lets the check assert Req 3.4's
 * "no native compilation" without needing to instrument npm itself.
 */

/** The 600-second install budget from Req 3.4, expressed in milliseconds. */
export const NPM_CI_TIME_BUDGET_MS = 600_000;

/** The Native_Modules the Monorepo installs (design.md "Native_Module"). */
export const KNOWN_NATIVE_MODULES: readonly string[] = ["better-sqlite3"] as const;

/** Why an `npm ci` run was judged a failure (mutually informative, not exclusive). */
export type NpmCiFailureReason = "non-zero-exit" | "timed-out" | "native-compilation";

/**
 * The verdict for one `npm ci` run.
 *
 * `pass` is the biconditional of Req 3.4: exit 0 AND within budget AND no native
 * compilation. When `pass` is false, `reasons` lists every failing condition and
 * (on a non-zero exit) `failingModule` names the Native_Module npm reported as
 * failing, if one could be extracted from the output (Req 3.5).
 */
export interface NpmCiOutcome {
  pass: boolean;
  exitCode: number;
  durationMs: number;
  /** True iff the run finished within `NPM_CI_TIME_BUDGET_MS`. */
  withinBudget: boolean;
  /** True iff the output shows a local native compile happened (Req 3.4). */
  nativeCompilation: boolean;
  /** All failing conditions; empty iff `pass` is true. */
  reasons: NpmCiFailureReason[];
  /**
   * On a non-zero exit, the Native_Module npm named as failing (Req 3.5), or
   * `null` when the failure is not attributable to a specific native module or
   * none could be parsed from the output.
   */
  failingModule: string | null;
}

/** The raw inputs to the evaluation — exactly what a real run produces. */
export interface NpmCiRunResult {
  /** The `npm ci` process exit code (0 on success). */
  exitCode: number;
  /** Elapsed wall-clock time of the run, in milliseconds. */
  durationMs: number;
  /** Combined stdout + stderr text emitted by the run. */
  output: string;
}

/**
 * Markers that indicate a LOCAL native compilation happened during install.
 *
 * A clean prebuilt install prints none of these. A fallback build prints at
 * least one: a direct node-gyp `rebuild`/`build` invocation, an MSBuild /
 * `cl.exe` / `.vcxproj` compile (the Windows toolchain), or a `prebuild-install`
 * failure that explicitly falls back to `node-gyp` / building from source.
 *
 * Each entry is anchored to a compile ACTION rather than an incidental mention
 * of the word "node-gyp" (e.g. a dependency named in a lockfile), so that a
 * transcript merely referencing gyp without compiling does not trip a false
 * positive.
 *
 * One shape is DELIBERATELY excluded (see `INSTALL_SCRIPT_DECLARATION` below):
 * a dry-run `npm warn install-scripts <pkg>@<ver> (install: node-gyp rebuild)`
 * line merely DECLARES the install script that WOULD run; `npm ci --dry-run`
 * never executes it, so it is not evidence a compile happened. The real run,
 * if the prebuilt is missing, additionally emits actual gyp/MSBuild build
 * output which the markers below still catch.
 */
const NATIVE_COMPILE_MARKERS: readonly RegExp[] = [
  // node-gyp actually building/rebuilding.
  /\bnode-gyp\b[^\n]*\b(?:rebuild|build|configure)\b/i,
  // gyp emitting its own build banner.
  /\bgyp\b[^\n]*\binfo\b[^\n]*\b(?:spawn|build)\b/i,
  // Windows MSBuild toolchain compiling the addon.
  /\bMSBuild\b/i,
  /\.vcxproj\b/i,
  /\bcl\.exe\b/i,
  // prebuild-install / node-gyp-build falling back to a source build.
  /\bprebuild-install\b[^\n]*\b(?:not found|failed|building|compiling|source)\b/i,
  /\bbuilding\s+from\s+source\b/i,
  /\bcompiling\s+native\b/i,
] as const;

/**
 * Decide whether the combined output shows a local native compilation occurred.
 *
 * Returns true iff at least one native-compile marker matches. This is the
 * "no native compilation" half of Req 3.4: a prebuilt install for Node 24 /
 * Windows x64 must not fall through to a local compile.
 */
/**
 * A dry-run install-script DECLARATION line, e.g.
 *   `npm warn install-scripts better-sqlite3@12.11.1 (install: node-gyp rebuild)`
 *
 * `npm ci --dry-run` prints one of these for every package that declares a
 * native `install`/`postinstall` script, but it does NOT run them, so the line
 * is not evidence that a compile occurred. Such lines are stripped before the
 * compile-marker scan so the safe dry-run smoke mode does not report a false
 * `native-compilation`. On a REAL run a missing prebuilt still emits genuine
 * gyp/MSBuild build output, which the markers catch on the surviving lines.
 */
const INSTALL_SCRIPT_DECLARATION = /npm\s+warn\s+install-scripts\b[^\n]*/i;

/**
 * Decide whether the combined output shows a local native compilation occurred.
 *
 * Returns true iff at least one native-compile marker matches AFTER dropping the
 * dry-run install-script declaration lines (which announce a script that would
 * run without running it). This is the "no native compilation" half of Req 3.4:
 * a prebuilt install for Node 24 / Windows x64 must not fall through to a local
 * compile.
 */
export function detectNativeCompilation(output: string): boolean {
  const scanned = output
    .split(/\r?\n/)
    .filter((line) => !INSTALL_SCRIPT_DECLARATION.test(line))
    .join("\n");
  return NATIVE_COMPILE_MARKERS.some((re) => re.test(scanned));
}

/**
 * Extract the name of the Native_Module npm reported as failing (Req 3.5).
 *
 * npm surfaces the failing package in a few recognisable shapes. We try them in
 * order of specificity and return the first match, preferring a match that names
 * a KNOWN native module. Returns `null` when no failing module can be attributed
 * — the caller then reports a generic non-zero-exit failure without a module.
 *
 *   - `npm error <pkg>@<ver> <phase>: ...`     (npm 9/10 error prefix)
 *   - `npm ERR! <pkg>@<ver> install: ...`      (legacy npm error prefix)
 *   - `gyp ERR! ... <pkg> ...`                 (node-gyp failure naming a pkg)
 *   - `... while installing <pkg> ...`
 *
 * The extractor is intentionally conservative: an arbitrary error line does not
 * yield a module name, so `failingModule` is only set when the output genuinely
 * attributes the failure to a package.
 */
export function extractFailingModule(
  output: string,
  knownModules: readonly string[] = KNOWN_NATIVE_MODULES,
): string | null {
  // 1) Prefer a known native module explicitly named on an error/failure line.
  //    Scan line-by-line so we only credit a module mentioned in an error
  //    context, not one merely listed among added packages.
  const errorLine = /\b(?:npm error|npm ERR!|gyp ERR!|ERR!|error)\b/i;
  for (const rawLine of output.split(/\r?\n/)) {
    if (!errorLine.test(rawLine)) continue;
    for (const mod of knownModules) {
      // Word-ish boundary around the module name (handles `better-sqlite3@1.2.3`).
      const re = new RegExp(`(?:^|[^\\w-])${escapeRegExp(mod)}(?![\\w-])`, "i");
      if (re.test(rawLine)) return mod;
    }
  }

  // 2) Structured npm error prefix: `npm (error|ERR!) <pkg>@<ver> <phase>:`.
  //    Capture the package name (supports scoped `@scope/name`).
  const npmErr =
    /npm (?:error|ERR!)\s+(@?[\w./-]+?)@[\w.+-]+\s+(?:install|postinstall|rebuild|build|preinstall)\b/i.exec(
      output,
    );
  if (npmErr) return npmErr[1];

  // 3) `while installing <pkg>` style attribution.
  const whileInstalling = /\bwhile installing\s+(@?[\w./-]+)/i.exec(output);
  if (whileInstalling) return whileInstalling[1];

  return null;
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Evaluate a completed `npm ci` run into an `NpmCiOutcome` (Req 3.4, 3.5).
 *
 * The verdict is a strict biconditional (Req 3.4):
 *
 *     pass  <=>  exitCode === 0 AND durationMs <= NPM_CI_TIME_BUDGET_MS
 *                                AND NOT nativeCompilation
 *
 * When `pass` is false, `reasons` enumerates exactly the failing conditions:
 *   - `non-zero-exit`      when `exitCode !== 0`
 *   - `timed-out`          when the run exceeded the 600s budget
 *   - `native-compilation` when a local compile was detected (even on exit 0,
 *                          because Req 3.4 requires NO native compilation)
 *
 * `failingModule` is populated only on a non-zero exit (Req 3.5): a successful
 * run has no failing module to name. This mirrors the error-handling contract
 * in design.md — a non-zero `npm ci` surfaces the failing Native_Module while a
 * clean run does not.
 *
 * This function performs NO I/O and does not mutate `node_modules`; leaving the
 * pre-existing `node_modules` untouched is a property of `npm ci` semantics and
 * of this check being read-only (see `npm-ci-check.ts`), which the failure-path
 * contract in Req 3.5 relies on.
 */
export function evaluateNpmCiOutcome(
  run: NpmCiRunResult,
  knownModules: readonly string[] = KNOWN_NATIVE_MODULES,
): NpmCiOutcome {
  const withinBudget = run.durationMs <= NPM_CI_TIME_BUDGET_MS;
  const nativeCompilation = detectNativeCompilation(run.output);

  const reasons: NpmCiFailureReason[] = [];
  if (run.exitCode !== 0) reasons.push("non-zero-exit");
  if (!withinBudget) reasons.push("timed-out");
  if (nativeCompilation) reasons.push("native-compilation");

  const pass = reasons.length === 0;

  // Only attribute a failing module on a non-zero exit (Req 3.5). A pass, or a
  // failure that is purely a timeout / unexpected native compile on exit 0, has
  // no npm-reported failing module.
  const failingModule = run.exitCode !== 0 ? extractFailingModule(run.output, knownModules) : null;

  return {
    pass,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    withinBudget,
    nativeCompilation,
    reasons,
    failingModule,
  };
}
