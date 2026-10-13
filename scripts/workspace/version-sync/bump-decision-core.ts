/**
 * Pure version-bump decision core for the dependency-refresh (Phase I).
 *
 * Feature: dependency-refresh-node24 (Requirements 9.1, 9.2, 9.10)
 *
 * This module contains ONLY pure, I/O-free functions. It models the decision
 * the Phase I version bump relies on: given the current live Repo_Version (read
 * by the caller from root `package.json`), a proposed new version, and the
 * state of the bump's prerequisites (all quality gates passing + the installer
 * release workflow passing), decide whether to ACCEPT the bump or REJECT it,
 * and if rejecting, WHICH of the two textually distinct rejection channels
 * applies.
 *
 * There is deliberately no file-reading / process-exit wrapper shipped here:
 * the "current live version" is read from root `package.json` by the caller
 * (the sync tool from task 9.1) and passed in, and the prerequisite state is
 * observed from the gate/release results. This module models the pure
 * *decision + retention semantics* around that state. Keeping the core pure
 * mirrors the `check-node-24-core.ts`, `crate-currency-core.ts`,
 * `shared-consistency-core.ts`, and `peer-resolution-core.ts` splits already
 * used in `scripts/workspace/`, and lets the Property 5 `fast-check` test
 * (task 9.4) import `decideBump` directly and drive it over generated proposed
 * versions and prerequisite states without touching the filesystem.
 *
 * Decision contract (design.md "Property 5" / "Error Handling", Req 9.1 / 9.2 /
 * 9.10):
 *   (a) ACCEPT iff the proposed version is a valid semantic version AND is
 *       strictly greater than the current live version by semantic-version
 *       precedence AND all prerequisites are met (every quality gate passing
 *       and the installer release workflow passing).
 *   (b) When the proposed version is NOT valid semver OR is NOT strictly
 *       greater, REJECT with an `invalid-version-value` indication naming the
 *       offending value, and retain the current version in all files. This
 *       channel is checked FIRST — the value must be valid-and-greater before
 *       prerequisites are even consulted.
 *   (c) When the proposed version IS valid and strictly greater BUT at least
 *       one prerequisite is unmet, REJECT with an `unmet-prerequisite`
 *       indication that states the value was valid and enumerates each unmet
 *       prerequisite, and retain the current version in all files.
 *
 *   The two rejection indications are DISTINCT `kind`s
 *   (`"invalid-version-value"` vs `"unmet-prerequisite"`) and must never be
 *   conflated: an invalid/not-greater value is never reported as an
 *   unmet-prerequisite, and a valid-and-greater value blocked only by a
 *   prerequisite is never reported as an invalid value.
 */

/**
 * A parsed semantic version (MAJOR.MINOR.PATCH plus optional prerelease).
 *
 * Only the fields needed for precedence comparison are retained. `prerelease`
 * is the list of dot-separated identifiers following a `-` (empty for a normal
 * release). Build metadata (after `+`) is intentionally NOT retained because it
 * is ignored for precedence per the semver spec.
 */
interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; empty for a normal release. */
  prerelease: string[];
}

/**
 * A non-negative integer with NO leading zeros (`0`, `1`, `42`, ...) — the
 * shape of each MAJOR/MINOR/PATCH component per the semver 2.0.0 grammar.
 */
const NUMERIC_IDENTIFIER_RE = /^(?:0|[1-9]\d*)$/;

/** A single prerelease identifier: alphanumeric-with-hyphen, or a numeric id. */
const PRERELEASE_IDENTIFIER_RE = /^[0-9A-Za-z-]+$/;

/** A single build-metadata identifier: alphanumeric-with-hyphen. */
const BUILD_IDENTIFIER_RE = /^[0-9A-Za-z-]+$/;

/**
 * A numeric prerelease identifier is valid only without leading zeros
 * (e.g. `1`, `0`, but not `01`). Non-numeric identifiers have no such rule.
 */
function isValidPrereleaseIdentifier(id: string): boolean {
  if (id.length === 0) return false;
  if (!PRERELEASE_IDENTIFIER_RE.test(id)) return false;
  if (/^\d+$/.test(id)) return NUMERIC_IDENTIFIER_RE.test(id);
  return true;
}

/**
 * Parse a strict semantic version string, returning `null` when the value is
 * NOT a valid semver (the `invalid-version-value` trigger). Pure and total.
 *
 * The parse is done structurally (split off build metadata after `+`, then the
 * prerelease after `-`, then the dotted MAJOR.MINOR.PATCH core) rather than via
 * one monolithic regex, keeping each check small and readable while enforcing
 * the full semver 2.0.0 grammar: three no-leading-zero numeric components, an
 * optional dotted prerelease, and optional build metadata.
 *
 * A leading `v` is NOT accepted: Repo_Version fields (`package.json`,
 * `Cargo.toml`, `tauri.conf.json`) carry a bare semantic version, so accepting
 * `v`-prefixed input would let an out-of-spec value through.
 */
