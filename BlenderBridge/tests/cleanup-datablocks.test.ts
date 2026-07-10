/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-bridge-improvements, Property 1: Cleanup detection correctness
 * Feature: blender-bridge-improvements, Property 2: Cleanup report aggregation consistency
 * Feature: blender-bridge-improvements, Property 3: Partial failure partitioning
 *
 * Tests the pure detection/aggregation logic for datablock cleanup.
 */

import * as fc from "fast-check";

/**
 * Simulates the cleanup detection logic: filters datablocks where
 * users == 0 AND use_fake_user == false.
 */
function detectOrphans(
  datablocks: Array<{ name: string; type: string; users: number; use_fake_user: boolean }>,
): Array<{ name: string; type: string }> {
  return datablocks
    .filter((db) => db.users === 0 && !db.use_fake_user)
    .map(({ name, type }) => ({ name, type }));
}

/**
 * Aggregates removed datablocks into a grouped count by type,
 * omitting types with zero items.
 */
function aggregateByType(items: Array<{ name: string; type: string }>): Record<string, number> {
  const grouped: Record<string, number> = {};
  for (const item of items) {
    grouped[item.type] = (grouped[item.type] || 0) + 1;
  }
  return grouped;
}

/**
 * Partitions cleanup results into removed and errors arrays.
 */
function partitionResults(
  orphans: Array<{ name: string; type: string }>,
  failedIndices: Set<number>,
): {
  removed: Array<{ name: string; type: string }>;
  errors: Array<{ name: string; type: string; reason: string }>;
} {
  const removed: Array<{ name: string; type: string }> = [];
  const errors: Array<{ name: string; type: string; reason: string }> = [];

  for (let i = 0; i < orphans.length; i++) {
    if (failedIndices.has(i)) {
      errors.push({ ...orphans[i], reason: "removal failed" });
    } else {
      removed.push(orphans[i]);
    }
  }

  return { removed, errors };
}

