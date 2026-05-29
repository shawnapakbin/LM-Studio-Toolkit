/**
 * Canonical ToolCall format for tool invocation normalization.
 */
export interface ToolCall {
  [key: string]: unknown;
  id: string;
  task_run_id: string;
  tool_name: string;
  input_params: string;
  output_result: string;
  success: boolean;
  error_code?: string;
  duration_ms?: number;
  timestamp: string;
}
/**
 * Shared Types for LLM Toolkit
 *
 * Unified response envelope and error codes used across all tools.
 */

/**
 * Standard error codes used across all tools.
 */
export enum ErrorCode {
  /** Invalid input parameters */
  INVALID_INPUT = "INVALID_INPUT",
  /** Operation timed out */
  TIMEOUT = "TIMEOUT",
  /** Request blocked by security policy */
  POLICY_BLOCKED = "POLICY_BLOCKED",
  /** Execution failed during runtime */
  EXECUTION_FAILED = "EXECUTION_FAILED",
  /** Resource not found */
  NOT_FOUND = "NOT_FOUND",
  /** Authentication failure */
  AUTH_FAILED = "AUTH_FAILED",
  /** Rate limit exceeded */
  RATE_LIMITED = "RATE_LIMITED",
}

/**
 * Unified response envelope for all tool operations.
 * Ensures consistent structure across HTTP and MCP interfaces.
 */
export interface ToolResponse<T = unknown> {
  /** Indicates if the operation completed successfully */
  success: boolean;

  /** Error code if operation failed */
  errorCode?: ErrorCode;

  /** Human-readable error message if operation failed */
  errorMessage?: string;

  /** Operation result data if successful */
  data?: T;

  /** Operation duration in milliseconds */
  timingMs?: number;

  /** Trace ID for request tracking and debugging */
  traceId?: string;
}

/**
 * Timing utility for tracking operation duration.
 */
export class OperationTimer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Get elapsed time in milliseconds since timer creation.
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Generate a unique trace ID for request tracking.
 * Format: timestamp-random (e.g., "1709251200000-a1b2c3d4")
 */
export function generateTraceId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Create a successful tool response.
 */
export function createSuccessResponse<T>(
  data: T,
  timingMs?: number,
  traceId?: string,
): ToolResponse<T> {
  return {
    success: true,
    data,
    timingMs,
    traceId,
  };
}

/**
 * Create a failed tool response.
 */
export function createErrorResponse(
  errorCode: ErrorCode,
  errorMessage: string,
  timingMs?: number,
  traceId?: string,
): ToolResponse {
  return {
    success: false,
    errorCode,
    errorMessage,
    timingMs,
    traceId,
  };
}
