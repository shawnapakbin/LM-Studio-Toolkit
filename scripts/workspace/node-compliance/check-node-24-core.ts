/**
 * Pure Node-version-compliance core for the dependency-refresh (Phase B).
 *
 * Feature: dependency-refresh-node24 (Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7)
 *
 * This module contains ONLY pure, I/O-free functions. It turns a set of already
 * extracted Node version references into a `NodeComplianceReport`, deciding for
 * each reference whether it targets Node 24 within the required bounds. The
 * file-scanning / process-exit wrapper lives in `check-node-24.ts`, mirroring
 * the `baseline-core.ts` / `capture-baseline.ts` split already used in
 * `scripts/workspace/baseline/`.
 *
 * Keeping the core pure means:
 *   - the scanning CLI (`check-node-24.ts`) reuses the exact compliance
 *     decision, and
 *   - the Property 1 `fast-check` test (task 2.5) can import
 *     `checkNodeCompliance` and property-test it over generated reference sets
 *     without touching the filesystem.
 *
 * Compliance contract (design.md "Node version reference" data model, Req 1.7):
 *   A reference is compliant IFF its resolved major version equals 24 AND its
 *   bounds admit no version below 24.0.0 and no version at or above 25.0.0.
 *   The report's `offending` list contains exactly the non-compliant references,
 *   each carrying its `filePath` and `rawValue`.
 */

/** The kind of source a Node version reference was extracted from. */
export type NodeRefKind = "engines" | "nvmrc" | "setup-node" | "dockerfile" | "tool-config";

/**
 * One Node version reference, mirroring design.md's `NodeVersionRef` data model.
 *
 * `resolvedMajor` is the parsed major version (or `null` when the raw value
 * cannot be parsed), and `compliant` is `resolvedMajor === 24` AND the bounds
 * satisfy the Node-24 window `[24.0.0, 25.0.0)`.
 */
export interface NodeVersionRef {
  /** Where the reference lives (repo-relative path). */
  filePath: string;
  kind: NodeRefKind;
  /** e.g. `">=24.0.0 <25.0.0"`, `"24"`, `"24.x"`, `"v24.3.0"`. */
  rawValue: string;
  /** Parsed major version; `null` when unparseable. */
  resolvedMajor: number | null;
  /** `resolvedMajor === 24` AND bounds admit only versions in `[24.0.0, 25.0.0)`. */
  compliant: boolean;
}

/** A single offending reference as surfaced to the caller (Req 1.7). */
export interface OffendingRef {
  filePath: string;
  offendingValue: string;
}

/**
 * The compliance report, mirroring design.md's `NodeComplianceReport`.
 *
 * `refs` is the full set of evaluated references (each already carrying its
 * `resolvedMajor` and `compliant` flag as decided by `evaluateRef`), `offending`
 * is exactly the non-compliant subset, and `ok` is `offending.length === 0`.
 */
export interface NodeComplianceReport {
  refs: NodeVersionRef[];
  offending: OffendingRef[];
  ok: boolean;
}

/** The Node major this refresh standardizes on. */
export const TARGET_NODE_MAJOR = 24;

/**
 * Parse the major version implied by a raw Node version reference.
 *
 * Handles the common forms found across the repo's Node references:
 *   - a plain major / partial version: `"24"`, `"24.3"`, `"24.3.1"`, `"24.x"`
 *   - a `v`-prefixed version (as `.nvmrc` / node output may carry): `"v24.3.0"`
 *   - a range whose bounds are read by `boundsAreNode24Only` — for a range we
 *     return the LOWER bound's major (the range is only compliant when the
 *     bounds check also passes, so the major here is used for reporting).
 *
 * Returns `null` when no leading numeric major can be extracted.
 */
