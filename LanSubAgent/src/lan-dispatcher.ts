/**
 * LanDispatcher — orchestrates task dispatch across LAN endpoints.
 * Validates manifests, distributes tasks via LoadBalancer, handles retries,
 * checkpoints results to disk, and supports cancel/resume operations.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { EndpointRegistry } from "./endpoint-registry";
import { HealthChecker } from "./health-checker";
import { LoadBalancer, isSelectionError } from "./load-balancer";
import { Logger, logger as defaultLogger } from "./logger";
import {
  InternalTask,
  LanCheckpointFile,
  LanDispatchState,
  LanTaskResult,
  TaskManifest,
} from "./types";

// ─── Local Interfaces ────────────────────────────────────────────────────────

/**
 * In-memory dedup cache interface.
 * Maps task content hash to previous result to avoid re-executing identical tasks.
 */
export interface DedupCache {
  get(key: string): LanTaskResult | undefined;
  set(key: string, result: LanTaskResult): void;
  has(key: string): boolean;
}

/**
 * File-based checkpoint store interface.
 * Persists completed task results to disk for resume capability.
 */
export interface CheckpointStore {
  save(dispatchId: string, checkpoint: LanCheckpointFile): void;
  load(dispatchId: string): LanCheckpointFile[];
  clear(dispatchId: string): void;
}

/**
 * LAN telemetry tracker interface.
 * Records per-endpoint task completions and failures.
 */
export interface LanTelemetryTracker {
  recordLanTask(
    taskId: string,
    endpointId: string,
    durationMs: number,
    tokens: number,
    host: string,
    port: number,
  ): void;
  recordLanFailure(endpointId: string, durationMs: number, host: string, port: number): void;
}

// ─── Result Types ────────────────────────────────────────────────────────────

export interface LanAggregatedResult {
  dispatchId: string;
  success: boolean;
  results: LanTaskResult[];
  totalDurationMs: number;
  endpointsUsed: string[];
}

export interface LanPartialResult {
  dispatchId: string;
  completed: LanTaskResult[];
  cancelled: string[];
  inFlight: string[];
}

export interface LanProgressReport {
  dispatchId: string;
  totalTasks: number;
  completed: number;
  failed: number;
  inFlight: number;
  pending: number;
  elapsedMs: number;
}

// ─── Simple DedupCache Implementation ────────────────────────────────────────

export class InMemoryDedupCache implements DedupCache {
  private cache: Map<string, LanTaskResult> = new Map();

  get(key: string): LanTaskResult | undefined {
    return this.cache.get(key);
  }

  set(key: string, result: LanTaskResult): void {
    this.cache.set(key, result);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }
}

// ─── Simple CheckpointStore Implementation ───────────────────────────────────

export class FileCheckpointStore implements CheckpointStore {
  private dir: string;

