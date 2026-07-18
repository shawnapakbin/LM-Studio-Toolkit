import * as fc from "fast-check";
import { InternalTask, SessionPool } from "../../src/session-pool";
import type { SessionPoolConfig, TaskManifest } from "../../src/types";

// ─── Global Fetch Mock Infrastructure ────────────────────────────────────────

let concurrentCount = 0;
let peakConcurrent = 0;
const arrivalOrder: string[] = [];
let responseDelay = 20;

const originalFetch = global.fetch;

function installFetchMock(): void {
  (global as any).fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    const userMsg = body.messages.find((m: any) => m.role === "user");
    const taskPrompt = userMsg?.content ?? "";

    arrivalOrder.push(taskPrompt);

    concurrentCount++;
    if (concurrentCount > peakConcurrent) {
      peakConcurrent = concurrentCount;
    }

    // Simulate API processing time with abort support
    await new Promise<void>((resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      const timeout = setTimeout(resolve, responseDelay);
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Request aborted"));
        });
      }
    });

    concurrentCount--;

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
  concurrentCount = 0;
  peakConcurrent = 0;
  arrivalOrder.length = 0;
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
      inputHash: `hash-${i}`,
    });
  }
  const manifest: TaskManifest = {
    tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
    concurrency,
    maxRetries: 0,
    taskTimeout: 300,
    dispatchTimeout: 600,
  };
  return { manifest, tasks };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const arbConcurrency = fc.integer({ min: 1, max: 5 });
const arbTaskCount = fc.integer({ min: 2, max: 10 });

// ─── Property 17: Concurrency Limit Enforcement ──────────────────────────────

describe("Property 17: Concurrency Limit Enforcement", () => {
  beforeEach(() => {
    resetTracking();
    responseDelay = 20;
    installFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it("the number of concurrent in-flight HTTP requests never exceeds N", async () => {
    await fc.assert(
      fc.asyncProperty(arbConcurrency, arbTaskCount, async (concurrency, taskCount) => {
        resetTracking();
        responseDelay = 20;

        const pool = buildPool(concurrency);
        const { manifest, tasks } = buildManifest(taskCount, concurrency);

        await pool.dispatch(manifest, tasks);

        // The peak concurrent requests must never exceed the concurrency limit
        expect(peakConcurrent).toBeLessThanOrEqual(concurrency);
        // All tasks should have completed
        expect(arrivalOrder.length).toBe(taskCount);
      }),
      { numRuns: 10 },
    );
  });

  it("with concurrency 1, requests are fully serialized (peak is exactly 1)", async () => {
    await fc.assert(
      fc.asyncProperty(arbTaskCount, async (taskCount) => {
        resetTracking();
        responseDelay = 15;

        const pool = buildPool(1);
        const { manifest, tasks } = buildManifest(taskCount, 1);

        await pool.dispatch(manifest, tasks);

        expect(peakConcurrent).toBe(1);
        expect(arrivalOrder.length).toBe(taskCount);
      }),
      { numRuns: 5 },
    );
  });

  it("with concurrency >= task count, all tasks can start immediately but never exceed N", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (taskCount) => {
        const concurrency = taskCount + 2; // concurrency > taskCount
        resetTracking();
        responseDelay = 30;

        const pool = buildPool(concurrency);
        const { manifest, tasks } = buildManifest(taskCount, concurrency);

        await pool.dispatch(manifest, tasks);

        // Even though concurrency > taskCount, peak should be at most taskCount
        expect(peakConcurrent).toBeLessThanOrEqual(Math.min(concurrency, taskCount));
        expect(peakConcurrent).toBeLessThanOrEqual(concurrency);
        expect(arrivalOrder.length).toBe(taskCount);
      }),
      { numRuns: 5 },
    );
  });
});

// ─── Property 18: FIFO Dispatch Ordering ─────────────────────────────────────

describe("Property 18: FIFO Dispatch Ordering", () => {
  beforeEach(() => {
    resetTracking();
    responseDelay = 20;
    installFetchMock();
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it("tasks are dispatched in array-position order from the TaskManifest", async () => {
    await fc.assert(
      fc.asyncProperty(arbConcurrency, arbTaskCount, async (concurrency, taskCount) => {
        resetTracking();
        responseDelay = 20;

        const pool = buildPool(concurrency);
        const { manifest, tasks } = buildManifest(taskCount, concurrency);

        await pool.dispatch(manifest, tasks);

        // Verify all tasks were dispatched
        expect(arrivalOrder.length).toBe(taskCount);

        // Verify FIFO ordering: tasks should arrive in array-position order.
        for (let i = 0; i < taskCount; i++) {
          expect(arrivalOrder[i]).toBe(`prompt-${i}`);
        }
      }),
      { numRuns: 10 },
    );
  });

  it("with concurrency 1, tasks arrive strictly in sequential array order", async () => {
    await fc.assert(
      fc.asyncProperty(arbTaskCount, async (taskCount) => {
        resetTracking();
        responseDelay = 10;

        const pool = buildPool(1);
        const { manifest, tasks } = buildManifest(taskCount, 1);

        await pool.dispatch(manifest, tasks);

        expect(arrivalOrder.length).toBe(taskCount);
        for (let i = 0; i < taskCount; i++) {
          expect(arrivalOrder[i]).toBe(`prompt-${i}`);
        }
      }),
      { numRuns: 5 },
    );
  });

  it("tasks dispatched before index i always arrive at the API before tasks at index >= i+concurrency", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 4, max: 10 }),
        async (concurrency, taskCount) => {
          fc.pre(taskCount > concurrency);
          resetTracking();
          responseDelay = 25;

          const pool = buildPool(concurrency);
          const { manifest, tasks } = buildManifest(taskCount, concurrency);

          await pool.dispatch(manifest, tasks);

          expect(arrivalOrder.length).toBe(taskCount);

          // For FIFO: task at position i must appear in arrivalOrder before
          // task at position i + 1 (strict FIFO ordering).
          for (let i = 0; i < taskCount - 1; i++) {
            const posI = arrivalOrder.indexOf(`prompt-${i}`);
            const posNext = arrivalOrder.indexOf(`prompt-${i + 1}`);
            expect(posI).toBeLessThan(posNext);
          }
        },
      ),
      { numRuns: 5 },
    );
  });
});
