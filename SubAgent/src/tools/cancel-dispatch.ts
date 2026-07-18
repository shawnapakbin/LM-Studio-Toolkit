/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { getLogger } from "llm-toolkit-observability";
import { CheckpointStore } from "../checkpoint-store";
import type { ServerConfig } from "../mcp-server";
import { SessionPool } from "../session-pool";
import type { AggregatedResult, ProgressReport, TaskResult, TelemetrySummary } from "../types";

// ─── Module-level singletons ─────────────────────────────────────────────────
// These will be replaced by proper singleton initialization from mcp-server.ts later.

let sessionPool: SessionPool | null = null;
let checkpointStore: CheckpointStore | null = null;

/**
 * Set the singleton SessionPool instance (called from mcp-server integration).
 */
export function setSessionPool(pool: SessionPool): void {
  sessionPool = pool;
}

/**
 * Set the singleton CheckpointStore instance (called from mcp-server integration).
 */
export function setCheckpointStore(store: CheckpointStore): void {
  checkpointStore = store;
}

/**
 * Get or lazily create the SessionPool singleton.
 */
function getSessionPool(config: ServerConfig): SessionPool {
  if (!sessionPool) {
    sessionPool = new SessionPool({
      concurrency: config.maxConcurrency,
      apiUrl: config.apiUrl,
      defaultTimeout: 3600,
    });
  }
  return sessionPool;
}

/**
 * Get or lazily create the CheckpointStore singleton.
 */
function getCheckpointStore(config: ServerConfig): CheckpointStore {
  if (!checkpointStore) {
    checkpointStore = new CheckpointStore(config.checkpointDir);
  }
  return checkpointStore;
}

/**
 * Handler for the cancel_dispatch MCP tool.
 *
 * Accepts a dispatch identifier, validates it matches an active operation,
 * invokes SessionPool.cancel() to abort in-flight requests and mark pending
 * tasks as cancelled, persists completed results to CheckpointStore within
 * 1 second, emits a final ProgressReport with cancelled state counts, and
 * returns a partial AggregatedResult.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
export async function handleCancelDispatch(
  args: unknown,
  config: ServerConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const logger = getLogger().child("cancel-dispatch");

  // ─── Validate Input ──────────────────────────────────────────────────────
  const input = args as { dispatchId?: string };
  const dispatchId = input?.dispatchId;

  if (!dispatchId || typeof dispatchId !== "string" || dispatchId.trim().length === 0) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Invalid input: dispatchId is required and must be a non-empty string",
          }),
        },
      ],
    };
  }

  // ─── Cancel via SessionPool ──────────────────────────────────────────────
  const pool = getSessionPool(config);
  const cancelResult = pool.cancel(dispatchId);

  // Req 9.3: If dispatch not found (no completed, aborted, or cancelled tasks),
  // return an error indicating the dispatch was not found.
  if (
    cancelResult.completedResults.length === 0 &&
    cancelResult.abortedTaskIds.length === 0 &&
    cancelResult.cancelledTaskIds.length === 0
  ) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Dispatch not found: no active operation with identifier "${dispatchId}"`,
            dispatchId,
          }),
        },
      ],
    };
  }

  // ─── Persist completed results to CheckpointStore (Req 9.5) ──────────────
  // Must complete within 1 second of the cancellation call.
  const store = getCheckpointStore(config);
  const checkpointStart = Date.now();

  for (const taskResult of cancelResult.completedResults) {
    if (taskResult.status === "success" && taskResult.response) {
      await store.writeCheckpoint(dispatchId, {
        taskId: taskResult.taskId,
        inputHash: "", // Hash not available from PartialResult; stored for resume compatibility
        result: taskResult.response,
        tokenUsage: {
          prompt: taskResult.telemetry?.promptTokens ?? 0,
          completion: taskResult.telemetry?.completionTokens ?? 0,
          total: taskResult.telemetry?.totalTokens ?? 0,
        },
        telemetry: taskResult.telemetry ?? {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          wallClockMs: 0,
          tokensPerSecond: 0,
        },
        completedAt: new Date().toISOString(),
      });
    }
  }

  const checkpointDuration = Date.now() - checkpointStart;
  logger.info("Checkpoint persistence completed", {
    traceId: dispatchId,
    durationMs: checkpointDuration,
    tasksCheckpointed: cancelResult.completedResults.filter((r) => r.status === "success").length,
  });

  // ─── Build final ProgressReport (Req 9.4) ───────────────────────────────
  const totalTasks =
    cancelResult.completedResults.length +
    cancelResult.abortedTaskIds.length +
    cancelResult.cancelledTaskIds.length;

  const progressReport: ProgressReport = {
    dispatchId,
    totalTasks,
    completedTasks: cancelResult.completedResults.filter((r) => r.status === "success").length,
    failedTasks: cancelResult.completedResults.filter(
      (r) => r.status === "failed" || r.status === "timed_out",
    ).length,
    inProgressTasks: 0, // All in-progress tasks are now aborted
    elapsedSeconds: 0, // Not tracked post-cancellation
    estimatedRemainingSeconds: null,
    tokensConsumed: cancelResult.completedResults.reduce(
      (sum, r) => sum + (r.telemetry?.totalTokens ?? 0),
      0,
    ),
    taskStatuses: [
      ...cancelResult.completedResults.map((r) => ({
        taskId: r.taskId,
        state: r.status === "success" ? ("completed" as const) : ("failed" as const),
        elapsedMs: r.telemetry?.wallClockMs,
      })),
      ...cancelResult.abortedTaskIds.map((taskId) => ({
        taskId,
        state: "failed" as const,
      })),
      ...cancelResult.cancelledTaskIds.map((taskId) => ({
        taskId,
        state: "pending" as const,
      })),
    ],
  };

  logger.info("Final progress report emitted", {
    traceId: dispatchId,
    completed: progressReport.completedTasks,
    aborted: cancelResult.abortedTaskIds.length,
    cancelled: cancelResult.cancelledTaskIds.length,
  });

  // ─── Build partial AggregatedResult (Req 9.2) ───────────────────────────
  const tasks: TaskResult[] = [
    ...cancelResult.completedResults,
    ...cancelResult.abortedTaskIds.map((taskId) => ({
      taskId,
      sessionId: "",
      status: "aborted" as const,
    })),
    ...cancelResult.cancelledTaskIds.map((taskId) => ({
      taskId,
      sessionId: "",
      status: "cancelled" as const,
    })),
  ];

  // Compute telemetry summary from completed results
  const successfulTasks = cancelResult.completedResults.filter(
    (r) => r.status === "success" && r.telemetry,
  );

  const telemetrySummary: TelemetrySummary = buildTelemetrySummary(successfulTasks);

  const aggregatedResult: AggregatedResult = {
    dispatchId,
    status: "cancelled",
    tasks,
    telemetrySummary,
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(aggregatedResult),
      },
    ],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a TelemetrySummary from a list of successful task results.
 */
