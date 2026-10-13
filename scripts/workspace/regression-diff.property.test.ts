// Feature: dependency-refresh-node24, Property 6: Gate preservation — baseline diff detects every regression

/**
 * Feature: dependency-refresh-node24
 * Property 6: Gate preservation (baseline diff detects every regression)
 *
 * For all pairs of a pre-refresh baseline test snapshot and a post-refresh test
 * snapshot over the same test corpus (jest and cargo), the regression diff SHALL
 * classify the run as a regression if and only if there exists at least one test
 * that is `pass` in the baseline and `fail` in the post-refresh snapshot, and the
 * diff's `newlyFailing` list SHALL contain exactly those tests, each identified by
 * test id and failure.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 10.1, 10.4, 10.5
 * Design: Property 6
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `computeRegressionDiff` is the pure regression-oracle diff consumed by the
 * Phase A baseline capture script and every phase gate. This test drives the
 * REAL function (imported from `regression-diff.ts`, no mocks) against generated
 * baseline/post snapshot pairs built over a SHARED corpus of test ids — the diff
 * is only meaningful over the same corpus (design.md: "over the same test
 * corpus"). For each id we generate a baseline status and a post status
 * independently across {pass, fail, skip} (jest and cargo both use these three).
 * An independent oracle re-derives the expected `newlyFailing` set (baseline
 * pass AND post fail) and the expected `isRegression` flag, and we assert the
 * function agrees exactly — same ids, same failing status, and the biconditional.
 */

import * as fc from "fast-check";
import { computeRegressionDiff, type TestResult, type TestStatus } from "./regression-diff";

const STATUSES: readonly TestStatus[] = ["pass", "fail", "skip"] as const;

/**
 * A corpus entry: a unique test id with its baseline status and post status.
 * The baseline snapshot is the projection onto `baselineStatus`, the post
 * snapshot the projection onto `postStatus` — both over the SAME set of ids,
 * modelling "the same test corpus (jest and cargo)".
 */
interface CorpusEntry {
  id: string;
  baselineStatus: TestStatus;
  postStatus: TestStatus;
}

/**
 * Generate a corpus of unique test ids, each with an independently-chosen
 * baseline and post status. Ids look like real oracle ids
 * (`{suite}::{testName}`) drawn from both jest- and cargo-style suites so the
 * property exercises the combined corpus. `uniqueArray` on the id keeps the
 * snapshots free of duplicate ids (the capture tooling normalizes to a set).
 */
const corpusArb: fc.Arbitrary<CorpusEntry[]> = fc
  .uniqueArray(
    fc.record({
      suite: fc.constantFrom(
        // jest-style suites
        "CLI",
        "SlashCommands",
        "mcp/common",
        "Memory",
        "Skills",
        // cargo-style suites
        "src-tauri::payload",
        "src-tauri::runtimes",
      ),
      testName: fc.string({ minLength: 1, maxLength: 12 }),
    }),
    {
      minLength: 0,
      maxLength: 40,
      selector: (r) => `${r.suite}::${r.testName}`,
    },
  )
  .chain((keys) =>
    fc.tuple(
      ...keys.map((k) =>
        fc.record({
          id: fc.constant(`${k.suite}::${k.testName}`),
          baselineStatus: fc.constantFrom(...STATUSES),
          postStatus: fc.constantFrom(...STATUSES),
        }),
      ),
    ),
  );

function toBaseline(corpus: CorpusEntry[]): TestResult[] {
  return corpus.map((e) => ({ id: e.id, status: e.baselineStatus }));
}

function toPost(corpus: CorpusEntry[]): TestResult[] {
  return corpus.map((e) => ({ id: e.id, status: e.postStatus }));
}

/** Independent oracle: the ids that regressed (baseline pass -> post fail). */
function expectedNewlyFailingIds(corpus: CorpusEntry[]): Set<string> {
  return new Set(
    corpus.filter((e) => e.baselineStatus === "pass" && e.postStatus === "fail").map((e) => e.id),
  );
}

describe("Feature: dependency-refresh-node24, Property 6: regression diff detects every regression", () => {
  it("isRegression is true iff some test is baseline-pass and post-fail, and newlyFailing lists exactly those tests by id + failure", () => {
    fc.assert(
      fc.property(corpusArb, (corpus) => {
        const baseline = toBaseline(corpus);
        const post = toPost(corpus);

        const diff = computeRegressionDiff(baseline, post);
        const expectedIds = expectedNewlyFailingIds(corpus);

        // Biconditional: regression iff at least one baseline-pass -> post-fail.
        expect(diff.isRegression).toBe(expectedIds.size > 0);
        expect(diff.isRegression).toBe(diff.newlyFailing.length > 0);

        // newlyFailing lists EXACTLY those tests — same id set, no more, no less.
        const actualIds = new Set(diff.newlyFailing.map((t) => t.id));
        expect(actualIds).toEqual(expectedIds);
        expect(diff.newlyFailing).toHaveLength(expectedIds.size);

        // Each reported regression carries its id and its failure status.
        for (const t of diff.newlyFailing) {
          expect(expectedIds.has(t.id)).toBe(true);
          expect(t.status).toBe("fail");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("a snapshot with zero baseline-pass->post-fail transitions is never a regression (skips and already-failing baselines are not regressions)", () => {
    // Restrict the generator so no id ever goes baseline-pass -> post-fail:
    // either the baseline was not passing, or the post status is not fail.
    const nonRegressingCorpusArb: fc.Arbitrary<CorpusEntry[]> = fc.array(
      fc
        .record({
          id: fc.string({ minLength: 1, maxLength: 16 }),
          baselineStatus: fc.constantFrom<TestStatus>("pass", "fail", "skip"),
          postStatus: fc.constantFrom<TestStatus>("pass", "fail", "skip"),
        })
        .filter((e) => !(e.baselineStatus === "pass" && e.postStatus === "fail")),
      { minLength: 0, maxLength: 30 },
    );

    fc.assert(
      fc.property(nonRegressingCorpusArb, (corpus) => {
        // De-duplicate ids (last-wins) to keep the snapshots a normalized set.
        const byId = new Map(corpus.map((e) => [e.id, e]));
        const deduped = [...byId.values()];
        const diff = computeRegressionDiff(toBaseline(deduped), toPost(deduped));
        expect(diff.isRegression).toBe(false);
        expect(diff.newlyFailing).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
