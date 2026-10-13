// Feature: dependency-refresh-node24, Property 7: Gate aggregation fails if any gate fails

/**
 * Feature: dependency-refresh-node24
 * Property 7: Gate aggregation fails if any gate fails
 *
 * For all six-gate status vectors, `aggregateGates` SHALL report overall
 * verification as FAILED (`ok: false`) IF AND ONLY IF at least one gate is
 * failing, where a gate is failing IF AND ONLY IF at least one of its three
 * fields (`exitCode`, `failureCount`, `errorCount`) is non-zero. Every failing
 * gate SHALL be reported individually — echoing its gate name and its three
 * recorded fields — in canonical `GATE_NAMES` order, and all six gate fields
 * SHALL be evaluated regardless of whether a gate actually ran this pass (a
 * not-run gate is an all-zero result, treated as passing rather than skipped).
 *
 * Validates: Requirements 8.7
 * Design: Property 7
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `aggregateGates` is the pure six-gate aggregation core. This test drives the
 * REAL function (imported from `gate-aggregation-core` with no `.ts` extension
 * so ts-jest / CommonJS resolves it, and with NO mocks) over generated six-gate
 * vectors that mix zero and non-zero exit/failure/error fields.
 *
 * The verdict is derived from an INDEPENDENT oracle (`oracleFailing` below),
 * hand-written straight from the acceptance criteria — a gate fails iff ANY of
 * its three fields is non-zero — rather than by re-calling the module's own
 * `isGateFailing`. We then assert the function agrees exactly: `ok` is the
 * biconditional of an empty failing list; a gate appears in `failing` iff the
 * oracle says it fails; each failing entry echoes the gate name plus its three
 * fields; and `failing` is in canonical `GATE_NAMES` order.
 */

import * as fc from "fast-check";
import {
  aggregateGates,
  GATE_NAMES,
  type GateName,
  type GateResult,
  type GateVector,
} from "./gate-aggregation-core";

/**
 * Independent oracle: decide, straight from the acceptance criteria, whether a
 * single gate result is failing. A gate fails IF AND ONLY IF at least one of its
 * three fields is non-zero. This deliberately does not call the module's own
 * `isGateFailing`.
 */
function oracleFailing(result: GateResult): boolean {
  return result.exitCode !== 0 || result.failureCount !== 0 || result.errorCount !== 0;
}

/**
 * A single field value arbitrary that emits zero often enough (so clean gates
 * and all-clean vectors are well-represented) alongside a spread of non-zero
 * codes/counts (including negatives, which are still "non-zero" = failing).
 */
const fieldArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 3, arbitrary: fc.integer({ min: -5, max: 255 }) },
);

/** One gate result: three independently-generated fields. */
const gateResultArb: fc.Arbitrary<GateResult> = fc.record({
  exitCode: fieldArb,
  failureCount: fieldArb,
  errorCount: fieldArb,
});

/** A full six-gate vector: exactly one generated result per canonical gate. */
const gateVectorArb: fc.Arbitrary<GateVector> = fc
  .tuple(...GATE_NAMES.map(() => gateResultArb))
  .map((results) => Object.fromEntries(GATE_NAMES.map((g, i) => [g, results[i]])) as GateVector);

describe("Feature: dependency-refresh-node24, Property 7: Gate aggregation fails if any gate fails", () => {
  it("ok iff every gate all-zero; failing lists exactly the non-zero gates (name + 3 fields) in canonical order", () => {
    fc.assert(
      fc.property(gateVectorArb, (vector) => {
        const report = aggregateGates(vector);

        // The set of gates the oracle deems failing, in canonical order.
        const expectedFailingGates: GateName[] = GATE_NAMES.filter((g) => oracleFailing(vector[g]));

        // (1) `ok` iff every gate has all-zero fields (i.e. none failing).
        expect(report.ok).toBe(expectedFailingGates.length === 0);
        // `ok` is also the biconditional of an empty failing list.
        expect(report.ok).toBe(report.failing.length === 0);

        // (2)/(4) A gate appears in `failing` iff any field is non-zero, and the
        // list is in canonical GATE_NAMES order.
        expect(report.failing.map((f) => f.gate)).toEqual(expectedFailingGates);

        // (3) Each failing entry echoes the gate name + its three fields exactly
        // as recorded in the input vector.
        for (const entry of report.failing) {
          const source = vector[entry.gate];
          expect(entry.exitCode).toBe(source.exitCode);
          expect(entry.failureCount).toBe(source.failureCount);
          expect(entry.errorCount).toBe(source.errorCount);
          // And the echoed gate is genuinely failing per the oracle.
          expect(oracleFailing(source)).toBe(true);
        }

        // Symmetry: every gate the oracle deems passing is absent from `failing`.
        const reportedGates = new Set(report.failing.map((f) => f.gate));
        for (const g of GATE_NAMES) {
          if (!oracleFailing(vector[g])) {
            expect(reportedGates.has(g)).toBe(false);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("an all-clean vector (including not-run gates modelled all-zero) reports ok with no failing gates", () => {
    const clean: GateVector = Object.fromEntries(
      GATE_NAMES.map((g) => [g, { exitCode: 0, failureCount: 0, errorCount: 0 }]),
    ) as GateVector;

    const report = aggregateGates(clean);
    expect(report.ok).toBe(true);
    expect(report.failing).toEqual([]);
  });

  it("any single gate with one non-zero field forces ok=false and reports exactly that gate", () => {
    // Pick which gate fails, which of its three fields is non-zero, and the
    // (non-zero) value; every other gate stays clean.
    const scenarioArb = fc.record({
      failingGate: fc.constantFrom(...GATE_NAMES),
      field: fc.constantFrom<keyof GateResult>("exitCode", "failureCount", "errorCount"),
      value: fc.integer({ min: -5, max: 255 }).filter((n) => n !== 0),
    });

    fc.assert(
      fc.property(scenarioArb, ({ failingGate, field, value }) => {
        const vector = Object.fromEntries(
          GATE_NAMES.map((g) => [g, { exitCode: 0, failureCount: 0, errorCount: 0 }]),
        ) as GateVector;
        vector[failingGate] = { ...vector[failingGate], [field]: value };

        const report = aggregateGates(vector);
        expect(report.ok).toBe(false);
        expect(report.failing).toHaveLength(1);
        expect(report.failing[0].gate).toBe(failingGate);
        expect(report.failing[0][field]).toBe(value);
      }),
      { numRuns: 200 },
    );
  });
});