describe("cleanup-datablocks property tests", () => {
  // --- Generators ---
  const datablockTypeArb = fc.constantFrom(
    "meshes",
    "materials",
    "cameras",
    "lights",
    "images",
    "textures",
    "node_groups",
    "worlds",
    "actions",
    "armatures",
    "curves",
    "particles",
  );

  const datablockNameArb = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split("")),
    { minLength: 1, maxLength: 30 },
  );

  const datablockArb = fc.record({
    name: datablockNameArb,
    type: datablockTypeArb,
    users: fc.integer({ min: 0, max: 10 }),
    use_fake_user: fc.boolean(),
  });

  const datablockListArb = fc.array(datablockArb, { minLength: 0, maxLength: 50 });

  /**
   * Property 1: Cleanup detection correctness
   *
   * For any set of datablocks, the detection logic returns exactly those
   * where users == 0 AND use_fake_user == false, and no others.
   */
  describe("Property 1: Cleanup detection correctness", () => {
    it("detects only datablocks with users == 0 AND use_fake_user == false", () => {
      fc.assert(
        fc.property(datablockListArb, (datablocks) => {
          const orphans = detectOrphans(datablocks);

          // Every returned item must have been an orphan in the input
          for (const orphan of orphans) {
            const original = datablocks.find(
              (db) => db.name === orphan.name && db.type === orphan.type,
            );
            expect(original).toBeDefined();
            expect(original!.users).toBe(0);
            expect(original!.use_fake_user).toBe(false);
          }

          // No orphan is missing from the result
          const expectedCount = datablocks.filter(
            (db) => db.users === 0 && !db.use_fake_user,
          ).length;
          expect(orphans.length).toBe(expectedCount);
        }),
        { numRuns: 100 },
      );
    });

    it("excludes datablocks with users > 0", () => {
      fc.assert(
        fc.property(datablockListArb, (datablocks) => {
          const orphans = detectOrphans(datablocks);
          const orphanKeys = new Set(orphans.map((o) => `${o.name}::${o.type}`));

          for (const db of datablocks) {
            if (db.users > 0) {
              expect(orphanKeys.has(`${db.name}::${db.type}`)).toBe(false);
            }
          }
        }),
        { numRuns: 100 },
      );
    });

    it("excludes datablocks with use_fake_user == true", () => {
      fc.assert(
        fc.property(datablockListArb, (datablocks) => {
          const orphans = detectOrphans(datablocks);
          const orphanKeys = new Set(orphans.map((o) => `${o.name}::${o.type}`));

          for (const db of datablocks) {
            if (db.use_fake_user) {
              expect(orphanKeys.has(`${db.name}::${db.type}`)).toBe(false);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 2: Cleanup report aggregation consistency
   *
   * For any list of removed datablocks, the grouped counts sum to
   * the total, and types with zero items are omitted.
   */
  describe("Property 2: Cleanup report aggregation consistency", () => {
    const removedListArb = fc.array(fc.record({ name: datablockNameArb, type: datablockTypeArb }), {
      minLength: 0,
      maxLength: 50,
    });

    it("removedByType values sum to totalRemoved", () => {
      fc.assert(
        fc.property(removedListArb, (removed) => {
          const grouped = aggregateByType(removed);
          const sum = Object.values(grouped).reduce((a, b) => a + b, 0);
          expect(sum).toBe(removed.length);
        }),
        { numRuns: 100 },
      );
    });

    it("no type key has a zero count", () => {
      fc.assert(
        fc.property(removedListArb, (removed) => {
          const grouped = aggregateByType(removed);
          for (const count of Object.values(grouped)) {
            expect(count).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it("every type in grouped corresponds to at least one item", () => {
      fc.assert(
        fc.property(removedListArb, (removed) => {
          const grouped = aggregateByType(removed);
          const typesInItems = new Set(removed.map((r) => r.type));

          for (const typeKey of Object.keys(grouped)) {
            expect(typesInItems.has(typeKey)).toBe(true);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 3: Partial failure partitioning
   *
   * For any cleanup operation, removed + errors combined count equals
   * the total orphans attempted, with no item in both arrays.
   */
  describe("Property 3: Partial failure partitioning", () => {
    const orphanListArb = fc.array(fc.record({ name: datablockNameArb, type: datablockTypeArb }), {
      minLength: 0,
      maxLength: 30,
    });

    it("removed + errors count equals total orphans attempted", () => {
      fc.assert(
        fc.property(
          orphanListArb,
          fc.uniqueArray(fc.integer({ min: 0, max: 29 }), { minLength: 0, maxLength: 10 }),
          (orphans, failedIndicesArr) => {
            const failedIndices = new Set(failedIndicesArr.filter((i) => i < orphans.length));
            const { removed, errors } = partitionResults(orphans, failedIndices);
            expect(removed.length + errors.length).toBe(orphans.length);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("no item appears in both removed and errors", () => {
      fc.assert(
        fc.property(
          orphanListArb,
          fc.uniqueArray(fc.integer({ min: 0, max: 29 }), { minLength: 0, maxLength: 10 }),
          (orphans, failedIndicesArr) => {
            const failedIndices = new Set(failedIndicesArr.filter((i) => i < orphans.length));
            const { removed, errors } = partitionResults(orphans, failedIndices);

            const removedKeys = new Set(removed.map((r) => `${r.name}::${r.type}`));
            for (const err of errors) {
              expect(removedKeys.has(`${err.name}::${err.type}`)).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it("failed indices produce errors and the rest are removed", () => {
      fc.assert(
        fc.property(
          orphanListArb,
          fc.uniqueArray(fc.integer({ min: 0, max: 29 }), { minLength: 0, maxLength: 10 }),
          (orphans, failedIndicesArr) => {
            const failedIndices = new Set(failedIndicesArr.filter((i) => i < orphans.length));
            const { removed, errors } = partitionResults(orphans, failedIndices);

            expect(errors.length).toBe(failedIndices.size);
            expect(removed.length).toBe(orphans.length - failedIndices.size);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