export function parseSemVer(value: string): ParsedSemVer | null {
  if (typeof value !== "string" || value.length === 0) return null;

  // Split off build metadata (ignored for precedence but must be well-formed).
  const plusIndex = value.indexOf("+");
  let rest = value;
  if (plusIndex !== -1) {
    const build = value.slice(plusIndex + 1);
    rest = value.slice(0, plusIndex);
    const buildIds = build.split(".");
    if (buildIds.some((id) => !BUILD_IDENTIFIER_RE.test(id))) return null;
  }

  // Split off the prerelease (after the FIRST hyphen following the core).
  const dashIndex = rest.indexOf("-");
  let corePart = rest;
  let prerelease: string[] = [];
  if (dashIndex !== -1) {
    corePart = rest.slice(0, dashIndex);
    const preIds = rest.slice(dashIndex + 1).split(".");
    if (!preIds.every(isValidPrereleaseIdentifier)) return null;
    prerelease = preIds;
  }

  // The core must be exactly MAJOR.MINOR.PATCH, each a no-leading-zero integer.
  const components = corePart.split(".");
  if (components.length !== 3) return null;
  if (!components.every((c) => NUMERIC_IDENTIFIER_RE.test(c))) return null;

  return {
    major: Number.parseInt(components[0], 10),
    minor: Number.parseInt(components[1], 10),
    patch: Number.parseInt(components[2], 10),
    prerelease,
  };
}

/** `true` iff `value` is a valid semantic version string. */
export function isValidSemVer(value: string): boolean {
  return parseSemVer(value) !== null;
}

/**
 * Compare two prerelease identifier lists per semver precedence rule 11.4.
 *
 *   - Numeric identifiers compare numerically.
 *   - Alphanumeric identifiers compare lexically (ASCII order).
 *   - Numeric identifiers always rank lower than alphanumeric ones.
 *   - A larger set of prerelease fields ranks higher when all preceding
 *     identifiers are equal.
 *
 * Returns a negative number if `a < b`, `0` if equal, positive if `a > b`.
 * Callers guarantee at least one list is non-empty (both-empty is handled by
 * the release-vs-release path in `compareSemVer`).
 */
