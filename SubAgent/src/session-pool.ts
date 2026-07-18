/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * SessionPool — Concurrency manager, FIFO queue, HTTP dispatch.
 * Manages parallel LLM inference sessions against LM Studio's OpenAI-compatible API.
 */

import { randomUUID } from "node:crypto";
import { getLogger } from "llm-toolkit-observability";
import { type ChatMessage, type LMStudioRequest, sendChatCompletion } from "./http-client";
import { RecursionGuard } from "./recursion-guard";
import {
  type DispatchState,
  type InternalTask,
  type PartialResult,
  buildCancelledResult,
  buildProgressReport,
  buildToolDefinitions,
  normalizeToolCalls,
} from "./session-pool-helpers";
import { SessionRegistry } from "./session-registry";
import { TelemetryTracker } from "./telemetry";
import type {
  ProgressReport,
  SessionPoolConfig,
  TaskError,
  TaskManifest,
  TaskResult,
  TelemetryRecord,
} from "./types";

// Re-export for downstream consumers
export type { InternalTask, PartialResult } from "./session-pool-helpers";

// ─── Constants ───────────────────────────────────────────────────────────────

type Logger = ReturnType<typeof getLogger>;

const MAX_TOOL_CALL_ITERATIONS = 25;
const PROGRESS_INTERVAL_MS = 5000;
const BLOCKED_TOOL = "dispatch_sub_tasks";

// ─── SessionPool Class ───────────────────────────────────────────────────────

export class SessionPool {
  private config: SessionPoolConfig;
  private logger: Logger;
  private dispatches: Map<string, DispatchState> = new Map();
  private registry: SessionRegistry;
  private telemetry: TelemetryTracker;

  constructor(
    config: SessionPoolConfig,
    logger?: Logger,
    registry?: SessionRegistry,
    telemetry?: TelemetryTracker,
  ) {
    this.config = {
      concurrency: Math.max(1, Math.min(10, config.concurrency)),
      apiUrl: config.apiUrl,
      defaultTimeout: config.defaultTimeout,
    };
    this.logger = logger ?? getLogger();
    this.registry = registry ?? new SessionRegistry();
    this.telemetry = telemetry ?? new TelemetryTracker();
  }

  async dispatch(manifest: TaskManifest, tasks: InternalTask[]): Promise<TaskResult[]> {
    const dispatchId = randomUUID();
    const concurrency = manifest.concurrency ?? this.config.concurrency;
    this.logger.info("Dispatch started", {
      traceId: dispatchId,
      taskCount: tasks.length,
      concurrency,
    });

    const dispatchAbort = new AbortController();
    const state: DispatchState = {
      dispatchId,
      manifest,
      tasks,
      results: new Map(),
      inFlight: new Map(),
      cancelled: false,
      startTime: Date.now(),
      dispatchAbort,
      progressInterval: null,
    };
    this.dispatches.set(dispatchId, state);

    const dispatchTimeout = (manifest.dispatchTimeout ?? 14400) * 1000;
    const dispatchTimer = setTimeout(() => dispatchAbort.abort(), dispatchTimeout);
    state.progressInterval = setInterval(() => this.emitProgress(state), PROGRESS_INTERVAL_MS);

    try {
      for (const task of tasks) {
        this.registry.register({
          taskId: task.taskId,
          inputHash: task.inputHash,
          status: "pending",
          result: null,
          dispatchId,
          timestamp: new Date().toISOString(),
        });
      }
      await this.processQueue(state, concurrency, dispatchId);
    } finally {
      clearTimeout(dispatchTimer);
      if (state.progressInterval) clearInterval(state.progressInterval);
    }

    this.emitProgress(state);
    const results = tasks.map((t) => state.results.get(t.taskId) ?? buildCancelledResult(t.taskId));
    this.logger.info("Dispatch completed", {
      traceId: dispatchId,
      total: tasks.length,
      completed: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
    });
    return results;
  }