  constructor(checkpointDir: string) {
    this.dir = checkpointDir;
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  save(dispatchId: string, checkpoint: LanCheckpointFile): void {
    const dispatchDir = path.join(this.dir, dispatchId);
    if (!fs.existsSync(dispatchDir)) {
      fs.mkdirSync(dispatchDir, { recursive: true });
    }
    const filePath = path.join(dispatchDir, `${checkpoint.taskId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), "utf-8");
  }

  load(dispatchId: string): LanCheckpointFile[] {
    const dispatchDir = path.join(this.dir, dispatchId);
    if (!fs.existsSync(dispatchDir)) {
      return [];
    }

    const files = fs.readdirSync(dispatchDir).filter((f) => f.endsWith(".json"));
    const checkpoints: LanCheckpointFile[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dispatchDir, file), "utf-8");
        checkpoints.push(JSON.parse(content) as LanCheckpointFile);
      } catch {
        // Skip corrupted checkpoint files
      }
    }

    return checkpoints;
  }

  clear(dispatchId: string): void {
    const dispatchDir = path.join(this.dir, dispatchId);
    if (fs.existsSync(dispatchDir)) {
      fs.rmSync(dispatchDir, { recursive: true, force: true });
    }
  }
}

// ─── Manifest Validation ─────────────────────────────────────────────────────

export interface ManifestValidationError {
  type: "invalid_manifest";
  message: string;
  details: string[];
}

function validateManifest(
  manifest: unknown,
): { valid: true; manifest: TaskManifest } | { valid: false; error: ManifestValidationError } {
  const errors: string[] = [];

  if (typeof manifest !== "object" || manifest === null) {
    return {
      valid: false,
      error: {
        type: "invalid_manifest",
        message: "TaskManifest must be a non-null object",
        details: ["manifest is not an object"],
      },
    };
  }

  const m = manifest as Record<string, unknown>;

  if (!Array.isArray(m.tasks)) {
    errors.push("tasks must be an array");
  } else if (m.tasks.length === 0) {
    errors.push("tasks array must not be empty");
  } else {
    for (let i = 0; i < m.tasks.length; i++) {
      const task = m.tasks[i];
      if (typeof task !== "object" || task === null) {
        errors.push(`tasks[${i}] must be an object`);
        continue;
      }
      const t = task as Record<string, unknown>;
      if (typeof t.taskId !== "string" || t.taskId.trim().length === 0) {
        errors.push(`tasks[${i}].taskId must be a non-empty string`);
      }
      if (typeof t.prompt !== "string" || t.prompt.trim().length === 0) {
        errors.push(`tasks[${i}].prompt must be a non-empty string`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: {
        type: "invalid_manifest",
        message: "TaskManifest validation failed",
        details: errors,
      },
    };
  }

  return { valid: true, manifest: m as unknown as TaskManifest };
}

// ─── Dedup Key Generation ────────────────────────────────────────────────────

function computeDedupKey(taskId: string, prompt: string, systemPrompt?: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(taskId);
  hash.update(prompt);
  if (systemPrompt) {
    hash.update(systemPrompt);
  }
  return hash.digest("hex");
}

// ─── LanDispatcher ───────────────────────────────────────────────────────────

export class LanDispatcher {
  private registry: EndpointRegistry;
  private loadBalancer: LoadBalancer;
  private _healthChecker: HealthChecker;
  private dedupCache: DedupCache;
  private checkpointStore: CheckpointStore;
  private telemetry: LanTelemetryTracker;
  private logger: Logger;
  private dispatches: Map<string, LanDispatchState>;

  constructor(deps: {
    registry: EndpointRegistry;
    loadBalancer: LoadBalancer;
    healthChecker: HealthChecker;
    telemetry: LanTelemetryTracker;
    logger?: Logger;
    checkpointDir?: string;
    dedupCache?: DedupCache;
    checkpointStore?: CheckpointStore;
  }) {
    this.registry = deps.registry;
    this.loadBalancer = deps.loadBalancer;
    this._healthChecker = deps.healthChecker;
    this.telemetry = deps.telemetry;
    this.logger = deps.logger ?? defaultLogger;
    this.dedupCache = deps.dedupCache ?? new InMemoryDedupCache();
    this.checkpointStore =
      deps.checkpointStore ?? new FileCheckpointStore(deps.checkpointDir ?? "./.lan-checkpoints");
    this.dispatches = new Map();
  }

  /**
   * Dispatch tasks across LAN endpoints.
   * Validates the manifest, checks dedup cache, assigns tasks to endpoints,
   * handles retries on failure, and checkpoints results.
   */
  async dispatch(manifest: TaskManifest): Promise<LanAggregatedResult> {
    // Validate manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      this.logger.error(`Manifest validation failed: ${validation.error.message}`);
      return {
        dispatchId: "",
        success: false,
        results: [],
        totalDurationMs: 0,
        endpointsUsed: [],
      };
    }

    const dispatchId = crypto.randomUUID();
    const startTime = Date.now();
    const dispatchAbort = new AbortController();

    // Build internal task list
    const tasks: InternalTask[] = validation.manifest.tasks.map((t) => ({
      taskId: t.taskId,
      prompt: t.prompt,
      systemPrompt: t.systemPrompt ?? validation.manifest.systemPrompt,
      status: "pending" as const,
      retryCount: 0,
      failedEndpoints: [],
    }));

    // Initialize dispatch state
    const state: LanDispatchState = {
      dispatchId,
      manifest: validation.manifest,
      tasks,
      results: new Map(),
      inFlight: new Map(),
      cancelled: false,
      startTime,
      dispatchAbort,
    };

    this.dispatches.set(dispatchId, state);

    // Check dedup cache for already-completed tasks
    for (const task of tasks) {
      const dedupKey = computeDedupKey(task.taskId, task.prompt, task.systemPrompt);
      const cached = this.dedupCache.get(dedupKey);
      if (cached) {
        task.status = "completed";
        state.results.set(task.taskId, { ...cached, taskId: task.taskId });
        this.logger.info(`Task "${task.taskId}" resolved from dedup cache`);
      }
    }

    // Dispatch pending tasks concurrently
    const maxConcurrency = validation.manifest.concurrency ?? 5;
    await this.executeTasks(state, maxConcurrency);

    const totalDurationMs = Date.now() - startTime;
    const results = Array.from(state.results.values());
    const endpointsUsed = [...new Set(results.map((r) => r.endpointId).filter(Boolean))];
    const allSucceeded = results.every((r) => r.success);

    // Cleanup dispatch state
    this.dispatches.delete(dispatchId);

    return {
      dispatchId,
      success: allSucceeded && results.length === tasks.length,
      results,
      totalDurationMs,
      endpointsUsed,
    };
  }

  /**
   * Cancel an active dispatch.
   * Aborts in-flight requests and returns partial results.
   */
  cancel(dispatchId: string): LanPartialResult {
    const state = this.dispatches.get(dispatchId);
    if (!state) {
      return { dispatchId, completed: [], cancelled: [], inFlight: [] };
    }

    state.cancelled = true;
    state.dispatchAbort.abort();

    // Abort all in-flight requests
    const inFlightIds: string[] = [];
    for (const [taskId, flight] of state.inFlight) {
      flight.abort.abort();
      inFlightIds.push(taskId);
    }
    state.inFlight.clear();

    // Collect cancelled task IDs (pending tasks that won't be executed)
    const cancelledIds = state.tasks.filter((t) => t.status === "pending").map((t) => t.taskId);

    const completed = Array.from(state.results.values());

    this.logger.info(
      `Dispatch "${dispatchId}" cancelled: ${completed.length} completed, ${cancelledIds.length} cancelled, ${inFlightIds.length} in-flight aborted`,
    );

    return {
      dispatchId,
      completed,
      cancelled: cancelledIds,
      inFlight: inFlightIds,
    };
  }

  /**
   * Resume a dispatch from checkpoint.
   * Loads previously checkpointed results and re-dispatches incomplete tasks.
   */
  async resume(dispatchId: string): Promise<LanAggregatedResult> {
    const checkpoints = this.checkpointStore.load(dispatchId);
    if (checkpoints.length === 0) {
      this.logger.warn(`No checkpoints found for dispatch "${dispatchId}"`);
      return {
        dispatchId,
        success: false,
        results: [],
        totalDurationMs: 0,
        endpointsUsed: [],
      };
    }

    // Reconstruct results from checkpoints
    const completedTaskIds = new Set(checkpoints.map((cp) => cp.taskId));

    // We need the original manifest to re-dispatch. If we don't have it,
    // we can only return what we have from checkpoints.
    const existingState = this.dispatches.get(dispatchId);
    if (!existingState) {
      // Return checkpoint data as partial results
      const results: LanTaskResult[] = checkpoints.map((cp) => ({
        taskId: cp.taskId,
        sessionId: dispatchId,
        status: "success" as const,
        response: cp.result,
        endpointId: cp.endpointId,
        endpointHost: "",
        endpointPort: 0,
        durationMs: cp.telemetry?.wallClockMs ?? 0,
        success: true,
      }));

      return {
        dispatchId,
        success: true,
        results,
        totalDurationMs: 0,
        endpointsUsed: [...new Set(checkpoints.map((cp) => cp.endpointId))],
      };
    }

    // Resume: mark checkpointed tasks as complete and re-dispatch the rest
    const startTime = Date.now();
    for (const task of existingState.tasks) {
      if (completedTaskIds.has(task.taskId)) {
        task.status = "completed";
        const cp = checkpoints.find((c) => c.taskId === task.taskId)!;
        existingState.results.set(task.taskId, {
          taskId: cp.taskId,
          sessionId: dispatchId,
          status: "success",
          response: cp.result,
          endpointId: cp.endpointId,
          endpointHost: "",
          endpointPort: 0,
          durationMs: cp.telemetry?.wallClockMs ?? 0,
          success: true,
        });
      }
    }

    existingState.cancelled = false;
    const maxConcurrency = existingState.manifest.concurrency ?? 5;
    await this.executeTasks(existingState, maxConcurrency);

    const totalDurationMs = Date.now() - startTime;
    const results = Array.from(existingState.results.values());
    const endpointsUsed = [...new Set(results.map((r) => r.endpointId).filter(Boolean))];

    this.dispatches.delete(dispatchId);

    return {
      dispatchId,
      success: results.every((r) => r.success) && results.length === existingState.tasks.length,
      results,
      totalDurationMs,
      endpointsUsed,
    };
  }

  /**
   * Get progress report for an active dispatch.
   */
  getStatus(dispatchId: string): LanProgressReport | null {
    const state = this.dispatches.get(dispatchId);
    if (!state) {
      return null;
    }

    const completed = state.tasks.filter((t) => t.status === "completed").length;
    const failed = state.tasks.filter((t) => t.status === "failed").length;
    const inFlight = state.inFlight.size;
    const pending = state.tasks.filter((t) => t.status === "pending").length;

    return {
      dispatchId,
      totalTasks: state.tasks.length,
      completed,
      failed,
      inFlight,
      pending,
      elapsedMs: Date.now() - state.startTime,
    };
  }

  // ─── Private: Task Execution Engine ────────────────────────────────────────

  /**
   * Execute pending tasks with bounded concurrency.
   * Implements graceful degradation: redistributes tasks on endpoint failure,
   * returns partial results if all endpoints become unhealthy.
   */
  private async executeTasks(state: LanDispatchState, maxConcurrency: number): Promise<void> {
    const pendingTasks = () => state.tasks.filter((t) => t.status === "pending");
    const retryLimit = this.loadBalancer.getRetryLimit();

    // Semaphore-style concurrent execution
    const runTask = async (task: InternalTask): Promise<void> => {
      if (state.cancelled) return;

      // Select endpoint via LoadBalancer
      const selection = this.loadBalancer.selectEndpoint(
        state.manifest.systemPrompt ? undefined : undefined,
      );

      if (isSelectionError(selection)) {
        // No endpoints available — check if we should wait for recovery
        if (task.retryCount < retryLimit) {
          // Try to get candidates excluding failed endpoints
          const candidates = this.loadBalancer.getCandidates(undefined, task.failedEndpoints);
          if (candidates.length > 0) {
            // Use first available candidate
            const endpoint = candidates[0];
            await this.executeOnEndpoint(state, task, endpoint.definition.id, retryLimit);
            return;
          }
        }

        // All endpoints unavailable — mark task as failed
        task.status = "failed";
        state.results.set(task.taskId, {
          taskId: task.taskId,
          sessionId: state.dispatchId,
          status: "failed",
          error: {
            type: selection.error,
            message: selection.reason,
            retryAttempts: task.retryCount,
          },
          endpointId: "",
          endpointHost: "",
          endpointPort: 0,
          durationMs: 0,
          success: false,
        });
        this.logger.warn(`Task "${task.taskId}" failed: ${selection.reason}`);
        return;
      }

      const endpointId = selection.endpoint.definition.id;
      await this.executeOnEndpoint(state, task, endpointId, retryLimit);
    };

    // Execute with concurrency limit
    const executing: Promise<void>[] = [];

    while (pendingTasks().length > 0 && !state.cancelled) {
      const pending = pendingTasks();
      if (pending.length === 0) break;

      // Fill up to max concurrency
      while (executing.length < maxConcurrency && pending.length > 0) {
        const task = pending.shift();
        if (!task) break;
        task.status = "in-progress";

        const promise = runTask(task).then(() => {
          const idx = executing.indexOf(promise);
          if (idx >= 0) executing.splice(idx, 1);
        });
        executing.push(promise);
      }

      // Wait for at least one to complete before scheduling more
      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
      } else if (pendingTasks().length === 0 && executing.length > 0) {
        await Promise.all(executing);
      } else {
        break;
      }
    }

    // Wait for all remaining in-flight tasks to complete
    if (executing.length > 0) {
      await Promise.all(executing);
    }
  }

  /**
   * Execute a single task on a specific endpoint with retry support.
   */
  private async executeOnEndpoint(
    state: LanDispatchState,
    task: InternalTask,
    endpointId: string,
    retryLimit: number,
  ): Promise<void> {
    const endpoint = this.registry.getEndpoint(endpointId);
    if (!endpoint) {
      // Endpoint disappeared — try retry
      await this.retryTask(state, task, retryLimit);
      return;
    }

    // Acquire concurrency slot
    if (!this.registry.acquireSlot(endpointId)) {
      // At capacity — try another endpoint
      await this.retryTask(state, task, retryLimit);
      return;
    }

    // Set up abort controller for this task
    const taskAbort = new AbortController();
    state.inFlight.set(task.taskId, { endpointId, abort: taskAbort });
    task.assignedEndpoint = endpointId;

    const startMs = Date.now();

    try {
      const result = await this.sendRequest(
        endpoint.definition.host,
        endpoint.definition.port,
        task,
        taskAbort.signal,
      );
      const durationMs = Date.now() - startMs;

      // Release slot
      this.registry.releaseSlot(endpointId);
      state.inFlight.delete(task.taskId);

      // Record success
      const taskResult: LanTaskResult = {
        taskId: task.taskId,
        sessionId: state.dispatchId,
        status: "success",
        response: result,
        endpointId,
        endpointHost: endpoint.definition.host,
        endpointPort: endpoint.definition.port,
        durationMs,
        success: true,
        retryEndpoints: task.failedEndpoints.length > 0 ? [...task.failedEndpoints] : undefined,
      };

      task.status = "completed";
      state.results.set(task.taskId, taskResult);

      // Record telemetry
      this.telemetry.recordLanTask(
        task.taskId,
        endpointId,
        durationMs,
        0,
        endpoint.definition.host,
        endpoint.definition.port,
      );
      this.registry.recordTaskMetrics(endpointId, durationMs, 0, false);

      // Cache for dedup
      const dedupKey = computeDedupKey(task.taskId, task.prompt, task.systemPrompt);
      this.dedupCache.set(dedupKey, taskResult);

      // Checkpoint to disk
      this.saveCheckpoint(state.dispatchId, task, taskResult, endpointId);

      this.logger.info(
        `Task "${task.taskId}" completed on endpoint "${endpointId}" in ${durationMs}ms`,
      );
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;

      // Release slot
      this.registry.releaseSlot(endpointId);
      state.inFlight.delete(task.taskId);

      // Record failure telemetry
      this.telemetry.recordLanFailure(
        endpointId,
        durationMs,
        endpoint.definition.host,
        endpoint.definition.port,
      );
      this.registry.recordTaskMetrics(endpointId, durationMs, 0, true);

      // Track failed endpoint for retry exclusion
      task.failedEndpoints.push(endpointId);

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Task "${task.taskId}" failed on endpoint "${endpointId}": ${errorMessage}`);

      // Retry on a different endpoint
      await this.retryTask(state, task, retryLimit);
    }
  }

