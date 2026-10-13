// Feature: dependency-refresh-node24, Property 9: GitHub Action major currency

/**
 * Feature: dependency-refresh-node24
 * Property 9: GitHub Action major currency
 *
 * For all sets of GitHub Action references, `checkActionCurrency` SHALL report a
 * reference as PASSING IF AND ONLY IF it pins the action at its expected current
 * major via an IMMUTABLE MAJOR TAG — either a bare numbered major tag `v<N>`
 * equal to the expected numbered major, or a named channel tag (e.g. `stable`)
 * equal to the expected channel. Every other pin (a superseded numbered major, a
 * full-version tag `v<N>.<...>`, a floating branch, or a full commit SHA) SHALL
 * be FLAGGED, and each flagged entry SHALL name its file (`filePath`) and its
 * reference (`action` + `pinned`). `ok` SHALL be true iff `flagged` is empty.
 *
 * Validates: Requirements 7.1, 7.2
 * Design: Property 9
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `checkActionCurrency` is the pure action major-currency core consumed by the
 * file-scanning CLI (`check-action-currency.ts`). This test drives the REAL
 * function (imported from `action-currency-core.ts` with no `.ts` extension so
 * ts-jest / CommonJS resolves it, and with NO mocks) over generated
 * action-reference sets that mix compliant and non-compliant pins.
 *
 * Each generated pin is drawn from a pool tagged with the pin's shape and value
 * by an INDEPENDENT oracle (`oraclePasses` below), hand-derived straight from the
 * acceptance criteria — a bare `v<N>` equal to the expected numbered major, or a
 * channel token equal to the expected channel (case-insensitive) — rather than
 * by re-calling the module's own `classifyPinnedRef` / `evaluateActionRef`. We
 * then assert the function agrees exactly: `ok` is the biconditional of an empty
 * `flagged` list; a ref is in `flagged` IFF the oracle says it does not pin the
 * expected current major via an immutable major tag; and every flagged entry
 * carries its file path and its reference (action + pinned ref).
 */

import * as fc from "fast-check";
import { type ActionRef, checkActionCurrency } from "./action-currency-core";

const CI = ".github/workflows/ci.yml";
const RELEASE = ".github/workflows/installer-release.yml";

const FILE_PATHS: readonly string[] = [CI, RELEASE] as const;
const ACTIONS: readonly string[] = [
  "actions/checkout",
  "actions/setup-node",
  "codecov/codecov-action",
  "swatinem/rust-cache",
  "softprops/action-gh-release",
] as const;

/**
 * A pool of pinned-ref forms, each tagged with the SHAPE the acceptance criteria
 * recognise:
 *   - `numbered-major`  — a bare `v<N>` immutable major tag (its `major` records
 *     the numeric major so the oracle can compare against the expectation);
 *   - `channel`         — a named channel tag (its `channel` records the token);
 *   - `flagged-shape`   — a full-version tag, floating branch, or full SHA, which
 *     is never an immutable major tag and so can never pass.
 * The shape tags are hand-decided from the criteria and share no logic with the
 * module's own classifier.
 */
type PinShape =
  | { kind: "numbered-major"; pinned: string; major: number }
  | { kind: "channel"; pinned: string; channel: string }
  | { kind: "flagged-shape"; pinned: string };

const NUMBERED_MAJOR_PINS: readonly PinShape[] = [
  { kind: "numbered-major", pinned: "v2", major: 2 },
  { kind: "numbered-major", pinned: "v3", major: 3 },
  { kind: "numbered-major", pinned: "v5", major: 5 },
  { kind: "numbered-major", pinned: "v6", major: 6 },
  { kind: "numbered-major", pinned: "v7", major: 7 },
  { kind: "numbered-major", pinned: "v8", major: 8 },
] as const;

const CHANNEL_PINS: readonly PinShape[] = [
  { kind: "channel", pinned: "stable", channel: "stable" },
  { kind: "channel", pinned: "beta", channel: "beta" },
  { kind: "channel", pinned: "nightly", channel: "nightly" },
] as const;

