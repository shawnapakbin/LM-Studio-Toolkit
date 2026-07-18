/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Feature: sub-agent-mcp
// **Validates: Requirements 13.1, 13.2**

import * as fc from "fast-check";
import { TelemetryTracker } from "../../src/telemetry";
import type { TaskResult, TelemetryRecord } from "../../src/types";

/**
 * Property 24: Telemetry Record Correctness
 *
 * For any completed Sub_Session, the TelemetryRecord contains:
 * prompt tokens, completion tokens, total tokens (= prompt + completion),
 * wall-clock duration in integer milliseconds, and tokens per second
 * (= completion tokens / (wallClockMs / 1000)).
 * tokensPerSecond is 0 when wallClockMs is 0.
 *
 * **Validates: Requirements 13.1**
 */
describe("Property 24: Telemetry Record Correctness", () => {
  const tracker = new TelemetryTracker();

  // Generators for token counts and wall-clock values
  const promptTokensArb = fc.integer({ min: 0, max: 100_000 });
  const completionTokensArb = fc.integer({ min: 0, max: 100_000 });
  const wallClockMsArb = fc.integer({ min: 1, max: 600_000 });
  const zeroWallClock = fc.constant(0);

  it("totalTokens always equals promptTokens + completionTokens", () => {
    fc.assert(
      fc.property(
        promptTokensArb,
        completionTokensArb,
        wallClockMsArb,
        (prompt, completion, wallClock) => {
          const record = tracker.createRecord(prompt, completion, wallClock);
          expect(record.totalTokens).toBe(prompt + completion);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("tokensPerSecond equals completionTokens / (wallClockMs / 1000) for non-zero wallClockMs", () => {
    fc.assert(
      fc.property(
        promptTokensArb,
        completionTokensArb,
        wallClockMsArb,
        (prompt, completion, wallClock) => {
          const record = tracker.createRecord(prompt, completion, wallClock);
          const expected = completion / (wallClock / 1000);
          expect(record.tokensPerSecond).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("tokensPerSecond is 0 when wallClockMs is 0", () => {
    fc.assert(
      fc.property(
        promptTokensArb,
        completionTokensArb,
        zeroWallClock,
        (prompt, completion, wallClock) => {
          const record = tracker.createRecord(prompt, completion, wallClock);
          expect(record.tokensPerSecond).toBe(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("record preserves promptTokens and completionTokens exactly", () => {
    fc.assert(
      fc.property(
        promptTokensArb,
        completionTokensArb,
        wallClockMsArb,
        (prompt, completion, wallClock) => {
          const record = tracker.createRecord(prompt, completion, wallClock);
          expect(record.promptTokens).toBe(prompt);
          expect(record.completionTokens).toBe(completion);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("record preserves wallClockMs exactly", () => {
    fc.assert(
      fc.property(
        promptTokensArb,
        completionTokensArb,
        wallClockMsArb,
        (prompt, completion, wallClock) => {
          const record = tracker.createRecord(prompt, completion, wallClock);
          expect(record.wallClockMs).toBe(wallClock);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("tokensPerSecond is non-negative for any valid input", () => {
    fc.assert(
      fc.property(
        promptTokensArb,
        completionTokensArb,
        fc.integer({ min: 0, max: 600_000 }),
        (prompt, completion, wallClock) => {
          const record = tracker.createRecord(prompt, completion, wallClock);
          expect(record.tokensPerSecond).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});

/**
 * Property 25: Telemetry Summary Aggregation
 *
 * For any set of successfully completed tasks, the telemetry summary correctly
 * computes: total prompt/completion tokens (sum), total wall-clock time,
 * arithmetic mean tokens/sec (excluding failed/cached/deduped), and identifies
 * slowest/fastest tasks (ties broken by lexicographic order of task ID).
 *
 * **Validates: Requirements 13.2**
 */
describe("Property 25: Telemetry Summary Aggregation", () => {
  const tracker = new TelemetryTracker();

  // Generator for a successful task result with telemetry
  const successTaskResultArb = fc
    .record({
      taskId: fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }),
      sessionId: fc.uuid(),
      status: fc.constant("success" as const),
      promptTokens: fc.integer({ min: 0, max: 50_000 }),
      completionTokens: fc.integer({ min: 0, max: 50_000 }),
      wallClockMs: fc.integer({ min: 1, max: 300_000 }),
    })
    .map(({ taskId, sessionId, status, promptTokens, completionTokens, wallClockMs }) => {
      const tokensPerSecond = completionTokens / (wallClockMs / 1000);
      const telemetry: TelemetryRecord = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        wallClockMs,
        tokensPerSecond,
      };
      return {
        taskId,
        sessionId,
        status,
        telemetry,
      } as TaskResult;
    });

  // Generator for a list of successful tasks with unique IDs
  const successTaskListArb = fc
    .array(successTaskResultArb, { minLength: 1, maxLength: 15 })
    .map((tasks) => {
      // Ensure unique taskIds by appending index
      return tasks.map((task, i) => ({
        ...task,
        taskId: `${task.taskId}_${i}`,
      }));
    });

  it("totalPromptTokens equals sum of all tasks' promptTokens", () => {
    fc.assert(
      fc.property(successTaskListArb, (tasks) => {
        const summary = tracker.computeSummary(tasks);
        const expectedTotal = tasks.reduce((sum, t) => sum + (t.telemetry?.promptTokens ?? 0), 0);
        expect(summary.totalPromptTokens).toBe(expectedTotal);
      }),
      { numRuns: 25 },
    );
  });

  it("totalCompletionTokens equals sum of all tasks' completionTokens", () => {
    fc.assert(
      fc.property(successTaskListArb, (tasks) => {
        const summary = tracker.computeSummary(tasks);
        const expectedTotal = tasks.reduce(
          (sum, t) => sum + (t.telemetry?.completionTokens ?? 0),
          0,
        );
        expect(summary.totalCompletionTokens).toBe(expectedTotal);
      }),
      { numRuns: 25 },
    );
  });

  it("totalWallClockMs equals sum of all tasks' wallClockMs", () => {
    fc.assert(
      fc.property(successTaskListArb, (tasks) => {
        const summary = tracker.computeSummary(tasks);
        const expectedTotal = tasks.reduce((sum, t) => sum + (t.telemetry?.wallClockMs ?? 0), 0);
        expect(summary.totalWallClockMs).toBe(expectedTotal);
      }),
      { numRuns: 25 },
    );
  });

  it("meanTokensPerSecond is arithmetic mean of eligible tasks' tokensPerSecond", () => {
    fc.assert(
      fc.property(successTaskListArb, (tasks) => {
        const summary = tracker.computeSummary(tasks);
        // All successful, non-cached, non-deduped tasks are eligible
        const eligible = tasks.filter(
          (t) => t.status === "success" && !t.cached && !t.deduplicated,
        );
        const expectedMean =
          eligible.length > 0
            ? eligible.reduce((sum, t) => sum + (t.telemetry?.tokensPerSecond ?? 0), 0) /
              eligible.length
            : 0;
        expect(summary.meanTokensPerSecond).toBeCloseTo(expectedMean, 5);
      }),
      { numRuns: 25 },
    );
  });

  it("slowestTask has the highest wallClockMs among tasks with telemetry", () => {
    fc.assert(
      fc.property(successTaskListArb, (tasks) => {
        const summary = tracker.computeSummary(tasks);
        const maxWallClock = Math.max(...tasks.map((t) => t.telemetry?.wallClockMs ?? 0));
        expect(summary.slowestTask.durationMs).toBe(maxWallClock);
      }),
      { numRuns: 25 },
    );
  });

  it("fastestTask has the lowest wallClockMs among tasks with telemetry", () => {
    fc.assert(
      fc.property(successTaskListArb, (tasks) => {
        const summary = tracker.computeSummary(tasks);
        const minWallClock = Math.min(...tasks.map((t) => t.telemetry?.wallClockMs ?? 0));
        expect(summary.fastestTask.durationMs).toBe(minWallClock);
      }),
      { numRuns: 25 },
    );
  });

  // Test tie-breaking: when multiple tasks share the same duration, the one
  // with the lexicographically first taskId wins
  it("ties for slowest task are broken by lexicographic order of taskId", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10, unit: "grapheme-ascii" }), {
          minLength: 2,
          maxLength: 10,
        }),
        fc.integer({ min: 1, max: 300_000 }),
        (taskIds, sharedDuration) => {
          // Create tasks all with the same wallClockMs
          const uniqueIds = [...new Set(taskIds)];
          if (uniqueIds.length < 2) return; // Need at least 2 unique IDs

          const tasks: TaskResult[] = uniqueIds.map((id) => ({
            taskId: id,
            sessionId: "00000000-0000-0000-0000-000000000000",
            status: "success" as const,
            telemetry: {
              promptTokens: 100,
              completionTokens: 200,
              totalTokens: 300,
              wallClockMs: sharedDuration,
              tokensPerSecond: 200 / (sharedDuration / 1000),
            },
          }));

          const summary = tracker.computeSummary(tasks);
          const expectedId = [...uniqueIds].sort()[0];
          expect(summary.slowestTask.taskId).toBe(expectedId);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("ties for fastest task are broken by lexicographic order of taskId", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10, unit: "grapheme-ascii" }), {
          minLength: 2,
          maxLength: 10,
        }),
        fc.integer({ min: 1, max: 300_000 }),
        (taskIds, sharedDuration) => {
          // Create tasks all with the same wallClockMs
          const uniqueIds = [...new Set(taskIds)];
          if (uniqueIds.length < 2) return; // Need at least 2 unique IDs

          const tasks: TaskResult[] = uniqueIds.map((id) => ({
            taskId: id,
            sessionId: "00000000-0000-0000-0000-000000000000",
            status: "success" as const,
            telemetry: {
              promptTokens: 100,
              completionTokens: 200,
              totalTokens: 300,
              wallClockMs: sharedDuration,
              tokensPerSecond: 200 / (sharedDuration / 1000),
            },
          }));

          const summary = tracker.computeSummary(tasks);
          const expectedId = [...uniqueIds].sort()[0];
          expect(summary.fastestTask.taskId).toBe(expectedId);
        },
      ),
      { numRuns: 25 },
    );
  });

  // Mean excludes failed/cached/deduped tasks
  it("meanTokensPerSecond excludes failed, cached, and deduplicated tasks", () => {
    fc.assert(
      fc.property(
        successTaskListArb,
        fc.integer({ min: 0, max: 5 }),
        (successTasks, numExcluded) => {
          // Create some excluded tasks (failed, cached, deduplicated)
          const excludedStatuses: Array<{
            status: TaskResult["status"];
            cached?: boolean;
            deduplicated?: boolean;
          }> = [
            { status: "failed" },
            { status: "success", cached: true },
            { status: "success", deduplicated: true },
            { status: "timed_out" },
            { status: "aborted" },
          ];

          const excludedTasks: TaskResult[] = Array.from(
            { length: Math.min(numExcluded, excludedStatuses.length) },
            (_, i) => ({
              taskId: `excluded_${i}`,
              sessionId: "00000000-0000-0000-0000-000000000001",
              ...excludedStatuses[i],
              telemetry: {
                promptTokens: 9999,
                completionTokens: 9999,
                totalTokens: 19998,
                wallClockMs: 1000,
                tokensPerSecond: 9999,
              },
            }),
          );

          const allTasks = [...successTasks, ...excludedTasks];
          const summary = tracker.computeSummary(allTasks);

          // Compute expected mean from ONLY eligible tasks
          // Eligible = successful + not cached + not deduplicated
          const eligible = allTasks.filter(
            (t) => t.status === "success" && !t.cached && !t.deduplicated,
          );

          const expectedMean =
            eligible.length > 0
              ? eligible.reduce((sum, t) => sum + (t.telemetry?.tokensPerSecond ?? 0), 0) /
                eligible.length
              : 0;

          expect(summary.meanTokensPerSecond).toBeCloseTo(expectedMean, 5);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("summary returns zero-valued defaults when no tasks have telemetry", () => {
    const tasksWithoutTelemetry: TaskResult[] = [
      { taskId: "a", sessionId: "uuid-1", status: "success" },
      { taskId: "b", sessionId: "uuid-2", status: "failed" },
    ];

    const summary = tracker.computeSummary(tasksWithoutTelemetry);
    expect(summary.totalPromptTokens).toBe(0);
    expect(summary.totalCompletionTokens).toBe(0);
    expect(summary.totalWallClockMs).toBe(0);
    expect(summary.meanTokensPerSecond).toBe(0);
    expect(summary.slowestTask).toEqual({ taskId: "", durationMs: 0 });
    expect(summary.fastestTask).toEqual({ taskId: "", durationMs: 0 });
  });
});
