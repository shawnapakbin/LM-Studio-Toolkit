/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Feature: sub-agent-mcp
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

import { jest } from "@jest/globals";
import * as fc from "fast-check";
import { type InternalTask, SessionPool } from "../../src/session-pool";
import type { SessionPoolConfig, TaskManifest } from "../../src/types";

const API_URL = "http://localhost:1234/v1/chat/completions";

const DEFAULT_CONFIG: SessionPoolConfig = {
  concurrency: 10,
  apiUrl: API_URL,
  defaultTimeout: 3600,
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
};

// ─── Global Fetch Mock Infrastructure ────────────────────────────────────────

type FetchHandler = (url: string, options: any) => Promise<any>;

const originalFetch = global.fetch;
let currentFetchHandler: FetchHandler | null = null;

function installFetchMock(handler: FetchHandler): void {
  currentFetchHandler = handler;
  (global as any).fetch = async (url: string, options: any) => {
    if (!currentFetchHandler) throw new Error("No fetch handler installed");
    return currentFetchHandler(url, options);
  };
}

function restoreFetchMock(): void {
  global.fetch = originalFetch;
  currentFetchHandler = null;
}

/** Build a mock Response object mimicking a successful LM Studio API reply. */
function buildMockResponse(content: string, status = 200) {
  const responseBody = {
    choices: [{ message: { role: "assistant", content, tool_calls: null }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  };
}

/** Build a mock Response for a failed request (non-retryable 400). */
function buildFailedResponse(message: string) {
  return {
    ok: false,
    status: 400,
    json: async () => ({ error: { message } }),
    text: async () => JSON.stringify({ error: { message } }),
  };
}

/** UUID v4 regex pattern. */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Property 1: Session Isolation
 *
 * For any dispatch of N tasks, each Sub_Session's messages array, tool call
 * results, and token counters are independent instances with no shared
 * references — mutating one session's state never affects another.
 *
 * **Validates: Requirements 3.1, 3.2**
 */
describe("Property 1: Session Isolation", () => {
  afterEach(() => {
    restoreFetchMock();
    jest.clearAllMocks();
  });

  // Generator for task count (2–8 for test speed)
  const taskCountArb = fc.integer({ min: 2, max: 8 });
  // Generator for task prompts
  const taskPromptArb = fc.string({ minLength: 1, maxLength: 200 });

  it("each task result corresponds to its own unique prompt and session — no cross-contamination", async () => {
    await fc.assert(
      fc.asyncProperty(
        taskCountArb,
        fc.array(taskPromptArb, { minLength: 2, maxLength: 8 }),
        async (count, prompts) => {
          const taskPrompts = prompts.slice(0, Math.max(2, Math.min(count, prompts.length)));

          // Mock fetch to echo the user message content in the response
          installFetchMock(async (_url, options) => {
            const body = JSON.parse(options.body);
            const userMsg = body.messages.find((m: any) => m.role === "user");
            return buildMockResponse(`Response to: ${userMsg?.content ?? "unknown"}`);
          });

          const tasks: InternalTask[] = taskPrompts.map((prompt, i) => ({
            taskId: `task-${i}`,
            prompt,
            inputHash: `hash-${i}`,
          }));

          const manifest: TaskManifest = {
            tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
            concurrency: taskPrompts.length,
          };

          const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
          const results = await pool.dispatch(manifest, tasks);

          // Each result should have content corresponding to its own prompt
          for (let i = 0; i < taskPrompts.length; i++) {
            const result = results.find((r) => r.taskId === `task-${i}`);
            expect(result).toBeDefined();
            expect(result!.response).toContain(taskPrompts[i]);
          }

          // Verify each session got independent sessionIds
          const sessionIds = results.map((r) => r.sessionId);
          expect(new Set(sessionIds).size).toBe(sessionIds.length);
        },
      ),
      { numRuns: 5 },
    );
  });

  it("results from one session are not shared references with another session", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (count) => {
        installFetchMock(async () => buildMockResponse("independent response"));

        const tasks: InternalTask[] = Array.from({ length: count }, (_, i) => ({
          taskId: `task-${i}`,
          prompt: `Prompt for task ${i}`,
          inputHash: `hash-${i}`,
        }));

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: count,
        };

        const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
        const results = await pool.dispatch(manifest, tasks);

        // Verify that telemetry objects are independent instances (not same reference)
        for (let i = 0; i < results.length; i++) {
          for (let j = i + 1; j < results.length; j++) {
            if (results[i].telemetry && results[j].telemetry) {
              expect(results[i].telemetry).not.toBe(results[j].telemetry);
            }
          }
        }
      }),
      { numRuns: 5 },
    );
  });

  it("task-specific system prompts are isolated — one task's system prompt does not appear in another's result", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 5, maxLength: 100 }), { minLength: 2, maxLength: 5 }),
        async (systemPrompts) => {
          // Mock echoes the system prompt in the response
          installFetchMock(async (_url, options) => {
            const body = JSON.parse(options.body);
            const systemMsg = body.messages.find((m: any) => m.role === "system");
            return buildMockResponse(`SystemPrompt: ${systemMsg?.content ?? "none"}`);
          });

          const tasks: InternalTask[] = systemPrompts.map((sp, i) => ({
            taskId: `task-${i}`,
            prompt: `Do task ${i}`,
            systemPrompt: sp,
            inputHash: `hash-${i}`,
          }));

          const manifest: TaskManifest = {
            tasks: tasks.map((t) => ({
              taskId: t.taskId,
              prompt: t.prompt,
              systemPrompt: t.systemPrompt,
            })),
            concurrency: systemPrompts.length,
          };

          const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
          const results = await pool.dispatch(manifest, tasks);

          // Each result should reference its OWN system prompt, not another's
          for (let i = 0; i < systemPrompts.length; i++) {
            const result = results.find((r) => r.taskId === `task-${i}`);
            expect(result).toBeDefined();
            expect(result!.response).toContain(systemPrompts[i]);
          }
        },
      ),
      { numRuns: 5 },
    );
  });
});

