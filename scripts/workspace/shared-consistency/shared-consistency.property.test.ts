// Feature: dependency-refresh-node24, Property 2: Shared-dependency version consistency

/**
 * Feature: dependency-refresh-node24
 * Property 2: Shared-dependency version consistency
 *
 * For all dependencies declared by two or more workspaces, the consistency
 * check SHALL report a dependency as inconsistent IF AND ONLY IF at least two
 * declaring workspaces record different ranges, naming each divergent workspace;
 * a dependency declared by fewer than two workspaces SHALL never be reported;
 * and `ok` SHALL be true iff no shared dependency is inconsistent.
 *
 * Validates: Requirements 3.3, 6.5, 6.6
 * Design: Property 2
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * `checkSharedConsistency` is the pure consistency core consumed by the
 * file-scanning CLI (`check-shared-consistency.ts`). This test drives the REAL
 * function (imported from `shared-consistency-core.ts`, no mocks) over generated
 * `DependencyTable`s: a small pool of dependency names, each mapped to a set of
 * `(workspace, range)` declarations drawn from small pools so collisions and
 * divergences both occur frequently. An INDEPENDENT oracle (`oracleInconsistent`
 * below) re-derives, straight from the acceptance criteria, which dependencies
 * are shared-and-inconsistent (>=2 declarers AND >=2 distinct ranges among them),
 * without reusing the module's own decision. We then assert the function agrees
 * exactly: the reported set of inconsistent dependency names equals the oracle's;
 * every reported entry names every declaring workspace with its recorded range
 * (so divergent workspaces are visible); dependencies with <2 declarers are never
 * reported; and `ok` is the biconditional of an empty inconsistent set.
 */

import * as fc from "fast-check";
import {
  checkSharedConsistency,
  type Declaration,
  type DependencyTable,
} from "./shared-consistency-core";

/** Small pools so the generator produces frequent collisions and divergences. */
const DEPENDENCIES: readonly string[] = [
  "better-sqlite3",
  "typescript",
  "zod",
  "fast-check",
  "vitest",
] as const;

const WORKSPACES: readonly string[] = ["CLI", "Memory", "Skills", "mcp/common", "root"] as const;

const RANGES: readonly string[] = ["^1.0.0", "^1.2.0", "~2.3.4", "3.0.0", "^12.6.2"] as const;

/** One generated declaration of a dependency by a workspace at some range. */
const declarationArb: fc.Arbitrary<Declaration> = fc.record({
  workspace: fc.constantFrom(...WORKSPACES),
  range: fc.constantFrom(...RANGES),
});

/**
 * Generate a full `DependencyTable`: a subset of dependency names, each mapped
 * to 0..5 declarations. Duplicate workspaces within a dependency are allowed —
 * the core treats every occurrence on its own for divergence — so the generator
 * does not dedupe them.
 */
const tableArb: fc.Arbitrary<DependencyTable> = fc
  .subarray(DEPENDENCIES as string[], { minLength: 0, maxLength: DEPENDENCIES.length })
  .chain((deps) =>
    fc
      .tuple(...deps.map(() => fc.array(declarationArb, { minLength: 0, maxLength: 5 })))
      .map((lists) => {
        const table: Record<string, Declaration[]> = {};
        deps.forEach((dep, i) => {
          table[dep] = lists[i];
        });
        return table;
      }),
  );

/**
 * Independent oracle: a dependency is inconsistent iff it has >=2 declarers AND
 * those declarers record >=2 distinct ranges. Derived straight from the
 * acceptance criteria; shares no logic with the code under test.
 */
function oracleInconsistent(declarers: ReadonlyArray<Declaration>): boolean {
  if (declarers.length < 2) return false;
  const distinct = new Set(declarers.map((d) => d.range));
  return distinct.size >= 2;
}

