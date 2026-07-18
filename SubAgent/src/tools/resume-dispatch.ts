/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { randomUUID } from "node:crypto";
import { getLogger } from "llm-toolkit-observability";
import { CheckpointStore, computeInputHash } from "../checkpoint-store";
import { type ChatMessage, type LMStudioRequest, sendChatCompletion } from "../http-client";
import type { ServerConfig } from "../mcp-server";
import { type InternalTask, SessionPool } from "../session-pool";
import { SessionRegistry } from "../session-registry";
import { TelemetryTracker } from "../telemetry";
import type {
  AggregatedResult,
  CheckpointFile,
  SynthesisResult,
  TaskResult,
  TelemetryRecord,
} from "../types";

const logger = getLogger().child("resume-dispatch");

/**
 * Handler for the resume_dispatch MCP tool.
 *
 * Resumes a previously interrupted dispatch from checkpoint:
 * 1. Locates the checkpoint directory for the given dispatch identifier
 * 2. Loads the persisted TaskManifest via CheckpointStore.readManifest()
 * 3. Loads existing checkpoints and validates input hashes against manifest
 * 4. Handles corrupt checkpoint JSON by treating affected tasks as incomplete
 * 5. Skips completed tasks, re-dispatches only incomplete tasks via SessionPool
 * 6. If all tasks are complete and a synthesis prompt exists: runs synthesis only
 * 7. If all tasks are complete and no synthesis prompt: assembles from checkpoints
 */