  cancel(dispatchId: string): PartialResult {
    const state = this.dispatches.get(dispatchId);
    if (!state)
      return {
        dispatchId,
        status: "cancelled",
        completedResults: [],
        cancelledTaskIds: [],
        abortedTaskIds: [],
      };

    state.cancelled = true;
    const abortedTaskIds: string[] = [];
    for (const [taskId, controller] of state.inFlight) {
      controller.abort();
      abortedTaskIds.push(taskId);
      this.registry.updateStatus(taskId, dispatchId, "aborted");
    }

    const completedResults = Array.from(state.results.values());
    const completedIds = new Set(completedResults.map((r) => r.taskId));
    const abortedSet = new Set(abortedTaskIds);
    const cancelledTaskIds = state.tasks
      .map((t) => t.taskId)
      .filter((id) => !completedIds.has(id) && !abortedSet.has(id));
    for (const taskId of cancelledTaskIds)
      this.registry.updateStatus(taskId, dispatchId, "cancelled");

    this.logger.info("Dispatch cancelled", {
      traceId: dispatchId,
      completed: completedResults.length,
      aborted: abortedTaskIds.length,
      cancelled: cancelledTaskIds.length,
    });
    return { dispatchId, status: "cancelled", completedResults, cancelledTaskIds, abortedTaskIds };
  }

  getStatus(dispatchId: string): ProgressReport | null {
    const state = this.dispatches.get(dispatchId);
    return state ? buildProgressReport(state) : null;
  }

  getMostRecentCompletedStatus(): ProgressReport | null {
    let mostRecent: DispatchState | null = null;
    for (const state of this.dispatches.values()) {
      // A dispatch is "completed" when it has no in-flight tasks
      if (state.inFlight.size === 0 && state.results.size > 0) {
        if (!mostRecent || state.startTime > mostRecent.startTime) {
          mostRecent = state;
        }
      }
    }
    return mostRecent ? buildProgressReport(mostRecent) : null;
  }

  // ─── Queue Processing ──────────────────────────────────────────────────────

  private async processQueue(
    state: DispatchState,
    concurrency: number,
    traceId: string,
  ): Promise<void> {
    let nextIndex = 0;
    const executing: Set<Promise<void>> = new Set();

    while (nextIndex < state.tasks.length || executing.size > 0) {
      if (state.cancelled || state.dispatchAbort.signal.aborted) break;
      while (nextIndex < state.tasks.length && executing.size < concurrency) {
        if (state.cancelled || state.dispatchAbort.signal.aborted) break;
        const task = state.tasks[nextIndex++];
        const promise = this.executeTask(state, task, traceId).then(() => {
          executing.delete(promise);
        });
        executing.add(promise);
      }
      if (executing.size > 0) await Promise.race(executing);
    }
  }

  private async executeTask(
    state: DispatchState,
    task: InternalTask,
    traceId: string,
  ): Promise<void> {
    const sessionId = randomUUID();
    const taskTimeout = (state.manifest.taskTimeout ?? this.config.defaultTimeout) * 1000;
    const taskAbort = new AbortController();
    const timer = setTimeout(() => taskAbort.abort(), taskTimeout);

    state.inFlight.set(task.taskId, taskAbort);
    this.registry.updateStatus(task.taskId, state.dispatchId, "in-progress");
    const onDispatchAbort = () => taskAbort.abort();
    state.dispatchAbort.signal.addEventListener("abort", onDispatchAbort);
    const startTime = Date.now();

    try {
      const result = await this.runSession(state, task, sessionId, taskAbort.signal, traceId);
      const wallClockMs = Date.now() - startTime;
      const taskResult: TaskResult = {
        taskId: task.taskId,
        sessionId,
        status: "success",
        response: result.response,
        truncated: result.truncated || undefined,
        telemetry: result.telemetry
          ? { ...result.telemetry, wallClockMs }
          : this.telemetry.createRecord(0, 0, wallClockMs),
      };
      state.results.set(task.taskId, taskResult);
      this.registry.updateStatus(task.taskId, state.dispatchId, "success", result.response);
      if (taskResult.telemetry) this.telemetry.record(task.taskId, taskResult.telemetry);
    } catch (err: unknown) {
      const wallClockMs = Date.now() - startTime;
      const error = err as Error & { httpStatus?: number; retryAttempts?: number };
      const isTimeout = taskAbort.signal.aborted && !state.cancelled;
      const status = state.cancelled ? "aborted" : isTimeout ? "timed_out" : "failed";
      const taskError: TaskError = {
        type: isTimeout ? "timeout" : error.httpStatus ? "api_error" : "connection_error",
        message: error.message ?? "Unknown error",
        httpStatus: error.httpStatus,
        retryAttempts: error.retryAttempts ?? 0,
      };
      state.results.set(task.taskId, {
        taskId: task.taskId,
        sessionId,
        status,
        error: taskError,
        telemetry: this.telemetry.createRecord(0, 0, wallClockMs),
      });
      this.registry.updateStatus(task.taskId, state.dispatchId, status);
      this.logger.warn("Task failed", {
        traceId,
        taskId: task.taskId,
        status,
        error: error.message,
      });
    } finally {
      clearTimeout(timer);
      state.inFlight.delete(task.taskId);
      state.dispatchAbort.signal.removeEventListener("abort", onDispatchAbort);
    }
  }

