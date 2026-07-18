/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * HTTP client layer for LM Studio API communication.
 * Handles request formatting, retry logic with exponential backoff,
 * and response parsing. Extracted from session-pool to respect file size limits.
 */

import type { Logger } from "llm-toolkit-observability";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LMStudioRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none";
}

export interface LMStudioResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCallRequest[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface HttpClientConfig {
  apiUrl: string;
  model: string;
  maxRetries: number;
}

export interface HttpRequestResult {
  response: LMStudioResponse;
  durationMs: number;
}

// ─── Retry Logic ─────────────────────────────────────────────────────────────

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isNonRetryableClientError(status: number): boolean {
  return status >= 400 && status <= 498;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── HTTP Client ─────────────────────────────────────────────────────────────

export async function sendChatCompletion(
  config: HttpClientConfig,
  request: LMStudioRequest,
  signal: AbortSignal,
  logger: Logger,
  traceId: string,
): Promise<{ result: HttpRequestResult; retryAttempts: number }> {
  let lastError: Error | null = null;
  let retryAttempts = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (signal.aborted) {
      throw new Error("Request aborted");
    }

    if (attempt > 0) {
      const backoffMs = Math.pow(2, attempt) * 1000;
      logger.debug("Retrying after backoff", { traceId, attempt, backoffMs });
      await sleep(backoffMs);
      retryAttempts++;
    }

    const startTime = Date.now();

    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });

      const durationMs = Date.now() - startTime;

      if (response.ok) {
        const data = (await response.json()) as LMStudioResponse;
        return { result: { response: data, durationMs }, retryAttempts };
      }

      if (isRetryableStatus(response.status)) {
        lastError = Object.assign(new Error(`HTTP ${response.status}`), {
          httpStatus: response.status,
          retryable: true,
        });
        logger.warn("Retryable HTTP error", { traceId, status: response.status, attempt });
        continue;
      }

      if (isNonRetryableClientError(response.status)) {
        const body = await response.text().catch(() => "");
        throw Object.assign(new Error(`HTTP ${response.status}: ${body}`), {
          httpStatus: response.status,
          retryable: false,
        });
      }

      // Unknown status — treat as non-retryable
      const body = await response.text().catch(() => "");
      throw Object.assign(new Error(`HTTP ${response.status}: ${body}`), {
        httpStatus: response.status,
        retryable: false,
      });
    } catch (err: unknown) {
      const error = err as Error & { httpStatus?: number; retryable?: boolean };

      if (signal.aborted) {
        throw new Error("Request aborted");
      }

      if (error.retryable === false) {
        throw error;
      }

      // Connection errors are retryable
      if (!error.httpStatus) {
        lastError = Object.assign(error, { retryable: true });
        logger.warn("Connection error", { traceId, attempt, message: error.message });
        continue;
      }

      throw error;
    }
  }

  // All retries exhausted
  throw Object.assign(lastError ?? new Error("Request failed after retries"), { retryAttempts });
}
