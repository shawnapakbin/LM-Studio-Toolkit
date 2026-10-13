/**
 * Pure baseline-normalization logic for the dependency-refresh regression oracle.
 *
 * Feature: dependency-refresh-node24 (Requirements 10.1, 10.4, 10.5)
 *
 * This module contains ONLY pure functions that turn raw test-runner output
 * (jest `--json` reports and `cargo test` JSON message streams) into the
 * machine-comparable `Baseline` record described in the design's
 * "Baseline snapshot (regression oracle)" data model, plus the regression-diff
 * that Property 6 (task 1.3) drives directly.
 *
 * Keeping the normalization + diff pure means:
 *   - the capture CLI (`capture-baseline.ts`) reuses the exact same
 *     normalization that any later post-refresh comparison uses, and
 *   - the Property 6 `fast-check` test can exercise `diffBaseline` over
 *     generated snapshot pairs without spawning jest/cargo.
 *
 * Design contract (design.md "Baseline: the regression oracle"):
 *   The baseline is a set of `(id, status)` pairs. A post-refresh run produces
 *   the same shape. The comparison computes
 *     newlyFailing = { t | baseline[t] == pass AND current[t] == fail }
 *   and classifies the run as a regression iff `newlyFailing` is non-empty.
 *   Tests that were already failing/skipped in the baseline are NOT regressions
 *   if they still fail — the gate is "no newly failing tests", not "all green".
 */

/** A single test's outcome, normalized across the jest and cargo runners. */
export type TestStatus = "pass" | "fail" | "skip";

/** One normalized test result: a stable id plus its pass/fail/skip status. */
export interface TestResult {
  /** Stable `"{suite}::{testName}"` identifier. */
  id: string;
  status: TestStatus;
}

/**
 * The pre-refresh baseline snapshot — the regression oracle.
 *
 * Captured on the current toolchain and persisted as a machine-comparable
 * artifact so every later phase can diff against it.
 */
export interface Baseline {
  /** ISO timestamp of when the snapshot was captured. */
  capturedOn: string;
  /** Node version at capture time, e.g. `"v20.11.1"`. */
  nodeVersion: string;
  /** Live Repo_Version read from root `package.json` at capture time. */
  repoVersion: string;
  jest: TestResult[];
  cargo: TestResult[];
  /**
   * Optional per-suite capture provenance: which suites actually ran vs. were
   * skipped, and why. This does NOT affect the regression diff (which reads
   * only `jest`/`cargo`); it records honestly whether a suite's results are
   * present so a later comparison is not silently blind to a suite that could
   * not be captured in this environment (e.g. a cargo suite whose test binary
   * requires OS elevation).
   */
  suites?: SuiteCapture[];
}

/** Records whether one capture suite ran and, if not, why it was skipped. */
export interface SuiteCapture {
  /** Suite label, e.g. `"root"`, `"CLI"`, or `"cargo:Installer/src-tauri"`. */
  suite: string;
  /** "jest" or "cargo". */
  runner: "jest" | "cargo";
  /** Whether the suite ran and produced results this capture. */
  ran: boolean;
  /** Number of normalized test results captured for the suite. */
  testCount: number;
  /** Human-readable reason when `ran` is false (else omitted). */
  skipReason?: string;
}

/** Result of diffing a post-refresh snapshot against the baseline. */
export interface RegressionDiff {
  /** Tests that were `pass` in the baseline and `fail` afterwards. */
  newlyFailing: TestResult[];
  /** True iff `newlyFailing` is non-empty. */
  isRegression: boolean;
}

// ── jest normalization ───────────────────────────────────────────────────────

/**
 * The subset of jest's `--json` output shape this normalizer reads.
 *
 * jest emits `testResults[]` (one per test file / suite), each with an
 * `assertionResults[]` array of individual test cases. We only depend on the
 * fields relevant to id + status so partial/streamed reports still parse.
 */
export interface JestAssertionResult {
  /** The individual test's title, e.g. `"returns 0 for empty input"`. */
  title?: string;
  fullName?: string;
  /** jest statuses: passed | failed | pending | skipped | todo | disabled. */
  status?: string;
}

export interface JestSuiteResult {
  /** Absolute or relative path to the test file, used to derive the suite id. */
  name?: string;
  testFilePath?: string;
  assertionResults?: JestAssertionResult[];
}

export interface JestJsonReport {
  testResults?: JestSuiteResult[];
}

/**
 * Map a raw jest assertion status to the normalized `TestStatus`.
 *
 * `passed` -> pass; `failed` -> fail; everything else jest uses to mean
 * "did not run as a real pass/fail" (`pending`, `skipped`, `todo`, `disabled`)
 * -> skip.
 */
export function normalizeJestStatus(raw: string | undefined): TestStatus {
  switch (raw) {
    case "passed":
      return "pass";
    case "failed":
      return "fail";
    default:
      return "skip";
  }
}

