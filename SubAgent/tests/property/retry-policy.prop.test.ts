/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Property 21: Retry Policy Correctness
// **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.6**

import { jest } from "@jest/globals";
import * as fc from "fast-check";
import {
  type HttpClientConfig,
  type LMStudioRequest,
  sendChatCompletion,
} from "../../src/http-client";
import { SessionPool } from "../../src/session-pool";
import type { TaskManifest } from "../../src/types";

// Increase Jest timeout for retry tests with real timers
jest.setTimeout(60000);

// ─── Mock Logger ─────────────────────────────────────────────────────────────

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildRequest(): LMStudioRequest {
  return {
    model: "default",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ],
    temperature: 0.7,
    max_tokens: 100,
  };
}

function successResponseBody() {
  return {
    choices: [
      {
        message: { role: "assistant", content: "Hello!", tool_calls: undefined },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Retryable HTTP status codes: 429, 500-599 */
const arbRetryableStatus = fc.oneof(fc.constant(429), fc.integer({ min: 500, max: 599 }));

/** Non-retryable HTTP status codes: 400-498 (excluding 429) */
const arbNonRetryableStatus = fc.integer({ min: 400, max: 498 }).filter((s) => s !== 429);

/** Max retries: 1-2 (kept low for test speed with real timers — each retry has exponential backoff) */
const arbMaxRetries = fc.integer({ min: 1, max: 2 });

// ─── Global Fetch Mock Infrastructure ────────────────────────────────────────

const originalFetch = global.fetch;

function restoreFetch(): void {
  global.fetch = originalFetch;
}

// ─── Property 21: Retry Policy Correctness ───────────────────────────────────

describe("Property 21: Retry Policy Correctness", () => {
  let fetchCallCount: number;

  beforeEach(() => {
    fetchCallCount = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    restoreFetch();
  });

  describe("Retryable errors trigger retries up to maxRetries times", () => {
    it("retryable HTTP status codes cause exactly maxRetries+1 total fetch calls", async () => {
      await fc.assert(
        fc.asyncProperty(arbRetryableStatus, arbMaxRetries, async (statusCode, maxRetries) => {
          fetchCallCount = 0;

          // Mock fetch to always return a retryable error
          (global as any).fetch = async () => {
            fetchCallCount++;
            return {
              ok: false,
              status: statusCode,
              text: async () => `Error ${statusCode}`,
              json: async () => ({ error: `Error ${statusCode}` }),
            };
          };

          const config: HttpClientConfig = {
            apiUrl: "http://localhost:1234/v1/chat/completions",
            model: "default",
            maxRetries,
          };
          const signal = new AbortController().signal;

          // Should throw after exhausting all retries
          await expect(
            sendChatCompletion(config, buildRequest(), signal, mockLogger as any, "trace-1"),
          ).rejects.toThrow();

          // Total fetch calls = 1 initial + maxRetries retries
          expect(fetchCallCount).toBe(maxRetries + 1);
        }),
        { numRuns: 2 },
      );
    }, 30000);

    it("connection errors (fetch throws) are retried up to maxRetries times", async () => {
      await fc.assert(
        fc.asyncProperty(arbMaxRetries, async (maxRetries) => {
          fetchCallCount = 0;

          // Mock fetch to throw a connection error
          (global as any).fetch = async () => {
            fetchCallCount++;
            throw new Error("Connection refused");
          };

          const config: HttpClientConfig = {
            apiUrl: "http://localhost:1234/v1/chat/completions",
            model: "default",
            maxRetries,
          };
          const signal = new AbortController().signal;

          await expect(
            sendChatCompletion(config, buildRequest(), signal, mockLogger as any, "trace-2"),
          ).rejects.toThrow();

          // Total fetch calls = 1 initial + maxRetries retries
          expect(fetchCallCount).toBe(maxRetries + 1);
        }),
        { numRuns: 2 },
      );
    }, 30000);

    it("retryable errors that succeed within retry limit produce success", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRetryableStatus,
          arbMaxRetries,
          fc.integer({ min: 1, max: 2 }),
          async (statusCode, maxRetries, failCount) => {
            // Ensure we fail fewer times than allowed retries
            fc.pre(failCount <= maxRetries);
            fetchCallCount = 0;

            // Mock fetch to fail `failCount` times then succeed
            (global as any).fetch = async () => {
              fetchCallCount++;
              if (fetchCallCount <= failCount) {
                return {
                  ok: false,
                  status: statusCode,
                  text: async () => `Error ${statusCode}`,
                  json: async () => ({ error: `Error ${statusCode}` }),
                };
              }
              return {
                ok: true,
                status: 200,
                json: async () => successResponseBody(),
                text: async () => JSON.stringify(successResponseBody()),
              };
            };

            const config: HttpClientConfig = {
              apiUrl: "http://localhost:1234/v1/chat/completions",
              model: "default",
              maxRetries,
            };
            const signal = new AbortController().signal;

            const { result, retryAttempts } = await sendChatCompletion(
              config,
              buildRequest(),
              signal,
              mockLogger as any,
              "trace-3",
            );

            // Should succeed
            expect(result.response.choices[0].message.content).toBe("Hello!");
            // Retry attempts should equal the number of failures
            expect(retryAttempts).toBe(failCount);
            // Total fetch calls = failCount + 1 successful
            expect(fetchCallCount).toBe(failCount + 1);
          },
        ),
        { numRuns: 2 },
      );
    }, 30000);
  });

  describe("Non-retryable errors (HTTP 400-498 excluding 429) do NOT retry", () => {
    it("non-retryable client errors result in exactly 1 fetch call", async () => {
      await fc.assert(
        fc.asyncProperty(arbNonRetryableStatus, async (statusCode) => {
          fetchCallCount = 0;

          // Mock fetch to return a non-retryable error
          (global as any).fetch = async () => {
            fetchCallCount++;
            return {
              ok: false,
              status: statusCode,
              text: async () => `Client error ${statusCode}`,
              json: async () => ({ error: `Client error ${statusCode}` }),
            };
          };

          const config: HttpClientConfig = {
            apiUrl: "http://localhost:1234/v1/chat/completions",
            model: "default",
            maxRetries: 5, // High maxRetries to prove it doesn't retry
          };
          const signal = new AbortController().signal;

          let thrownError: any;
          try {
            await sendChatCompletion(config, buildRequest(), signal, mockLogger as any, "trace-4");
          } catch (err) {
            thrownError = err;
          }

          // Should have thrown with the status code
          expect(thrownError).toBeDefined();
          expect(thrownError.httpStatus).toBe(statusCode);

          // Only 1 attempt — no retries for non-retryable errors
          expect(fetchCallCount).toBe(1);
        }),
        { numRuns: 2 },
      );
    }, 15000);
  });

  describe("Only the individual failed task is retried, never the entire batch", () => {
    it("in a multi-task dispatch, only the failing task makes multiple fetch calls", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRetryableStatus,
          fc.integer({ min: 2, max: 3 }),
          async (statusCode, taskCount) => {
            const attemptsByPrompt = new Map<string, number>();

            // Mock fetch: first task (prompt-0) always fails, rest succeed
            (global as any).fetch = async (_url: string | URL | Request, init?: RequestInit) => {
              const body = JSON.parse(init?.body as string);
              const userMsg = body.messages.find((m: any) => m.role === "user");
              const prompt = userMsg?.content ?? "";

              const count = (attemptsByPrompt.get(prompt) ?? 0) + 1;
              attemptsByPrompt.set(prompt, count);

              if (prompt === "prompt-0") {
                return {
                  ok: false,
                  status: statusCode,
                  text: async () => `Error ${statusCode}`,
                  json: async () => ({ error: `Error ${statusCode}` }),
                };
              }

              return {
                ok: true,
                status: 200,
                json: async () => successResponseBody(),
                text: async () => JSON.stringify(successResponseBody()),
              };
            };

            const maxRetries = 1; // Keep low for speed
            const pool = new SessionPool({
              concurrency: 1,
              apiUrl: "http://localhost:1234/v1/chat/completions",
              defaultTimeout: 3600,
            });

            const tasks = Array.from({ length: taskCount }, (_, i) => ({
              taskId: `task-${i}`,
              prompt: `prompt-${i}`,
              inputHash: `hash-${i}`,
            }));

            const manifest: TaskManifest = {
              tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
              concurrency: 1,
              maxRetries,
              taskTimeout: 300,
              dispatchTimeout: 600,
            };

            const results = await pool.dispatch(manifest, tasks);

            // The failing task should have made maxRetries + 1 attempts
            const failingAttempts = attemptsByPrompt.get("prompt-0") ?? 0;
            expect(failingAttempts).toBe(maxRetries + 1);

            // All other tasks should have exactly 1 attempt each
            for (let i = 1; i < taskCount; i++) {
              const attempts = attemptsByPrompt.get(`prompt-${i}`) ?? 0;
              expect(attempts).toBe(1);
            }

            // The first task should be failed
            const failedResult = results.find((r) => r.taskId === "task-0");
            expect(failedResult).toBeDefined();
            expect(failedResult!.status).toBe("failed");

            // Other tasks should be successful
            const successResults = results.filter((r) => r.taskId !== "task-0");
            for (const result of successResults) {
              expect(result.status).toBe("success");
            }
          },
        ),
        { numRuns: 2 },
      );
    }, 45000);
  });

  describe("maxRetries parameter controls retry count", () => {
    it("maxRetries=0 means no retries — exactly 1 fetch call", async () => {
      await fc.assert(
        fc.asyncProperty(arbRetryableStatus, async (statusCode) => {
          fetchCallCount = 0;

          (global as any).fetch = async () => {
            fetchCallCount++;
            return {
              ok: false,
              status: statusCode,
              text: async () => `Error ${statusCode}`,
              json: async () => ({ error: `Error ${statusCode}` }),
            };
          };

          const config: HttpClientConfig = {
            apiUrl: "http://localhost:1234/v1/chat/completions",
            model: "default",
            maxRetries: 0,
          };
          const signal = new AbortController().signal;

          await expect(
            sendChatCompletion(config, buildRequest(), signal, mockLogger as any, "trace-5"),
          ).rejects.toThrow();

          // With maxRetries=0, only 1 attempt
          expect(fetchCallCount).toBe(1);
        }),
        { numRuns: 2 },
      );
    }, 15000);

    it("arbitrary maxRetries N results in exactly N+1 total attempts on persistent failure", async () => {
      await fc.assert(
        fc.asyncProperty(
          arbRetryableStatus,
          fc.integer({ min: 0, max: 2 }),
          async (statusCode, maxRetries) => {
            fetchCallCount = 0;

            (global as any).fetch = async () => {
              fetchCallCount++;
              return {
                ok: false,
                status: statusCode,
                text: async () => `Error ${statusCode}`,
                json: async () => ({ error: `Error ${statusCode}` }),
              };
            };

            const config: HttpClientConfig = {
              apiUrl: "http://localhost:1234/v1/chat/completions",
              model: "default",
              maxRetries,
            };
            const signal = new AbortController().signal;

            await expect(
              sendChatCompletion(config, buildRequest(), signal, mockLogger as any, "trace-6"),
            ).rejects.toThrow();

            expect(fetchCallCount).toBe(maxRetries + 1);
          },
        ),
        { numRuns: 2 },
      );
    }, 30000);
  });

  describe("Exponential backoff timing verification", () => {
    it("backoff delays follow 2^attempt * 1000ms pattern (verified via log calls)", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 2 }), async (maxRetries) => {
          fetchCallCount = 0;
          jest.clearAllMocks();

          (global as any).fetch = async () => {
            fetchCallCount++;
            return {
              ok: false,
              status: 500,
              text: async () => "Error 500",
              json: async () => ({ error: "Error 500" }),
            };
          };

          const config: HttpClientConfig = {
            apiUrl: "http://localhost:1234/v1/chat/completions",
            model: "default",
            maxRetries,
          };
          const signal = new AbortController().signal;

          await expect(
            sendChatCompletion(config, buildRequest(), signal, mockLogger as any, "trace-7"),
          ).rejects.toThrow();

          // Verify the logger was called with correct backoff values for each retry
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            expect(mockLogger.debug).toHaveBeenCalledWith(
              "Retrying after backoff",
              expect.objectContaining({
                attempt,
                backoffMs: Math.pow(2, attempt) * 1000,
              }),
            );
          }
        }),
        { numRuns: 2 },
      );
    }, 30000);
  });
});
