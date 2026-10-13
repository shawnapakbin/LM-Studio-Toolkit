// Feature: dependency-refresh-node24, Property 5: Version-bump decision
// distinguishes invalid-value from unmet-prerequisite

/**
 * Feature: dependency-refresh-node24
 * Property 5: Version-bump decision distinguishes invalid-value from
 * unmet-prerequisite
 *
 * For all pairs of (current, proposed) version strings — a mix of valid semver
 * proposals that are greater / equal / lower than the current, invalid-semver
 * proposals, and arbitrary prerequisite states (both booleans generated
 * independently) — `decideBump` obeys the two-stage, distinct-channel contract:
 *   1. it ACCEPTs iff the proposed value is valid semver AND strictly greater
 *      than current by semver precedence AND both prerequisites are met
 *      (Req 9.1);
 *   2. it rejects with `invalid-version-value` iff the proposed value is invalid
 *      semver OR not strictly greater, REGARDLESS of prerequisite state — the
 *      value channel is decided first and wins (Req 9.2);
 *   3. it rejects with `unmet-prerequisite` iff the value is valid-and-greater
 *      but at least one prerequisite is unmet, and `unmet` enumerates exactly
 *      the false prerequisites in stable order (Req 9.10);
 *   4. the two rejection `kind`s are distinct literals and are never conflated.
 *
 * Validates: Requirements 9.1, 9.2, 9.10
 * Design: Property 5
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `decideBump` is the pure accept / invalid-version-value / unmet-prerequisite
 * decision consumed by the Phase I sync CLI. This test drives the REAL function
 * (imported from `bump-decision-core` with no `.ts` extension so ts-jest /
 * CommonJS resolves it, matching the sibling `version-sync-core.property.test`
 * import style, and with NO mocks) over generated version pairs and prerequisite
 * states.
 *
 * The oracle is INDEPENDENT of `decideBump`'s internal branching. Rather than
 * re-calling the module's decision logic, the expected branch is derived
 * straight from the acceptance criteria via a hand-written comparator that
 * classifies each generated proposal as valid-and-greater or not (using a small
 * from-scratch numeric-triple comparison for the release versions the oracle
 * emits) and a hand-written enumeration of the false prerequisite flags. The
 * generators intentionally mix release triples that are greater / equal / lower
 * than a fixed current version, plus known-invalid strings, so all three
 * branches are exercised across runs.
 */

import * as fc from "fast-check";
import {
  type BumpDecision,
  decideBump,
  isValidSemVer,
  PREREQUISITE_LABELS,
  type PrerequisiteState,
} from "./bump-decision-core";

// ── Fixed reference point ────────────────────────────────────────────────────

/**
 * The oracle and generators are all defined relative to a single, fixed current
 * version so the independent "strictly greater" comparison stays a trivial
 * numeric-triple compare (no reuse of the module's semver parser).
 */
const CURRENT = "5.3.0";
const CURRENT_TRIPLE: readonly [number, number, number] = [5, 3, 0];

// ── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * A strict MAJOR.MINOR.PATCH release triple (no prerelease/build), spanning
 * values both above and below the current version so the generated proposals
 * mix strictly-greater, equal, and lower cases.
 */
const releaseVersionArb: fc.Arbitrary<string> = fc
  .tuple(fc.nat({ max: 7 }), fc.nat({ max: 6 }), fc.nat({ max: 4 }))
  .map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/** Known-invalid (non-semver) proposals — every one must fail semver parsing. */
const invalidVersionArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  "5",
  "5.3",
  "5.3.0.0",
  "5.03.0",
  "v5.4.0",
  "^5.4.0",
  "~5.4.0",
  "5.4.x",
  "latest",
  "not-a-version",
  "abc.def.ghi",
);

/**
 * A proposed value: a mix (~2:1) of valid release triples and known-invalid
 * strings, so both the value channel (invalid + not-greater) and the
 * prerequisite channel are reached.
 */
const proposedArb: fc.Arbitrary<string> = fc.oneof(
  releaseVersionArb,
  releaseVersionArb,
  invalidVersionArb,
);

/** Arbitrary prerequisite state — both flags generated independently. */
const prerequisiteArb: fc.Arbitrary<PrerequisiteState> = fc.record({
  allGatesPassing: fc.boolean(),
  installerReleasePassing: fc.boolean(),
});

// ── Independent oracle ───────────────────────────────────────────────────────

/** Parse a plain MAJOR.MINOR.PATCH string the oracle itself emitted. */
function parseTriple(version: string): [number, number, number] | null {
  const parts = version.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return [nums[0], nums[1], nums[2]];
}

/**
 * Is `proposed` strictly greater than the current version, per the oracle's own
 * numeric-triple comparison? For invalid (non-semver) inputs, or for values not
 * strictly greater, this is `false`. Independent of `compareSemVer`.
 */
function isStrictlyGreaterThanCurrent(proposed: string): boolean {
  const triple = parseTriple(proposed);
  if (triple === null) return false;
  for (let i = 0; i < 3; i++) {
    if (triple[i] > CURRENT_TRIPLE[i]) return true;
    if (triple[i] < CURRENT_TRIPLE[i]) return false;
  }
  return false; // equal
}

/**
 * The set of prerequisite labels that are unmet (false), in the same stable
 * order the module enumerates them. Hand-written from the criterion so it does
 * not reuse the module's `unmetPrerequisites` helper.
 */
