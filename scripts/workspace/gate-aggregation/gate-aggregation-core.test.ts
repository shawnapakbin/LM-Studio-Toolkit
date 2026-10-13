// Unit/example tests for the pure six-gate aggregation core.
//
// Feature: dependency-refresh-node24
// Source of truth: scripts/workspace/gate-aggregation/gate-aggregation-core.ts
//
// These are focused, example-based unit tests for `aggregateGates` /
// `isGateFailing`. The exhaustive over-all-inputs assertion lives in the
// Property 7 `fast-check` test (task 8.2); here we pin the specific, meaningful
// cases from Req 8.7: an all-clean vector passes, any single non-zero field on
// any gate fails, every failing gate is reported individually, and a "did not
// run" (all-zero) gate is evaluated as passing rather than skipped.
//
// **Validates: Requirements 8.7**

import {
  aggregateGates,
  GATE_NAMES,
  type GateName,
  type GateResult,
  type GateVector,
  isGateFailing,
} from "./gate-aggregation-core";

/** A clean (passing) gate result: every field zero. */
const CLEAN: GateResult = { exitCode: 0, failureCount: 0, errorCount: 0 };

/** Build a six-gate vector where every gate is clean, then apply overrides. */
function vector(overrides: Partial<Record<GateName, GateResult>> = {}): GateVector {
  const base = Object.fromEntries(GATE_NAMES.map((g) => [g, { ...CLEAN }])) as GateVector;
  return { ...base, ...overrides };
}

describe("Feature: dependency-refresh-node24 — six-gate aggregation (Req 8.7)", () => {
  describe("isGateFailing", () => {
    it("treats an all-zero result (including a not-run gate) as passing", () => {
      expect(isGateFailing({ exitCode: 0, failureCount: 0, errorCount: 0 })).toBe(false);
    });

    it("fails on a non-zero exit code alone", () => {
      expect(isGateFailing({ exitCode: 1, failureCount: 0, errorCount: 0 })).toBe(true);
    });

    it("fails on a non-zero failure count alone", () => {
      expect(isGateFailing({ exitCode: 0, failureCount: 3, errorCount: 0 })).toBe(true);
    });

    it("fails on a non-zero error count alone", () => {
      expect(isGateFailing({ exitCode: 0, failureCount: 0, errorCount: 2 })).toBe(true);
    });
  });

  describe("aggregateGates", () => {
    it("reports ok with no failing gates when all six gates are clean", () => {
      const report = aggregateGates(vector());
      expect(report.ok).toBe(true);
      expect(report.failing).toEqual([]);
    });

    it("fails overall and names the gate when a single gate's exit code is non-zero", () => {
      const report = aggregateGates(
        vector({ jest: { exitCode: 1, failureCount: 0, errorCount: 0 } }),
      );
      expect(report.ok).toBe(false);
      expect(report.failing).toEqual([
        { gate: "jest", exitCode: 1, failureCount: 0, errorCount: 0 },
      ]);
    });

    it("fails overall on a non-zero failure count with a clean exit code", () => {
      const report = aggregateGates(
        vector({ "cargo-test": { exitCode: 0, failureCount: 2, errorCount: 0 } }),
      );
      expect(report.ok).toBe(false);
      expect(report.failing).toEqual([
        { gate: "cargo-test", exitCode: 0, failureCount: 2, errorCount: 0 },
      ]);
    });

    it("fails overall on a non-zero error count with a clean exit code and failure count", () => {
      const report = aggregateGates(
        vector({ "type-check": { exitCode: 0, failureCount: 0, errorCount: 5 } }),
      );
      expect(report.ok).toBe(false);
      expect(report.failing).toEqual([
        { gate: "type-check", exitCode: 0, failureCount: 0, errorCount: 5 },
      ]);
    });

    it("reports every failing gate individually, in canonical order", () => {
      const report = aggregateGates(
        vector({
          // Intentionally out of canonical order in the overrides object to
          // prove the report is ordered by GATE_NAMES, not insertion order.
          "config-schema-validation": { exitCode: 0, failureCount: 0, errorCount: 1 },
          "biome-check-ci": { exitCode: 1, failureCount: 0, errorCount: 0 },
          "property-based-tests": { exitCode: 0, failureCount: 7, errorCount: 0 },
        }),
      );
      expect(report.ok).toBe(false);
      expect(report.failing.map((f) => f.gate)).toEqual([
        "property-based-tests",
        "biome-check-ci",
        "config-schema-validation",
      ]);
    });

    it("reports all six gates when every gate fails", () => {
      const failEach = Object.fromEntries(
        GATE_NAMES.map((g) => [g, { exitCode: 1, failureCount: 0, errorCount: 0 }]),
      ) as GateVector;
      const report = aggregateGates(failEach);
      expect(report.ok).toBe(false);
      expect(report.failing.map((f) => f.gate)).toEqual([...GATE_NAMES]);
    });

    it("still passes overall when several gates 'did not run' (all-zero) and the rest are clean", () => {
      // A not-run gate contributes all-zero fields; it must be evaluated as
      // passing, not skipped, and must not flip overall verification to failed.
      const report = aggregateGates(
        vector({
          jest: { ...CLEAN },
          "cargo-test": { ...CLEAN },
          "biome-check-ci": { ...CLEAN },
        }),
      );
      expect(report.ok).toBe(true);
      expect(report.failing).toEqual([]);
    });

    it("evaluates all six gate fields even when a not-run gate sits beside a failing one", () => {
      // biome-check-ci did not run (all-zero) but cargo-test failed: overall
      // fails, and only the truly-failing gate is reported.
      const report = aggregateGates(
        vector({
          "biome-check-ci": { ...CLEAN },
          "cargo-test": { exitCode: 0, failureCount: 0, errorCount: 4 },
        }),
      );
      expect(report.ok).toBe(false);
      expect(report.failing).toEqual([
        { gate: "cargo-test", exitCode: 0, failureCount: 0, errorCount: 4 },
      ]);
    });
  });
});
