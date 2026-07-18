/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { getLogger } from "llm-toolkit-observability";

import type { TaskResult, TelemetryRecord, TelemetrySummary } from "./types";

// ─── Environment Variable Keys ───────────────────────────────────────────────

const ENV_PROMPT_TOKEN_COST = "SUBAGENT_PROMPT_TOKEN_COST";
const ENV_COMPLETION_TOKEN_COST = "SUBAGENT_COMPLETION_TOKEN_COST";

// ─── Telemetry Tracker ───────────────────────────────────────────────────────

/**
 * Per-session telemetry recorder and summary aggregator.
 *
 * Records individual TelemetryRecord entries for each completed sub-session
 * and produces an aggregated TelemetrySummary at dispatch completion. Integrates
 * with the llm-toolkit-observability Logger for structured JSON logging of
 * telemetry summaries including cost estimation from environment variables.
 */
export class TelemetryTracker {
  private records: Map<string, TelemetryRecord> = new Map();

  /**
   * Create a TelemetryRecord from raw API response data.
   *
   * tokensPerSecond is computed as completionTokens / (wallClockMs / 1000).
   * If wallClockMs is 0, tokensPerSecond is set to 0 to avoid division by zero.
   */
  createRecord(
    promptTokens: number,
    completionTokens: number,
    wallClockMs: number,
  ): TelemetryRecord {
    const totalTokens = promptTokens + completionTokens;
    const tokensPerSecond = wallClockMs === 0 ? 0 : completionTokens / (wallClockMs / 1000);

    return {
      promptTokens,
      completionTokens,
      totalTokens,
      wallClockMs,
      tokensPerSecond,
    };
  }

  /**
   * Record a telemetry entry for a specific task by its taskId.
   */
  record(taskId: string, telemetry: TelemetryRecord): void {
    this.records.set(taskId, telemetry);
  }

  /**
   * Compute the aggregated TelemetrySummary from task results.
   *
   * - Total prompt/completion tokens are summed across ALL tasks with telemetry.
   * - Total wall-clock time is summed across ALL tasks with telemetry.
   * - Mean tokens/sec excludes failed, cached, and deduplicated tasks.
   * - Slowest/fastest task selection considers all tasks with telemetry;
   *   ties are broken by lexicographic order of taskId (first wins).
   */
  computeSummary(taskResults: TaskResult[]): TelemetrySummary {
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalWallClockMs = 0;

    let slowestTask: { taskId: string; durationMs: number } | null = null;
    let fastestTask: { taskId: string; durationMs: number } | null = null;

    // For mean tokens/sec: exclude failed, cached, and deduplicated tasks
    const eligibleTokensPerSec: number[] = [];

    for (const task of taskResults) {
      if (!task.telemetry) continue;

      const { promptTokens, completionTokens, wallClockMs, tokensPerSecond } = task.telemetry;

      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;
      totalWallClockMs += wallClockMs;

      // Slowest task: highest wallClockMs, ties broken lexicographically
      if (
        slowestTask === null ||
        wallClockMs > slowestTask.durationMs ||
        (wallClockMs === slowestTask.durationMs && task.taskId < slowestTask.taskId)
      ) {
        slowestTask = { taskId: task.taskId, durationMs: wallClockMs };
      }

      // Fastest task: lowest wallClockMs, ties broken lexicographically
      if (
        fastestTask === null ||
        wallClockMs < fastestTask.durationMs ||
        (wallClockMs === fastestTask.durationMs && task.taskId < fastestTask.taskId)
      ) {
        fastestTask = { taskId: task.taskId, durationMs: wallClockMs };
      }

      // Only include in mean calculation if not failed, cached, or deduplicated
      const isExcluded =
        task.status === "failed" ||
        task.status === "timed_out" ||
        task.status === "aborted" ||
        task.status === "cancelled" ||
        task.status === "budget_exceeded" ||
        task.cached === true ||
        task.deduplicated === true;

      if (!isExcluded) {
        eligibleTokensPerSec.push(tokensPerSecond);
      }
    }

    // Arithmetic mean of tokens/sec for eligible tasks
    const meanTokensPerSecond =
      eligibleTokensPerSec.length > 0
        ? eligibleTokensPerSec.reduce((sum, v) => sum + v, 0) / eligibleTokensPerSec.length
        : 0;

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalWallClockMs,
      meanTokensPerSecond,
      slowestTask: slowestTask ?? { taskId: "", durationMs: 0 },
      fastestTask: fastestTask ?? { taskId: "", durationMs: 0 },
    };
  }

  /**
   * Log the telemetry summary at INFO level using the observability Logger.
   *
   * The log entry includes total tokens consumed, total wall-clock time,
   * average tokens per second, and cost estimation computed from:
   *   cost = (promptTokens × promptRate) + (completionTokens × completionRate)
   *
   * Rates are read from environment variables:
   * - SUBAGENT_PROMPT_TOKEN_COST (decimal per token, default 0)
   * - SUBAGENT_COMPLETION_TOKEN_COST (decimal per token, default 0)
   */
  logSummary(summary: TelemetrySummary, dispatchId: string): void {
    const logger = getLogger();

    const promptRate = parseFloat(process.env[ENV_PROMPT_TOKEN_COST] ?? "0") || 0;
    const completionRate = parseFloat(process.env[ENV_COMPLETION_TOKEN_COST] ?? "0") || 0;

    const costEstimation =
      summary.totalPromptTokens * promptRate + summary.totalCompletionTokens * completionRate;

    logger.info("Telemetry summary", {
      dispatchId,
      totalTokens: summary.totalPromptTokens + summary.totalCompletionTokens,
      totalPromptTokens: summary.totalPromptTokens,
      totalCompletionTokens: summary.totalCompletionTokens,
      totalWallClockMs: summary.totalWallClockMs,
      meanTokensPerSecond: summary.meanTokensPerSecond,
      slowestTask: summary.slowestTask,
      fastestTask: summary.fastestTask,
      costEstimation,
      promptRate,
      completionRate,
    });
  }

  /**
   * Get a recorded telemetry entry by taskId.
   */
  getRecord(taskId: string): TelemetryRecord | undefined {
    return this.records.get(taskId);
  }

  /**
   * Get all recorded telemetry entries.
   */
  getAllRecords(): Map<string, TelemetryRecord> {
    return new Map(this.records);
  }

  /**
   * Clear all recorded telemetry entries.
   */
  clear(): void {
    this.records.clear();
  }
}