  /**
   * Retry a task on a different endpoint.
   * Redistributes to remaining healthy endpoints (graceful degradation).
   */
  private async retryTask(
    state: LanDispatchState,
    task: InternalTask,
    retryLimit: number,
  ): Promise<void> {
    if (state.cancelled) {
      task.status = "failed";
      return;
    }

    if (task.retryCount >= retryLimit) {
      // Exhausted retries
      task.status = "failed";
      state.results.set(task.taskId, {
        taskId: task.taskId,
        sessionId: state.dispatchId,
        status: "failed",
        error: {
          type: "retry_exhausted",
          message: `Task failed after ${task.retryCount} retries on endpoints: ${task.failedEndpoints.join(", ")}`,
          retryAttempts: task.retryCount,
        },
        endpointId: "",
        endpointHost: "",
        endpointPort: 0,
        durationMs: 0,
        success: false,
        retryEndpoints: [...task.failedEndpoints],
      });
      this.logger.warn(`Task "${task.taskId}" exhausted ${retryLimit} retries`);
      return;
    }

    task.retryCount++;

    // Get candidates excluding previously failed endpoints
    const candidates = this.loadBalancer.getCandidates(undefined, task.failedEndpoints);

    if (candidates.length === 0) {
      // No healthy endpoints available — partial result scenario (Req 10.2)
      task.status = "failed";
      state.results.set(task.taskId, {
        taskId: task.taskId,
        sessionId: state.dispatchId,
        status: "failed",
        error: {
          type: "no_endpoints_available",
          message: "All endpoints unhealthy or previously failed for this task",
          retryAttempts: task.retryCount,
        },
        endpointId: "",
        endpointHost: "",
        endpointPort: 0,
        durationMs: 0,
        success: false,
        retryEndpoints: [...task.failedEndpoints],
      });
      this.logger.warn(`Task "${task.taskId}" failed: no healthy endpoints available for retry`);
      return;
    }

    // Retry on the first available candidate
    const retryEndpoint = candidates[0];
    this.logger.info(
      `Retrying task "${task.taskId}" on endpoint "${retryEndpoint.definition.id}" (attempt ${task.retryCount})`,
    );
    await this.executeOnEndpoint(state, task, retryEndpoint.definition.id, retryLimit);
  }