describe("Feature: dependency-refresh-node24, Property 2: shared-dependency version consistency", () => {
  it("reports a dependency inconsistent iff >=2 declarers diverge; names every declaring workspace; ignores <2-declarer deps; ok iff none inconsistent", () => {
    fc.assert(
      fc.property(tableArb, (table) => {
        const report = checkSharedConsistency(table);

        // Oracle: the exact set of dependency names that should be reported.
        const expectedNames = new Set(
          Object.keys(table).filter((dep) => oracleInconsistent(table[dep])),
        );

        // The reported set of inconsistent dependency names equals the oracle's.
        const actualNames = new Set(report.inconsistent.map((e) => e.dependency));
        expect(actualNames).toEqual(expectedNames);
        expect(report.inconsistent).toHaveLength(expectedNames.size);

        // Reported entries are sorted by dependency name (stable reporting).
        const names = report.inconsistent.map((e) => e.dependency);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

        for (const entry of report.inconsistent) {
          const source = table[entry.dependency];

          // A dependency with <2 declarers is never reported.
          expect(source.length).toBeGreaterThanOrEqual(2);

          // Each reported entry names EVERY declaring workspace with its recorded
          // range (so the divergent workspaces are visible). Compare as multisets
          // because a workspace may legitimately appear more than once.
          const expectedPairs = [...source]
            .map((d) => `${d.workspace}=${d.range}`)
            .sort((a, b) => a.localeCompare(b));
          const actualPairs = entry.declarers
            .map((d) => `${d.workspace}=${d.range}`)
            .sort((a, b) => a.localeCompare(b));
          expect(actualPairs).toEqual(expectedPairs);

          // declarers are sorted by workspace name.
          const workspaces = entry.declarers.map((d) => d.workspace);
          expect(workspaces).toEqual([...workspaces].sort((a, b) => a.localeCompare(b)));

          // distinctRanges are exactly the distinct ranges observed, and there
          // are at least two of them (that is what makes it inconsistent).
          expect(new Set(entry.distinctRanges)).toEqual(new Set(source.map((d) => d.range)));
          expect(entry.distinctRanges.length).toBeGreaterThanOrEqual(2);
        }

        // ok is the biconditional of an empty inconsistent set.
        expect(report.ok).toBe(report.inconsistent.length === 0);
        expect(report.ok).toBe(expectedNames.size === 0);
      }),
      { numRuns: 100 },
    );
  });

  it("a dependency all of whose declarers agree on one range is never reported (even with many declarers)", () => {
    const agreeingArb: fc.Arbitrary<DependencyTable> = fc
      .record({
        dependency: fc.constantFrom(...DEPENDENCIES),
        range: fc.constantFrom(...RANGES),
        workspaces: fc.uniqueArray(fc.constantFrom(...WORKSPACES), {
          minLength: 0,
          maxLength: WORKSPACES.length,
        }),
      })
      .map(({ dependency, range, workspaces }) => ({
        [dependency]: workspaces.map((workspace) => ({ workspace, range })),
      }));

    fc.assert(
      fc.property(agreeingArb, (table) => {
        const report = checkSharedConsistency(table);
        expect(report.inconsistent).toEqual([]);
        expect(report.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("a dependency with two declarers on different ranges is always reported inconsistent, naming both", () => {
    const divergentPairArb = fc
      .record({
        dependency: fc.constantFrom(...DEPENDENCIES),
        wsA: fc.constantFrom(...WORKSPACES),
        wsB: fc.constantFrom(...WORKSPACES),
        rangeA: fc.constantFrom(...RANGES),
        rangeB: fc.constantFrom(...RANGES),
      })
      .filter((r) => r.rangeA !== r.rangeB);

    fc.assert(
      fc.property(divergentPairArb, ({ dependency, wsA, wsB, rangeA, rangeB }) => {
        const table: DependencyTable = {
          [dependency]: [
            { workspace: wsA, range: rangeA },
            { workspace: wsB, range: rangeB },
          ],
        };
        const report = checkSharedConsistency(table);

        expect(report.ok).toBe(false);
        expect(report.inconsistent).toHaveLength(1);

        const entry = report.inconsistent[0];
        expect(entry.dependency).toBe(dependency);
        expect(new Set(entry.declarers.map((d) => `${d.workspace}=${d.range}`))).toEqual(
          new Set([`${wsA}=${rangeA}`, `${wsB}=${rangeB}`]),
        );
        expect(new Set(entry.distinctRanges)).toEqual(new Set([rangeA, rangeB]));
      }),
      { numRuns: 100 },
    );
  });
});
