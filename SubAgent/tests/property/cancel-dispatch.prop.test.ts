/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Property 19: Cancel State Assignment
// **Validates: Requirements 9.2, 9.4**

import * as fc from "fast-check";
import { InternalTask, SessionPool } from "../../src/session-pool";
import type { SessionPoolConfig, TaskManifest } from "../../src/types";

// ─── Global Fetch Mock ───────────────────────────────────────────────────────

/**
 * Mock global fetch to control task completion timing.
 * Each task's response delay is configured via taskDelays map.
 * This avoids ESM module mocking issues with jest.mock.
 */

let taskDelays: Map<string, number> = new Map();
let completedTaskPrompts: string[] = [];
let requestIndex = 0;

const originalFetch = global.fetch;

function installFetchMock(): void {
  (global as any).fetch = async (_url: string, options: any) => {
    const body = JSON.parse(options.body);
    const signal: AbortSignal = options.signal;
    const userMsg = body.messages.find((m: any) => m.role === "user");
    const taskPrompt = userMsg?.content ?? `unknown-${requestIndex++}`;

    const delay = taskDelays.get(taskPrompt) ?? 50;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, delay);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("The operation was aborted."));
        });
      }
    });

    completedTaskPrompts.push(taskPrompt);

    const responseBody = JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: `Result for: ${taskPrompt}`, tool_calls: null },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(responseBody),
      text: async () => responseBody,
    };
  };
}