export function parseMajor(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return null;

  // First numeric token in the string, optionally `v`-prefixed and optionally
  // preceded by a range operator (>=, >, ^, ~, =). This yields the lower/leading
  // version's major, which is what the resolved-major field records.
  const match = /(?:^|[\s><=^~])v?(\d+)/i.exec(trimmed);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * Decide whether a raw version value's bounds admit ONLY Node 24 versions —
 * i.e. no version below 24.0.0 and no version at or above 25.0.0 (Req 1.1/1.2).
 *
 * The two shapes the repo uses:
 *   - Exact / partial pin (`"24"`, `"24.x"`, `"v24.3.0"`): compliant on bounds
 *     iff its single major is 24. A bare `"24"` or `"24.x"` cannot resolve
 *     outside the 24.x line, so its bounds are inside the window.
 *   - Range (`">=24.0.0 <25.0.0"`): compliant iff every comparator keeps the
 *     admissible set within `[24.0.0, 25.0.0)`. Concretely: a lower bound of
 *     `>=24.0.0` (or `>24.x` at major 24) and an upper bound strictly below
 *     `25.0.0` (`<25.0.0`, or `<=24.x`). An open-ended range (no upper bound,
 *     or an upper bound of `<25.1.0` etc.) admits 25.x and is NOT compliant;
 *     a lower bound below 24 (`>=23…`, `>=20…`) admits sub-24 and is NOT
 *     compliant.
 */
export function boundsAreNode24Only(rawValue: string): boolean {
  const value = rawValue.trim();
  if (value.length === 0) return false;

  // A range contains a comparator operator (>, <, >=, <=) or the OR `||`.
  const isRange = /[<>]|\|\|/.test(value);

  if (!isRange) {
    // Exact / partial pin (`24`, `24.x`, `24.3.1`, `v24.3.1`, `^24.x`, `~24.3`).
    // All of these stay within [24.0.0, 25.0.0) exactly when their single major
    // is 24: `^24`/`~24` cap below 25.0.0, and a bare `24`/`24.x` cannot resolve
    // outside the 24 line. A `^25`/`~23` fails on the major check.
    return parseMajor(value) === TARGET_NODE_MAJOR;
  }

  // Range: a disjunction (`||`) widens the admissible set beyond a single
  // window, so it is never compliant.
  if (value.includes("||")) return false;

  return rangeComparatorsAreNode24Only(value);
}

/** Which side(s) of the [24, 25) window one comparator constrains, and whether it satisfies them. */
interface BoundContribution {
  lowerOk: boolean;
  lowerBad: boolean;
  upperOk: boolean;
  upperBad: boolean;
}

const NO_CONTRIBUTION: BoundContribution = {
  lowerOk: false,
  lowerBad: false,
  upperOk: false,
  upperBad: false,
};

/**
 * Classify a single range comparator (e.g. `>=24.0.0`, `<25.0.0`, `=24.0.0`)
 * into its contribution to the lower/upper bound of the [24.0.0, 25.0.0) window.
 */
function classifyComparator(comparator: string): BoundContribution {
  const op = /^(>=|<=|>|<|=)?/.exec(comparator)?.[1] ?? "=";
  const major = parseMajor(comparator);
  if (major === null) return NO_CONTRIBUTION;

  if (op === ">=" || op === ">") {
    // Lower bound. OK iff it keeps the floor at exactly 24 (admits nothing
    // below 24.0.0). `>=24…` / `>24…` both keep the floor at 24.
    const ok = major === TARGET_NODE_MAJOR;
    return { lowerOk: ok, lowerBad: !ok, upperOk: false, upperBad: false };
  }
  if (op === "<=" || op === "<") {
    // Upper bound. OK iff it admits nothing at or above 25.0.0: `<25.x`
    // (strict, major 25) or any `<=`/`<` capped at major <= 24.
    const capsBelow25 =
      (op === "<" && major === TARGET_NODE_MAJOR + 1) || major <= TARGET_NODE_MAJOR;
    return { lowerOk: false, lowerBad: false, upperOk: capsBelow25, upperBad: !capsBelow25 };
  }
  // A bare `=24.0.0` acts as both a floor and a ceiling at 24.
  const ok = major === TARGET_NODE_MAJOR;
  return { lowerOk: ok, lowerBad: !ok, upperOk: ok, upperBad: !ok };
}

/** Whether every comparator in a conjunctive range keeps the set in [24, 25). */
function rangeComparatorsAreNode24Only(value: string): boolean {
  const comparators = value.split(/\s+|&&/).filter((c) => c.length > 0);

  let hasLowerBoundOk = false;
  let hasUpperBoundOk = false;
  let hasLowerBoundBad = false;
  let hasUpperBoundBad = false;

  for (const comparator of comparators) {
    const c = classifyComparator(comparator);
    hasLowerBoundOk ||= c.lowerOk;
    hasLowerBoundBad ||= c.lowerBad;
    hasUpperBoundOk ||= c.upperOk;
    hasUpperBoundBad ||= c.upperBad;
  }

  // Compliant only when BOTH bounds are present and satisfied, and neither bound
  // is violated. A missing upper bound (open-ended range) admits 25.x => not ok.
  return hasLowerBoundOk && hasUpperBoundOk && !hasLowerBoundBad && !hasUpperBoundBad;
}

/**
 * Evaluate a single reference's `resolvedMajor` and `compliant` fields from its
 * `filePath`, `kind`, and `rawValue`.
 *
 * A reference is compliant IFF its resolved major is 24 AND its bounds admit
 * only versions in `[24.0.0, 25.0.0)` (Req 1.7).
 */
export function evaluateRef(input: {
  filePath: string;
  kind: NodeRefKind;
  rawValue: string;
}): NodeVersionRef {
  const resolvedMajor = parseMajor(input.rawValue);
  const compliant = resolvedMajor === TARGET_NODE_MAJOR && boundsAreNode24Only(input.rawValue);
  return {
    filePath: input.filePath,
    kind: input.kind,
    rawValue: input.rawValue,
    resolvedMajor,
    compliant,
  };
}

/**
 * Build the `NodeComplianceReport` from a set of Node version references.
 *
 * Each input reference is evaluated (its `resolvedMajor` / `compliant` fields
 * are recomputed here so the report is self-consistent regardless of whatever
 * the caller pre-filled). `offending` contains exactly the references whose
 * evaluation is non-compliant, each surfaced as `{ filePath, offendingValue }`,
 * and `ok` is true iff `offending` is empty (Req 1.7).
 *
 * This is the pure function the Property 1 test drives directly.
 */
export function checkNodeCompliance(
  refs: ReadonlyArray<{ filePath: string; kind: NodeRefKind; rawValue: string }>,
): NodeComplianceReport {
  const evaluated = refs.map(evaluateRef);
  const offending: OffendingRef[] = evaluated
    .filter((ref) => !ref.compliant)
    .map((ref) => ({ filePath: ref.filePath, offendingValue: ref.rawValue }));

  return {
    refs: evaluated,
    offending,
    ok: offending.length === 0,
  };
}
