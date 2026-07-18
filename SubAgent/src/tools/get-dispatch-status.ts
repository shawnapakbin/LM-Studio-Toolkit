/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import type { ServerConfig } from "../mcp-server";
import { SessionPool } from "../session-pool";
import type { ProgressReport, TaskStatus } from "../types";

/**
 * Module-level reference to the shared SessionPool singleton.
 * Set via `setSessionPool()` during server initialization.
 */
let poolInstance: SessionPool | null = null;

/**
 * Configure the SessionPool instance used by this handler.
 * Called during server startup to wire the shared singleton.
 */
export function setSessionPool(pool: SessionPool): void {
  poolInstance = pool;
}

/**
 * Returns the configured SessionPool or throws if not yet initialized.
 */
function getPool(): SessionPool {
  if (!poolInstance) {
    throw new Error("SessionPool not initialized. Call setSessionPool() during server startup.");
  }
  return poolInstance;
}

/**
 * Apply stall detection to in-progress tasks.
 * A task is flagged as potentially stalled if its elapsed time exceeds
 * 2× the average completion time of already-finished tasks in the same dispatch.
 */
function applyStallDetection(report: ProgressReport): ProgressReport {
  const completedStatuses = report.taskStatuses.filter(
    (t) => (t.state === "completed" || t.state === "failed") && t.elapsedMs !== undefined,
  );

  if (completedStatuses.length === 0) {
    return report;
  }

  const totalElapsed = completedStatuses.reduce((sum, t) => sum + (t.elapsedMs ?? 0), 0);
  const averageCompletionMs = totalElapsed / completedStatuses.length;
  const stallThreshold = averageCompletionMs * 2;

  const updatedStatuses: TaskStatus[] = report.taskStatuses.map((t) => {
    if (t.state === "in-progress" && t.elapsedMs !== undefined && t.elapsedMs > stallThreshold) {
      return { ...t, potentiallyStalled: true };
    }
    return t;
  });

  return { ...report, taskStatuses: updatedStatuses };
}

/**
 * Handler for the get_dispatch_status MCP tool.
 * Polls progress of an active dispatch or returns the most recent completed dispatch summary.
 *
 * - Accepts a dispatch identifier (1–128 characters)
 * - Returns the current ProgressReport from SessionPool.getStatus()
 * - If no active dispatch found: returns summary of most recent completed dispatch
 * - Includes stall detection: flags tasks in-progress longer than 2× average completion time
 */
export async function handleGetDispatchStatus(
  args: unknown,
  _config: ServerConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const parsed = args as { dispatchId?: string };
  const dispatchId = parsed?.dispatchId;

  if (
    !dispatchId ||
    typeof dispatchId !== "string" ||
    dispatchId.length < 1 ||
    dispatchId.length > 128
  ) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "Invalid dispatchId: must be a string between 1 and 128 characters.",
          }),
        },
      ],
    };
  }

  let pool: SessionPool;
  try {
    pool = getPool();
  } catch {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "SessionPool not initialized. Server may still be starting up.",
          }),
        },
      ],
    };
  }

  // Attempt to get status for the requested dispatch
  const report = pool.getStatus(dispatchId);

  if (report) {
    const enrichedReport = applyStallDetection(report);
    return {
      content: [{ type: "text", text: JSON.stringify(enrichedReport) }],
    };
  }

  // No active dispatch found with that ID — try to get the most recent completed dispatch
  const mostRecent = pool.getMostRecentCompletedStatus?.();
  if (mostRecent) {
    const enrichedReport = applyStallDetection(mostRecent);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            note: `No active dispatch found for "${dispatchId}". Returning most recent completed dispatch.`,
            ...enrichedReport,
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: `No dispatch found with identifier "${dispatchId}" and no recent completed dispatches available.`,
        }),
      },
    ],
  };
}
