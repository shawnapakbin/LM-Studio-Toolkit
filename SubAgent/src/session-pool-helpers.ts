/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * Session pool helper utilities — progress reporting, tool definitions, and normalizer.
 * Extracted from session-pool.ts to maintain the 400-line file limit.
 */

import { randomUUID } from "node:crypto";
import type { ToolCallRequest, ToolDefinition } from "./http-client";
import type { RecursionGuard } from "./recursion-guard";
import type { ProgressReport, TaskManifest, TaskResult, TaskStatus } from "./types";

export interface InternalTask {
  taskId: string;
  prompt: string;
  systemPrompt?: string;
  allowedTools?: string[];
  inputHash: string;
}

export interface PartialResult {
  dispatchId: string;
  status: "cancelled";
  completedResults: TaskResult[];
  cancelledTaskIds: string[];
  abortedTaskIds: string[];
}

export interface DispatchState {
  dispatchId: string;
  manifest: TaskManifest;
  tasks: InternalTask[];
  results: Map<string, TaskResult>;
  inFlight: Map<string, AbortController>;
  cancelled: boolean;
  startTime: number;
  dispatchAbort: AbortController;
  progressInterval: ReturnType<typeof setInterval> | null;
}

/** Inline tool call normalizer — passthrough until shared normalizer integration. */
export function normalizeToolCalls(toolCalls: ToolCallRequest[]): ToolCallRequest[] {
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: "function" as const,
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }));
}

export function buildToolDefinitions(
  allowedTools: string[] | undefined,
  guard: RecursionGuard,
): ToolDefinition[] | null {
  if (!allowedTools) return null;
  return guard.getFilteredTools(allowedTools).map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: `Tool: ${name}`,
      parameters: { type: "object", properties: {} },
    },
  }));
}

export function buildProgressReport(state: DispatchState): ProgressReport {
  const completed = Array.from(state.results.values());
  const completedCount = completed.filter((r) => r.status === "success").length;
  const failedCount = completed.filter(
    (r) => r.status !== "success" && r.status !== "cancelled",
  ).length;
  const elapsedMs = Date.now() - state.startTime;
  const doneCount = completedCount + failedCount;
  const estimatedRemainingSeconds =
    doneCount > 0
      ? Math.ceil(((elapsedMs / doneCount) * (state.tasks.length - doneCount)) / 1000)
      : null;
  const tokensConsumed = completed.reduce((sum, r) => sum + (r.telemetry?.totalTokens ?? 0), 0);

  const taskStatuses: TaskStatus[] = state.tasks.map((t) => {
    const result = state.results.get(t.taskId);
    if (result)
      return {
        taskId: t.taskId,
        state: result.status === "success" ? ("completed" as const) : ("failed" as const),
        elapsedMs: result.telemetry?.wallClockMs,
      };
    if (state.inFlight.has(t.taskId)) return { taskId: t.taskId, state: "in-progress" as const };
    return { taskId: t.taskId, state: "pending" as const };
  });

  return {
    dispatchId: state.dispatchId,
    totalTasks: state.tasks.length,
    completedTasks: completedCount,
    failedTasks: failedCount,
    inProgressTasks: state.inFlight.size,
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    estimatedRemainingSeconds,
    tokensConsumed,
    taskStatuses,
  };
}

export function buildCancelledResult(taskId: string): TaskResult {
  return { taskId, sessionId: randomUUID(), status: "cancelled" };
}
