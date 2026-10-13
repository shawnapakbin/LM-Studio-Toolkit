// Feature: dependency-refresh-node24, Property 1: Node-version compliance and flagging

/**
 * Feature: dependency-refresh-node24
 * Property 1: Node-version compliance and flagging
 *
 * For all sets of Node version references, `checkNodeCompliance` SHALL mark a
 * reference compliant IF AND ONLY IF its resolved major version equals 24 AND
 * its bounds admit only versions in the window [24.0.0, 25.0.0); the report's
 * `offending` list SHALL contain exactly the non-compliant references, each
 * carrying its `filePath` and its raw value (`offendingValue`); and `ok` SHALL
 * be true iff `offending` is empty.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 * Design: Property 1
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `checkNodeCompliance` is the pure compliance core consumed by the file-
 * scanning CLI (`check-node-24.ts`). This test drives the REAL function
 * (imported from `check-node-24-core.ts`, no mocks) over generated reference
 * sets that mix known-compliant and known-non-compliant raw values, each tagged
 * with a `filePath` and a `kind`. We tag every generated raw value with the
 * expected-compliant verdict decided by an INDEPENDENT oracle (`oracleCompliant`
 * below, written from the acceptance criteria — resolved major 24 AND a fully
 * bounded [24.0.0, 25.0.0) window — rather than by reusing the module's own
 * bound classifier). We then assert the function agrees exactly: per-ref
 * `compliant` flags match the oracle, `offending` lists exactly the non-compliant
 * refs preserving `filePath` + raw value, and `ok` is the biconditional of an
 * empty `offending` set.
 */

import * as fc from "fast-check";
import { checkNodeCompliance, type NodeRefKind } from "./check-node-24-core";

const KINDS: readonly NodeRefKind[] = [
  "engines",
  "nvmrc",
  "setup-node",
  "dockerfile",
  "tool-config",
] as const;

/**
 * Known-compliant raw values: each resolves to major 24 AND stays entirely
 * within [24.0.0, 25.0.0) — bare/partial pins on the 24 line and fully-bounded
 * caret/range forms.
 */
const COMPLIANT_VALUES: readonly string[] = [
  "24",
  "24.x",
  "24.3",
  "24.3.1",
  "v24.3.0",
  "^24.1.0",
  "~24.3.0",
  ">=24.0.0 <25.0.0",
  ">24.0.0 <25.0.0",
  ">=24.0.0 <=24.9.9",
  "=24.0.0",
] as const;

/**
 * Known-non-compliant raw values, each non-compliant for a distinct reason:
 *   - wrong major (below or above 24): "20", "23", "25", "^25.0.0", "v18.19.0"
 *   - open-ended lower-only range (admits 25.x): ">=24.0.0"
 *   - upper bound admits 25.x / 26.x: ">=24.0.0 <26.0.0", ">=25.0.0 <26.0.0"
 *   - lower bound below 24: ">=23.0.0 <25.0.0"
 *   - disjunction widens beyond one window: "24 || 25"
 *   - unparseable / non-numeric: "lts/*", "", "latest"
 */
const NON_COMPLIANT_VALUES: readonly string[] = [
  "20",
  "23",
  "25",
  "^25.0.0",
  "v18.19.0",
  ">=24.0.0",
  ">=24.0.0 <26.0.0",
  ">=25.0.0 <26.0.0",
  ">=23.0.0 <25.0.0",
  "24 || 25",
  "lts/*",
  "",
  "latest",
] as const;

/**
 * Independent oracle: decide compliance straight from the acceptance criteria,
 * WITHOUT calling the module's own bound classifier. A raw value is compliant
 * iff it names the Node-24 line only — either a bare/partial pin whose single
 * major is 24, or a conjunctive range fully bounded to [24.0.0, 25.0.0).
 *
 * This is deliberately a simpler, criteria-first re-derivation. It relies on the
 * generators only ever emitting values drawn from COMPLIANT_VALUES /
 * NON_COMPLIANT_VALUES, so it is expressed as an explicit membership check
 * against the known-compliant set — the strongest independent oracle: it does
 * not share any parsing logic with the code under test.
 */
function oracleCompliant(rawValue: string): boolean {
  return (COMPLIANT_VALUES as readonly string[]).includes(rawValue);
}

/** One generated reference input plus the oracle's expected verdict. */
interface TaggedRef {
  filePath: string;
  kind: NodeRefKind;
  rawValue: string;
  expectedCompliant: boolean;
}

