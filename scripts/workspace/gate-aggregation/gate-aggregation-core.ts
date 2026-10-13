/**
 * Pure six-gate aggregation core for the dependency-refresh (Phase H).
 *
 * Feature: dependency-refresh-node24 (Requirement 8.7)
 *
 * This module contains ONLY pure, I/O-free functions. It turns a vector of the
 * six quality-gate results (jest, property-based tests, cargo test, type-check,
 * `biome check:ci`, config schema validation) — each carrying an exit code, a
 * failure count, and an error count — into a `GateAggregationReport` that says
 * whether overall verification failed and, if so, exactly which gates failed.
 *
 * There is deliberately no file-scanning / process-exit wrapper shipped here:
 * the six gates are real commands whose exit/failure/error counts are produced
 * by running them (jest `--json`, `cargo test`, `tsc`, `biome check:ci`, the
 * config-schema validator). This module models the pure *aggregation decision*
 * over those recorded results, mirroring the pure-core split (no wrapper) used
 * by `peer-resolution-core.ts` in `scripts/workspace/peer-deps/`. Keeping it
 * pure lets the Property 7 `fast-check` test (task 8.2) import `aggregateGates`
 * directly and drive it over generated six-gate vectors without touching the
 * filesystem or spawning processes.
 *
 * Aggregation contract (design.md "Property 7", Req 8.7):
 *   Each of the six gates carries `{ exitCode, failureCount, errorCount }`. A
 *   gate is FAILING if and only if at least one of those three fields is
 *   non-zero. Overall verification is FAILED if and only if at least one gate is
 *   failing, and every failing gate is reported individually. Crucially, all six
 *   gate fields are evaluated regardless of whether a given gate actually ran in
 *   this pass — a gate that "did not run" still contributes its recorded
 *   exit/failure/error fields (a not-run gate is modelled by all-zero fields, so
 *   it is treated as passing rather than skipped; it is never dropped from the
 *   vector).
 */

/**
 * The canonical identifier of one of the six quality gates. The vector must
 * carry exactly one result per identifier; the identifiers are fixed so the
 * aggregation always evaluates all six fields (Req 8.7).
 */
export type GateName =
  | "jest"
  | "property-based-tests"
  | "cargo-test"
  | "type-check"
  | "biome-check-ci"
  | "config-schema-validation";

/** The six gate names, in canonical order, evaluated on every aggregation. */
export const GATE_NAMES: readonly GateName[] = [
  "jest",
  "property-based-tests",
  "cargo-test",
  "type-check",
  "biome-check-ci",
  "config-schema-validation",
] as const;

/**
 * One gate's recorded result. Each of the three fields is a count/code that is
 * `0` on a clean gate; any non-zero value means the gate failed on that axis.
 *
 * A gate that "did not run" this pass is modelled with all-zero fields
 * (`exitCode: 0, failureCount: 0, errorCount: 0`) — it is still present in the
 * vector and still evaluated, it just contributes nothing to the failure set
 * (Req 8.7's "evaluated over all six fields regardless of whether a gate ran").
 */
export interface GateResult {
  /** The process exit code the gate returned (`0` = clean). */
  exitCode: number;
  /** The number of failing test cases the gate reported (`0` = none). */
  failureCount: number;
  /** The number of errors the gate reported (`0` = none). */
  errorCount: number;
}

/**
 * The six-gate input vector: exactly one `GateResult` per `GateName`. Modelled
 * as a fixed-key record (rather than a free-form map) so every one of the six
 * gate fields is always present and always evaluated (Req 8.7).
 */
export type GateVector = Record<GateName, GateResult>;

/**
 * One failing gate as surfaced to the caller. It names the gate and echoes the
 * three fields so the report shows exactly why the gate failed (which of the
 * exit code / failure count / error count was non-zero).
 */
export interface FailingGate {
  /** The gate that failed. */
  gate: GateName;
  /** The gate's recorded exit code. */
  exitCode: number;
  /** The gate's recorded failure count. */
  failureCount: number;
  /** The gate's recorded error count. */
  errorCount: number;
}

/**
 * The aggregation report, mirroring the `{ ok, ... }` shape of the other
 * pure-core reports (`NodeComplianceReport`, `SharedConsistencyReport`,
 * `ResolutionResult`).
 *
 * `failing` is exactly the set of gates with at least one non-zero field, in
 * canonical gate order, and `ok` is `failing.length === 0` (overall verification
 * passed iff no gate is failing).
 */
export interface GateAggregationReport {
  /** `true` iff no gate is failing (overall verification passed). */
  ok: boolean;
  /** Every failing gate, in canonical `GATE_NAMES` order (empty iff `ok`). */
  failing: FailingGate[];
}

/**
 * Decide whether a single gate result is failing (Req 8.7).
 *
 * Pure. A gate is failing IF AND ONLY IF at least one of its three fields
 * (`exitCode`, `failureCount`, `errorCount`) is non-zero. An all-zero result —
 * including a gate that did not run this pass — is passing.
 */
export function isGateFailing(result: GateResult): boolean {
  return result.exitCode !== 0 || result.failureCount !== 0 || result.errorCount !== 0;
}

/**
 * Aggregate the six quality-gate results into an overall pass/fail report
 * (Req 8.7, Property 7).
 *
 * Pure and I/O-free. Every one of the six gate fields is evaluated regardless of
 * whether the gate ran this pass (a not-run gate is an all-zero result and is
 * therefore treated as passing, never skipped). A gate is failing iff any of its
 * three fields is non-zero; overall verification is FAILED (`ok: false`) iff at
 * least one gate is failing; and every failing gate is reported individually in
 * canonical `GATE_NAMES` order.
 *
 * This is the pure function the Property 7 test drives directly.
 */
export function aggregateGates(vector: GateVector): GateAggregationReport {
  const failing: FailingGate[] = [];

  // Iterate the fixed canonical gate list (not `Object.keys(vector)`) so all six
  // gates are always evaluated in a stable order and a caller cannot cause a
  // gate to be skipped by omitting/reordering keys.
  for (const gate of GATE_NAMES) {
    const result = vector[gate];
    if (isGateFailing(result)) {
      failing.push({
        gate,
        exitCode: result.exitCode,
        failureCount: result.failureCount,
        errorCount: result.errorCount,
      });
    }
  }

  return {
    ok: failing.length === 0,
    failing,
  };
}
