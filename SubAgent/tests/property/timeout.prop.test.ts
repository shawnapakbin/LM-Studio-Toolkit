/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Property 29: Timeout Enforcement
// **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.8**

import { jest } from "@jest/globals";
import * as fc from "fast-check";
import { InternalTask, SessionPool } from "../../src/session-pool";
import type { SessionPoolConfig, TaskManifest } from "../../src/types";

// Increase Jest timeout for real-timer-based property tests
jest.setTimeout(60000);

// ─── Global Fetch Mock Infrastructure ────────────────────────────────────────

let taskResponseDelays: Map<string, number> = new Map();
const originalFetch = global.fetch;

function installFetchMock(): void {
  (global as any).fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    const userMsg = body.messages.find((m: any) => m.role === "user");
    const taskPrompt = userMsg?.content ?? "";
    const signal = init?.signal as AbortSignal | undefined;

    const delay = taskResponseDelays.get(taskPrompt) ?? 10;

    if (signal?.aborted) {
      throw new Error("Request aborted");
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, delay);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Request aborted"));
        });
      }
    });

    const responseBody = {
      choices: [
        {
          message: {
            role: "assistant",
            content: `Response for: ${taskPrompt}`,
            tool_calls: undefined,
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };

    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  };
}

function restoreFetchMock(): void {
  global.fetch = originalFetch;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetTracking(): void {
  taskResponseDelays = new Map();
}

function buildPool(concurrency: number): SessionPool {
  const config: SessionPoolConfig = {
    concurrency,
    apiUrl: "http://localhost:1234/v1/chat/completions",
    defaultTimeout: 3600,
  };
  return new SessionPool(config);
}

function buildTasks(taskCount: number): InternalTask[] {
  const tasks: InternalTask[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push({
      taskId: `task-${i}`,
      prompt: `prompt-${i}`,
      inputHash: `hash-${i.toString(16).padStart(8, "0")}`,
    });
  }
  return tasks;
}

function buildManifest(
  tasks: InternalTask[],
  opts: {
    concurrency?: number;
    taskTimeout?: number;
    dispatchTimeout?: number;
    maxRetries?: number;
  },
): TaskManifest {
  return {
    tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
    concurrency: opts.concurrency ?? 5,
    taskTimeout: opts.taskTimeout ?? 3600,
    dispatchTimeout: opts.dispatchTimeout ?? 14400,
    maxRetries: opts.maxRetries ?? 0,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbTaskCount = fc.integer({ min: 2, max: 6 });
const arbConcurrency = fc.integer({ min: 2, max: 4 });

// ─── Property 29: Timeout Enforcement ────────────────────────────────────────

describe("Property 29: Timeout Enforcement", () => {
  beforeEach(() => {
    resetTracking();
    installFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  describe("Per-task timeout aborts only that task while others continue", () => {
    it("a task exceeding its per-task timeout gets status 'timed_out' while others succeed", async () => {
      await fc.assert(
        fc.asyncProperty(arbTaskCount, arbConcurrency, async (taskCount, concurrency) => {
          resetTracking();

          const tasks = buildTasks(taskCount);
          // taskTimeout is in seconds — the pool multiplies by 1000
          // Use taskTimeout=1 (1000ms). Slow task takes 1500ms (exceeds 1000ms).
          // Fast tasks take 10ms.
          const slowIndex = 0;
          for (let i = 0; i < taskCount; i++) {
            if (i === slowIndex) {
              taskResponseDelays.set(`prompt-${i}`, 1500);
            } else {
              taskResponseDelays.set(`prompt-${i}`, 10);
            }
          }

          const manifest = buildManifest(tasks, {
            concurrency,
            taskTimeout: 1, // 1 second = 1000ms
            dispatchTimeout: 60, // High dispatch timeout — won't interfere
            maxRetries: 0,
          });

          const pool = buildPool(concurrency);
          const results = await pool.dispatch(manifest, tasks);

          expect(results.length).toBe(taskCount);

          // The slow task should be timed_out
          const slowResult = results.find((r) => r.taskId === `task-${slowIndex}`);
          expect(slowResult).toBeDefined();
          expect(slowResult!.status).toBe("timed_out");

          // All other tasks should succeed
          const otherResults = results.filter((r) => r.taskId !== `task-${slowIndex}`);
          for (const result of otherResults) {
            expect(result.status).toBe("success");
            expect(result.response).toBeDefined();
          }
        }),
        { numRuns: 3 },
      );
    }, 30000);

    it("multiple slow tasks each independently time out while fast tasks succeed", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 4, max: 6 }),
          fc.integer({ min: 2, max: 4 }),
          fc.integer({ min: 1, max: 2 }),
          async (taskCount, concurrency, slowCount) => {
            fc.pre(slowCount < taskCount);
            resetTracking();

            const tasks = buildTasks(taskCount);

            for (let i = 0; i < taskCount; i++) {
              if (i < slowCount) {
                taskResponseDelays.set(`prompt-${i}`, 1500); // Exceeds 1s timeout
              } else {
                taskResponseDelays.set(`prompt-${i}`, 10); // Fast
              }
            }

            const manifest = buildManifest(tasks, {
              concurrency,
              taskTimeout: 1, // 1 second
              dispatchTimeout: 60, // Won't interfere
              maxRetries: 0,
            });

            const pool = buildPool(concurrency);
            const results = await pool.dispatch(manifest, tasks);

            expect(results.length).toBe(taskCount);

            // Slow tasks should be timed_out
            for (let i = 0; i < slowCount; i++) {
              const result = results.find((r) => r.taskId === `task-${i}`);
              expect(result).toBeDefined();
              expect(result!.status).toBe("timed_out");
            }

            // Fast tasks should succeed
            for (let i = slowCount; i < taskCount; i++) {
              const result = results.find((r) => r.taskId === `task-${i}`);
              expect(result).toBeDefined();
              expect(result!.status).toBe("success");
            }
          },
        ),
        { numRuns: 3 },
      );
    }, 30000);
  });

  describe("Overall dispatch timeout aborts all remaining tasks", () => {
    it("when dispatch timeout expires, all slow tasks get non-success status", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 3, max: 6 }), async (taskCount) => {
          resetTracking();

          // All tasks are slow — they all exceed the dispatch timeout
          for (let i = 0; i < taskCount; i++) {
            taskResponseDelays.set(`prompt-${i}`, 3000);
          }

          // Concurrency 1 so tasks queue up serialized.
          // dispatchTimeout = 1s. First task starts immediately but takes 3000ms.
          // At 1s, dispatch abort fires. First task gets aborted. Rest are never started.
          const tasks = buildTasks(taskCount);
          const manifest = buildManifest(tasks, {
            concurrency: 1,
            taskTimeout: 60, // High per-task timeout — won't trigger
            dispatchTimeout: 1, // 1 second dispatch timeout
            maxRetries: 0,
          });

          const pool = buildPool(1);
          const results = await pool.dispatch(manifest, tasks);

          expect(results.length).toBe(taskCount);

          // No tasks should succeed since all are slow and dispatch times out
          const succeeded = results.filter((r) => r.status === "success");
          expect(succeeded.length).toBe(0);

          // All tasks should have a timeout/abort/cancelled status
          for (const result of results) {
            expect(["timed_out", "cancelled", "aborted", "failed"]).toContain(result.status);
            // Specifically: none should be "success"
          }
        }),
        { numRuns: 3 },
      );
    }, 30000);

    it("fast tasks that complete before dispatch timeout are preserved as success", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 4, max: 6 }),
          fc.integer({ min: 2, max: 3 }),
          async (taskCount, _concurrency) => {
            resetTracking();

            // All tasks are in the same concurrent batch (concurrency >= taskCount)
            // Fast tasks complete quickly, slow tasks exceed dispatch timeout.
            const effectiveConcurrency = taskCount;
            const fastCount = 2;

            for (let i = 0; i < taskCount; i++) {
              if (i < fastCount) {
                taskResponseDelays.set(`prompt-${i}`, 10); // 10ms — very fast
              } else {
                taskResponseDelays.set(`prompt-${i}`, 3000); // 3s — exceeds 1s dispatch timeout
              }
            }

            const tasks = buildTasks(taskCount);
            const manifest = buildManifest(tasks, {
              concurrency: effectiveConcurrency,
              taskTimeout: 60, // High per-task timeout
              dispatchTimeout: 1, // 1 second dispatch timeout
              maxRetries: 0,
            });

            const pool = buildPool(effectiveConcurrency);
            const results = await pool.dispatch(manifest, tasks);

            expect(results.length).toBe(taskCount);

            // Fast tasks that completed before dispatch timeout should be success
            for (let i = 0; i < fastCount; i++) {
              const result = results.find((r) => r.taskId === `task-${i}`);
              expect(result).toBeDefined();
              expect(result!.status).toBe("success");
            }

            // Slow tasks should be timed_out or aborted (dispatch abort fires their signal)
            for (let i = fastCount; i < taskCount; i++) {
              const result = results.find((r) => r.taskId === `task-${i}`);
              expect(result).toBeDefined();
              expect(["timed_out", "cancelled", "aborted"]).toContain(result!.status);
            }
          },
        ),
        { numRuns: 3 },
      );
    }, 30000);
  });

  describe("Whichever timeout expires first takes effect", () => {
    it("per-task timeout fires before dispatch timeout — only that task is aborted", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 3, max: 5 }), async (taskCount) => {
          resetTracking();

          const concurrency = taskCount; // All concurrent
          // One slow task exceeds per-task timeout (1s) but within dispatch timeout (60s)
          for (let i = 0; i < taskCount; i++) {
            if (i === 0) {
              taskResponseDelays.set(`prompt-${i}`, 1500); // Exceeds 1s per-task timeout
            } else {
              taskResponseDelays.set(`prompt-${i}`, 10); // Fast
            }
          }

          const tasks = buildTasks(taskCount);
          const manifest = buildManifest(tasks, {
            concurrency,
            taskTimeout: 1, // 1 second per-task
            dispatchTimeout: 60, // 60 seconds dispatch — won't interfere
            maxRetries: 0,
          });

          const pool = buildPool(concurrency);
          const results = await pool.dispatch(manifest, tasks);

          expect(results.length).toBe(taskCount);

          // Slow task timed out individually
          const slowResult = results.find((r) => r.taskId === "task-0");
          expect(slowResult!.status).toBe("timed_out");

          // Other tasks succeed (dispatch timeout didn't fire)
          const otherResults = results.filter((r) => r.taskId !== "task-0");
          for (const result of otherResults) {
            expect(result.status).toBe("success");
          }
        }),
        { numRuns: 3 },
      );
    }, 30000);

    it("dispatch timeout fires before per-task timeout — all remaining tasks aborted", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 3, max: 5 }), async (taskCount) => {
          resetTracking();

          // All tasks are moderately slow (2s), per-task timeout is high (60s)
          // but dispatch timeout is low (1s)
          for (let i = 0; i < taskCount; i++) {
            taskResponseDelays.set(`prompt-${i}`, 2000);
          }

          const tasks = buildTasks(taskCount);
          const manifest = buildManifest(tasks, {
            concurrency: 1, // Serialize to ensure queuing
            taskTimeout: 60, // High per-task timeout (60s)
            dispatchTimeout: 1, // Low dispatch timeout (1s)
            maxRetries: 0,
          });

          const pool = buildPool(1);
          const results = await pool.dispatch(manifest, tasks);

          expect(results.length).toBe(taskCount);

          // Dispatch timeout fires at 1s. Per-task timeout at 60s.
          // Dispatch fires first. No task should have succeeded.
          const succeeded = results.filter((r) => r.status === "success");
          expect(succeeded.length).toBe(0);

          // All tasks should be timed_out or cancelled
          for (const result of results) {
            expect(["timed_out", "cancelled", "aborted"]).toContain(result.status);
          }
        }),
        { numRuns: 3 },
      );
    }, 30000);
  });

  describe("Timed-out tasks do NOT trigger retries", () => {
    it("a task that times out is not retried regardless of maxRetries setting", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 2, max: 4 }),
          async (maxRetries, taskCount) => {
            resetTracking();

            const tasks = buildTasks(taskCount);
            // Make first task slow enough to time out
            taskResponseDelays.set("prompt-0", 1500);
            for (let i = 1; i < taskCount; i++) {
              taskResponseDelays.set(`prompt-${i}`, 10);
            }

            const manifest = buildManifest(tasks, {
              concurrency: taskCount, // All concurrent
              taskTimeout: 1, // 1 second timeout
              dispatchTimeout: 60,
              maxRetries, // High retry count — should NOT apply to timeouts
            });

            const pool = buildPool(taskCount);
            const results = await pool.dispatch(manifest, tasks);

            expect(results.length).toBe(taskCount);

            // The timed-out task should have status timed_out
            const timedOutResult = results.find((r) => r.taskId === "task-0");
            expect(timedOutResult).toBeDefined();
            expect(timedOutResult!.status).toBe("timed_out");

            // The error should indicate timeout type
            expect(timedOutResult!.error).toBeDefined();
            expect(timedOutResult!.error!.type).toBe("timeout");

            // Retries should not have been attempted (0 retryAttempts)
            expect(timedOutResult!.error!.retryAttempts).toBe(0);
          },
        ),
        { numRuns: 3 },
      );
    }, 30000);

    it("dispatch-level timeout aborts tasks without triggering retries", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 2, max: 4 }),
          async (maxRetries, taskCount) => {
            resetTracking();

            const tasks = buildTasks(taskCount);
            // All tasks take longer than dispatch timeout
            for (let i = 0; i < taskCount; i++) {
              taskResponseDelays.set(`prompt-${i}`, 3000);
            }

            const manifest = buildManifest(tasks, {
              concurrency: 1,
              taskTimeout: 60, // High per-task timeout
              dispatchTimeout: 1, // 1 second dispatch
              maxRetries, // Should NOT apply to timeout
            });

            const pool = buildPool(1);
            const results = await pool.dispatch(manifest, tasks);

            expect(results.length).toBe(taskCount);

            // All tasks that got a timed_out status should have 0 retryAttempts
            const timedOut = results.filter((r) => r.status === "timed_out");
            for (const result of timedOut) {
              expect(result.error).toBeDefined();
              expect(result.error!.retryAttempts).toBe(0);
            }

            // No tasks should have succeeded
            const succeeded = results.filter((r) => r.status === "success");
            expect(succeeded.length).toBe(0);
          },
        ),
        { numRuns: 3 },
      );
    }, 30000);
  });
});