const FLAGGED_SHAPE_PINS: readonly PinShape[] = [
  // full-version tags (not the bare major tag)
  { kind: "flagged-shape", pinned: "v5.1" },
  { kind: "flagged-shape", pinned: "v5.1.2" },
  { kind: "flagged-shape", pinned: "v7.0.0" },
  // floating branches
  { kind: "flagged-shape", pinned: "main" },
  { kind: "flagged-shape", pinned: "master" },
  // full commit SHAs (immutable, but not a major tag)
  { kind: "flagged-shape", pinned: "a".repeat(40) },
  { kind: "flagged-shape", pinned: "0123456789abcdef0123456789abcdef01234567" },
] as const;

/**
 * The expectation the ref is paired against: either a numbered major tag or a
 * named channel. Kept in a small pool so both branches of the currency contract
 * are exercised, and so a numbered-major pin can be paired against a matching or
 * a superseded expected major.
 */
type Expectation =
  | { kind: "numbered"; expected: string; major: number }
  | { kind: "channel"; expected: string; channel: string };

const EXPECTATIONS: readonly Expectation[] = [
  { kind: "numbered", expected: "v5", major: 5 },
  { kind: "numbered", expected: "v7", major: 7 },
  { kind: "numbered", expected: "v8", major: 8 },
  { kind: "channel", expected: "stable", channel: "stable" },
] as const;

/**
 * Independent oracle: decide, straight from the acceptance criteria, whether a
 * pin passes for a given expectation. Passes IFF the pin is an immutable major
 * tag matching the expectation:
 *   - expected numbered major `v<N>` and pin is the bare `v<N>` (equal numeric
 *     major); or
 *   - expected channel and pin is that same channel token (case-insensitive).
 * Anything else — a superseded numbered major, a mismatched channel, or any
 * flagged-shape pin (full-version tag / branch / SHA) — fails. This deliberately
 * does not call the module's classifier.
 */
function oraclePasses(pin: PinShape, expectation: Expectation): boolean {
  if (expectation.kind === "numbered") {
    return pin.kind === "numbered-major" && pin.major === expectation.major;
  }
  return pin.kind === "channel" && pin.channel.toLowerCase() === expectation.channel.toLowerCase();
}

/** One generated reference plus the oracle's expected verdict. */
interface TaggedRef {
  filePath: string;
  action: string;
  pinned: string;
  expected: string;
  expectedPasses: boolean;
}

const pinArb: fc.Arbitrary<PinShape> = fc.oneof(
  fc.constantFrom(...NUMBERED_MAJOR_PINS),
  fc.constantFrom(...CHANNEL_PINS),
  fc.constantFrom(...FLAGGED_SHAPE_PINS),
);

const taggedRefArb: fc.Arbitrary<TaggedRef> = fc
  .record({
    filePath: fc.constantFrom(...FILE_PATHS),
    action: fc.constantFrom(...ACTIONS),
    pin: pinArb,
    expectation: fc.constantFrom(...EXPECTATIONS),
  })
  .map((r) => ({
    filePath: r.filePath,
    action: r.action,
    pinned: r.pin.pinned,
    expected: r.expectation.expected,
    expectedPasses: oraclePasses(r.pin, r.expectation),
  }));

/** A mixed set of references (possibly empty), 0..25 entries. */
const refSetArb: fc.Arbitrary<TaggedRef[]> = fc.array(taggedRefArb, {
  minLength: 0,
  maxLength: 25,
});

