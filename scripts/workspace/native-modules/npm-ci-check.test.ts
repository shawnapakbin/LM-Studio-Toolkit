// Feature: dependency-refresh-node24
// Task 3.2 — Integration check for `npm ci` on Node 24 / Windows x64
//
// **Validates: Requirements 3.4, 3.5**
//
// Req 3.4 — WHEN `npm ci` runs against the Monorepo on Node 24 for Windows x64,
//           the installation SHALL complete with exit code 0 within 600s (and,
//           per Phase C / Req 3.1, with NO local native compilation).
// Req 3.5 — IF `npm ci` terminates with a non-zero exit code, THEN the run
//           SHALL surface an error identifying the failing Native_Module and
//           SHALL leave the pre-existing `node_modules` unchanged.
//
// ── Testing approach ─────────────────────────────────────────────────────────
// A real `npm ci` is a heavy, minutes-long, node_modules-mutating operation, so
// it is gated behind an env flag in the runner (`npm-ci-check.ts`) and is NOT
// exercised here. Instead these tests drive the REAL pure decision core
// (`evaluateNpmCiOutcome` / `detectNativeCompilation` / `extractFailingModule`
// from `npm-ci-check-core.ts`, no mocks) over representative and generated
// `npm ci` transcripts. That is exactly the split the task calls for: the pure
// logic (parse npm ci output+exit -> decide pass? native compile? which module
// failed?) is unit- and property-tested; the thin runner performs the real run.
//
// The behaviour of interest (the biconditional in Req 3.4 plus the Req 3.5
// failure attribution) is asserted two ways: hand-written example transcripts
// for the concrete shapes npm emits, and a `fast-check` behaviour section that
// checks the pass decision is EXACTLY `exit 0 AND within budget AND no native
// compile` across randomised runs, using an independent oracle.

import * as fc from "fast-check";
import {
  detectNativeCompilation,
  evaluateNpmCiOutcome,
  extractFailingModule,
  KNOWN_NATIVE_MODULES,
  NPM_CI_TIME_BUDGET_MS,
} from "./npm-ci-check-core";

// ── Representative transcripts ───────────────────────────────────────────────

/** A clean prebuilt install: no compile chatter, added packages only. */
const CLEAN_PREBUILT_OUTPUT = [
  "npm warn deprecated something@1.0.0: use something-else",
  "added 842 packages, and audited 843 packages in 41s",
  "found 0 vulnerabilities",
].join("\n");

/** A fallback local build for better-sqlite3 via node-gyp / MSBuild. */
const NODE_GYP_COMPILE_OUTPUT = [
  "npm warn prebuild-install http request to prebuild failed, building from source",
  "> better-sqlite3@12.6.2 install",
  "> prebuild-install || node-gyp rebuild --release",
  "gyp info spawn args [ 'build' ]",
  "  better_sqlite3.cpp",
  "  MSBuild version 17.0 for .NET",
  "  better_sqlite3.vcxproj -> better_sqlite3.node",
].join("\n");

/** A non-zero-exit failure that names better-sqlite3 as the failing module. */
const BETTER_SQLITE3_FAILURE_OUTPUT = [
  "gyp ERR! build error",
  "npm error code 1",
  "npm error path C:\\repo\\node_modules\\better-sqlite3",
  "npm error command failed",
  "npm error better-sqlite3@12.6.2 install: `prebuild-install || node-gyp rebuild`",
  "npm error Exit status 1",
].join("\n");

