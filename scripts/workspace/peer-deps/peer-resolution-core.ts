/**
 * Pure peer-dependency resolution reporter for the dependency-refresh (Phase F).
 *
 * Feature: dependency-refresh-node24 (Requirements 6.2, 6.3)
 *
 * This module contains ONLY pure, I/O-free functions. It models the
 * resolution-time peer-dependency decision the refresh relies on: given the set
 * of peer-dependency conflicts detected for a proposed upgrade set, decide
 * whether the upgrade set resolves cleanly (`ok`) or must be REJECTED, and
 * enumerate each conflict as a `{ dependency, workspace }` pair for reporting.
 *
 * There is deliberately no file-scanning / process-exit wrapper shipped here:
 * peer-dependency conflicts are surfaced by npm at install time (see
 * design.md "Error Handling"), so the runtime "detector" is npm itself. This
 * module models the pure *decision + retention semantics* around that
 * detection — the reject-and-enumerate channel from design.md's
 * retain-and-remediate control loop. Keeping it pure mirrors the
 * `check-node-24-core.ts`, `crate-currency-core.ts`, and
 * `shared-consistency-core.ts` splits already used in `scripts/workspace/`, and
 * lets the Property 3 `fast-check` test (task 6.5) import `resolvePeerDeps`
 * directly and drive it over generated conflict sets without touching the
 * filesystem.
 *
 * Resolution contract (design.md "Property 3", Req 6.2 / 6.3):
 *   The result is `ok` IF AND ONLY IF its conflict set is empty. Whenever the
 *   conflict set is non-empty the outcome is a REJECTION: the upgrade set is
 *   rejected, prior versions are retained unchanged (`retainedPriorVersions`),
 *   and the report enumerates EXACTLY each conflict as a `{ dependency,
 *   workspace }` pair (the full `PeerConflict` may additionally carry
 *   `requiredBy` / `conflictWith` context). An empty conflict set accepts the
 *   upgrade set and retains nothing.
 */

/**
 * A single peer-dependency conflict detected for a proposed upgrade set,
 * mirroring the `PeerConflict` data model in design.md.
 *
 * `dependency` and `workspace` are the mandatory identifying pair the report
 * must enumerate (Req 6.3). `requiredBy` / `conflictWith` carry the additional
 * context npm surfaces (the package that pulled in the peer requirement and the
 * version it clashed with); they are optional so a caller that only has the
 * `{ dependency, workspace }` pair can still model a conflict.
 */
export interface PeerConflict {
  /** The workspace whose install surfaced the conflict (e.g. `"Memory"`). */
  workspace: string;
  /** The dependency whose peer requirement could not be satisfied. */
  dependency: string;
  /** The package that required the conflicting peer (optional context). */
  requiredBy?: string;
  /** The version/spec the requirement clashed with (optional context). */
  conflictWith?: string;
}

/**
 * The `{ dependency, workspace }` pair the rejection report enumerates for each
 * conflict (Req 6.3). This is the minimal identifying shape Property 3 asserts
 * the report contains "exactly" one of per conflict.
 */
export interface ConflictPair {
  dependency: string;
  workspace: string;
}

/**
 * The input to `resolvePeerDeps`: a proposed upgrade set plus the peer-
 * dependency conflicts detected for it.
 *
 * Modelling the resolution as a pure function of `(upgradeSet, conflicts)`
 * keeps the reject-and-retain behavior deterministic and serialisable: the
 * detection of conflicts is done upstream (by npm at install time), and this
 * function decides the OUTCOME. `upgradeSet` is the set of proposed dependency
 * upgrades under consideration; on rejection it is the set that gets rejected.
 * `priorVersions` records the versions in place BEFORE the proposed upgrade, so
 * the result can echo the retained versions on rejection (Req 6.3's "retain the
 * prior dependency versions unchanged").
 */
export interface ResolutionInput {
  /**
   * The proposed upgrades under consideration, as `dependency -> version`.
   * This is the "upgrade set" that is accepted or rejected atomically.
   */
  upgradeSet: Readonly<Record<string, string>>;
  /**
   * The versions in place before the proposed upgrade, as `dependency ->
   * version`. Retained unchanged when the upgrade set is rejected.
   */
  priorVersions: Readonly<Record<string, string>>;
  /**
   * The peer-dependency conflicts detected for the proposed upgrade set. An
   * empty list means the set resolves cleanly.
   */
  conflicts: ReadonlyArray<PeerConflict>;
}

/**
 * The outcome of a peer-dependency resolution, extending the design.md
 * `ResolutionResult` with the retention detail needed to prove the
 * reject-and-retain semantics.
 *
 * `ok` is `true` IF AND ONLY IF `conflicts` is empty. On rejection
 * (`ok: false`), `rejectedUpgradeSet` names the upgrade set that was rejected
 * and `retainedPriorVersions` holds the byte-identical prior versions that stay
 * in place; on acceptance both retention fields are empty because nothing is
 * rejected or rolled back.
 */
export interface ResolutionResult {
  /** `true` iff `conflicts` is empty (the upgrade set resolves cleanly). */
  ok: boolean;
  /**
   * The conflicts carried forward for reporting, each enumerated as a
   * `{ dependency, workspace }` pair (Req 6.3). Empty iff `ok`.
   */
  conflicts: ConflictPair[];
  /**
   * The upgrade set rejected on conflict (empty when `ok`). Because rejection
   * is atomic, this is the whole proposed set, not a subset.
   */
  rejectedUpgradeSet: Record<string, string>;
  /**
   * The prior versions retained unchanged on rejection (empty when `ok`),
   * proving no version was advanced when the set was rejected (Req 6.3).
   */
  retainedPriorVersions: Record<string, string>;
}

/**
 * Resolve a proposed peer-dependency upgrade set (Req 6.2 / 6.3, Property 3).
 *
 * Pure and I/O-free. The result is `ok` IF AND ONLY IF the detected conflict
 * set is empty:
 *
 *   - Empty conflicts  -> ACCEPT. `ok: true`, `conflicts: []`, and both
 *     retention fields empty (nothing is rejected).
 *   - Non-empty conflicts -> REJECT atomically. `ok: false`; the whole
 *     `upgradeSet` is echoed as `rejectedUpgradeSet`; `priorVersions` is echoed
 *     byte-identically as `retainedPriorVersions` (prior versions retained
 *     unchanged); and each conflict is enumerated EXACTLY once as a
 *     `{ dependency, workspace }` pair.
 *
 * This is the pure function the Property 3 test drives directly.
 */
export function resolvePeerDeps(input: ResolutionInput): ResolutionResult {
  const { upgradeSet, priorVersions, conflicts } = input;
  const ok = conflicts.length === 0;

  if (ok) {
    return {
      ok: true,
      conflicts: [],
      rejectedUpgradeSet: {},
      retainedPriorVersions: {},
    };
  }

  // Non-empty conflicts => reject the upgrade set atomically and retain prior
  // versions unchanged. Enumerate each conflict as exactly one { dependency,
  // workspace } pair (preserving order and multiplicity of the detected set).
  return {
    ok: false,
    conflicts: conflicts.map((c) => ({ dependency: c.dependency, workspace: c.workspace })),
    rejectedUpgradeSet: { ...upgradeSet },
    retainedPriorVersions: { ...priorVersions },
  };
}