  // ─── Session Execution with Tool Call Loop ─────────────────────────────────

  private async runSession(
    state: DispatchState,
    task: InternalTask,
    _sessionId: string,
    signal: AbortSignal,
    traceId: string,
  ): Promise<{ response: string; truncated: boolean; telemetry: TelemetryRecord | null }> {
    const guard = new RecursionGuard(1);
    const messages: ChatMessage[] = [];
    const baseSystemPrompt = task.systemPrompt ?? state.manifest.systemPrompt ?? "";
    const systemPrompt = guard.injectDepthPrompt(baseSystemPrompt);
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: task.prompt });

    const tools = buildToolDefinitions(task.allowedTools, guard);
    const hasTools = tools !== null && tools.length > 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    for (let iteration = 0; iteration < MAX_TOOL_CALL_ITERATIONS; iteration++) {
      if (signal.aborted) throw new Error("Request aborted");

      const request: LMStudioRequest = {
        model: process.env.SUBAGENT_MODEL ?? "default",
        messages: [...messages],
        temperature: state.manifest.temperature ?? 0.7,
        max_tokens: state.manifest.maxTokens ?? 4096,
      };
      if (hasTools) {
        request.tools = tools!;
        request.tool_choice = "auto";
      }

      const { result } = await sendChatCompletion(
        {
          apiUrl: this.config.apiUrl,
          model: request.model,
          maxRetries: state.manifest.maxRetries ?? 3,
        },
        request,
        signal,
        this.logger,
        traceId,
      );

      if (result.response.usage) {
        totalPromptTokens += result.response.usage.prompt_tokens;
        totalCompletionTokens += result.response.usage.completion_tokens;
      }

      const choice = result.response.choices[0];
      if (!choice) throw new Error("Empty response from LM Studio");

      messages.push({
        role: "assistant",
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        return {
          response: choice.message.content ?? "",
          truncated: false,
          telemetry: this.telemetry.createRecord(totalPromptTokens, totalCompletionTokens, 0),
        };
      }

      // Process tool calls with recursion guard and authorization checks
      const normalizedCalls = normalizeToolCalls(choice.message.tool_calls);
      for (const toolCall of normalizedCalls) {
        const toolName = toolCall.function.name;
        if (toolName === BLOCKED_TOOL) {
          messages.push({
            role: "tool",
            content: JSON.stringify({ error: guard.getDepthMessage() }),
            tool_call_id: toolCall.id,
          });
        } else if (task.allowedTools && !task.allowedTools.includes(toolName)) {
          messages.push({
            role: "tool",
            content: JSON.stringify({
              error: `Tool "${toolName}" is not available. Allowed tools: ${task.allowedTools.join(", ")}`,
            }),
            tool_call_id: toolCall.id,
          });
        } else {
          messages.push({
            role: "tool",
            content: JSON.stringify({ error: `Tool "${toolName}" execution not yet routed.` }),
            tool_call_id: toolCall.id,
          });
        }
      }

      if (iteration === MAX_TOOL_CALL_ITERATIONS - 1) {
        return {
          response: choice.message.content ?? "",
          truncated: true,
          telemetry: this.telemetry.createRecord(totalPromptTokens, totalCompletionTokens, 0),
        };
      }
    }
    return {
      response: "",
      truncated: true,
      telemetry: this.telemetry.createRecord(totalPromptTokens, totalCompletionTokens, 0),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private emitProgress(state: DispatchState): void {
    const report = buildProgressReport(state);
    this.logger.info("Progress update", {
      traceId: state.dispatchId,
      completed: report.completedTasks,
      failed: report.failedTasks,
      total: report.totalTasks,
      elapsedSeconds: report.elapsedSeconds,
    });
  }
}