export async function handleResumeDispatch(
  // biome-ignore lint/suspicious/noExplicitAny: MCP SDK passes untyped tool arguments
  args: any,
  config: ServerConfig,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const dispatchId = args?.dispatchId;

  if (!dispatchId || typeof dispatchId !== "string") {
    return errorResponse("Missing or invalid dispatchId parameter");
  }

  logger.info("Resume dispatch requested", { dispatchId });

  // ─── Load Checkpoint Store ───────────────────────────────────────────────
  const checkpointStore = new CheckpointStore(config.checkpointDir);

  // ─── Load Persisted Manifest ─────────────────────────────────────────────
  const manifest = await checkpointStore.readManifest(dispatchId);
  if (!manifest) {
    return errorResponse(
      `No manifest found for dispatch "${dispatchId}". The checkpoint directory may not exist or the manifest is corrupt.`,
    );
  }

  // ─── Load Existing Checkpoints ───────────────────────────────────────────
  const checkpoints = await checkpointStore.readCheckpoints(dispatchId);

  // ─── Validate Hashes ─────────────────────────────────────────────────────
  const validation = await checkpointStore.validateHashes(dispatchId, manifest);
  if (!validation.valid) {
    const mismatchDetails = validation.mismatched
      .map(
        (m) =>
          `${m.taskId}: stored=${m.storedHash.slice(0, 8)}… computed=${m.computedHash.slice(0, 8)}…`,
      )
      .join("; ");

    return errorResponse(
      `Hash validation failed for dispatch "${dispatchId}". ` +
        `Mismatched tasks: ${mismatchDetails}. ` +
        `The manifest may have been modified after initial dispatch.`,
    );
  }

  // ─── Determine Completed vs Incomplete Tasks ─────────────────────────────
  const completedTaskIds = new Set(checkpoints.map((cp) => cp.taskId));
  const incompleteTasks = manifest.tasks.filter((t) => !completedTaskIds.has(t.taskId));

  logger.info("Resume analysis complete", {
    dispatchId,
    totalTasks: manifest.tasks.length,
    completedTasks: completedTaskIds.size,
    incompleteTasks: incompleteTasks.length,
  });

  // ─── Case: All Tasks Complete ────────────────────────────────────────────
  if (incompleteTasks.length === 0) {
    const taskResults = assembleTaskResults(checkpoints, dispatchId);
    let synthesisResult: SynthesisResult | undefined;

    if (manifest.synthesisPrompt) {
      synthesisResult = await runSynthesis(
        dispatchId,
        checkpoints,
        manifest.synthesisPrompt,
        config,
        manifest.temperature,
        manifest.maxTokens,
      );
    }

    const telemetryTracker = new TelemetryTracker();
    const telemetrySummary = telemetryTracker.computeSummary(taskResults);
    const result: AggregatedResult = {
      dispatchId,
      status: "completed",
      tasks: taskResults,
      synthesis: synthesisResult,
      telemetrySummary,
    };

    if (!manifest.keepCheckpoints) await checkpointStore.cleanup(dispatchId);
    telemetryTracker.logSummary(telemetrySummary, dispatchId);
    logger.info("Resume completed (all checkpointed)", {
      dispatchId,
      hadSynthesis: !!manifest.synthesisPrompt,
    });

    return successResponse(result);
  }

  // ─── Case: Incomplete Tasks Remain — Re-dispatch ─────────────────────────
  const internalTasks: InternalTask[] = incompleteTasks.map((task) => ({
    taskId: task.taskId,
    prompt: task.prompt,
    systemPrompt: task.systemPrompt,
    allowedTools: task.allowedTools,
    inputHash: computeInputHash(task, manifest),
  }));

  const sessionPool = new SessionPool(
    {
      concurrency: manifest.concurrency ?? config.maxConcurrency,
      apiUrl: config.apiUrl,
      defaultTimeout: manifest.taskTimeout ?? 3600,
    },
    logger,
    new SessionRegistry(),
    new TelemetryTracker(),
  );

  const freshResults = await sessionPool.dispatch(manifest, internalTasks);

  // Write checkpoints for newly completed tasks
  for (const result of freshResults) {
    if (result.status === "success" && result.response !== undefined) {
      await checkpointStore.writeCheckpoint(dispatchId, {
        taskId: result.taskId,
        inputHash: computeInputHash(
          manifest.tasks.find((t) => t.taskId === result.taskId)!,
          manifest,
        ),
        result: result.response,
        tokenUsage: {
          prompt: result.telemetry?.promptTokens ?? 0,
          completion: result.telemetry?.completionTokens ?? 0,
          total: result.telemetry?.totalTokens ?? 0,
        },
        telemetry: result.telemetry ?? {
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

  // ─── Combine Checkpoint Results + Fresh Results ──────────────────────────
  const allTaskResults: TaskResult[] = [];

  // Add previously checkpointed tasks
  for (const checkpoint of checkpoints) {
    allTaskResults.push(checkpointToTaskResult(checkpoint, dispatchId));
  }

  // Add freshly dispatched results
  for (const result of freshResults) {
    allTaskResults.push(result);
  }

  // ─── Synthesis (if applicable and all tasks now succeeded) ───────────────
  let synthesisResult: SynthesisResult | undefined;
  const allSucceeded = allTaskResults.every((r) => r.status === "success");

  if (manifest.synthesisPrompt && allSucceeded) {
    const successCheckpoints: CheckpointFile[] = allTaskResults
      .filter((r) => r.status === "success")
      .map((r) => ({
        taskId: r.taskId,
        inputHash: "",
        result: r.response ?? "",
        tokenUsage: {
          prompt: r.telemetry?.promptTokens ?? 0,
          completion: r.telemetry?.completionTokens ?? 0,
          total: r.telemetry?.totalTokens ?? 0,
        },
        telemetry: r.telemetry ?? {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          wallClockMs: 0,
          tokensPerSecond: 0,
        },
        completedAt: new Date().toISOString(),
      }));
    synthesisResult = await runSynthesis(
      dispatchId,
      successCheckpoints,
      manifest.synthesisPrompt,
      config,
      manifest.temperature,
      manifest.maxTokens,
    );
  }

  // ─── Compute Telemetry Summary ───────────────────────────────────────────
  const telemetryTracker = new TelemetryTracker();
  const telemetrySummary = telemetryTracker.computeSummary(allTaskResults);
  const hasFailures = allTaskResults.some((r) => r.status !== "success");

  const result: AggregatedResult = {
    dispatchId,
    status: hasFailures ? "partial" : "completed",
    tasks: allTaskResults,
    synthesis: synthesisResult,
    telemetrySummary,
  };

  if (!hasFailures && !manifest.keepCheckpoints) await checkpointStore.cleanup(dispatchId);
  telemetryTracker.logSummary(telemetrySummary, dispatchId);
  logger.info("Resume dispatch finished", {
    dispatchId,
    status: result.status,
    totalTasks: allTaskResults.length,
    successful: allTaskResults.filter((r) => r.status === "success").length,
  });

  return successResponse(result);
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Converts checkpoint files into TaskResult format for the AggregatedResult.
 */
function assembleTaskResults(checkpoints: CheckpointFile[], dispatchId: string): TaskResult[] {
  return checkpoints.map((cp) => checkpointToTaskResult(cp, dispatchId));
}

/**
 * Converts a single checkpoint into a TaskResult.
 */
function checkpointToTaskResult(checkpoint: CheckpointFile, _dispatchId: string): TaskResult {
  return {
    taskId: checkpoint.taskId,
    sessionId: randomUUID(), // Assign new session ID for resumed results
    status: "success",
    response: checkpoint.result,
    telemetry: checkpoint.telemetry,
  };
}

/**
 * Executes the synthesis LLM call with all completed task results.
 */
async function runSynthesis(
  dispatchId: string,
  checkpoints: CheckpointFile[],
  synthesisPrompt: string,
  config: ServerConfig,
  temperature?: number,
  maxTokens?: number,
): Promise<SynthesisResult> {
  // Build the synthesis content: all task results with their identifiers
  const taskResultsText = checkpoints
    .map((cp) => `## Task: ${cp.taskId}\n\n${cp.result}`)
    .join("\n\n---\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: synthesisPrompt },
    { role: "user", content: taskResultsText },
  ];

  const request: LMStudioRequest = {
    model: config.model,
    messages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens ?? 4096,
  };

  const abortController = new AbortController();
  const startTime = Date.now();

  try {
    const { result } = await sendChatCompletion(
      { apiUrl: config.apiUrl, model: config.model, maxRetries: 3 },
      request,
      abortController.signal,
      logger,
      dispatchId,
    );

    const wallClockMs = Date.now() - startTime;
    const choice = result.response.choices[0];
    const responseText = choice?.message?.content ?? "";

    const promptTokens = result.response.usage?.prompt_tokens ?? 0;
    const completionTokens = result.response.usage?.completion_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const tokensPerSecond = wallClockMs === 0 ? 0 : completionTokens / (wallClockMs / 1000);

    const telemetry: TelemetryRecord = {
      promptTokens,
      completionTokens,
      totalTokens,
      wallClockMs,
      tokensPerSecond,
    };

    logger.info("Synthesis completed", { dispatchId, wallClockMs, totalTokens });

    return {
      status: "success",
      response: responseText,
      telemetry,
    };
  } catch (err: unknown) {
    const error = err as Error & { httpStatus?: number };
    const _wallClockMs = Date.now() - startTime;

    logger.error("Synthesis failed", {
      dispatchId,
      error: error.message,
      httpStatus: error.httpStatus,
    });

    return {
      status: "failed",
      error: {
        type: error.httpStatus ? "api_error" : "connection_error",
        message: error.message ?? "Synthesis call failed",
        httpStatus: error.httpStatus,
        retryAttempts: 0,
      },
    };
  }
}

/**
 * Builds a successful MCP tool response with JSON payload.
 */
function successResponse(result: AggregatedResult): {
  content: Array<{ type: string; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

/**
 * Builds an error MCP tool response.
 */
function errorResponse(message: string): { content: Array<{ type: string; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  };
}