function buildTelemetrySummary(successfulTasks: TaskResult[]): TelemetrySummary {
  if (successfulTasks.length === 0) {
    return {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalWallClockMs: 0,
      meanTokensPerSecond: 0,
      slowestTask: { taskId: "", durationMs: 0 },
      fastestTask: { taskId: "", durationMs: 0 },
    };
  }

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalWallClockMs = 0;
  let totalTps = 0;
  let slowest: { taskId: string; durationMs: number } = { taskId: "", durationMs: -1 };
  let fastest: { taskId: string; durationMs: number } = {
    taskId: "",
    durationMs: Number.MAX_SAFE_INTEGER,
  };

  for (const task of successfulTasks) {
    const t = task.telemetry!;
    totalPromptTokens += t.promptTokens;
    totalCompletionTokens += t.completionTokens;
    totalWallClockMs += t.wallClockMs;
    totalTps += t.tokensPerSecond;

    // Slowest: highest duration wins; ties broken by lexicographic taskId (first wins)
    if (
      t.wallClockMs > slowest.durationMs ||
      (t.wallClockMs === slowest.durationMs && task.taskId < slowest.taskId)
    ) {
      slowest = { taskId: task.taskId, durationMs: t.wallClockMs };
    }

    // Fastest: lowest duration wins; ties broken by lexicographic taskId (first wins)
    if (
      t.wallClockMs < fastest.durationMs ||
      (t.wallClockMs === fastest.durationMs && task.taskId < fastest.taskId)
    ) {
      fastest = { taskId: task.taskId, durationMs: t.wallClockMs };
    }
  }

  return {
    totalPromptTokens,
    totalCompletionTokens,
    totalWallClockMs,
    meanTokensPerSecond: successfulTasks.length > 0 ? totalTps / successfulTasks.length : 0,
    slowestTask: slowest.taskId ? slowest : { taskId: "", durationMs: 0 },
    fastestTask: fastest.taskId ? fastest : { taskId: "", durationMs: 0 },
  };
}