describe("evaluateNpmCiOutcome — Req 3.4 pass biconditional (Feature: dependency-refresh-node24)", () => {
  it("passes when npm ci exits 0, is within budget, and shows no native compilation", () => {
    const outcome = evaluateNpmCiOutcome({
      exitCode: 0,
      durationMs: 41_000,
      output: CLEAN_PREBUILT_OUTPUT,
    });
    expect(outcome.pass).toBe(true);
    expect(outcome.reasons).toEqual([]);
    expect(outcome.nativeCompilation).toBe(false);
    expect(outcome.withinBudget).toBe(true);
    expect(outcome.failingModule).toBeNull();
  });

  it("fails (native-compilation) when a prebuilt is missing and node-gyp compiles, even on exit 0", () => {
    // Req 3.4 requires NO native compilation; a local build fails the gate even
    // if npm ultimately exits 0.
    const outcome = evaluateNpmCiOutcome({
      exitCode: 0,
      durationMs: 120_000,
      output: NODE_GYP_COMPILE_OUTPUT,
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.nativeCompilation).toBe(true);
    expect(outcome.reasons).toContain("native-compilation");
  });

  it("fails (timed-out) when the run exceeds the 600s budget", () => {
    const outcome = evaluateNpmCiOutcome({
      exitCode: 0,
      durationMs: NPM_CI_TIME_BUDGET_MS + 1,
      output: CLEAN_PREBUILT_OUTPUT,
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.withinBudget).toBe(false);
    expect(outcome.reasons).toContain("timed-out");
  });

  it("treats exactly the 600s budget as within budget (boundary)", () => {
    const outcome = evaluateNpmCiOutcome({
      exitCode: 0,
      durationMs: NPM_CI_TIME_BUDGET_MS,
      output: CLEAN_PREBUILT_OUTPUT,
    });
    expect(outcome.withinBudget).toBe(true);
    expect(outcome.pass).toBe(true);
  });
});

describe("evaluateNpmCiOutcome — Req 3.5 failure attribution (Feature: dependency-refresh-node24)", () => {
  it("on non-zero exit, surfaces the failing native module name", () => {
    const outcome = evaluateNpmCiOutcome({
      exitCode: 1,
      durationMs: 90_000,
      output: BETTER_SQLITE3_FAILURE_OUTPUT,
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.reasons).toContain("non-zero-exit");
    expect(outcome.failingModule).toBe("better-sqlite3");
  });

  it("does not attribute a failing module on a successful run", () => {
    const outcome = evaluateNpmCiOutcome({
      exitCode: 0,
      durationMs: 41_000,
      output: CLEAN_PREBUILT_OUTPUT,
    });
    expect(outcome.failingModule).toBeNull();
  });

  it("reports a non-zero exit with no module when the failure is not attributable", () => {
    const outcome = evaluateNpmCiOutcome({
      exitCode: 1,
      durationMs: 5_000,
      output: "npm error code ERESOLVE\nnpm error unable to resolve dependency tree",
    });
    expect(outcome.pass).toBe(false);
    expect(outcome.reasons).toContain("non-zero-exit");
    expect(outcome.failingModule).toBeNull();
  });
});

describe("detectNativeCompilation (Feature: dependency-refresh-node24)", () => {
  it("detects node-gyp / MSBuild / vcxproj / building-from-source markers", () => {
    expect(detectNativeCompilation(NODE_GYP_COMPILE_OUTPUT)).toBe(true);
    expect(detectNativeCompilation("node-gyp rebuild")).toBe(true);
    expect(detectNativeCompilation("MSBuild version 17.0")).toBe(true);
    expect(detectNativeCompilation("foo.vcxproj -> foo.node")).toBe(true);
    expect(detectNativeCompilation("building from source")).toBe(true);
  });

  it("does not flag a clean prebuilt transcript or an incidental mention", () => {
    expect(detectNativeCompilation(CLEAN_PREBUILT_OUTPUT)).toBe(false);
    // A lockfile-style mention of node-gyp with no build ACTION must not trip.
    expect(detectNativeCompilation("added node-gyp@10.0.0 to the tree")).toBe(false);
  });

  it("does not flag a dry-run install-script DECLARATION line (Req 3.4 dry-run safety)", () => {
    // `npm ci --dry-run` announces the install script that WOULD run without
    // running it; this must not be read as a compile having occurred.
    const dryRunDeclaration =
      "npm warn install-scripts better-sqlite3@12.11.1 (install: node-gyp rebuild)\n" +
      "added 842 packages in 2s";
    expect(detectNativeCompilation(dryRunDeclaration)).toBe(false);
  });

  it("still flags a real build even when a declaration line is also present", () => {
    // A real run that falls through to a source build emits actual gyp/MSBuild
    // output alongside any declaration line; the real markers must still catch it.
    const realBuild =
      "npm warn install-scripts better-sqlite3@12.11.1 (install: node-gyp rebuild)\n" +
      "gyp info spawn args [ 'build' ]\n" +
      "  better_sqlite3.vcxproj -> better_sqlite3.node";
    expect(detectNativeCompilation(realBuild)).toBe(true);
  });
});

describe("extractFailingModule (Feature: dependency-refresh-node24)", () => {
  it("extracts a known native module named on an npm error line", () => {
    expect(extractFailingModule(BETTER_SQLITE3_FAILURE_OUTPUT)).toBe("better-sqlite3");
  });

  it("extracts a scoped package from a structured npm error prefix", () => {
    const out = "npm error @scope/native-thing@2.3.4 install: node-gyp rebuild";
    expect(extractFailingModule(out, ["@scope/native-thing"])).toBe("@scope/native-thing");
  });

  it("returns null when no failing module is attributable", () => {
    expect(extractFailingModule("npm error code ERESOLVE")).toBeNull();
    expect(extractFailingModule("")).toBeNull();
  });
});

// ── Behaviour section: the pass decision is exactly the Req 3.4 biconditional ─
//
// Independent oracle: pass <=> exit 0 AND within 600s AND no native compilation.
// We generate runs by composing an exit code, a duration on either side of the
// budget, and an output drawn from a pool tagged with whether it contains a
// native-compile marker — so the oracle is computed WITHOUT reusing the module's
// own marker classifier.

interface TaggedOutput {
  text: string;
  compiles: boolean;
}

const OUTPUT_POOL: readonly TaggedOutput[] = [
  { text: CLEAN_PREBUILT_OUTPUT, compiles: false },
  { text: "added 10 packages in 3s", compiles: false },
  { text: "added node-gyp@10.0.0 to the tree", compiles: false },
  { text: NODE_GYP_COMPILE_OUTPUT, compiles: true },
  { text: "gyp info spawn args [ 'build' ]", compiles: true },
  { text: "npm warn prebuild-install failed, building from source", compiles: true },
] as const;

describe("evaluateNpmCiOutcome behaviour — pass iff exit 0 AND within budget AND no compile (Feature: dependency-refresh-node24)", () => {
  it("matches the independent oracle across randomised runs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }), // exit code (0..5)
        fc.integer({ min: 0, max: NPM_CI_TIME_BUDGET_MS + 120_000 }), // duration
        fc.constantFrom(...OUTPUT_POOL),
        (exitCode, durationMs, tagged) => {
          const outcome = evaluateNpmCiOutcome({ exitCode, durationMs, output: tagged.text });

          const withinBudget = durationMs <= NPM_CI_TIME_BUDGET_MS;
          const expectedPass = exitCode === 0 && withinBudget && !tagged.compiles;

          expect(outcome.pass).toBe(expectedPass);
          expect(outcome.withinBudget).toBe(withinBudget);
          expect(outcome.nativeCompilation).toBe(tagged.compiles);

          // reasons enumerate exactly the failing conditions.
          expect(outcome.reasons.includes("non-zero-exit")).toBe(exitCode !== 0);
          expect(outcome.reasons.includes("timed-out")).toBe(!withinBudget);
          expect(outcome.reasons.includes("native-compilation")).toBe(tagged.compiles);
          expect(outcome.pass).toBe(outcome.reasons.length === 0);

          // A failing module is attributed only on a non-zero exit (Req 3.5).
          if (exitCode === 0) {
            expect(outcome.failingModule).toBeNull();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("on any non-zero exit that names a known module, that module is surfaced (Req 3.5)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(...KNOWN_NATIVE_MODULES),
        (exitCode, mod) => {
          const output = `npm error ${mod}@1.2.3 install: node-gyp rebuild\nnpm error Exit status 1`;
          const outcome = evaluateNpmCiOutcome({ exitCode, durationMs: 10_000, output });
          expect(outcome.pass).toBe(false);
          expect(outcome.reasons).toContain("non-zero-exit");
          expect(outcome.failingModule).toBe(mod);
        },
      ),
      { numRuns: 100 },
    );
  });
});
