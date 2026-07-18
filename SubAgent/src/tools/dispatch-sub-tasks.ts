/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { randomUUID } from "node:crypto";
import { getLogger } from "llm-toolkit-observability";

import { ChunkStrategy } from "../chunk-strategy";
import { DedupCache } from "../dedup-cache";
import type { ServerConfig } from "../mcp-server";
import { TaskManifestSchema } from "../mcp-server";
import { type InternalTask, SessionPool } from "../session-pool";
import { TokenBudget } from "../token-budget";
import type {
  AggregatedResult,
  CheckpointFile,
  SynthesisResult,
  TaskDefinition,
  TaskManifest,
  TaskResult,
} from "../types";
import {
  EMPTY_TELEMETRY,
  errorResponse,
  executeSynthesisCall,
  getCheckpointStore,
  getDedupCache,
  getSessionRegistry,
  getTelemetryTracker,
} from "./dispatch-helpers";

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleDispatchSubTasks(
  args: unknown,
  config: ServerConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const logger = getLogger();
  const dispatchId = randomUUID();

  try {
    // 1. Parse and validate TaskManifest
    const parseResult = TaskManifestSchema.safeParse(args);
    if (!parseResult.success) {
      return errorResponse(
        `Invalid TaskManifest: ${parseResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    const manifest: TaskManifest = parseResult.data;

    // 2. Validate unique task IDs
    const taskIds = manifest.tasks.map((t) => t.taskId);
    const uniqueIds = new Set(taskIds);
    if (uniqueIds.size !== taskIds.length) {
      const dupes = taskIds.filter((id, i) => taskIds.indexOf(id) !== i);
      return errorResponse(
        `Duplicate task IDs: ${[...new Set(dupes)].join(", ")}. Each taskId must be unique.`,
      );
    }
    // 3. Validate timeouts and concurrency (Zod already bounds them, but double-check)
    const concurrency = manifest.concurrency ?? config.maxConcurrency;
    // 4. Initialize components
    const cache = getDedupCache(config);
    const registry = getSessionRegistry();
    const checkpoint = getCheckpointStore(config);
    const telemetry = getTelemetryTracker();
    const modelContextSize = manifest.modelContextSize ?? 8192;
    const tokenBudget = new TokenBudget(modelContextSize);
    const chunkStrategy = new ChunkStrategy(modelContextSize);
    const cacheMaxAge = manifest.cacheMaxAge ?? 86400;
    const skipCache = manifest.skipCache ?? false;

    // 5. Compute Input_Hash for each task
    const taskHashes = new Map<string, string>();
    for (const task of manifest.tasks)
      taskHashes.set(task.taskId, DedupCache.computeHash(task, manifest));
    // 6. Intra-manifest deduplication (first occurrence wins)
    const hashToFirst = new Map<string, string>();
    const dedupMap = new Map<string, string>(); // duplicateId -> firstId
    for (const task of manifest.tasks) {
      const hash = taskHashes.get(task.taskId)!;
      if (hashToFirst.has(hash)) {
        dedupMap.set(task.taskId, hashToFirst.get(hash)!);
        logger.info("Intra-manifest dedup", {
          traceId: dispatchId,
          duplicate: task.taskId,
          original: hashToFirst.get(hash)!,
          inputHash: hash,
        });
      } else {
        hashToFirst.set(hash, task.taskId);
      }
    }

    // 7. Lookup: Registry → Cache → Fresh inference
    const resolved = new Map<string, TaskResult>();
    const needsInference: TaskDefinition[] = [];
    for (const task of manifest.tasks) {
      if (dedupMap.has(task.taskId)) continue;
      const hash = taskHashes.get(task.taskId)!;

      // Registry lookup
      const regEntry = registry.lookup(hash);
      if (regEntry?.result !== null && regEntry?.result !== undefined) {
        resolved.set(task.taskId, {
          taskId: task.taskId,
          sessionId: randomUUID(),
          status: "success",
          response: regEntry.result,
          registryHit: true,
        });
        logger.info("Registry hit", { traceId: dispatchId, taskId: task.taskId, inputHash: hash });
        continue;
      }
      // Cache lookup
      if (!skipCache && cacheMaxAge > 0) {
        const cached = cache.get(hash, cacheMaxAge);
        if (cached) {
          resolved.set(task.taskId, {
            taskId: task.taskId,
            sessionId: randomUUID(),
            status: "success",
            response: cached.result,
            cached: true,
            telemetry: cached.telemetry,
          });
          logger.info("Cache hit", { traceId: dispatchId, taskId: task.taskId, inputHash: hash });
          continue;
        }
      }
      needsInference.push(task);
    }

    // 8. Token budget check and chunking
    const tasksToDispatch: InternalTask[] = [];
    const chunkedTasks = new Map<string, TaskDefinition[]>();

    for (const task of needsInference) {
      const sysPrompt = task.systemPrompt ?? manifest.systemPrompt ?? "";
      const toolDefs = task.allowedTools ? JSON.stringify(task.allowedTools) : "";
      const est = tokenBudget.estimate(sysPrompt, task.prompt, toolDefs);

      if (tokenBudget.exceedsBudget(est)) {
        if (manifest.autoChunk) {
          try {
            const chunks = chunkStrategy.split(task.prompt);
            const chunkDefs = chunks.map((text, i) => ({
              taskId: `${task.taskId}_chunk_${i}`,
              prompt: text,
              systemPrompt: task.systemPrompt,
              allowedTools: task.allowedTools,
            }));
            chunkedTasks.set(task.taskId, chunkDefs);
            for (const cd of chunkDefs)
              tasksToDispatch.push({
                taskId: cd.taskId,
                prompt: cd.prompt,
                systemPrompt: cd.systemPrompt,
                allowedTools: cd.allowedTools,
                inputHash: DedupCache.computeHash(cd, manifest),
              });
          } catch (e) {
            resolved.set(task.taskId, {
              taskId: task.taskId,
              sessionId: randomUUID(),
              status: "budget_exceeded",
              error: {
                type: "budget_exceeded",
                message: e instanceof Error ? e.message : String(e),
                retryAttempts: 0,
              },
            });
          }
        } else {
          resolved.set(task.taskId, {
            taskId: task.taskId,
            sessionId: randomUUID(),
            status: "budget_exceeded",
            error: {
              type: "budget_exceeded",
              message: `Estimated ${Math.ceil(est)} tokens exceeds budget of ${Math.ceil(tokenBudget.getBudgetLimit())} (80% of ${modelContextSize}). Enable autoChunk or reduce input.`,
              retryAttempts: 0,
            },
          });
        }
      } else {
        tasksToDispatch.push({
          taskId: task.taskId,
          prompt: task.prompt,
          systemPrompt: task.systemPrompt,
          allowedTools: task.allowedTools,
          inputHash: taskHashes.get(task.taskId)!,
        });
      }
    }

    // 9. Log dispatch start
    const cacheHits = Array.from(resolved.values()).filter((r) => r.cached || r.registryHit).length;
    logger.info("Dispatch starting", {
      traceId: dispatchId,
      totalTasks: manifest.tasks.length,
      freshInference: tasksToDispatch.length,
      concurrency,
      cacheHits,
    });
    // 10. Write manifest checkpoint
    try {
      await checkpoint.writeManifest(dispatchId, manifest);
    } catch {
      logger.warn("Manifest checkpoint failed", { traceId: dispatchId });
    }
    // 11. Dispatch uncached tasks via SessionPool
    let dispatched: TaskResult[] = [];
    if (tasksToDispatch.length > 0) {
      const pool = new SessionPool(
        { concurrency, apiUrl: config.apiUrl, defaultTimeout: manifest.taskTimeout ?? 3600 },
        logger,
        registry,
        telemetry,
      );
      dispatched = await pool.dispatch(manifest, tasksToDispatch);
    }
    // 12. Process dispatched results: checkpoint, cache, log
    for (const r of dispatched) {
      resolved.set(r.taskId, r);
      if (r.status === "success" && r.response) {
        const hash =
          taskHashes.get(r.taskId) ??
          tasksToDispatch.find((t) => t.taskId === r.taskId)?.inputHash ??
          "";
        const cpFile: CheckpointFile = {
          taskId: r.taskId,
          inputHash: hash,
          result: r.response,
          tokenUsage: {
            prompt: r.telemetry?.promptTokens ?? 0,
            completion: r.telemetry?.completionTokens ?? 0,
            total: r.telemetry?.totalTokens ?? 0,
          },
          telemetry: r.telemetry ?? EMPTY_TELEMETRY,
          completedAt: new Date().toISOString(),
        };
        const { checkpointFailed } = await checkpoint.writeCheckpoint(dispatchId, cpFile);
        if (checkpointFailed) r.checkpointFailed = true;
        cache.set(hash, {
          inputHash: hash,
          result: r.response,
          tokenUsage: cpFile.tokenUsage,
          completedAt: cpFile.completedAt,
          modelId: config.model,
          telemetry: r.telemetry,
        });
        logger.info("Task completed", {
          traceId: dispatchId,
          taskId: r.taskId,
          sessionId: r.sessionId,
          status: r.status,
          wallClockMs: r.telemetry?.wallClockMs,
          totalTokens: r.telemetry?.totalTokens,
        });
      }
    }

    // 13. Handle chunked tasks: merge results
    for (const [origId, chunkDefs] of chunkedTasks) {
      const chunkResults = chunkDefs.map((cd) => resolved.get(cd.taskId));
      const allOk = chunkResults.every((r) => r?.status === "success" && r.response);
      if (allOk) {
        const mergePrompt =
          manifest.mergePrompt ??
          "Synthesize the following chunk results into a single coherent response. Preserve all details.";
        const mergeInput = `${mergePrompt}\n\n${chunkResults.map((r, i) => `[Chunk ${i}]:\n${r!.response}`).join("\n\n")}`;
        try {
          const mr = await executeSynthesisCall(config, manifest, mergeInput, dispatchId);
          const chunks = chunkResults.map((r, i) => ({
            chunkIndex: i,
            taskId: chunkDefs[i].taskId,
            response: r!.response!,
            telemetry: r!.telemetry ?? EMPTY_TELEMETRY,
          }));
          resolved.set(origId, {
            taskId: origId,
            sessionId: randomUUID(),
            status: "success",
            response: mr.response,
            telemetry: mr.telemetry,
            chunks,
          });
        } catch {
          const chunks = chunkResults.map((r, i) => ({
            chunkIndex: i,
            taskId: chunkDefs[i].taskId,
            response: r!.response!,
            telemetry: r!.telemetry ?? EMPTY_TELEMETRY,
          }));
          resolved.set(origId, {
            taskId: origId,
            sessionId: randomUUID(),
            status: "success",
            response: chunkResults.map((r) => r!.response).join("\n\n"),
            chunks,
          });
        }
      } else {
        resolved.set(origId, {
          taskId: origId,
          sessionId: randomUUID(),
          status: "failed",
          error: { type: "chunk_failure", message: "One or more chunks failed", retryAttempts: 0 },
        });
      }
      for (const cd of chunkDefs) resolved.delete(cd.taskId);
    }

    // 14. Apply dedup copies
    for (const [dupId, origId] of dedupMap) {
      const orig = resolved.get(origId);
      if (orig)
        resolved.set(dupId, {
          ...orig,
          taskId: dupId,
          sessionId: randomUUID(),
          deduplicated: true,
          cached: undefined,
          registryHit: undefined,
        });
    }

    // 15. Synthesis
    let synthesis: SynthesisResult | undefined;
    if (manifest.synthesisPrompt) {
      const successful = manifest.tasks
        .map((t) => resolved.get(t.taskId))
        .filter((r) => r?.status === "success" && r.response);
      if (successful.length > 0) {
        const input = `${manifest.synthesisPrompt}\n\n${successful.map((r) => `[Task: ${r!.taskId}]:\n${r!.response}`).join("\n\n")}`;
        try {
          const sr = await executeSynthesisCall(config, manifest, input, dispatchId);
          synthesis = { status: "success", response: sr.response, telemetry: sr.telemetry };
        } catch (e) {
          synthesis = {
            status: "failed",
            error: {
              type: "synthesis_error",
              message: e instanceof Error ? e.message : String(e),
              retryAttempts: 0,
            },
          };
        }
      }
    }

    // 16. Assemble AggregatedResult
    const allResults: TaskResult[] = manifest.tasks.map(
      (t) =>
        resolved.get(t.taskId) ?? {
          taskId: t.taskId,
          sessionId: randomUUID(),
          status: "failed" as const,
          error: { type: "unknown", message: "Task result not found", retryAttempts: 0 },
        },
    );
    const allOk = allResults.every((r) => r.status === "success" || r.deduplicated);
    const summary = telemetry.computeSummary(allResults);
    const result: AggregatedResult = {
      dispatchId,
      status: allOk ? "completed" : "partial",
      tasks: allResults,
      synthesis,
      telemetrySummary: summary,
    };

    // 17. Log summary
    logger.info("Dispatch summary", {
      traceId: dispatchId,
      success: allResults.filter((r) => r.status === "success").length,
      failed: allResults.filter((r) => r.status === "failed" || r.status === "timed_out").length,
      deduped: allResults.filter((r) => r.deduplicated).length,
      cacheHits,
      totalTokens: summary.totalPromptTokens + summary.totalCompletionTokens,
    });
    telemetry.logSummary(summary, dispatchId);

    // 18. Cleanup checkpoints
    if (!manifest.keepCheckpoints) await checkpoint.cleanup(dispatchId);

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    logger.error("Dispatch failed", {
      traceId: dispatchId,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      `Dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
