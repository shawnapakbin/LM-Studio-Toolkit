/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { enhanceError } from "./error-enhancer";
import { BlenderBridgeConfig, BlenderExecutionResult, CallToolFn, CallToolResult } from "./types";

/**
 * Delegate function type for executing Python code on the Blender MCP server.
 * This abstraction allows the actual MCP communication to be injected,
 * making the BlenderClient testable without a running Blender instance.
 *
 * The delegate should call the external Blender MCP server's `execute_blender_code`
 * tool and return the raw response text, or throw on communication failure.
 */
export type ExecuteBlenderCodeFn = (pythonCode: string) => Promise<string>;

/**
 * Operation type used to select per-operation timeout overrides.
 */
export type OperationType = "render" | "export" | "code_execution";

/**
 * Interface for the Blender client abstraction that delegates Python code
 * execution to the external Blender MCP server.
 */
export interface BlenderClient {
  executeCode(
    pythonCode: string,
    timeoutMs?: number,
    operationType?: OperationType,
  ): Promise<BlenderExecutionResult>;
  getSceneSummary(): Promise<BlenderExecutionResult>;
  getBlenderVersion(): Promise<BlenderExecutionResult>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

/**
 * Creates a BlenderClient that delegates Python code execution to
 * the external Blender MCP server via the provided delegate function.
 *
 * The delegate is responsible for the actual MCP transport communication.
 * This separation allows orchestration tools to be tested independently
 * of the MCP stdio transport layer.
 */
export function createBlenderClient(
  config: BlenderBridgeConfig,
  delegate: ExecuteBlenderCodeFn,
  callToolDelegate?: CallToolFn,
): BlenderClient {
  return new BlenderClientImpl(config, delegate, callToolDelegate);
}

class BlenderClientImpl implements BlenderClient {
  private config: BlenderBridgeConfig;
  private delegate: ExecuteBlenderCodeFn;
  private callToolDelegate?: CallToolFn;

  constructor(
    config: BlenderBridgeConfig,
    delegate: ExecuteBlenderCodeFn,
    callToolDelegate?: CallToolFn,
  ) {
    this.config = config;
    this.delegate = delegate;
    this.callToolDelegate = callToolDelegate;
  }

  /**
   * Executes Python code in the running Blender instance via the external
   * Blender MCP server's `execute_blender_code` tool.
   *
   * @param pythonCode - The Python code to execute in Blender
   * @param timeoutMs - Explicit timeout in milliseconds (takes priority over operationType-based timeout)
   * @param operationType - Operation type for selecting per-operation timeout override
   * @returns Structured execution result with success/error information
   */
  async executeCode(
    pythonCode: string,
    timeoutMs?: number,
    operationType?: OperationType,
  ): Promise<BlenderExecutionResult> {
    const timeout = timeoutMs ?? this.resolveTimeout(operationType);

    try {
      const output = await withTimeout(this.delegate(pythonCode), timeout);

      return {
        success: true,
        output,
      };
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        const effectiveOperationType = operationType || "code_execution";
        return {
          success: false,
          error: {
            message: `Operation timed out after ${Math.round(timeout / 1000)} seconds`,
            operationType: effectiveOperationType,
            timeoutMs: timeout,
            suggestion: `Retry with extended timeout or use async approach. Current timeout: ${timeout}ms for operation type '${effectiveOperationType}'.`,
          },
        };
      }

      const formattedResult = formatExecutionError(error);

      // Post-process with error enhancer for actionable suggestions (Req 2.1, 2.4, 2.5, 2.6)
      // All tools benefit automatically since enhancement happens at the client level.
      if (formattedResult.error) {
        try {
          const executeCodeFn = (code: string) => this.delegate(code);
          const enhancedError = await enhanceError(formattedResult.error, executeCodeFn);
          return { ...formattedResult, error: enhancedError };
        } catch {
          // Graceful degradation: if enhanceError itself throws, fall back to the original formatted error
          return formattedResult;
        }
      }

      return formattedResult;
    }
  }

  /**
   * Resolves the appropriate timeout based on operation type.
   * Render operations use renderTimeoutMs, export operations use exportTimeoutMs,
   * and all other operations fall back to the global operationTimeoutMs.
   */
  private resolveTimeout(operationType?: OperationType): number {
    switch (operationType) {
      case "render":
        return this.config.renderTimeoutMs ?? this.config.operationTimeoutMs;
      case "export":
        return this.config.exportTimeoutMs ?? this.config.operationTimeoutMs;
      default:
        return this.config.operationTimeoutMs;
    }
  }

  /**
   * Retrieves the current scene summary from Blender.
   * Executes a Python script that gathers scene hierarchy and render settings.
   */
  async getSceneSummary(): Promise<BlenderExecutionResult> {
    const code = `
import bpy
import json

scene = bpy.context.scene
objects = []
for obj in scene.objects:
    objects.append({
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None
    })

active = bpy.context.active_object
render = scene.render

result = json.dumps({
    "sceneName": scene.name,
    "objects": objects,
    "activeObject": active.name if active else None,
    "renderSettings": {
        "resolutionX": render.resolution_x,
        "resolutionY": render.resolution_y,
        "engine": render.engine,
        "outputFormat": render.image_settings.file_format
    }
})
`.trim();

    return this.executeCode(code);
  }