function restoreFetchMock(): void {
  global.fetch = originalFetch;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetTracking(): void {
  taskDelays = new Map();
  completedTaskPrompts = [];
  requestIndex = 0;
}

function buildPool(concurrency: number): SessionPool {
  const config: SessionPoolConfig = {
    concurrency,
    apiUrl: "http://localhost:1234/v1/chat/completions",
    defaultTimeout: 3600,
  };
  return new SessionPool(config);
}

function buildManifest(
  taskCount: number,
  concurrency: number,
): { manifest: TaskManifest; tasks: InternalTask[] } {
  const tasks: InternalTask[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push({
      taskId: `task-${i}`,
      prompt: `prompt-${i}`,
      inputHash: `hash-${i.toString(16).padStart(8, "0")}`,
    });
  }
  const manifest: TaskManifest = {
    tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
    concurrency,
    maxRetries: 0,
    taskTimeout: 60,
    dispatchTimeout: 120,
  };
  return { manifest, tasks };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbTaskCount = fc.integer({ min: 3, max: 10 });
const arbConcurrency = fc.integer({ min: 1, max: 3 });
const arbCancelDelay = fc.integer({ min: 15, max: 60 });

// ─── Property 19: Cancel State Assignment ────────────────────────────────────

describe("Property 19: Cancel State Assignment", () => {
  beforeEach(() => {
    resetTracking();
    installFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it("each task is assigned exactly one status from {success, aborted, cancelled} after cancel", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTaskCount,
        arbConcurrency,
        arbCancelDelay,
        async (taskCount, concurrency, cancelDelayMs) => {
          resetTracking();

          // Fast tasks for the first concurrent batch, slow for the rest
          for (let i = 0; i < taskCount; i++) {
            const delay = i < concurrency ? 5 : 300;
            taskDelays.set(`prompt-${i}`, delay);
          }

          const pool = buildPool(concurrency);
          const { manifest, tasks } = buildManifest(taskCount, concurrency);

          const dispatchPromise = pool.dispatch(manifest, tasks);

          // Wait, then cancel
          await new Promise((resolve) => setTimeout(resolve, cancelDelayMs));

          const poolAny = pool as any;
          const dispatches: Map<string, any> = poolAny.dispatches;
          const activeIds = Array.from(dispatches.keys());

          if (activeIds.length === 0) {
            // Dispatch already completed — all tasks should be success
            const results = await dispatchPromise;
            for (const result of results) {
              expect(result.status).toBe("success");
            }
            return;
          }

          const dispatchId = activeIds[0];
          pool.cancel(dispatchId);

          const results = await dispatchPromise;

          // Core property: each task has exactly one status from the valid cancel set
          const validStatuses = new Set(["success", "aborted", "cancelled"]);
          expect(results.length).toBe(taskCount);

          for (const result of results) {
            expect(validStatuses.has(result.status)).toBe(true);
          }

          // No duplicate task IDs
          const taskIds = results.map((r) => r.taskId);
          expect(new Set(taskIds).size).toBe(taskCount);

          // All original task IDs present
          const expectedIds = tasks.map((t) => t.taskId).sort();
          expect(taskIds.sort()).toEqual(expectedIds);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("completed results (status=success) preserve their response content", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 4, max: 8 }), async (taskCount) => {
        resetTracking();

        const concurrency = 2;
        for (let i = 0; i < taskCount; i++) {
          const delay = i < concurrency ? 5 : 500;
          taskDelays.set(`prompt-${i}`, delay);
        }

        const pool = buildPool(concurrency);
        const { manifest, tasks } = buildManifest(taskCount, concurrency);

        const dispatchPromise = pool.dispatch(manifest, tasks);

        // Wait for fast tasks to complete
        await new Promise((resolve) => setTimeout(resolve, 40));

        const poolAny = pool as any;
        const dispatches: Map<string, any> = poolAny.dispatches;
        const activeIds = Array.from(dispatches.keys());

        if (activeIds.length === 0) {
          await dispatchPromise;
          return;
        }

        const dispatchId = activeIds[0];
        const partial = pool.cancel(dispatchId);

        const results = await dispatchPromise;

        // All success results must have preserved response text
        const successResults = results.filter((r) => r.status === "success");
        for (const result of successResults) {
          expect(result.response).toBeDefined();
          expect(typeof result.response).toBe("string");
          expect(result.response!.length).toBeGreaterThan(0);
        }

        // Partial result's completedResults should match final success results
        for (const completed of partial.completedResults) {
          const matching = results.find((r) => r.taskId === completed.taskId);
          expect(matching).toBeDefined();
          expect(matching!.status).toBe("success");
          expect(matching!.response).toBe(completed.response);
        }
      }),
      { numRuns: 15 },
    );
  });

  it("the partition into success/aborted/cancelled covers all tasks exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(arbTaskCount, arbConcurrency, async (taskCount, concurrency) => {
        resetTracking();

        for (let i = 0; i < taskCount; i++) {
          const delay = i < concurrency ? 5 : 400;
          taskDelays.set(`prompt-${i}`, delay);
        }

        const pool = buildPool(concurrency);
        const { manifest, tasks } = buildManifest(taskCount, concurrency);

        const dispatchPromise = pool.dispatch(manifest, tasks);

        // Cancel after fast tasks likely complete
        await new Promise((resolve) => setTimeout(resolve, 30));

        const poolAny = pool as any;
        const dispatches: Map<string, any> = poolAny.dispatches;
        const activeIds = Array.from(dispatches.keys());

        if (activeIds.length === 0) {
          const results = await dispatchPromise;
          expect(results.length).toBe(taskCount);
          return;
        }

        const dispatchId = activeIds[0];
        const partial = pool.cancel(dispatchId);

        const results = await dispatchPromise;

        // Extract the three partitions
        const successIds = results.filter((r) => r.status === "success").map((r) => r.taskId);
        const abortedIds = results.filter((r) => r.status === "aborted").map((r) => r.taskId);
        const cancelledIds = results.filter((r) => r.status === "cancelled").map((r) => r.taskId);

        const allPartitioned = [...successIds, ...abortedIds, ...cancelledIds];
        const allOriginal = tasks.map((t) => t.taskId);

        // Exact partition: all tasks accounted for, no duplicates
        expect(allPartitioned.sort()).toEqual(allOriginal.sort());
        expect(new Set(allPartitioned).size).toBe(allPartitioned.length);

        // Partial result counts should be consistent
        expect(partial.completedResults.length).toBe(successIds.length);
        expect(partial.abortedTaskIds.sort()).toEqual(abortedIds.sort());
        expect(partial.cancelledTaskIds.sort()).toEqual(cancelledIds.sort());
      }),
      { numRuns: 20 },
    );
  });

  it("cancel on a non-existent dispatch returns empty partial result", () => {
    fc.assert(
      fc.property(fc.uuid(), (fakeDispatchId) => {
        const pool = buildPool(1);
        const partial = pool.cancel(fakeDispatchId);

        expect(partial.status).toBe("cancelled");
        expect(partial.dispatchId).toBe(fakeDispatchId);
        expect(partial.completedResults).toEqual([]);
        expect(partial.cancelledTaskIds).toEqual([]);
        expect(partial.abortedTaskIds).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });
});