/**
 * Property 2: Session ID Uniqueness
 *
 * For any dispatch, all session identifiers are valid UUID v4 strings
 * and globally unique across sessions.
 *
 * **Validates: Requirements 3.3**
 */
describe("Property 2: Session ID Uniqueness", () => {
  afterEach(() => {
    restoreFetchMock();
    jest.clearAllMocks();
  });

  const taskCountArb = fc.integer({ min: 1, max: 10 });

  it("all session IDs are valid UUID v4 format", async () => {
    await fc.assert(
      fc.asyncProperty(taskCountArb, async (count) => {
        installFetchMock(async () => buildMockResponse("ok"));

        const tasks: InternalTask[] = Array.from({ length: count }, (_, i) => ({
          taskId: `task-${i}`,
          prompt: `Task ${i}`,
          inputHash: `hash-${i}`,
        }));

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: count,
        };

        const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
        const results = await pool.dispatch(manifest, tasks);

        for (const result of results) {
          expect(result.sessionId).toMatch(UUID_V4_REGEX);
        }
      }),
      { numRuns: 5 },
    );
  });

  it("all session IDs within a single dispatch are globally unique", async () => {
    await fc.assert(
      fc.asyncProperty(taskCountArb, async (count) => {
        installFetchMock(async () => buildMockResponse("ok"));

        const tasks: InternalTask[] = Array.from({ length: count }, (_, i) => ({
          taskId: `task-${i}`,
          prompt: `Task ${i}`,
          inputHash: `hash-${i}`,
        }));

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: count,
        };

        const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
        const results = await pool.dispatch(manifest, tasks);

        const sessionIds = results.map((r) => r.sessionId);
        const uniqueIds = new Set(sessionIds);
        expect(uniqueIds.size).toBe(sessionIds.length);
      }),
      { numRuns: 5 },
    );
  });

  it("session IDs across concurrent dispatches are globally unique", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 2, max: 4 }),
        async (dispatchCount, tasksPerDispatch) => {
          installFetchMock(async () => buildMockResponse("ok"));

          const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
          const allResults = await Promise.all(
            Array.from({ length: dispatchCount }, (_, d) => {
              const tasks: InternalTask[] = Array.from({ length: tasksPerDispatch }, (_, i) => ({
                taskId: `dispatch-${d}-task-${i}`,
                prompt: `Task ${i} in dispatch ${d}`,
                inputHash: `hash-${d}-${i}`,
              }));
              const manifest: TaskManifest = {
                tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
                concurrency: tasksPerDispatch,
              };
              return pool.dispatch(manifest, tasks);
            }),
          );

          const allSessionIds = allResults.flat().map((r) => r.sessionId);
          const uniqueIds = new Set(allSessionIds);
          expect(uniqueIds.size).toBe(allSessionIds.length);
        },
      ),
      { numRuns: 5 },
    );
  });
});