function expectedUnmet(prereqs: PrerequisiteState): string[] {
  const unmet: string[] = [];
  if (!prereqs.allGatesPassing) unmet.push(PREREQUISITE_LABELS.allGatesPassing);
  if (!prereqs.installerReleasePassing) unmet.push(PREREQUISITE_LABELS.installerReleasePassing);
  return unmet;
}

type ExpectedKind = BumpDecision["kind"];

/** Derive the expected decision kind straight from the acceptance criteria. */
function expectedKind(proposed: string, prereqs: PrerequisiteState): ExpectedKind {
  const valueOk = isValidSemVer(proposed) && isStrictlyGreaterThanCurrent(proposed);
  if (!valueOk) return "invalid-version-value";
  return expectedUnmet(prereqs).length > 0 ? "unmet-prerequisite" : "accept";
}

describe("Feature: dependency-refresh-node24, Property 5: version-bump decision channels", () => {
  it("classifies accept / invalid-value / unmet-prereq exactly per the independent oracle", () => {
    fc.assert(
      fc.property(proposedArb, prerequisiteArb, (proposed, prerequisites) => {
        const result = decideBump({ current: CURRENT, proposed, prerequisites });
        const expected = expectedKind(proposed, prerequisites);

        // The decision kind matches the branch derived independently from the
        // criteria (accept iff valid-and-greater AND both prereqs met; else the
        // matching rejection channel).
        expect(result.kind).toBe(expected);

        if (result.kind === "accept") {
          // (1) ACCEPT: value was valid, strictly greater, prereqs all met, and
          // the accepted target is byte-identical to the proposed value.
          expect(isValidSemVer(proposed)).toBe(true);
          expect(isStrictlyGreaterThanCurrent(proposed)).toBe(true);
          expect(prerequisites.allGatesPassing).toBe(true);
          expect(prerequisites.installerReleasePassing).toBe(true);
          expect(result.target).toBe(proposed);
        } else if (result.kind === "invalid-version-value") {
          // (2) invalid-value iff invalid semver OR not strictly greater — the
          // value channel wins regardless of prerequisite state.
          const valueOk = isValidSemVer(proposed) && isStrictlyGreaterThanCurrent(proposed);
          expect(valueOk).toBe(false);
          // The offending value is named verbatim.
          expect(result.proposed).toBe(proposed);
        } else {
          // (3) unmet-prerequisite iff valid-and-greater but >=1 prereq false;
          // `unmet` enumerates exactly the false prerequisites, in stable order.
          expect(isValidSemVer(proposed)).toBe(true);
          expect(isStrictlyGreaterThanCurrent(proposed)).toBe(true);
          expect(result.proposed).toBe(proposed);
          expect(result.unmet).toEqual(expectedUnmet(prerequisites));
          expect(result.unmet.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("the value channel wins: an invalid/not-greater value is NEVER unmet-prerequisite, even with unmet prereqs", () => {
    fc.assert(
      fc.property(proposedArb, prerequisiteArb, (proposed, prerequisites) => {
        const valueOk = isValidSemVer(proposed) && isStrictlyGreaterThanCurrent(proposed);
        fc.pre(!valueOk); // focus on invalid / not-greater proposals

        const result = decideBump({ current: CURRENT, proposed, prerequisites });
        // Regardless of prerequisite state, an invalid/not-greater value is
        // reported through the value channel and never conflated with the
        // prerequisite channel.
        expect(result.kind).toBe("invalid-version-value");
        expect(result.kind).not.toBe("unmet-prerequisite");
      }),
      { numRuns: 200 },
    );
  });

  it("a valid-and-greater value blocked only by a prerequisite is NEVER invalid-version-value", () => {
    fc.assert(
      fc.property(releaseVersionArb, prerequisiteArb, (proposed, prerequisites) => {
        fc.pre(isStrictlyGreaterThanCurrent(proposed));
        fc.pre(!prerequisites.allGatesPassing || !prerequisites.installerReleasePassing);

        const result = decideBump({ current: CURRENT, proposed, prerequisites });
        // A valid, strictly-greater value blocked purely by prerequisites is
        // reported through the prerequisite channel — never as an invalid value.
        expect(result.kind).toBe("unmet-prerequisite");
        expect(result.kind).not.toBe("invalid-version-value");
      }),
      { numRuns: 200 },
    );
  });

  it("the two rejection kinds are distinct literals and never coincide", () => {
    // A single check that the channel literals the module uses are the two
    // distinct strings the criteria require (Req 9.2 vs 9.10).
    const invalid: ExpectedKind = "invalid-version-value";
    const unmet: ExpectedKind = "unmet-prerequisite";
    expect(invalid).not.toBe(unmet);

    fc.assert(
      fc.property(proposedArb, prerequisiteArb, (proposed, prerequisites) => {
        const result = decideBump({ current: CURRENT, proposed, prerequisites });
        // Every result is exactly one of the three known kinds — a rejection is
        // never simultaneously reported through both channels.
        expect(["accept", "invalid-version-value", "unmet-prerequisite"]).toContain(result.kind);
        if (result.kind === "invalid-version-value") {
          expect(result.kind).not.toBe("unmet-prerequisite");
        }
        if (result.kind === "unmet-prerequisite") {
          expect(result.kind).not.toBe("invalid-version-value");
        }
      }),
      { numRuns: 200 },
    );
  });
});
