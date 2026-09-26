import fc from "fast-check";

import {
  CANONICAL_TOOL_COUNT,
  CANONICAL_TOOL_PAYLOADS,
  type DistPresence,
  canonicalPayloads,
  isStagingComplete,
  planPayloadStaging,
  stagingBlockers,
} from "../../scripts/payload-manifest";

/**
 * Feature: installer-runtime-provisioning
 * Property 8: Build-time completeness names the exact missing set.
 *
 * For any observed dist-tree presence state over the nine canonical trees, the
 * build-time staging plan is COMPLETE iff its `missing` set is empty, and the
 * `missing` set equals exactly `required - present` — the nine canonical trees
 * minus those that are present AND non-empty. Staging proceeds only when the
 * plan is complete.
 *
 * "Present" is defined by the planner as `exists && nonEmpty` (a dist root that
 * exists but is empty does NOT count as present — Req 3.1). The `missing` set
 * is therefore the canonical servers that are NOT present-and-non-empty, as an
 * unordered set. `isStagingComplete` collapses to `missing.length === 0`, and
 * `stagingBlockers` is exactly `missing` (the names the build must report when
 * it aborts).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

/** The nine canonical server names, derived from the single source of truth. */
const CANONICAL_SERVER_NAMES: readonly string[] = canonicalPayloads().map((t) => t.serverName);

/**
 * An arbitrary presence state over the nine canonical servers: for each server,
 * independently pick `exists ∈ {true,false}` and `nonEmpty ∈ {true,false}`, so
 * the generator explores the full 4^9 presence space (present, absent, and
 * exists-but-empty).
 */
function arbitraryPresence(): fc.Arbitrary<DistPresence[]> {
  return fc.tuple(
    ...CANONICAL_SERVER_NAMES.map((serverName) =>
      fc
        .record({ exists: fc.boolean(), nonEmpty: fc.boolean() })
        .map(({ exists, nonEmpty }): DistPresence => ({ serverName, exists, nonEmpty })),
    ),
  );
}

/** A server counts as "present" iff its dist root exists AND is non-empty. */
function isPresent(p: DistPresence): boolean {
  return p.exists && p.nonEmpty;
}

describe("Feature: installer-runtime-provisioning, Property 8: Build-time completeness names the exact missing set", () => {
  it("names exactly required - present, and is complete iff missing is empty", () => {
    fc.assert(
      fc.property(arbitraryPresence(), (presence) => {
        const plan = planPayloadStaging(presence);

        // The `required` partition is always the full canonical nine.
        expect([...plan.required.map((r) => r.serverName)].sort()).toEqual(
          [...CANONICAL_SERVER_NAMES].sort(),
        );

        // Independent oracle: `present` = the servers that are present-and-non-empty,
        // `missing` = required - present.
        const expectedPresent = presence.filter(isPresent).map((p) => p.serverName);
        const expectedMissing = CANONICAL_SERVER_NAMES.filter(
          (name) => !expectedPresent.includes(name),
        );

        // `missing` equals exactly `required - present` as an unordered set.
        expect(new Set(plan.missing)).toEqual(new Set(expectedMissing));
        // ...and dually, `present` is exactly the present-and-non-empty servers.
        expect(new Set(plan.present)).toEqual(new Set(expectedPresent));

        // present and missing partition the canonical nine exactly (no overlap,
        // no omission).
        expect(plan.present.length + plan.missing.length).toBe(CANONICAL_TOOL_COUNT);
        for (const name of plan.present) {
          expect(plan.missing).not.toContain(name);
        }

        // The plan is complete iff its missing set is empty — staging proceeds
        // only when the plan is complete.
        expect(isStagingComplete(plan)).toBe(plan.missing.length === 0);
        expect(isStagingComplete(plan)).toBe(expectedMissing.length === 0);

        // The build's abort-blockers are exactly the missing set.
        expect(new Set(stagingBlockers(plan))).toEqual(new Set(plan.missing));
      }),
      { numRuns: 200 },
    );
  });

  it("is complete exactly when every canonical tree is present and non-empty", () => {
    fc.assert(
      fc.property(arbitraryPresence(), (presence) => {
        const plan = planPayloadStaging(presence);
        const allPresent = presence.every(isPresent);
        expect(isStagingComplete(plan)).toBe(allPresent);
        if (allPresent) {
          expect(plan.missing).toHaveLength(0);
          expect(plan.present).toHaveLength(CANONICAL_TOOL_COUNT);
          expect(stagingBlockers(plan)).toHaveLength(0);
        } else {
          expect(plan.missing.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("sanity: an exists-but-empty tree is missing, an all-present state is complete", () => {
    // Anchor the property with two concrete examples so the contract is legible.
    const allPresent: DistPresence[] = CANONICAL_TOOL_PAYLOADS.map((t) => ({
      serverName: t.serverName,
      exists: true,
      nonEmpty: true,
    }));
    const completePlan = planPayloadStaging(allPresent);
    expect(isStagingComplete(completePlan)).toBe(true);
    expect(completePlan.missing).toEqual([]);

    const oneEmpty: DistPresence[] = allPresent.map((p) =>
      p.serverName === "skills" ? { ...p, nonEmpty: false } : p,
    );
    const emptyPlan = planPayloadStaging(oneEmpty);
    expect(isStagingComplete(emptyPlan)).toBe(false);
    expect(emptyPlan.missing).toEqual(["skills"]);
    expect(stagingBlockers(emptyPlan)).toEqual(["skills"]);
  });
});