  /**
   * Retrieves the Blender version string.
   */
  async getBlenderVersion(): Promise<BlenderExecutionResult> {
    const code = `
import bpy
result = bpy.app.version_string
`.trim();

    return this.executeCode(code);
  }

  /**
   * Invokes a named tool on the Blender MCP server via the CallToolFn delegate.
   * Used by passthrough tools to forward invocations to the upstream server.
   *
   * @param toolName - The upstream tool name to invoke
   * @param args - The arguments to pass to the upstream tool
   * @returns CallToolResult with content and isError flag
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.callToolDelegate) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Full delegate not configured. The CallToolFn delegate is required for passthrough tool invocations.",
          },
        ],
      };
    }

    try {
      const resultContent = await withTimeout(
        this.callToolDelegate(toolName, args),
        this.config.operationTimeoutMs,
      );

      return {
        isError: false,
        content: resultContent,
      };
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Operation timed out after ${Math.round(this.config.operationTimeoutMs / 1000)} seconds while calling tool '${toolName}'.`,
            },
          ],
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  }
}

/**
 * Formats an execution error from the Blender MCP server into a structured
 * BlenderExecutionResult with traceback and suggestion.
 *
 * Requirements 4.5: Structured error containing the Blender Python traceback
 * and a human-readable suggestion describing the likely cause.
 * Requirements 2.4, 3.3: Parse operator errors for structured info while
 * leaving non-operator errors completely unchanged.
 */
export function formatExecutionError(error: unknown): BlenderExecutionResult {
  const rawMessage = error instanceof Error ? error.message : String(error);

  // Attempt to extract traceback from the error message
  const traceback = extractTraceback(rawMessage);
  const suggestion = generateSuggestion(rawMessage, traceback);

  // Extract structured operator info from Blender operator errors
  const operatorInfo = extractOperatorInfo(rawMessage);

  return {
    success: false,
    error: {
      traceback: traceback || undefined,
      message: rawMessage,
      suggestion,
      ...(operatorInfo?.operatorName && { operatorName: operatorInfo.operatorName }),
      ...(operatorInfo?.requiredContext && { requiredContext: operatorInfo.requiredContext }),
      ...(operatorInfo?.availableEnums && { availableEnums: operatorInfo.availableEnums }),
      ...(operatorInfo?.suggestions && { suggestions: operatorInfo.suggestions }),
    },
  };
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * Uses the classic dynamic programming approach with O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure 'a' is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;
  let prevRow = Array.from({ length: aLen + 1 }, (_, i) => i);
  let currRow = new Array<number>(aLen + 1);

  for (let j = 1; j <= bLen; j++) {
    currRow[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[i] = Math.min(
        currRow[i - 1] + 1, // insertion
        prevRow[i] + 1, // deletion
        prevRow[i - 1] + cost, // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[aLen];
}

/**
 * Computes a similarity ratio between two strings based on Levenshtein distance.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Finds close matches for a target string from a list of candidates.
 * Uses a combination of Levenshtein distance, similarity ratio, and
 * prefix/containment heuristics to determine good suggestions.
 *
 * A candidate is considered a match if:
 * - Levenshtein distance <= 3, OR
 * - Similarity ratio >= 0.6, OR
 * - One string starts with the other (shared prefix >= 3 chars), OR
 * - One string contains the other entirely
 *
 * Results are sorted by similarity ratio (best match first).
 */
export function findClosestMatches(target: string, candidates: string[]): string[] {
  const targetUpper = target.toUpperCase();

  const scored = candidates
    .map((candidate) => {
      const candidateUpper = candidate.toUpperCase();
      const distance = levenshteinDistance(targetUpper, candidateUpper);
      const ratio = similarityRatio(targetUpper, candidateUpper);

      // Prefix heuristic: boost if one starts with the other (min 3 chars shared prefix)
      const sharedPrefixLen = commonPrefixLength(targetUpper, candidateUpper);
      const prefixMatch = sharedPrefixLen >= 3;

      // Containment heuristic: one is a substring of the other
      const containsMatch =
        targetUpper.includes(candidateUpper) || candidateUpper.includes(targetUpper);

      const isMatch = distance <= 3 || ratio >= 0.6 || prefixMatch || containsMatch;

      // Compute a combined score for sorting: use ratio but boost prefix/containment matches
      let score = ratio;
      if (prefixMatch) {
        score = Math.max(
          score,
          sharedPrefixLen / Math.max(targetUpper.length, candidateUpper.length) + 0.3,
        );
      }
      if (containsMatch) {
        score = Math.max(score, 0.7);
      }

      return { candidate, distance, ratio, score, isMatch };
    })
    .filter((entry) => entry.isMatch)
    .sort((a, b) => b.score - a.score);

  return scored.map((entry) => entry.candidate);
}

/**
 * Computes the length of the common prefix between two strings.
 */
function commonPrefixLength(a: string, b: string): number {
  const maxLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < maxLen && a[i] === b[i]) {
    i++;
  }
  return i;
}

/**
 * Extracts structured operator information from a Blender error message.
 * Parses "context is incorrect" and "enum not found" error patterns to
 * extract operator name, required context, and available enum values.
 * Applies "did you mean?" suggestions for enum mismatches using string similarity.
 *
 * Returns null if the error is not an operator error (Requirement 3.3:
 * non-operator errors remain completely unchanged).
 */
export function extractOperatorInfo(message: string): {
  operatorName?: string;
  requiredContext?: string;
  availableEnums?: string[];
  suggestions?: string[];
} | null {
  // Extract operator name from bpy.ops.<module>.<operator> pattern
  const operatorMatch = message.match(/bpy\.ops\.(\w+\.\w+)/);
  if (!operatorMatch) {
    return null;
  }

  const operatorName = operatorMatch[1];
  const result: {
    operatorName?: string;
    requiredContext?: string;
    availableEnums?: string[];
    suggestions?: string[];
  } = { operatorName };

  // Pattern 1: "context is incorrect" - infer required context from operator path
  if (message.includes("context is incorrect")) {
    result.requiredContext = inferContextFromOperator(operatorName);
    result.suggestions = [
      `Ensure Blender is in ${result.requiredContext} mode before calling bpy.ops.${operatorName}()`,
    ];
  }

  // Pattern 2: "enum ... not found in (...)" - extract available enum values
  const enumMatch = message.match(/not found in \(([^)]+)\)/);
  if (enumMatch) {
    const enumListStr = enumMatch[1];
    // Parse quoted enum values like 'ARRAY', 'BEVEL', 'BOOLEAN'
    const enums = enumListStr.match(/'([^']+)'/g);
    if (enums) {
      result.availableEnums = enums.map((e) => e.replace(/'/g, ""));
    }
  }

  // "Did you mean?" logic for enum not found errors
  const requestedEnumMatch = message.match(/enum "([^"]+)" not found/);
  if (requestedEnumMatch && result.availableEnums && result.availableEnums.length > 0) {
    const requestedEnum = requestedEnumMatch[1];
    const closestMatches = findClosestMatches(requestedEnum, result.availableEnums);

    if (closestMatches.length > 0) {
      const didYouMeanSuggestions = closestMatches.map((match) => `Did you mean '${match}'?`);
      // Merge with existing suggestions (from context errors) or create new
      result.suggestions = [...(result.suggestions || []), ...didYouMeanSuggestions];
    }
  }

  return result;
}

/**
 * Infers the required Blender context mode from the operator path.
 * Operators under `object.*` require OBJECT mode, `mesh.*` require EDIT mode, etc.
 */
function inferContextFromOperator(operatorPath: string): string {
  const module = operatorPath.split(".")[0];

  switch (module) {
    case "object":
      return "OBJECT";
    case "mesh":
      return "EDIT";
    case "curve":
      return "EDIT";
    case "armature":
      return "EDIT";
    case "sculpt":
      return "SCULPT";
    case "paint":
      return "PAINT";
    default:
      return "OBJECT";
  }
}

/**
 * Extracts a Python traceback from an error message string.
 * Looks for the standard "Traceback (most recent call last):" pattern.
 */
function extractTraceback(message: string): string | null {
  const tracebackStart = message.indexOf("Traceback (most recent call last):");
  if (tracebackStart === -1) {
    return null;
  }
  return message.slice(tracebackStart);
}

/**
 * Generates a human-readable suggestion based on the error content.
 */
function generateSuggestion(message: string, traceback: string | null): string {
  const lowerMessage = (traceback || message).toLowerCase();

  if (lowerMessage.includes("modulenotfounderror") || lowerMessage.includes("no module named")) {
    return "A required Python module is missing. Ensure the script only uses modules available in Blender's bundled Python environment.";
  }

  if (lowerMessage.includes("attributeerror")) {
    return "An attribute access failed. Verify the Blender API call is compatible with the installed Blender version (5.1+).";
  }

  if (lowerMessage.includes("typeerror")) {
    return "A type mismatch occurred in the Python code. Check that function arguments match the expected Blender API signature.";
  }

  if (lowerMessage.includes("nameerror")) {
    return "A variable or function name was not found. Ensure all necessary imports are included in the generated Python code.";
  }

  if (lowerMessage.includes("runtimeerror")) {
    return "A Blender runtime error occurred. This may indicate an invalid operation for the current context (e.g., wrong mode or missing object).";
  }

  if (lowerMessage.includes("connection") || lowerMessage.includes("socket")) {
    return "A connection error occurred. Verify Blender is responsive using the blender_health_check tool.";
  }

  return "An error occurred during Blender code execution. Use blender_health_check to verify connectivity, then review the traceback for details.";
}

/**
 * Custom error class for timeout conditions.
 */
class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Wraps a promise with a timeout. Rejects with TimeoutError if the
 * promise does not resolve within the specified duration.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Export for testing
export { TimeoutError, withTimeout };