/** A file-path arbitrary spanning the reference sources the scanner emits. */
const filePathArb: fc.Arbitrary<string> = fc.constantFrom(
  "package.json",
  "CLI/package.json",
  "Memory/package.json",
  ".nvmrc",
  ".github/workflows/ci.yml",
  ".github/workflows/installer-release.yml",
  "Installer/Dockerfile",
  "tsconfig.base.json",
);

/**
 * Generate a single tagged reference: pick a raw value from either the
 * compliant or the non-compliant pool (so both are well-represented across a
 * set), attach a file path and kind, and record the oracle verdict.
 */
const taggedRefArb: fc.Arbitrary<TaggedRef> = fc
  .record({
    rawValue: fc.oneof(
      fc.constantFrom(...COMPLIANT_VALUES),
      fc.constantFrom(...NON_COMPLIANT_VALUES),
    ),
    filePath: filePathArb,
    kind: fc.constantFrom(...KINDS),
  })
  .map((r) => ({
    filePath: r.filePath,
    kind: r.kind,
    rawValue: r.rawValue,
    expectedCompliant: oracleCompliant(r.rawValue),
  }));

/** A mixed set of references (possibly empty), 0..25 entries. */
const refSetArb: fc.Arbitrary<TaggedRef[]> = fc.array(taggedRefArb, {
  minLength: 0,
  maxLength: 25,
});

describe("Feature: dependency-refresh-node24, Property 1: Node-version compliance and flagging", () => {
  it("compliant iff resolved major===24 with bounds satisfied; offending is exactly the non-compliant refs (filePath+rawValue); ok iff offending empty", () => {
    fc.assert(
      fc.property(refSetArb, (tagged) => {
        const input = tagged.map((t) => ({
          filePath: t.filePath,
          kind: t.kind,
          rawValue: t.rawValue,
        }));

        const report = checkNodeCompliance(input);

        // The report preserves every input reference, in order.
        expect(report.refs).toHaveLength(tagged.length);

        // Per-ref: the module's compliant flag matches the independent oracle,
        // and a compliant ref has resolved major exactly 24.
        for (let i = 0; i < tagged.length; i++) {
          const ref = report.refs[i];
          expect(ref.filePath).toBe(tagged[i].filePath);
          expect(ref.rawValue).toBe(tagged[i].rawValue);
          expect(ref.compliant).toBe(tagged[i].expectedCompliant);
          if (ref.compliant) {
            expect(ref.resolvedMajor).toBe(24);
          }
        }

        // `offending` contains EXACTLY the non-compliant refs, each carrying its
        // file path and its raw value surfaced as `offendingValue`, in order.
        const expectedOffending = tagged
          .filter((t) => !t.expectedCompliant)
          .map((t) => ({ filePath: t.filePath, offendingValue: t.rawValue }));
        expect(report.offending).toEqual(expectedOffending);

        // `ok` is the biconditional of an empty offending set.
        expect(report.ok).toBe(report.offending.length === 0);
        expect(report.ok).toBe(expectedOffending.length === 0);
      }),
      { numRuns: 100 },
    );
  });

  it("a set of only compliant references reports ok with no offenders", () => {
    const compliantRefArb: fc.Arbitrary<{
      filePath: string;
      kind: NodeRefKind;
      rawValue: string;
    }> = fc.record({
      filePath: filePathArb,
      kind: fc.constantFrom(...KINDS),
      rawValue: fc.constantFrom(...COMPLIANT_VALUES),
    });

    fc.assert(
      fc.property(fc.array(compliantRefArb, { minLength: 0, maxLength: 25 }), (refs) => {
        const report = checkNodeCompliance(refs);
        expect(report.offending).toEqual([]);
        expect(report.ok).toBe(true);
        for (const ref of report.refs) {
          expect(ref.compliant).toBe(true);
          expect(ref.resolvedMajor).toBe(24);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("any non-compliant reference forces ok=false and appears in offending with its filePath + rawValue", () => {
    const nonCompliantRefArb: fc.Arbitrary<{
      filePath: string;
      kind: NodeRefKind;
      rawValue: string;
    }> = fc.record({
      filePath: filePathArb,
      kind: fc.constantFrom(...KINDS),
      rawValue: fc.constantFrom(...NON_COMPLIANT_VALUES),
    });

    fc.assert(
      fc.property(nonCompliantRefArb, (bad) => {
        const report = checkNodeCompliance([bad]);
        expect(report.ok).toBe(false);
        expect(report.offending).toEqual([
          { filePath: bad.filePath, offendingValue: bad.rawValue },
        ]);
        expect(report.refs[0].compliant).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
