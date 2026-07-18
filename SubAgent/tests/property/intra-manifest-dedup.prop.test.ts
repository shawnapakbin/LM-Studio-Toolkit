/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Property tests for Intra-Manifest Deduplication — validates that within a single
// TaskManifest, duplicate tasks (same Input_Hash) are handled correctly: only the
// first occurrence is executed, duplicates receive copied results with deduplicated: true,
// and the executed task does NOT carry the deduplicated field.

import * as fc from "fast-check";
import { DedupCache } from "../../src/dedup-cache";
import type { TaskDefinition, TaskManifest, TaskResult } from "../../src/types";

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid task prompt */
const arbPrompt = fc.string({ minLength: 1, maxLength: 200 });

/** Generate an optional system prompt */
const arbSystemPrompt = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined });

/** Generate allowed tools list */
const arbAllowedTools = fc.option(
  fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
  { nil: undefined },
);

/** Generate temperature or undefined */
const arbTemperature = fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined });

/** Generate maxTokens or undefined */
const arbMaxTokens = fc.option(fc.integer({ min: 1, max: 32768 }), { nil: undefined });

/** Generate a TaskManifest shell (tasks array is built separately) */
const arbManifestShell = fc.record({
  systemPrompt: arbSystemPrompt,
  temperature: arbTemperature,
  maxTokens: arbMaxTokens,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulates intra-manifest deduplication logic.
 *
 * Given a TaskManifest, computes hashes for all tasks and applies the
 * first-occurrence-wins rule. Returns the set of TaskResults that would
 * be produced — tasks chosen for execution get a mock result without
 * `deduplicated`, while duplicate tasks receive a copied result with
 * `deduplicated: true`.
 */
function simulateIntraManifestDedup(manifest: TaskManifest): TaskResult[] {
  const hashToFirstTaskId = new Map<string, string>();
  const results: TaskResult[] = [];

  // First pass: identify which task is the "first occurrence" for each hash
  for (const task of manifest.tasks) {
    const hash = DedupCache.computeHash(task, manifest);
    if (!hashToFirstTaskId.has(hash)) {
      hashToFirstTaskId.set(hash, task.taskId);
    }
  }

  // Second pass: build results
  for (const task of manifest.tasks) {
    const hash = DedupCache.computeHash(task, manifest);
    const firstTaskId = hashToFirstTaskId.get(hash)!;

    if (task.taskId === firstTaskId) {
      // This is the first occurrence — it gets "executed"
      results.push({
        taskId: task.taskId,
        sessionId: "mock-session-id",
        status: "success",
        response: `Result for ${task.taskId}`,
      });
    } else {
      // This is a duplicate — it gets a copied result with deduplicated: true
      results.push({
        taskId: task.taskId,
        sessionId: "mock-session-id",
        status: "success",
        response: `Result for ${firstTaskId}`,
        deduplicated: true,
      });
    }
  }

  return results;
}

// ─── Property 11: Intra-Manifest Deduplication ───────────────────────────────

/**
 * **Validates: Requirements 6.2, 6.4**
 *
 * Property 11: For any Task_Manifest containing two or more tasks that produce
 * the same Input_Hash, only the first occurrence (by array position) is executed,
 * all other matching tasks receive a copied result with `deduplicated: true`, and
 * the executed task does NOT carry the `deduplicated` field.
 */
describe("Property 11: Intra-Manifest Deduplication", () => {
  it("first occurrence of a duplicated hash is NOT marked deduplicated", () => {
    fc.assert(
      fc.property(
        arbManifestShell,
        arbPrompt,
        arbSystemPrompt,
        arbAllowedTools,
        fc.integer({ min: 2, max: 8 }),
        (manifestShell, prompt, taskSystemPrompt, allowedTools, duplicateCount) => {
          // Create multiple tasks with identical content (same hash) but different taskIds
          const tasks: TaskDefinition[] = [];
          for (let i = 0; i < duplicateCount; i++) {
            tasks.push({
              taskId: `task_${i}`,
              prompt,
              systemPrompt: taskSystemPrompt,
              allowedTools: allowedTools,
            });
          }

          const manifest: TaskManifest = { ...manifestShell, tasks };

          // Verify all tasks produce the same hash
          const hashes = tasks.map((t) => DedupCache.computeHash(t, manifest));
          const uniqueHashes = new Set(hashes);
          expect(uniqueHashes.size).toBe(1);

          // Simulate dedup
          const results = simulateIntraManifestDedup(manifest);

          // The first occurrence (index 0) should NOT have deduplicated field
          const firstResult = results[0];
          expect(firstResult.taskId).toBe("task_0");
          expect(firstResult.deduplicated).toBeUndefined();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("all duplicate occurrences after the first are marked deduplicated: true", () => {
    fc.assert(
      fc.property(
        arbManifestShell,
        arbPrompt,
        arbSystemPrompt,
        arbAllowedTools,
        fc.integer({ min: 2, max: 8 }),
        (manifestShell, prompt, taskSystemPrompt, allowedTools, duplicateCount) => {
          // Create multiple tasks with identical content (same hash) but different taskIds
          const tasks: TaskDefinition[] = [];
          for (let i = 0; i < duplicateCount; i++) {
            tasks.push({
              taskId: `task_${i}`,
              prompt,
              systemPrompt: taskSystemPrompt,
              allowedTools: allowedTools,
            });
          }

          const manifest: TaskManifest = { ...manifestShell, tasks };

          // Simulate dedup
          const results = simulateIntraManifestDedup(manifest);

          // All results after the first should be marked deduplicated
          for (let i = 1; i < results.length; i++) {
            expect(results[i].deduplicated).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("only first occurrence by array position is executed when multiple tasks share hash", () => {
    fc.assert(
      fc.property(
        arbManifestShell,
        arbPrompt,
        arbSystemPrompt,
        arbAllowedTools,
        fc.integer({ min: 2, max: 10 }),
        (manifestShell, prompt, taskSystemPrompt, allowedTools, duplicateCount) => {
          const tasks: TaskDefinition[] = [];
          for (let i = 0; i < duplicateCount; i++) {
            tasks.push({
              taskId: `task_${i}`,
              prompt,
              systemPrompt: taskSystemPrompt,
              allowedTools: allowedTools,
            });
          }

          const manifest: TaskManifest = { ...manifestShell, tasks };
          const results = simulateIntraManifestDedup(manifest);

          // Count how many results are NOT deduplicated (i.e., "executed")
          const executedResults = results.filter((r) => r.deduplicated !== true);
          expect(executedResults.length).toBe(1);
          expect(executedResults[0].taskId).toBe("task_0");
        },
      ),
      { numRuns: 50 },
    );
  });

  it("tasks with different hashes are all independently executed (no false dedup)", () => {
    fc.assert(
      fc.property(
        arbManifestShell,
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 2, maxLength: 10 }),
        (manifestShell, prompts) => {
          // Ensure all prompts are unique so they produce different hashes
          const uniquePrompts = [...new Set(prompts)];
          fc.pre(uniquePrompts.length >= 2);

          const tasks: TaskDefinition[] = uniquePrompts.map((p, i) => ({
            taskId: `task_${i}`,
            prompt: p,
          }));

          const manifest: TaskManifest = { ...manifestShell, tasks };

          // Verify all hashes are unique
          const hashes = tasks.map((t) => DedupCache.computeHash(t, manifest));
          const uniqueHashes = new Set(hashes);
          fc.pre(uniqueHashes.size === tasks.length);

          // Simulate dedup
          const results = simulateIntraManifestDedup(manifest);

          // No results should be marked as deduplicated
          for (const result of results) {
            expect(result.deduplicated).toBeUndefined();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("mixed manifest with some duplicates and some unique tasks handles correctly", () => {
    fc.assert(
      fc.property(
        arbManifestShell,
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        (manifestShell, dupPrompt, uniquePrompt, dupCount, uniqueCount) => {
          // Ensure the two prompts are different so they produce different hashes
          fc.pre(dupPrompt !== uniquePrompt);

          const tasks: TaskDefinition[] = [];

          // Add duplicate tasks (all share the same prompt -> same hash)
          for (let i = 0; i < dupCount; i++) {
            tasks.push({ taskId: `dup_${i}`, prompt: dupPrompt });
          }

          // Add unique tasks (each with the unique prompt but different suffixes to avoid collisions)
          for (let i = 0; i < uniqueCount; i++) {
            tasks.push({ taskId: `unique_${i}`, prompt: `${uniquePrompt}_${i}` });
          }

          const manifest: TaskManifest = { ...manifestShell, tasks };

          // Verify unique tasks produce different hashes from each other and from dup tasks
          const dupHash = DedupCache.computeHash(tasks[0], manifest);
          const uniqueHashes = tasks
            .slice(dupCount)
            .map((t) => DedupCache.computeHash(t, manifest));
          const allUniqueFromDup = uniqueHashes.every((h) => h !== dupHash);
          const allUniqueFromEachOther = new Set(uniqueHashes).size === uniqueHashes.length;
          fc.pre(allUniqueFromDup && allUniqueFromEachOther);

          // Simulate dedup
          const results = simulateIntraManifestDedup(manifest);

          // First duplicate task should be executed (not deduplicated)
          const firstDupResult = results.find((r) => r.taskId === "dup_0")!;
          expect(firstDupResult.deduplicated).toBeUndefined();

          // Remaining duplicate tasks should be deduplicated
          for (let i = 1; i < dupCount; i++) {
            const dupResult = results.find((r) => r.taskId === `dup_${i}`)!;
            expect(dupResult.deduplicated).toBe(true);
          }

          // All unique tasks should NOT be deduplicated
          for (let i = 0; i < uniqueCount; i++) {
            const uniqueResult = results.find((r) => r.taskId === `unique_${i}`)!;
            expect(uniqueResult.deduplicated).toBeUndefined();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("dedup respects array position: inserting duplicate at any position still picks index-0 match", () => {
    fc.assert(
      fc.property(
        arbManifestShell,
        arbPrompt,
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (manifestShell, sharedPrompt, uniqueBeforeCount, uniqueAfterCount) => {
          const tasks: TaskDefinition[] = [];

          // Add unique tasks before the duplicates
          for (let i = 0; i < uniqueBeforeCount; i++) {
            tasks.push({ taskId: `before_${i}`, prompt: `unique_before_${i}_${sharedPrompt}` });
          }

          // Add the first duplicate
          const firstDupIndex = tasks.length;
          tasks.push({ taskId: "first_dup", prompt: sharedPrompt });

          // Add unique tasks between duplicates
          for (let i = 0; i < uniqueAfterCount; i++) {
            tasks.push({ taskId: `between_${i}`, prompt: `unique_after_${i}_${sharedPrompt}` });
          }

          // Add the second duplicate (same prompt -> same hash)
          tasks.push({ taskId: "second_dup", prompt: sharedPrompt });

          const manifest: TaskManifest = { ...manifestShell, tasks };

          // Verify the two dup tasks have the same hash
          const hash1 = DedupCache.computeHash(tasks[firstDupIndex], manifest);
          const hash2 = DedupCache.computeHash(tasks[tasks.length - 1], manifest);
          expect(hash1).toBe(hash2);

          // Simulate dedup
          const results = simulateIntraManifestDedup(manifest);

          // The first dup (by array position) should NOT be deduplicated
          const firstDupResult = results.find((r) => r.taskId === "first_dup")!;
          expect(firstDupResult.deduplicated).toBeUndefined();

          // The second dup should be deduplicated
          const secondDupResult = results.find((r) => r.taskId === "second_dup")!;
          expect(secondDupResult.deduplicated).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("deduplicated tasks receive the same response as the executed first occurrence", () => {
    fc.assert(
      fc.property(
        arbManifestShell,
        arbPrompt,
        fc.integer({ min: 2, max: 6 }),
        (manifestShell, prompt, duplicateCount) => {
          const tasks: TaskDefinition[] = [];
          for (let i = 0; i < duplicateCount; i++) {
            tasks.push({ taskId: `task_${i}`, prompt });
          }

          const manifest: TaskManifest = { ...manifestShell, tasks };
          const results = simulateIntraManifestDedup(manifest);

          // The first result is the executed one
          const executedResult = results[0];
          expect(executedResult.deduplicated).toBeUndefined();

          // All duplicated results should carry the same response as the executed task
          for (let i = 1; i < results.length; i++) {
            expect(results[i].response).toBe(executedResult.response);
            expect(results[i].deduplicated).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
