// Feature: dependency-refresh-node24, Property 3: Peer-dependency resolution is reject-and-enumerate

/**
 * Feature: dependency-refresh-node24
 * Property 3: Peer-dependency resolution is reject-and-enumerate
 *
 * For all proposed upgrade sets and detected peer-dependency conflict sets,
 * `resolvePeerDeps` SHALL report `ok` IF AND ONLY IF the conflict set is empty.
 * Whenever the conflict set is non-empty the outcome SHALL be a REJECTION: `ok`
 * is false, the report enumerates EXACTLY each detected conflict as a
 * `{ dependency, workspace }` pair (same order and multiplicity), the whole
 * proposed upgrade set is rejected (`rejectedUpgradeSet`), and the prior
 * versions are retained byte-identically (`retainedPriorVersions`). An empty
 * conflict set accepts the set and retains nothing.
 *
 * Validates: Requirements 6.2, 6.3
 * Design: Property 3
 *
 * -- Testing approach --------------------------------------------------------
 * `resolvePeerDeps` is the pure resolution core (design.md "Property 3"). This
 * test drives the REAL function (imported from `peer-resolution-core.ts`, no
 * mocks) over generated `ResolutionInput`s with varying `upgradeSet`,
 * `priorVersions`, and conflict sets that are both empty and non-empty. An
 * INDEPENDENT oracle re-derives the expected outcome straight from the
 * acceptance criteria (ok iff no conflicts; reject-and-retain otherwise) rather
 * than reusing the module's own branching, and we assert the function agrees
 * exactly: the biconditional, the exact enumeration of `{ dependency, workspace }`
 * pairs, and byte-identical retention of the upgrade / prior-version maps.
 */

import * as fc from "fast-check";
import { type PeerConflict, type ResolutionInput, resolvePeerDeps } from "./peer-resolution-core";

/** Small pools so generated sets share keys and conflicts overlap realistically. */
const DEPENDENCIES: readonly string[] = [
  "react",
  "zod",
  "typescript",
  "eslint",
  "@types/node",
  "vite",
] as const;

const WORKSPACES: readonly string[] = [
  "CLI",
  "Memory",
  "Skills",
  "mcp/common",
  "SlashCommands",
] as const;

const VERSIONS: readonly string[] = ["1.0.0", "2.3.1", "^18.2.0", "~5.9.3", "24.19.0"] as const;

/** A `dependency -> version` map (possibly empty). */
const versionMapArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.constantFrom(...DEPENDENCIES),
  fc.constantFrom(...VERSIONS),
  { maxKeys: 6 },
);

/**
 * A single peer-dependency conflict. `dependency`/`workspace` are the mandatory
 * enumerated pair; `requiredBy`/`conflictWith` are optional context that MUST
 * NOT leak into the enumerated `{ dependency, workspace }` pair.
 */
const conflictArb: fc.Arbitrary<PeerConflict> = fc.record(
  {
    workspace: fc.constantFrom(...WORKSPACES),
    dependency: fc.constantFrom(...DEPENDENCIES),
    requiredBy: fc.option(fc.constantFrom(...DEPENDENCIES), { nil: undefined }),
    conflictWith: fc.option(fc.constantFrom(...VERSIONS), { nil: undefined }),
  },
  { requiredKeys: ["workspace", "dependency"] },
);

/**
 * A full input: independently generated upgrade set, prior versions, and a
 * conflict list. `minLength: 0` keeps the empty (accept) case well-represented;
 * duplicates are allowed so multiplicity is exercised.
 */
const inputArb: fc.Arbitrary<ResolutionInput> = fc.record({
  upgradeSet: versionMapArb,
  priorVersions: versionMapArb,
  conflicts: fc.array(conflictArb, { minLength: 0, maxLength: 8 }),
});

describe("Feature: dependency-refresh-node24, Property 3: peer-dependency resolution is reject-and-enumerate", () => {
  it("ok iff conflicts empty; non-empty conflicts reject the whole upgrade set, retain prior versions byte-identically, and enumerate exactly each {dependency, workspace} pair", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = resolvePeerDeps(input);
        const hasConflicts = input.conflicts.length > 0;

        // Biconditional: ok IFF the conflict set is empty.
        expect(result.ok).toBe(!hasConflicts);

        if (hasConflicts) {
          // Rejection: ok is false.
          expect(result.ok).toBe(false);

          // Independent oracle for the enumerated pairs: exactly each input
          // conflict projected to { dependency, workspace }, same order and
          // multiplicity; optional context (requiredBy/conflictWith) dropped.
          const expectedPairs = input.conflicts.map((c) => ({
            dependency: c.dependency,
            workspace: c.workspace,
          }));
          expect(result.conflicts).toEqual(expectedPairs);
          expect(result.conflicts).toHaveLength(input.conflicts.length);

          // The whole proposed upgrade set is rejected (atomic), byte-identical.
          expect(result.rejectedUpgradeSet).toEqual(input.upgradeSet);
          // Prior versions retained unchanged, byte-identical.
          expect(result.retainedPriorVersions).toEqual(input.priorVersions);
        } else {
          // Acceptance: nothing enumerated, nothing rejected or retained.
          expect(result.conflicts).toEqual([]);
          expect(result.rejectedUpgradeSet).toEqual({});
          expect(result.retainedPriorVersions).toEqual({});
        }
      }),
      { numRuns: 100 },
    );
  });

  it("an empty conflict set always accepts: ok=true with empty conflicts and empty retention regardless of upgrade/prior maps", () => {
    fc.assert(
      fc.property(versionMapArb, versionMapArb, (upgradeSet, priorVersions) => {
        const result = resolvePeerDeps({ upgradeSet, priorVersions, conflicts: [] });
        expect(result.ok).toBe(true);
        expect(result.conflicts).toEqual([]);
        expect(result.rejectedUpgradeSet).toEqual({});
        expect(result.retainedPriorVersions).toEqual({});
      }),
      { numRuns: 100 },
    );
  });

  it("any non-empty conflict set forces ok=false and enumerates exactly the {dependency, workspace} pairs", () => {
    const nonEmptyInputArb: fc.Arbitrary<ResolutionInput> = fc.record({
      upgradeSet: versionMapArb,
      priorVersions: versionMapArb,
      conflicts: fc.array(conflictArb, { minLength: 1, maxLength: 8 }),
    });

    fc.assert(
      fc.property(nonEmptyInputArb, (input) => {
        const result = resolvePeerDeps(input);
        expect(result.ok).toBe(false);
        expect(result.conflicts).toEqual(
          input.conflicts.map((c) => ({ dependency: c.dependency, workspace: c.workspace })),
        );
        expect(result.rejectedUpgradeSet).toEqual(input.upgradeSet);
        expect(result.retainedPriorVersions).toEqual(input.priorVersions);
      }),
      { numRuns: 100 },
    );
  });
});