  /**
   * Send an HTTP POST request to an endpoint's /v1/chat/completions API.
   */
  private async sendRequest(
    host: string,
    port: number,
    task: InternalTask,
    signal: AbortSignal,
  ): Promise<string> {
    const url = `http://${host}:${port}/v1/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (task.systemPrompt) {
      messages.push({ role: "system", content: task.systemPrompt });
    }
    messages.push({ role: "user", content: task.prompt });

    const body = JSON.stringify({
      messages,
      stream: false,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data?.choices?.[0]?.message?.content ?? "";
    return content;
  }

  /**
   * Save a checkpoint file for a completed task.
   */
  private saveCheckpoint(
    dispatchId: string,
    task: InternalTask,
    result: LanTaskResult,
    endpointId: string,
  ): void {
    try {
      const checkpoint: LanCheckpointFile = {
        taskId: task.taskId,
        inputHash: computeDedupKey(task.taskId, task.prompt, task.systemPrompt),
        result: result.response ?? "",
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        telemetry: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          wallClockMs: result.durationMs,
          tokensPerSecond: 0,
        },
        completedAt: new Date().toISOString(),
        endpointId,
      };

      this.checkpointStore.save(dispatchId, checkpoint);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Checkpoint save failed for task "${task.taskId}": ${msg}`);
    }
  }
}
