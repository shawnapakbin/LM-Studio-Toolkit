/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Feature: sub-agent-mcp
// **Validates: Requirements 18.6**

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

// ─── Mock Logger that records all calls ──────────────────────────────────────

interface LogCall {
  level: string;
  message: string;
  metadata: Record<string, unknown>;
}

function createRecordingLogger(): { logger: any; calls: LogCall[] } {
  const calls: LogCall[] = [];

  const makeHandler = (level: string) => (message: string, metadata?: Record<string, unknown>) => {
    calls.push({ level, message, metadata: metadata ?? {} });
  };

  const logger = {
    info: jest.fn(makeHandler("info")),
    warn: jest.fn(makeHandler("warn")),
    error: jest.fn(makeHandler("error")),
    debug: jest.fn(makeHandler("debug")),
    trace: jest.fn(makeHandler("trace")),
  };

  return { logger, calls };
}

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

/** Build a mock Response for a successful LM Studio API reply. */
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
 * Property 30: TraceId Correlation
 *
 * For any dispatch operation, all structured log entries produced during that
 * dispatch include the dispatch identifier as the traceId field, enabling
 * full correlation of related log entries.
 *
 * **Validates: Requirements 18.6**
 */
describe("Property 30: TraceId Correlation", () => {
  afterEach(() => {
    restoreFetchMock();
    jest.clearAllMocks();
  });

  const taskCountArb = fc.integer({ min: 1, max: 8 });

  it("every log entry produced during a dispatch contains a traceId field", async () => {
    await fc.assert(
      fc.asyncProperty(taskCountArb, async (count) => {
        const { logger, calls } = createRecordingLogger();
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

        const pool = new SessionPool(DEFAULT_CONFIG, logger as any);
        await pool.dispatch(manifest, tasks);

        // All log entries must have a traceId field
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          expect(call.metadata).toHaveProperty("traceId");
        }
      }),
      { numRuns: 5 },
    );
  });

  it("the traceId is consistent across all log entries within a single dispatch", async () => {
    await fc.assert(
      fc.asyncProperty(taskCountArb, async (count) => {
        const { logger, calls } = createRecordingLogger();
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

        const pool = new SessionPool(DEFAULT_CONFIG, logger as any);
        await pool.dispatch(manifest, tasks);

        // All entries should share the same traceId
        expect(calls.length).toBeGreaterThan(0);
        const traceIds = new Set(calls.map((c) => c.metadata.traceId));
        expect(traceIds.size).toBe(1);
      }),
      { numRuns: 5 },
    );
  });

  it("the traceId matches UUID v4 format (the dispatchId)", async () => {
    await fc.assert(
      fc.asyncProperty(taskCountArb, async (count) => {
        const { logger, calls } = createRecordingLogger();
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

        const pool = new SessionPool(DEFAULT_CONFIG, logger as any);
        await pool.dispatch(manifest, tasks);

        // The traceId should be a valid UUID v4
        expect(calls.length).toBeGreaterThan(0);
        const traceId = calls[0].metadata.traceId as string;
        expect(traceId).toMatch(UUID_V4_REGEX);
      }),
      { numRuns: 5 },
    );
  });

  it("different dispatches produce different traceIds", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        async (dispatchCount, tasksPerDispatch) => {
          const { logger, calls } = createRecordingLogger();
          installFetchMock(async () => buildMockResponse("ok"));

          const pool = new SessionPool(DEFAULT_CONFIG, logger as any);

          for (let d = 0; d < dispatchCount; d++) {
            const tasks: InternalTask[] = Array.from({ length: tasksPerDispatch }, (_, i) => ({
              taskId: `d${d}-task-${i}`,
              prompt: `Dispatch ${d} Task ${i}`,
              inputHash: `hash-${d}-${i}`,
            }));

            const manifest: TaskManifest = {
              tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
              concurrency: tasksPerDispatch,
            };

            await pool.dispatch(manifest, tasks);
          }

          // Collect distinct traceIds across all log entries
          const allTraceIds = new Set(calls.map((c) => c.metadata.traceId as string));
          expect(allTraceIds.size).toBe(dispatchCount);
        },
      ),
      { numRuns: 5 },
    );
  });

  it("traceId is present in warn-level log entries when tasks fail", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (count) => {
        const { logger, calls } = createRecordingLogger();
        // Fail all tasks with non-retryable error
        installFetchMock(async () => buildFailedResponse("Simulated failure"));

        const tasks: InternalTask[] = Array.from({ length: count }, (_, i) => ({
          taskId: `task-${i}`,
          prompt: `Task ${i}`,
          inputHash: `hash-${i}`,
        }));

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: count,
          maxRetries: 0,
        };

        const pool = new SessionPool(DEFAULT_CONFIG, logger as any);
        await pool.dispatch(manifest, tasks);

        // Filter warn-level entries (task failure logs)
        const warnCalls = calls.filter((c) => c.level === "warn");
        expect(warnCalls.length).toBeGreaterThan(0);

        // All warn entries must have the traceId
        for (const call of warnCalls) {
          expect(call.metadata).toHaveProperty("traceId");
          expect(call.metadata.traceId).toMatch(UUID_V4_REGEX);
        }

        // The traceId in warn entries matches the one in info entries
        const infoTraceIds = new Set(
          calls.filter((c) => c.level === "info").map((c) => c.metadata.traceId),
        );
        for (const call of warnCalls) {
          expect(infoTraceIds.has(call.metadata.traceId)).toBe(true);
        }
      }),
      { numRuns: 5 },
    );
  });

  it("traceId is present in progress update log entries", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (count) => {
        const { logger, calls } = createRecordingLogger();
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

        const pool = new SessionPool(DEFAULT_CONFIG, logger as any);
        await pool.dispatch(manifest, tasks);

        // Find progress-related log entries
        const progressCalls = calls.filter(
          (c) => c.message.includes("Progress") || c.message.includes("progress"),
        );

        // All progress entries (if any) should have traceId
        for (const call of progressCalls) {
          expect(call.metadata).toHaveProperty("traceId");
          expect(call.metadata.traceId).toMatch(UUID_V4_REGEX);
        }
      }),
      { numRuns: 5 },
    );
  });
});
