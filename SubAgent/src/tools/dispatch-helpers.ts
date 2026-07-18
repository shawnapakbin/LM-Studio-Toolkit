/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * Helper utilities for the dispatch_sub_tasks handler.
 * Includes singleton management, synthesis call, and shared helpers.
 */

import { getLogger } from "llm-toolkit-observability";
import { CheckpointStore } from "../checkpoint-store";
import { DedupCache } from "../dedup-cache";
import { type ChatMessage, sendChatCompletion } from "../http-client";
import type { ServerConfig } from "../mcp-server";
import { SessionRegistry } from "../session-registry";
import { TelemetryTracker } from "../telemetry";
import type { TaskManifest, TelemetryRecord } from "../types";

// ─── Singleton Instances ─────────────────────────────────────────────────────

let dedupCache: DedupCache | null = null;
let sessionRegistry: SessionRegistry | null = null;
let checkpointStore: CheckpointStore | null = null;
let telemetryTracker: TelemetryTracker | null = null;

export function getDedupCache(config: ServerConfig): DedupCache {
  if (!dedupCache) dedupCache = new DedupCache(config.cachePath);
  return dedupCache;
}

export function getSessionRegistry(): SessionRegistry {
  if (!sessionRegistry) sessionRegistry = new SessionRegistry();
  return sessionRegistry;
}

export function getCheckpointStore(config: ServerConfig): CheckpointStore {
  if (!checkpointStore) checkpointStore = new CheckpointStore(config.checkpointDir);
  return checkpointStore;
}

export function getTelemetryTracker(): TelemetryTracker {
  if (!telemetryTracker) telemetryTracker = new TelemetryTracker();
  return telemetryTracker;
}

export function errorResponse(message: string) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
}

export const EMPTY_TELEMETRY: TelemetryRecord = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  wallClockMs: 0,
  tokensPerSecond: 0,
};

// ─── Synthesis/Merge Call ─────────────────────────────────────────────────────

export async function executeSynthesisCall(
  config: ServerConfig,
  manifest: TaskManifest,
  inputText: string,
  traceId: string,
): Promise<{ response: string; telemetry: TelemetryRecord }> {
  const logger = getLogger();
  const messages: ChatMessage[] = [{ role: "user", content: inputText }];
  const startTime = Date.now();
  const { result } = await sendChatCompletion(
    { apiUrl: config.apiUrl, model: config.model, maxRetries: manifest.maxRetries ?? 3 },
    {
      model: config.model,
      messages,
      temperature: manifest.temperature ?? 0.7,
      max_tokens: manifest.maxTokens ?? 4096,
    },
    AbortSignal.timeout((manifest.taskTimeout ?? 3600) * 1000),
    logger,
    traceId,
  );
  const wallClockMs = Date.now() - startTime;
  const promptTokens = result.response.usage?.prompt_tokens ?? 0;
  const completionTokens = result.response.usage?.completion_tokens ?? 0;
  const tokensPerSecond = wallClockMs === 0 ? 0 : completionTokens / (wallClockMs / 1000);
  return {
    response: result.response.choices[0]?.message?.content ?? "",
    telemetry: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      wallClockMs,
      tokensPerSecond,
    },
  };
}