function comparePrerelease(a: string[], b: string[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number.parseInt(ai, 10) - Number.parseInt(bi, 10);
      if (diff !== 0) return diff;
    } else if (aNum !== bNum) {
      // Numeric identifiers have lower precedence than alphanumeric ones.
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  // All shared identifiers equal: the longer prerelease list has higher
  // precedence.
  return a.length - b.length;
}

/**
 * Compare two parsed semantic versions by precedence (semver 2.0.0 §11).
 *
 * MAJOR, then MINOR, then PATCH are compared numerically. When those are equal,
 * a version WITH a prerelease ranks lower than one without; two versions that
 * both have prereleases compare by `comparePrerelease`. Build metadata is
 * ignored (already dropped during parsing).
 *
 * Returns a negative number if `a < b`, `0` if equal, positive if `a > b`.
 */
export function compareSemVer(a: ParsedSemVer, b: ParsedSemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  const aPre = a.prerelease.length > 0;
  const bPre = b.prerelease.length > 0;
  // A normal release has higher precedence than a prerelease of the same
  // MAJOR.MINOR.PATCH.
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (!aPre && !bPre) return 0;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * The state of the bump's prerequisites (design.md "Error Handling", Req 9.1).
 *
 * A bump may only be accepted once EVERY quality gate passes and the installer
 * release workflow passes. Both are modelled as booleans so the pure decision
 * is deterministic and serialisable; the caller sets them from the observed
 * gate-aggregation result and release-run conclusion. Each `false` field
 * contributes one entry to the enumerated `unmet` list on rejection.
 */
export interface PrerequisiteState {
  /** `true` iff all six quality gates passed (see `aggregateGates`). */
  allGatesPassing: boolean;
  /** `true` iff the installer release workflow passed. */
  installerReleasePassing: boolean;
}

/**
 * Stable, human-readable labels for each prerequisite, enumerated verbatim in
 * the `unmet-prerequisite` rejection's `unmet` list (Req 9.10). Exported so the
 * Property 5 test can assert the exact enumeration without duplicating strings.
 */
export const PREREQUISITE_LABELS = {
  allGatesPassing: "all quality gates passing",
  installerReleasePassing: "installer release workflow passing",
} as const;

/**
 * A rejection of the version bump, mirroring the `BumpRejection` data model in
 * design.md. The two variants are DISTINCT `kind`s and must never be conflated
 * (Req 9.2 vs 9.10):
 *
 *   - `invalid-version-value` — the proposed value is not valid semver or not
 *     strictly greater than current. `reason` explains which, and `proposed`
 *     names the offending value.
 *   - `unmet-prerequisite` — the proposed value WAS valid and strictly greater,
 *     but at least one prerequisite is unmet. `unmet` enumerates each unmet
 *     prerequisite (from `PREREQUISITE_LABELS`).
 */
export type BumpRejection =
  | { kind: "invalid-version-value"; proposed: string; reason: string }
  | { kind: "unmet-prerequisite"; proposed: string; unmet: string[] };

/**
 * The accept outcome of the bump decision: the proposed value is valid,
 * strictly greater than current, and every prerequisite is met.
 */
export interface BumpAccept {
  kind: "accept";
  /** The accepted target version (byte-identical to `proposed`). */
  target: string;
}

/** The full decision result: either an accept or one of the two rejections. */
export type BumpDecision = BumpAccept | BumpRejection;

/** The inputs to `decideBump`, kept fully explicit so the core reads no I/O. */
export interface BumpDecisionInput {
  /** The current live Repo_Version, as read from root `package.json`. */
  current: string;
  /** The proposed new Repo_Version to bump to. */
  proposed: string;
  /** The observed state of the bump's prerequisites. */
  prerequisites: PrerequisiteState;
}

/**
 * Enumerate the unmet prerequisites (in a stable order) from a
 * `PrerequisiteState`. Empty iff all prerequisites are met.
 */
function unmetPrerequisites(state: PrerequisiteState): string[] {
  const unmet: string[] = [];
  if (!state.allGatesPassing) unmet.push(PREREQUISITE_LABELS.allGatesPassing);
  if (!state.installerReleasePassing) unmet.push(PREREQUISITE_LABELS.installerReleasePassing);
  return unmet;
}

/**
 * Decide whether to accept or reject a proposed version bump (Req 9.1 / 9.2 /
 * 9.10, Property 5).
 *
 * Pure and I/O-free. The decision proceeds in two ordered stages so the two
 * rejection channels stay distinct and never conflate:
 *
 *   1. VALUE stage — the proposed value must be valid semver AND strictly
 *      greater than `current` by semver precedence. If not, return an
 *      `invalid-version-value` rejection naming the offending value (the
 *      current version is retained in all files). Prerequisites are NOT
 *      consulted at this stage.
 *   2. PREREQUISITE stage — the value is known valid and greater. If any
 *      prerequisite is unmet, return an `unmet-prerequisite` rejection stating
 *      the value was valid and enumerating each unmet prerequisite (current
 *      retained). Otherwise ACCEPT with the proposed value as the target.
 *
 * Because stage 1 fully decides validity before stage 2 is reached, an
 * invalid/not-greater value can never surface as `unmet-prerequisite`, and a
 * valid-and-greater value blocked only by a prerequisite can never surface as
 * `invalid-version-value`.
 */
export function decideBump(input: BumpDecisionInput): BumpDecision {
  const { current, proposed, prerequisites } = input;

  const parsedProposed = parseSemVer(proposed);
  if (parsedProposed === null) {
    return {
      kind: "invalid-version-value",
      proposed,
      reason: `Proposed version "${proposed}" is not a valid semantic version; retaining current version "${current}".`,
    };
  }

  const parsedCurrent = parseSemVer(current);
  // If the current version cannot be parsed we cannot establish "strictly
  // greater", so the proposed value cannot be shown valid-and-greater: reject
  // through the value channel rather than silently accepting.
  if (parsedCurrent === null || compareSemVer(parsedProposed, parsedCurrent) <= 0) {
    return {
      kind: "invalid-version-value",
      proposed,
      reason:
        parsedCurrent === null
          ? `Current version "${current}" is not a valid semantic version; cannot establish that "${proposed}" is strictly greater. Retaining current version.`
          : `Proposed version "${proposed}" is not strictly greater than the current version "${current}" by semantic-version precedence; retaining current version.`,
    };
  }

  // The value is valid and strictly greater. Now (and only now) consult the
  // prerequisites — a distinct rejection channel.
  const unmet = unmetPrerequisites(prerequisites);
  if (unmet.length > 0) {
    return {
      kind: "unmet-prerequisite",
      proposed,
      unmet,
    };
  }

  return { kind: "accept", target: proposed };
}