/**
 * Derive a stable, path-independent suite label from a jest suite's file path.
 *
 * Absolute machine paths (and Windows/Unix separator differences) would make
 * ids non-portable across capture environments, so we keep only the path
 * relative to the repo root when one is derivable, normalized to `/`.
 */
export function jestSuiteLabel(suite: JestSuiteResult): string {
  const raw = suite.testFilePath ?? suite.name ?? "unknown-suite";
  const normalized = raw.replaceAll("\\", "/");
  // Strip everything up to and including a `llm-toolkit/` root marker if present
  // so the label is stable regardless of where the repo is checked out.
  const rootMarker = normalized.lastIndexOf("/llm-toolkit/");
  if (rootMarker !== -1) {
    return normalized.slice(rootMarker + "/llm-toolkit/".length);
  }
  return normalized;
}

/**
 * Normalize a parsed jest `--json` report into `TestResult[]`.
 *
 * The id is `"{suiteLabel}::{testName}"`, using `fullName` when jest provides
 * it (it includes describe-block nesting) and falling back to `title`.
 */
export function normalizeJestReport(report: JestJsonReport): TestResult[] {
  const results: TestResult[] = [];
  for (const suite of report.testResults ?? []) {
    const suiteLabel = jestSuiteLabel(suite);
    for (const assertion of suite.assertionResults ?? []) {
      const testName = assertion.fullName ?? assertion.title ?? "unknown-test";
      results.push({
        id: `${suiteLabel}::${testName}`,
        status: normalizeJestStatus(assertion.status),
      });
    }
  }
  return results;
}

// ── cargo normalization ──────────────────────────────────────────────────────

/**
 * A single event line from `cargo test ... --format json`.
 *
 * The libtest JSON stream emits `{ "type": "test", "event": "...", "name": ... }`
 * objects. We read only the `test` events with a terminal event.
 */
export interface CargoTestEvent {
  type?: string;
  event?: string;
  name?: string;
}

/**
 * Map a cargo/libtest terminal `event` to the normalized `TestStatus`.
 *
 * `ok` -> pass; `failed` -> fail; `ignored` -> skip. The non-terminal
 * `started` event carries no outcome and is filtered out by the caller.
 */
export function normalizeCargoEvent(event: string | undefined): TestStatus | null {
  switch (event) {
    case "ok":
      return "pass";
    case "failed":
      return "fail";
    case "ignored":
      return "skip";
    default:
      return null;
  }
}

/**
 * Normalize a `cargo test` JSON message stream (one JSON object per line) into
 * `TestResult[]`.
 *
 * `suite` is the crate/target label the caller supplies (libtest json does not
 * repeat the crate name per line); the id is `"{suite}::{testName}"`.
 */
export function normalizeCargoOutput(stdout: string, suite: string): TestResult[] {
  const results: TestResult[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith("{")) continue;
    let parsed: CargoTestEvent;
    try {
      parsed = JSON.parse(trimmed) as CargoTestEvent;
    } catch {
      // Non-JSON progress lines (compiler output, "running N tests") are ignored.
      continue;
    }
    if (parsed.type !== "test") continue;
    const status = normalizeCargoEvent(parsed.event);
    if (status === null) continue; // "started" and other non-terminal events.
    results.push({
      id: `${suite}::${parsed.name ?? "unknown-test"}`,
      status,
    });
  }
  return results;
}

// ── regression diff (Property 6) ─────────────────────────────────────────────

/** Build an id -> status lookup, keeping the LAST status seen for a repeated id. */
function indexById(results: readonly TestResult[]): Map<string, TestStatus> {
  const index = new Map<string, TestStatus>();
  for (const r of results) index.set(r.id, r.status);
  return index;
}

/**
 * Diff a post-refresh snapshot against a baseline over the same corpus.
 *
 * A test is "newly failing" iff it was `pass` in the baseline and `fail` in the
 * post-refresh snapshot. The run is a regression iff at least one such test
 * exists. Tests that were already failing or skipped in the baseline are not
 * regressions if they still fail (design: gate is "no newly failing").
 *
 * The comparison is over the union of jest + cargo results in each snapshot,
 * matched by `id`, so a jest test and a cargo test never collide as long as
 * their suite labels differ (which they always do — jest uses file paths and
 * cargo uses crate labels).
 */
export function diffBaseline(
  baseline: Pick<Baseline, "jest" | "cargo">,
  post: Pick<Baseline, "jest" | "cargo">,
): RegressionDiff {
  const baselineIndex = indexById([...baseline.jest, ...baseline.cargo]);
  const postResults = [...post.jest, ...post.cargo];

  const newlyFailing: TestResult[] = [];
  for (const result of postResults) {
    if (result.status !== "fail") continue;
    if (baselineIndex.get(result.id) === "pass") {
      newlyFailing.push(result);
    }
  }

  return {
    newlyFailing,
    isRegression: newlyFailing.length > 0,
  };
}
