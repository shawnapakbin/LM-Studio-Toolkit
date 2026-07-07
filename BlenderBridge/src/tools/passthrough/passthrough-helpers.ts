/**
 * Shared validation and error formatting utilities for passthrough tools.
 * Provides input validation functions and consistent error response builders
 * that produce OrchestrationErrorResponse-formatted ToolResults.
 */

import { CallToolResult, OrchestrationErrorResponse } from "../../types";
import { ToolResult } from "../health-check.tool";

// --- Validation Functions ---
// Each returns an error message string if validation fails, or null if valid.

/**
 * Validates a required string parameter is non-empty and within max length.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateStringParam(
  value: unknown,
  paramName: string,
  maxLength: number,
): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return `${paramName} must be a non-empty string.`;
  }
  if (value.length > maxLength) {
    return `${paramName} must not exceed ${maxLength} characters (got ${value.length}).`;
  }
  return null;
}

/**
 * Validates a required string parameter is non-empty and not whitespace-only.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateNonWhitespaceParam(value: unknown, paramName: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${paramName} must be a non-empty string that is not whitespace-only.`;
  }
  return null;
}

/**
 * Validates a numeric parameter is an integer within the specified range [min, max].
 * Returns an error message string if invalid, or null if valid.
 */
export function validateNumericRange(
  value: unknown,
  paramName: string,
  min: number,
  max: number,
): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${paramName} must be an integer.`;
  }
  if (value < min || value > max) {
    return `${paramName} must be between ${min} and ${max} (got ${value}).`;
  }
  return null;
}

/**
 * Validates a string parameter is one of the allowed values.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateEnum(
  value: unknown,
  paramName: string,
  allowedValues: readonly string[],
): string | null {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    return `${paramName} must be one of: ${allowedValues.join(", ")}.`;
  }
  return null;
}

// --- Code Parameter Normalization ---

/**
 * Attempts to normalize a raw code parameter value into a valid code string.
 * Handles common LLM serialization mistakes: arrays of lines, objects with code fields, etc.
 * Returns null if the value is unrecoverable (null, undefined, empty).
 */
export function normalizeCodeParam(rawCode: unknown): string | null {
  // Check for null/undefined FIRST
  if (rawCode === null || rawCode === undefined) {
    return null;
  }

  // If already a string, return as-is if non-empty, null if empty
  if (typeof rawCode === "string") {
    return rawCode.length > 0 ? rawCode : null;
  }

  // If array of strings, join with newlines
  if (Array.isArray(rawCode)) {
    if (rawCode.length > 0 && rawCode.every((item) => typeof item === "string")) {
      return rawCode.join("\n");
    }
    return null;
  }

  // If object (not null, not array) with a code-like string field
  if (typeof rawCode === "object") {
    const obj = rawCode as Record<string, unknown>;
    // Check fields in priority order: python, code, text
    for (const field of ["python", "code", "text"]) {
      if (typeof obj[field] === "string" && (obj[field] as string).length > 0) {
        return obj[field] as string;
      }
    }
    return null;
  }

  // If number or boolean, convert to string representation
  if (typeof rawCode === "number" || typeof rawCode === "boolean") {
    return String(rawCode);
  }

  return null;
}

/**
 * Builds a diagnostic error message for a code parameter that could not be normalized.
 * Includes type information, length (for strings), a truncated preview, and formatting guidance.
 */
export function buildDiagnosticError(rawValue: unknown, paramName: string): string {
  const actualType = rawValue === null ? "null" : typeof rawValue;
  const lengthInfo = typeof rawValue === "string" ? ` (length: ${rawValue.length})` : "";

  let preview: string;
  try {
    const serialized = JSON.stringify(rawValue);
    preview = serialized.length > 200 ? serialized.slice(0, 200) + "..." : serialized;
  } catch {
    preview = String(rawValue);
  }

  return (
    `${paramName} could not be normalized to a valid code string. ` +
    `Received type: ${actualType}${lengthInfo}. ` +
    `Preview: ${preview}. ` +
    `Hint: Multi-line code must use \\n escape sequences within a single JSON string value. ` +
    `Do not send an array of lines or a nested object.`
  );
}

// --- Result Formatting ---

/**
 * Maps an upstream CallToolResult into the standard ToolResult format.
 * - On success (isError: false): passes through text content items.
 * - On error (isError: true): wraps content as an OrchestrationErrorResponse JSON.
 */
export function formatPassthroughResult(result: CallToolResult): ToolResult {
  if (!result.isError) {
    // Success: pass through text content items from upstream
    const textContent = result.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => ({ type: "text" as const, text: item.text }));

    // If there are image items, include a description reference
    const imageItems = result.content.filter((item) => item.type === "image");
    if (imageItems.length > 0) {
      textContent.push({
        type: "text" as const,
        text: `[${imageItems.length} image(s) returned from Blender]`,
      });
    }

    return {
      isError: false,
      content: textContent.length > 0 ? textContent : [{ type: "text", text: "" }],
    };
  }

  // Error from upstream: wrap as OrchestrationErrorResponse
  const errorMessage =
    result.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n") || "Unknown upstream error";

  return upstreamError(errorMessage);
}

// --- Error Builders ---

/**
 * Creates a validation error ToolResult without invoking upstream.
 * Returns isError: true with the validation message as text content.
 */
export function validationError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/**
 * Creates a timeout error ToolResult with OrchestrationErrorResponse JSON.
 * Uses error code "BLENDER_TIMEOUT".
 */
export function timeoutError(timeoutMs: number): ToolResult {
  const response: OrchestrationErrorResponse = {
    success: false,
    error: {
      code: "BLENDER_TIMEOUT",
      message: `Operation timed out after ${timeoutMs / 1000} seconds.`,
      suggestion: "Verify Blender is responsive using the blender_health_check tool.",
    },
  };

  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}

/**
 * Creates an upstream error ToolResult with OrchestrationErrorResponse JSON.
 * Uses error code "UPSTREAM_ERROR".
 */
export function upstreamError(
  message: string,
  traceback?: string,
  suggestion?: string,
): ToolResult {
  const response: OrchestrationErrorResponse = {
    success: false,
    error: {
      code: "UPSTREAM_ERROR",
      message,
      ...(traceback ? { traceback } : {}),
      ...(suggestion ? { suggestion } : {}),
    },
  };

  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}

/**
 * Creates a connection error ToolResult with OrchestrationErrorResponse JSON.
 * Uses error code "CONNECTION_ERROR".
 */
export function connectionError(message: string): ToolResult {
  const response: OrchestrationErrorResponse = {
    success: false,
    error: {
      code: "CONNECTION_ERROR",
      message,
      suggestion: "Verify Blender is responsive using the blender_health_check tool.",
    },
  };

  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
  };
}
