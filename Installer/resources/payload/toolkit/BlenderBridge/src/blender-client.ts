/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { BlenderBridgeConfig, BlenderExecutionResult } from "./types";

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
 * Interface for the Blender client abstraction that delegates Python code
 * execution to the external Blender MCP server.
 */
export interface BlenderClient {
  executeCode(pythonCode: string, timeoutMs?: number): Promise<BlenderExecutionResult>;
  getSceneSummary(): Promise<BlenderExecutionResult>;
  getBlenderVersion(): Promise<BlenderExecutionResult>;
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
): BlenderClient {
  return new BlenderClientImpl(config, delegate);
}

class BlenderClientImpl implements BlenderClient {
  private config: BlenderBridgeConfig;
  private delegate: ExecuteBlenderCodeFn;

  constructor(config: BlenderBridgeConfig, delegate: ExecuteBlenderCodeFn) {
    this.config = config;
    this.delegate = delegate;
  }

  /**
   * Executes Python code in the running Blender instance via the external
   * Blender MCP server's `execute_blender_code` tool.
   *
   * @param pythonCode - The Python code to execute in Blender
   * @param timeoutMs - Timeout in milliseconds (defaults to config.operationTimeoutMs, typically 30s)
   * @returns Structured execution result with success/error information
   */
  async executeCode(pythonCode: string, timeoutMs?: number): Promise<BlenderExecutionResult> {
    const timeout = timeoutMs ?? this.config.operationTimeoutMs;

    try {
      const output = await withTimeout(
        this.delegate(pythonCode),
        timeout,
      );

      return {
        success: true,
        output,
      };
    } catch (error: unknown) {
      if (error instanceof TimeoutError) {
        return {
          success: false,
          error: {
            message: `Operation timed out after ${Math.round(timeout / 1000)} seconds`,
            suggestion: "Verify Blender is responsive using the blender_health_check tool.",
          },
        };
      }

      return formatExecutionError(error);
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
}

/**
 * Formats an execution error from the Blender MCP server into a structured
 * BlenderExecutionResult with traceback and suggestion.
 *
 * Requirements 4.5: Structured error containing the Blender Python traceback
 * and a human-readable suggestion describing the likely cause.
 */
export function formatExecutionError(error: unknown): BlenderExecutionResult {
  const rawMessage = error instanceof Error ? error.message : String(error);

  // Attempt to extract traceback from the error message
  const traceback = extractTraceback(rawMessage);
  const suggestion = generateSuggestion(rawMessage, traceback);

  return {
    success: false,
    error: {
      traceback: traceback || undefined,
      message: rawMessage,
      suggestion,
    },
  };
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
