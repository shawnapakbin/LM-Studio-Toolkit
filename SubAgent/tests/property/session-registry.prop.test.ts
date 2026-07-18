/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Properties 31–34: Session Registry
// **Validates: Requirements 20.3, 20.4, 20.5, 20.6, 20.7, 20.8**

import * as fc from "fast-check";
import { RegistryEntry, RegistryStatus, SessionRegistry } from "../../src/session-registry";

// ─── Generators ──────────────────────────────────────────────────────────────

const terminalStatuses: RegistryStatus[] = [
  "success",
  "failed",
  "timed_out",
  "aborted",
  "cancelled",
  "budget_exceeded",
];

const nonTerminalStatuses: RegistryStatus[] = ["pending", "in-progress"];

const allStatuses: RegistryStatus[] = [...nonTerminalStatuses, ...terminalStatuses];

const arbStatus: fc.Arbitrary<RegistryStatus> = fc.constantFrom(...allStatuses);

const _arbTerminalStatus: fc.Arbitrary<RegistryStatus> = fc.constantFrom(...terminalStatuses);

const arbNonTerminalStatus: fc.Arbitrary<RegistryStatus> = fc.constantFrom(...nonTerminalStatuses);

const arbInputHash: fc.Arbitrary<string> = fc.hexaString({
  minLength: 16,
  maxLength: 64,
});

const arbTaskId: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")),
  { minLength: 1, maxLength: 32 },
);

const arbDispatchId: fc.Arbitrary<string> = fc.uuid();

const arbTimestamp: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2024-01-01T00:00:00Z"),
    max: new Date("2025-12-31T23:59:59Z"),
  })
  .map((d) => d.toISOString());

const arbResult: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 200 }),
);

function arbEntry(overrides?: Partial<RegistryEntry>): fc.Arbitrary<RegistryEntry> {
  return fc.record({
    taskId: overrides?.taskId !== undefined ? fc.constant(overrides.taskId) : arbTaskId,
    inputHash: overrides?.inputHash !== undefined ? fc.constant(overrides.inputHash) : arbInputHash,
    status: overrides?.status !== undefined ? fc.constant(overrides.status) : arbStatus,
    result: overrides?.result !== undefined ? fc.constant(overrides.result) : arbResult,
    dispatchId:
      overrides?.dispatchId !== undefined ? fc.constant(overrides.dispatchId) : arbDispatchId,
    timestamp: overrides?.timestamp !== undefined ? fc.constant(overrides.timestamp) : arbTimestamp,
  });
}

// ─── Property 31: Session Registry Cross-Dispatch Dedup ──────────────────────

