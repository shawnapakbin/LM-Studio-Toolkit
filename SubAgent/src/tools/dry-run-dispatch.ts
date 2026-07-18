/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { ChunkStrategy } from "../chunk-strategy";
import { DedupCache } from "../dedup-cache";
import { type ServerConfig, TaskManifestSchema } from "../mcp-server";
import { TokenBudget } from "../token-budget";
import type { TaskManifest } from "../types";

// ─── DryRunReport Interface ──────────────────────────────────────────────────

interface PerTaskAnalysis {
  taskId: string;
  estimatedTokens: number;
  exceedsBudget: boolean;
  cached: boolean;
  deduplicated: boolean;
  wouldChunk: boolean;
  estimatedChunks?: number;
}

interface ExecutionPlanEntry {
  batch: number;
  taskIds: string[];
}

interface DryRunReport {
  taskCount: number;
  deduplicatedCount: number;
  tasksAfterDedup: number;
  perTaskAnalysis: PerTaskAnalysis[];
  totalEstimatedTokens: number;
  executionPlan: ExecutionPlanEntry[];
  estimatedWallClockMs: number | null;
  estimationAvailable: boolean;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Handler for the dry_run_dispatch MCP tool.
 *
 * Accepts the same TaskManifest as dispatch_sub_tasks and produces a DryRunReport
 * without executing any LLM inference calls. The report includes deduplication
 * analysis, per-task token estimates, cache hit status, budget exceedance flags,
 * FIFO batch execution plan, and estimated wall-clock time (when available).
 */
export async function handleDryRunDispatch(
  args: unknown,
  config: ServerConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // ─── Validate Input ──────────────────────────────────────────────────────
  const parseResult = TaskManifestSchema.safeParse(args);
  if (!parseResult.success) {
    return errorResponse(
      `Invalid Task_Manifest: ${parseResult.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const manifest: TaskManifest = parseResult.data;

  // Validate task IDs are unique within manifest
  const taskIds = manifest.tasks.map((t) => t.taskId);
  const uniqueIds = new Set(taskIds);
  if (uniqueIds.size !== taskIds.length) {
    const duplicates = taskIds.filter((id, idx) => taskIds.indexOf(id) !== idx);
    return errorResponse(
      `Duplicate task IDs found: ${[...new Set(duplicates)].join(", ")}. Task IDs must be unique within the manifest.`,
    );
  }

  // ─── Compute Input Hashes and Deduplication ──────────────────────────────
  const hashMap = new Map<string, string[]>(); // hash → taskIds[]
  const taskHashMap = new Map<string, string>(); // taskId → hash

  for (const task of manifest.tasks) {
    const hash = DedupCache.computeHash(task, manifest);
    taskHashMap.set(task.taskId, hash);

    const existing = hashMap.get(hash);
    if (existing) {
      existing.push(task.taskId);
    } else {
      hashMap.set(hash, [task.taskId]);
    }
  }

  // Identify deduplicated tasks (all but the first occurrence for each hash)
  const deduplicatedTaskIds = new Set<string>();
  for (const [_hash, ids] of hashMap) {
    for (let i = 1; i < ids.length; i++) {
      deduplicatedTaskIds.add(ids[i]);
    }
  }

  const deduplicatedCount = deduplicatedTaskIds.size;
  const tasksAfterDedup = manifest.tasks.length - deduplicatedCount;

  // ─── Token Budget Analysis ───────────────────────────────────────────────
  const modelContextSize = manifest.modelContextSize ?? 8192;
  const tokenBudget = new TokenBudget(modelContextSize);
  const chunkStrategy = new ChunkStrategy(modelContextSize);
  const autoChunk = manifest.autoChunk ?? false;

  // ─── Cache Lookup ────────────────────────────────────────────────────────
  let cache: DedupCache | null = null;
  try {
    cache = new DedupCache(config.cachePath);
  } catch {
    // Cache unavailable — all tasks will be marked as not cached
  }

  const skipCache = manifest.skipCache ?? false;
  const cacheMaxAge = manifest.cacheMaxAge ?? 86400;

  // ─── Per-Task Analysis ───────────────────────────────────────────────────
  const perTaskAnalysis: PerTaskAnalysis[] = [];
  let totalEstimatedTokens = 0;

  for (const task of manifest.tasks) {
    const systemPrompt = task.systemPrompt ?? manifest.systemPrompt ?? "";
    const toolDefs = task.allowedTools ? JSON.stringify(task.allowedTools) : "";
    const estimatedTokens = tokenBudget.estimate(systemPrompt, task.prompt, toolDefs);
    const exceedsBudget = tokenBudget.exceedsBudget(estimatedTokens);
    const isDeduplicated = deduplicatedTaskIds.has(task.taskId);

    // Check cache for this task's hash
    let cached = false;
    if (!skipCache && cache && cacheMaxAge > 0) {
      const hash = taskHashMap.get(task.taskId)!;
      const cacheEntry = cache.get(hash, cacheMaxAge);
      if (cacheEntry !== null) {
        cached = true;
      }
    }

    // Chunking analysis
    let wouldChunk = false;
    let estimatedChunks: number | undefined;
    if (exceedsBudget && autoChunk) {
      wouldChunk = true;
      try {
        const chunks = chunkStrategy.split(task.prompt);
        estimatedChunks = chunks.length;
      } catch {
        // If chunking fails, still flag it but omit chunk count
        estimatedChunks = undefined;
      }
    }

    const analysis: PerTaskAnalysis = {
      taskId: task.taskId,
      estimatedTokens: Math.round(estimatedTokens),
      exceedsBudget,
      cached,
      deduplicated: isDeduplicated,
      wouldChunk,
    };

    if (estimatedChunks !== undefined) {
      analysis.estimatedChunks = estimatedChunks;
    }

    perTaskAnalysis.push(analysis);
    totalEstimatedTokens += estimatedTokens;
  }

  // ─── Execution Plan (FIFO batch ordering) ────────────────────────────────
  const concurrency = manifest.concurrency ?? config.maxConcurrency;

  // Tasks that would actually execute: non-deduplicated and non-cached
  const tasksToExecute = manifest.tasks.filter(
    (t) =>
      !deduplicatedTaskIds.has(t.taskId) &&
      !perTaskAnalysis.find((a) => a.taskId === t.taskId && a.cached),
  );

  const executionPlan: ExecutionPlanEntry[] = [];
  for (let i = 0; i < tasksToExecute.length; i += concurrency) {
    const batchTaskIds = tasksToExecute.slice(i, i + concurrency).map((t) => t.taskId);
    executionPlan.push({
      batch: Math.floor(i / concurrency) + 1,
      taskIds: batchTaskIds,
    });
  }

  // ─── Estimated Wall-Clock Time ───────────────────────────────────────────
  let estimatedWallClockMs: number | null = null;
  let estimationAvailable = false;

  if (cache) {
    const telemetryEstimate = cache.getEstimatedTelemetry({
      temperature: manifest.temperature ?? 0.7,
      maxTokens: manifest.maxTokens ?? 4096,
    });

    if (telemetryEstimate) {
      estimationAvailable = true;
      // Estimate: average wall-clock per task × number of batches
      const tasksRequiringInference = tasksToExecute.length;
      const batchCount = Math.ceil(tasksRequiringInference / concurrency);
      estimatedWallClockMs = telemetryEstimate.wallClockMs * batchCount;
    }
  }

  // ─── Close cache connection ──────────────────────────────────────────────
  if (cache) {
    cache.close();
  }

  // ─── Assemble Report ─────────────────────────────────────────────────────
  const report: DryRunReport = {
    taskCount: manifest.tasks.length,
    deduplicatedCount,
    tasksAfterDedup,
    perTaskAnalysis,
    totalEstimatedTokens: Math.round(totalEstimatedTokens),
    executionPlan,
    estimatedWallClockMs,
    estimationAvailable,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(report) }],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(message: string): { content: Array<{ type: string; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}
