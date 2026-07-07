/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

export type ErrorCode =
  | "INVALID_INPUT"
  | "TIMEOUT"
  | "POLICY_BLOCKED"
  | "EXECUTION_FAILED"
  | "EXTERNAL_SERVICE_ERROR"
  | "RESOURCE_EXHAUSTED";

export interface ToolError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}

export interface ToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ToolError;
  timing: {
    durationMs: number;
    startTime: string;
  };
  traceId: string;
}

export function createResponse<T>(
  success: boolean,
  data?: T,
  error?: Partial<ToolError>,
  durationMs?: number,
): ToolResponse<T> {
  return {
    success,
    data,
    error: error
      ? {
          code: error.code || "EXECUTION_FAILED",
          message: error.message || "Unknown error",
          ...error,
        }
      : undefined,
    timing: {
      durationMs: durationMs || 0,
      startTime: new Date().toISOString(),
    },
    traceId: Math.random().toString(36).substring(2, 15),
  };
}
