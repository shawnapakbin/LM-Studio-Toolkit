/**
 * Feature: dependency-refresh-node24
 *
 * Pure regression-diff core for the pre-refresh baseline oracle (Phase A).
 *
 * The existing jest + cargo suites are the regression oracle for this refresh:
 * a pre-refresh baseline snapshot of `(id, status)` pairs is captured on the
 * current toolchain, and after each phase a post-refresh snapshot of the same
 * shape is diffed against it. A regression is any test that PASSED in the
 * baseline and FAILS after the refresh. Tests that were already failing or
 * skipped in the baseline are NOT regressions if their status is unchanged —
 * the gate is "no newly failing tests", not "all tests green".
 *
 * `computeRegressionDiff` is the pure function that both the baseline capture
 * script (task 1.1) and the Phase gate diffs consume. It is deliberately free
 * of any I/O so it can be property-tested exhaustively (Property 6) and reused
 * by the capture tooling.
 *
 * Data models mirror design.md ("Baseline snapshot (regression oracle)").
 */

export type TestStatus = "pass" | "fail" | "skip";

export interface TestResult {
  /** Stable "{suite}::{testName}" identifier. */
  id: string;
  status: TestStatus;
}

export interface RegressionDiff {
  /** Tests that were `pass` in the baseline and `fail` post-refresh. */
  newlyFailing: TestResult[];
  /** True iff `newlyFailing` is non-empty. */
  isRegression: boolean;
}

/**
 * Compute the regression diff between a pre-refresh baseline snapshot and a
 * post-refresh snapshot over the same test corpus.
 *
 * A test is "newly failing" iff it is `pass` in the baseline and `fail` in the
 * post-refresh snapshot (matched by `id`). The returned `newlyFailing` list
 * carries the POST-refresh result (id + failing status), so each regression is
 * identified by its test id and its failure. `isRegression` is true iff at
 * least one such test exists.
 *
 * Duplicate ids within a snapshot are resolved last-wins, which matches the
 * shape of a normalized `(id, status)` set (the capture tooling normalizes the
 * jest/cargo output into such a set). A test present in the baseline but absent
 * from the post-refresh snapshot is not counted (there is no observed post
 * status to call a failure), and vice versa.
 *
 * @param baseline pre-refresh `TestResult[]` snapshot
 * @param post post-refresh `TestResult[]` snapshot over the same corpus
 */
export function computeRegressionDiff(
  baseline: readonly TestResult[],
  post: readonly TestResult[],
): RegressionDiff {
  const baselineStatus = new Map<string, TestStatus>();
  for (const t of baseline) {
    baselineStatus.set(t.id, t.status);
  }

  const postById = new Map<string, TestResult>();
  for (const t of post) {
    postById.set(t.id, t);
  }

  const newlyFailing: TestResult[] = [];
  for (const [id, postResult] of postById) {
    if (baselineStatus.get(id) === "pass" && postResult.status === "fail") {
      newlyFailing.push({ id, status: postResult.status });
    }
  }

  return {
    newlyFailing,
    isRegression: newlyFailing.length > 0,
  };
}