describe("Property 31: Session Registry Cross-Dispatch Dedup", () => {
  it("lookup() returns the entry's result for entries with status 'success'", () => {
    fc.assert(
      fc.property(
        arbInputHash,
        arbTaskId,
        arbDispatchId,
        arbTimestamp,
        fc.string({ minLength: 1, maxLength: 200 }),
        (inputHash, taskId, dispatchId, timestamp, resultText) => {
          const registry = new SessionRegistry();

          const entry: RegistryEntry = {
            taskId,
            inputHash,
            status: "success",
            result: resultText,
            dispatchId,
            timestamp,
          };

          registry.register(entry);

          const found = registry.lookup(inputHash);
          expect(found).not.toBeNull();
          expect(found!.result).toBe(resultText);
          expect(found!.status).toBe("success");
        },
      ),
      { numRuns: 25 },
    );
  });

  it("lookup() returns null for entries with non-terminal status (pending, in-progress)", () => {
    fc.assert(
      fc.property(
        arbInputHash,
        arbTaskId,
        arbDispatchId,
        arbTimestamp,
        arbNonTerminalStatus,
        (inputHash, taskId, dispatchId, timestamp, status) => {
          const registry = new SessionRegistry();

          const entry: RegistryEntry = {
            taskId,
            inputHash,
            status,
            result: null,
            dispatchId,
            timestamp,
          };

          registry.register(entry);

          const found = registry.lookup(inputHash);
          expect(found).toBeNull();
        },
      ),
      { numRuns: 25 },
    );
  });

  it("lookup() returns null for entries with non-success terminal status", () => {
    fc.assert(
      fc.property(
        arbInputHash,
        arbTaskId,
        arbDispatchId,
        arbTimestamp,
        fc.constantFrom(
          "failed" as RegistryStatus,
          "timed_out" as RegistryStatus,
          "aborted" as RegistryStatus,
          "cancelled" as RegistryStatus,
          "budget_exceeded" as RegistryStatus,
        ),
        (inputHash, taskId, dispatchId, timestamp, status) => {
          const registry = new SessionRegistry();

          const entry: RegistryEntry = {
            taskId,
            inputHash,
            status,
            result: null,
            dispatchId,
            timestamp,
          };

          registry.register(entry);

          const found = registry.lookup(inputHash);
          expect(found).toBeNull();
        },
      ),
      { numRuns: 25 },
    );
  });

  it("lookup() finds success across multiple dispatch IDs for same hash", () => {
    fc.assert(
      fc.property(
        arbInputHash,
        fc.array(arbDispatchId, { minLength: 2, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (inputHash, dispatchIds, resultText) => {
          const registry = new SessionRegistry();

          // Register non-success entries from earlier dispatches
          for (let i = 0; i < dispatchIds.length - 1; i++) {
            registry.register({
              taskId: `task-${i}`,
              inputHash,
              status: "failed",
              result: null,
              dispatchId: dispatchIds[i],
              timestamp: new Date(2024, 0, 1, 0, 0, i).toISOString(),
            });
          }

          // Register a success entry from the last dispatch
          registry.register({
            taskId: `task-success`,
            inputHash,
            status: "success",
            result: resultText,
            dispatchId: dispatchIds[dispatchIds.length - 1],
            timestamp: new Date(2024, 0, 1, 0, 0, dispatchIds.length).toISOString(),
          });

          const found = registry.lookup(inputHash);
          expect(found).not.toBeNull();
          expect(found!.result).toBe(resultText);
          expect(found!.status).toBe("success");
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ─── Property 32: Session Registry Lookup Order ──────────────────────────────

describe("Property 32: Session Registry Lookup Order", () => {
  it("lookup() returns the FIRST entry with status 'success' for a given inputHash", () => {
    fc.assert(
      fc.property(
        arbInputHash,
        fc.array(
          fc.record({
            taskId: arbTaskId,
            dispatchId: arbDispatchId,
            result: fc.string({ minLength: 1, maxLength: 100 }),
            timestamp: arbTimestamp,
          }),
          { minLength: 2, maxLength: 6 },
        ),
        (inputHash, entryData) => {
          const registry = new SessionRegistry();

          // Register multiple success entries for the same hash
          const entries: RegistryEntry[] = entryData.map((data) => ({
            taskId: data.taskId,
            inputHash,
            status: "success" as RegistryStatus,
            result: data.result,
            dispatchId: data.dispatchId,
            timestamp: data.timestamp,
          }));

          for (const entry of entries) {
            registry.register(entry);
          }

          const found = registry.lookup(inputHash);
          expect(found).not.toBeNull();

          // The result should be from the first registered entry (insertion order)
          expect(found!.result).toBe(entries[0].result);
          expect(found!.taskId).toBe(entries[0].taskId);
          expect(found!.dispatchId).toBe(entries[0].dispatchId);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("lookup() skips non-success entries and finds the first success in insertion order", () => {
    fc.assert(
      fc.property(
        arbInputHash,
        fc.nat({ max: 4 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (inputHash, numPendingBefore, firstResult, secondResult) => {
          fc.pre(firstResult !== secondResult);

          const registry = new SessionRegistry();

          // Insert some non-success entries first
          for (let i = 0; i < numPendingBefore; i++) {
            registry.register({
              taskId: `pending-${i}`,
              inputHash,
              status: "pending",
              result: null,
              dispatchId: `dispatch-pre-${i}`,
              timestamp: new Date(2024, 0, 1, 0, 0, i).toISOString(),
            });
          }

          // Insert the first success
          registry.register({
            taskId: "first-success",
            inputHash,
            status: "success",
            result: firstResult,
            dispatchId: "dispatch-first",
            timestamp: new Date(2024, 0, 1, 0, 1, 0).toISOString(),
          });

          // Insert a second success
          registry.register({
            taskId: "second-success",
            inputHash,
            status: "success",
            result: secondResult,
            dispatchId: "dispatch-second",
            timestamp: new Date(2024, 0, 1, 0, 2, 0).toISOString(),
          });

          const found = registry.lookup(inputHash);
          expect(found).not.toBeNull();
          expect(found!.result).toBe(firstResult);
          expect(found!.taskId).toBe("first-success");
        },
      ),
      { numRuns: 25 },
    );
  });
});

// ─── Property 33: Session Registry Session Scope ─────────────────────────────

describe("Property 33: Session Registry Session Scope", () => {
  it("a freshly constructed registry has zero entries", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const registry = new SessionRegistry();
        const entries = registry.list();
        expect(entries).toHaveLength(0);
      }),
      { numRuns: 5 },
    );
  });

  it("after clear(), the registry has zero entries", () => {
    fc.assert(
      fc.property(fc.array(arbEntry(), { minLength: 1, maxLength: 20 }), (entries) => {
        const registry = new SessionRegistry();

        // Register all entries
        for (const entry of entries) {
          registry.register(entry);
        }

        // Verify there are entries present
        const beforeClear = registry.list();
        expect(beforeClear.length).toBeGreaterThan(0);

        // Clear and verify empty
        registry.clear();
        const afterClear = registry.list();
        expect(afterClear).toHaveLength(0);
      }),
      { numRuns: 15 },
    );
  });

  it("after clear(), lookup() returns null for any previously registered hash", () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry({ status: "success", result: "some result" }), {
          minLength: 1,
          maxLength: 10,
        }),
        (entries) => {
          const registry = new SessionRegistry();

          for (const entry of entries) {
            registry.register(entry);
          }

          registry.clear();

          // Every previously registered hash should now return null
          for (const entry of entries) {
            expect(registry.lookup(entry.inputHash)).toBeNull();
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});

// ─── Property 34: Session Registry Filter Correctness ────────────────────────

describe("Property 34: Session Registry Filter Correctness", () => {
  it("status filter returns only entries matching that status", () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry(), { minLength: 1, maxLength: 30 }),
        arbStatus,
        (entries, filterStatus) => {
          const registry = new SessionRegistry();
          for (const entry of entries) {
            registry.register(entry);
          }

          const results = registry.list({ status: filterStatus });

          // All returned entries must have the matching status
          for (const r of results) {
            expect(r.status).toBe(filterStatus);
          }

          // Count how many entries in the input match the filter
          const expectedCount = entries.filter((e) => e.status === filterStatus).length;
          expect(results.length).toBe(expectedCount);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("dispatchId filter returns only entries from that dispatch", () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry(), { minLength: 1, maxLength: 30 }),
        arbDispatchId,
        (entries, filterDispatchId) => {
          const registry = new SessionRegistry();

          // Ensure at least one entry has the target dispatchId
          const targetEntry: RegistryEntry = {
            taskId: "target-task",
            inputHash: "abcdef1234567890",
            status: "success",
            result: "target result",
            dispatchId: filterDispatchId,
            timestamp: new Date(2024, 5, 15).toISOString(),
          };
          registry.register(targetEntry);

          for (const entry of entries) {
            registry.register(entry);
          }

          const results = registry.list({ dispatchId: filterDispatchId });

          // All results must belong to the target dispatch
          for (const r of results) {
            expect(r.dispatchId).toBe(filterDispatchId);
          }

          // Must include our target entry
          expect(results.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("hashPrefix filter returns only entries whose inputHash starts with the prefix", () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry(), { minLength: 5, maxLength: 30 }),
        fc.hexaString({ minLength: 2, maxLength: 8 }),
        (entries, prefix) => {
          const registry = new SessionRegistry();
          for (const entry of entries) {
            registry.register(entry);
          }

          const results = registry.list({ hashPrefix: prefix });

          // All returned entries must have inputHash starting with prefix
          for (const r of results) {
            expect(r.inputHash.startsWith(prefix)).toBe(true);
          }

          // Count expected matches
          const expectedCount = entries.filter((e) => e.inputHash.startsWith(prefix)).length;
          expect(results.length).toBe(expectedCount);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("multiple filters use AND logic", () => {
    fc.assert(
      fc.property(
        fc.array(arbEntry(), { minLength: 5, maxLength: 30 }),
        arbStatus,
        arbDispatchId,
        (entries, filterStatus, filterDispatchId) => {
          const registry = new SessionRegistry();

          // Add a known entry that matches both filters
          const knownEntry: RegistryEntry = {
            taskId: "known-task",
            inputHash: "aabbccdd11223344",
            status: filterStatus,
            result: filterStatus === "success" ? "result" : null,
            dispatchId: filterDispatchId,
            timestamp: new Date(2024, 3, 10).toISOString(),
          };
          registry.register(knownEntry);

          for (const entry of entries) {
            registry.register(entry);
          }

          const results = registry.list({
            status: filterStatus,
            dispatchId: filterDispatchId,
          });

          // All results must satisfy BOTH filters
          for (const r of results) {
            expect(r.status).toBe(filterStatus);
            expect(r.dispatchId).toBe(filterDispatchId);
          }

          // Must include our known entry
          expect(results.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("no filter returns all entries ordered by timestamp ascending", () => {
    fc.assert(
      fc.property(fc.array(arbEntry(), { minLength: 2, maxLength: 30 }), (entries) => {
        const registry = new SessionRegistry();
        for (const entry of entries) {
          registry.register(entry);
        }

        const results = registry.list();

        // Should return all entries
        expect(results.length).toBe(entries.length);

        // Should be ordered by timestamp ascending
        for (let i = 1; i < results.length; i++) {
          expect(
            results[i].timestamp.localeCompare(results[i - 1].timestamp),
          ).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 25 },
    );
  });
});