/**
 * Property 3: Failure Isolation
 *
 * For any dispatch where one or more Sub_Sessions fail, all completed
 * results are preserved intact.
 *
 * **Validates: Requirements 3.4, 3.5**
 */
describe("Property 3: Failure Isolation", () => {
  afterEach(() => {
    restoreFetchMock();
    jest.clearAllMocks();
  });

  // Generator for deciding which tasks succeed vs fail (must have at least one of each)
  const taskOutcomesArb = fc
    .array(fc.boolean(), { minLength: 2, maxLength: 8 })
    .filter((outcomes) => outcomes.includes(true) && outcomes.includes(false));

  it("successful tasks preserve their results when other tasks fail", async () => {
    await fc.assert(
      fc.asyncProperty(taskOutcomesArb, async (outcomes) => {
        // Track request order via user message content
        installFetchMock(async (_url, options) => {
          const body = JSON.parse(options.body);
          const userMsg = body.messages.find((m: any) => m.role === "user");
          const content: string = userMsg?.content ?? "";
          // Extract task index from "Task N" pattern
          const match = content.match(/Task (\d+)/);
          const idx = match ? parseInt(match[1], 10) : -1;

          if (idx >= 0 && idx < outcomes.length && outcomes[idx]) {
            return buildMockResponse(`Success for task-${idx}`);
          }
          return buildFailedResponse("Bad request");
        });

        const tasks: InternalTask[] = outcomes.map((_, i) => ({
          taskId: `task-${i}`,
          prompt: `Task ${i}`,
          inputHash: `hash-${i}`,
        }));

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: 1,
          maxRetries: 0,
        };

        const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
        const results = await pool.dispatch(manifest, tasks);

        // All tasks should have results
        expect(results.length).toBe(outcomes.length);

        // Successful tasks should be preserved with their responses
        for (let i = 0; i < outcomes.length; i++) {
          const result = results.find((r) => r.taskId === `task-${i}`);
          expect(result).toBeDefined();
          if (outcomes[i]) {
            expect(result!.status).toBe("success");
            expect(result!.response).toBeDefined();
            expect(result!.response!.length).toBeGreaterThan(0);
          } else {
            expect(result!.status).toBe("failed");
            expect(result!.error).toBeDefined();
          }
        }
      }),
      { numRuns: 5 },
    );
  });

  it("failed task count plus successful task count equals total tasks dispatched", async () => {
    await fc.assert(
      fc.asyncProperty(taskOutcomesArb, async (outcomes) => {
        installFetchMock(async (_url, options) => {
          const body = JSON.parse(options.body);
          const userMsg = body.messages.find((m: any) => m.role === "user");
          const content: string = userMsg?.content ?? "";
          const match = content.match(/Task (\d+)/);
          const idx = match ? parseInt(match[1], 10) : -1;

          if (idx >= 0 && idx < outcomes.length && outcomes[idx]) {
            return buildMockResponse("ok");
          }
          return buildFailedResponse("fail");
        });

        const tasks: InternalTask[] = outcomes.map((_, i) => ({
          taskId: `task-${i}`,
          prompt: `Task ${i}`,
          inputHash: `hash-${i}`,
        }));

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: 1,
          maxRetries: 0,
        };

        const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
        const results = await pool.dispatch(manifest, tasks);

        const successCount = results.filter((r) => r.status === "success").length;
        const failedCount = results.filter((r) => r.status === "failed").length;
        expect(successCount + failedCount).toBe(outcomes.length);
        expect(successCount).toBe(outcomes.filter((o) => o).length);
        expect(failedCount).toBe(outcomes.filter((o) => !o).length);
      }),
      { numRuns: 5 },
    );
  });

  it("a single failure among many does not affect other sessions' completeness", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 8 }),
        fc.integer({ min: 0, max: 7 }),
        async (totalTasks, failIndex) => {
          const actualFailIndex = failIndex % totalTasks;

          installFetchMock(async (_url, options) => {
            const body = JSON.parse(options.body);
            const userMsg = body.messages.find((m: any) => m.role === "user");
            const content: string = userMsg?.content ?? "";
            const match = content.match(/Task (\d+)/);
            const idx = match ? parseInt(match[1], 10) : -1;

            if (idx === actualFailIndex) {
              return buildFailedResponse("Simulated failure");
            }
            return buildMockResponse(`Result ${idx}`);
          });

          const tasks: InternalTask[] = Array.from({ length: totalTasks }, (_, i) => ({
            taskId: `task-${i}`,
            prompt: `Task ${i}`,
            inputHash: `hash-${i}`,
          }));

          const manifest: TaskManifest = {
            tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
            concurrency: 1,
            maxRetries: 0,
          };

          const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
          const results = await pool.dispatch(manifest, tasks);

          // All results accounted for
          expect(results.length).toBe(totalTasks);

          // Exactly one failure
          const failed = results.filter((r) => r.status === "failed");
          expect(failed.length).toBe(1);

          // All other tasks succeeded
          const succeeded = results.filter((r) => r.status === "success");
          expect(succeeded.length).toBe(totalTasks - 1);

          // All successful results have non-empty responses
          for (const result of succeeded) {
            expect(result.response).toBeDefined();
            expect(result.response!.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 5 },
    );
  });

  it("each successful result has its own unique sessionId even when failures occur", async () => {
    await fc.assert(
      fc.asyncProperty(taskOutcomesArb, async (outcomes) => {
        installFetchMock(async (_url, options) => {
          const body = JSON.parse(options.body);
          const userMsg = body.messages.find((m: any) => m.role === "user");
          const content: string = userMsg?.content ?? "";
          const match = content.match(/Task (\d+)/);
          const idx = match ? parseInt(match[1], 10) : -1;

          if (idx >= 0 && idx < outcomes.length && outcomes[idx]) {
            return buildMockResponse("ok");
          }
          return buildFailedResponse("fail");
        });

        const tasks: InternalTask[] = outcomes.map((_, i) => ({
          taskId: `task-${i}`,
          prompt: `Task ${i}`,
          inputHash: `hash-${i}`,
        }));

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: 1,
          maxRetries: 0,
        };

        const pool = new SessionPool(DEFAULT_CONFIG, mockLogger as any);
        const results = await pool.dispatch(manifest, tasks);

        // All results (success and failed) should have unique session IDs
        const allSessionIds = results.map((r) => r.sessionId);
        const uniqueSessionIds = new Set(allSessionIds);
        expect(uniqueSessionIds.size).toBe(allSessionIds.length);
      }),
      { numRuns: 5 },
    );
  });
});