describe("Feature: dependency-refresh-node24, Property 9: GitHub Action major currency", () => {
  it("flagged is exactly the refs NOT pinning the expected current major via an immutable major tag; each names file + reference; ok iff flagged empty", () => {
    fc.assert(
      fc.property(refSetArb, (tagged) => {
        const input: ActionRef[] = tagged.map((t) => ({
          filePath: t.filePath,
          action: t.action,
          pinned: t.pinned,
          expected: t.expected,
        }));

        const report = checkActionCurrency(input);

        // The report preserves every input reference, in order.
        expect(report.refs).toHaveLength(tagged.length);
        for (let i = 0; i < tagged.length; i++) {
          expect(report.refs[i].filePath).toBe(tagged[i].filePath);
          expect(report.refs[i].action).toBe(tagged[i].action);
          expect(report.refs[i].pinned).toBe(tagged[i].pinned);
          expect(report.refs[i].expected).toBe(tagged[i].expected);
        }

        // A ref is flagged IFF the oracle says it does not pin the expected
        // current major via an immutable major tag. Compare as multisets of the
        // identifying (file, action, pinned, expected) tuples.
        const key = (r: { filePath: string; action: string; pinned: string; expected: string }) =>
          `${r.filePath}\u0000${r.action}\u0000${r.pinned}\u0000${r.expected}`;

        const expectedFlaggedKeys = tagged
          .filter((t) => !t.expectedPasses)
          .map(key)
          .sort();
        const actualFlaggedKeys = report.flagged.map(key).sort();
        expect(actualFlaggedKeys).toEqual(expectedFlaggedKeys);

        // Every flagged entry names its file and its reference (action + pinned).
        for (const flag of report.flagged) {
          expect(FILE_PATHS).toContain(flag.filePath);
          expect(flag.action.length).toBeGreaterThan(0);
          expect(flag.pinned.length).toBeGreaterThan(0);
          // The human-readable reason surfaces both the file and the reference
          // so the caller can locate it (Req 7.1 / 7.2).
          expect(flag.reason).toContain(flag.filePath);
          expect(flag.reason).toContain(flag.action);
          expect(flag.reason).toContain(flag.pinned);
        }

        // `ok` is the biconditional of an empty flagged set.
        expect(report.ok).toBe(report.flagged.length === 0);
        expect(report.ok).toBe(expectedFlaggedKeys.length === 0);
      }),
      { numRuns: 200 },
    );
  });

  it("a set that pins every expected current major via an immutable major tag reports ok with no flags", () => {
    const compliantRefArb: fc.Arbitrary<ActionRef> = fc
      .constantFrom(...EXPECTATIONS)
      .chain((expectation) =>
        fc
          .record({
            filePath: fc.constantFrom(...FILE_PATHS),
            action: fc.constantFrom(...ACTIONS),
          })
          .map((r) => ({
            filePath: r.filePath,
            action: r.action,
            // Pin exactly the expected immutable major tag / channel.
            pinned: expectation.expected,
            expected: expectation.expected,
          })),
      );

    fc.assert(
      fc.property(fc.array(compliantRefArb, { minLength: 0, maxLength: 25 }), (refs) => {
        const report = checkActionCurrency(refs);
        expect(report.flagged).toEqual([]);
        expect(report.ok).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("any flagged-shape pin (full-version / branch / SHA) forces ok=false and appears in flagged naming file + reference", () => {
    const badRefArb: fc.Arbitrary<ActionRef> = fc
      .record({
        filePath: fc.constantFrom(...FILE_PATHS),
        action: fc.constantFrom(...ACTIONS),
        pin: fc.constantFrom(...FLAGGED_SHAPE_PINS),
        expectation: fc.constantFrom(...EXPECTATIONS),
      })
      .map((r) => ({
        filePath: r.filePath,
        action: r.action,
        pinned: r.pin.pinned,
        expected: r.expectation.expected,
      }));

    fc.assert(
      fc.property(badRefArb, (bad) => {
        const report = checkActionCurrency([bad]);
        expect(report.ok).toBe(false);
        expect(report.flagged).toHaveLength(1);
        const flag = report.flagged[0];
        expect(flag.filePath).toBe(bad.filePath);
        expect(flag.action).toBe(bad.action);
        expect(flag.pinned).toBe(bad.pinned);
        expect(flag.reason).toContain(bad.filePath);
        expect(flag.reason).toContain(bad.action);
      }),
      { numRuns: 200 },
    );
  });
});
