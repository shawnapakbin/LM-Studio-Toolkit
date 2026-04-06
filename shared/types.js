"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationTimer = exports.ErrorCode = void 0;
exports.generateTraceId = generateTraceId;
exports.createSuccessResponse = createSuccessResponse;
exports.createErrorResponse = createErrorResponse;
/**
 * Shared Types for LLM Toolkit
 *
 * Unified response envelope and error codes used across all tools.
 */
/**
 * Standard error codes used across all tools.
 */
var ErrorCode;
(function (ErrorCode) {
  /** Invalid input parameters */
  ErrorCode["INVALID_INPUT"] = "INVALID_INPUT";
  /** Operation timed out */
  ErrorCode["TIMEOUT"] = "TIMEOUT";
  /** Request blocked by security policy */
  ErrorCode["POLICY_BLOCKED"] = "POLICY_BLOCKED";
  /** Execution failed during runtime */
  ErrorCode["EXECUTION_FAILED"] = "EXECUTION_FAILED";
  /** Resource not found */
  ErrorCode["NOT_FOUND"] = "NOT_FOUND";
  /** Authentication failure */
  ErrorCode["AUTH_FAILED"] = "AUTH_FAILED";
  /** Rate limit exceeded */
  ErrorCode["RATE_LIMITED"] = "RATE_LIMITED";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
/**
 * Timing utility for tracking operation duration.
 */
class OperationTimer {
  startTime;
  constructor() {
    this.startTime = Date.now();
  }
  /**
   * Get elapsed time in milliseconds since timer creation.
   */
  elapsed() {
    return Date.now() - this.startTime;
  }
}
exports.OperationTimer = OperationTimer;
/**
 * Generate a unique trace ID for request tracking.
 * Format: timestamp-random (e.g., "1709251200000-a1b2c3d4")
 */
function generateTraceId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}
/**
 * Create a successful tool response.
 */
function createSuccessResponse(data, timingMs, traceId) {
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
function createErrorResponse(errorCode, errorMessage, timingMs, traceId) {
  return {
    success: false,
    errorCode,
    errorMessage,
    timingMs,
    traceId,
  };
}
//# sourceMappingURL=types.js.map
