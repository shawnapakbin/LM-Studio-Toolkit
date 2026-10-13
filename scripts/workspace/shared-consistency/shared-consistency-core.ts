/**
 * Pure shared-dependency version-consistency core for the dependency-refresh
 * (Phase F).
 *
 * Feature: dependency-refresh-node24 (Requirements 3.3, 6.5, 6.6)
 *
 * This module contains ONLY pure, I/O-free functions. It turns a table of, per
 * dependency, the set of `(workspace, range)` declarations into a
 * `SharedConsistencyReport`, deciding for every dependency declared by two or
 * more workspaces whether all declarers agree on a byte-identical range.
 *
 * The file-scanning / process-exit wrapper (reading each workspace's
 * `package.json` `dependencies` + `devDependencies`) lives in
 * `check-shared-consistency.ts`, mirroring the
 * `check-node-24-core.ts` / `check-node-24.ts` and
 * `crate-currency-core.ts` / `check-crate-currency.ts` splits already used in
 * `scripts/workspace/`.
 *
 * Keeping the core pure means:
 *   - the scanning CLI (`check-shared-consistency.ts`) reuses the exact
 *     consistency decision, and
 *   - the Property 2 `fast-check` test (task 6.3) can import
 *     `checkSharedConsistency` and property-test it over generated
 *     workspace/dependency/range tables without touching the filesystem.
 *
 * Consistency contract (design.md "Property 2", Req 3.3 / 6.5 / 6.6):
 *   A dependency is SHARED when it is declared by two or more workspaces. A
 *   shared dependency is INCONSISTENT if and only if at least two of its
 *   declarers record different ranges. When inconsistent, the report names each
 *   divergent declaring workspace together with the range it recorded. A
 *   dependency declared by fewer than two workspaces is never shared and is
 *   therefore never reported. `ok` is true iff no shared dependency is
 *   inconsistent.
 */

/** One workspace's declaration of a dependency's version range. */
export interface Declaration {
  /** The declaring workspace (e.g. `"Memory"`, `"CLI"`). */
  workspace: string;
  /** The version range the workspace declared (e.g. `"^12.6.2"`). */
  range: string;
}

/**
 * The input table: for each dependency name, the set of `(workspace, range)`
 * declarations recorded across the monorepo. The map value is the list of
 * declarers for that dependency.
 *
 * Modelled as a plain record so it is trivially serialisable and easy to
 * generate in the Property 2 test. A workspace SHOULD appear at most once per
 * dependency (a `package.json` cannot declare the same dependency twice in the
 * same section); when the same workspace appears more than once for a
 * dependency, every occurrence is considered on its own for divergence.
 */
export type DependencyTable = Record<string, ReadonlyArray<Declaration>>;

/**
 * A single inconsistent shared dependency, as surfaced to the caller
 * (Req 6.5 / 6.6). It names the dependency and every declaring workspace with
 * the range it recorded, so the caller can see exactly which declarers diverge.
 */
export interface InconsistentDependency {
  /** The dependency name (e.g. `"better-sqlite3"`). */
  dependency: string;
  /**
   * Every declaring workspace and the range it recorded. Sorted by workspace
   * name for stable reporting. Because the dependency is only reported when it
   * is inconsistent, at least two of these ranges differ.
   */
  declarers: Declaration[];
  /** The distinct ranges recorded across the declarers, for a compact summary. */
  distinctRanges: string[];
}

/**
 * The consistency report, mirroring the shape of the other pure-core reports
 * (`NodeComplianceReport`, `CrateMatchResult`).
 *
 * `inconsistent` is exactly the set of shared dependencies whose declarers do
 * not all agree on a byte-identical range, and `ok` is
 * `inconsistent.length === 0`.
 */
export interface SharedConsistencyReport {
  /** Every inconsistent shared dependency, sorted by dependency name. */
  inconsistent: InconsistentDependency[];
  /** `true` iff no shared dependency is inconsistent. */
  ok: boolean;
}

/**
 * Decide, for a table of per-dependency `(workspace, range)` declarations,
 * which SHARED dependencies (declared by two or more workspaces) are
 * inconsistent (Req 3.3 / 6.5 / 6.6, Property 2).
 *
 * Pure and I/O-free. A dependency is reported inconsistent IF AND ONLY IF it is
 * declared by two or more workspaces AND at least two of those declarers record
 * different ranges. Each reported entry names every declaring workspace with the
 * range it recorded (so the divergent workspaces are visible) plus the distinct
 * ranges observed. `ok` is true iff no shared dependency is inconsistent.
 *
 * This is the pure function the Property 2 test drives directly.
 */
export function checkSharedConsistency(table: DependencyTable): SharedConsistencyReport {
  const inconsistent: InconsistentDependency[] = [];

  for (const dependency of Object.keys(table).sort((a, b) => a.localeCompare(b))) {
    const declarers = table[dependency] ?? [];

    // Only dependencies declared by two or more workspaces are "shared" and can
    // be inconsistent. A single (or zero) declarer is trivially consistent.
    if (declarers.length < 2) continue;

    const distinctRanges = [...new Set(declarers.map((d) => d.range))];

    // Inconsistent iff at least two declarers record different ranges — i.e.
    // there is more than one distinct range across the declarers.
    if (distinctRanges.length < 2) continue;

    const sortedDeclarers = [...declarers].sort((a, b) => a.workspace.localeCompare(b.workspace));

    inconsistent.push({
      dependency,
      declarers: sortedDeclarers.map((d) => ({ workspace: d.workspace, range: d.range })),
      distinctRanges,
    });
  }

  return {
    inconsistent,
    ok: inconsistent.length === 0,
  };
}
