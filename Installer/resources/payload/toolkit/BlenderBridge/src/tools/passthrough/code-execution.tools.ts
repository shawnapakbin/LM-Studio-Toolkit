/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Passthrough tools for executing Python code in Blender.
 * Provides blender_execute_code (interactive) and blender_cli_execute_code (background/CLI).
 */

import { z } from "zod";
import { BlenderClient } from "../../blender-client";
import { BlenderBridgeConfig } from "../../types";
import { ToolHandler, ToolResult } from "../health-check.tool";
import {
  buildDiagnosticError,
  connectionError,
  formatPassthroughResult,
  normalizeCodeParam,
  validateStringParam,
  validationError,
} from "./passthrough-helpers";

/**
 * Creates the code execution passthrough tools.
 *
 * @param config - BlenderBridge configuration
 * @param client - BlenderClient instance with callTool delegate configured
 * @returns Array of ToolHandler definitions for code execution tools
 */
export function createCodeExecutionTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_execute_code",
      description:
        "Executes arbitrary Python code directly in the running Blender instance via the Blender MCP server. " +
        "The code runs in Blender's Python environment with full access to bpy. " +
        "To return data, assign a JSON-serialisable dict to a variable named `result`. " +
        "IMPORTANT: The 'code' parameter must be a single JSON string containing Python code. " +
        "Multi-line code uses \\n for newlines: {\"code\": \"import bpy\\nresult = bpy.context.scene.name\"}. " +
        "Do NOT pass objects, arrays, or previous tool results as the code parameter.",
      inputSchema: z.object({
        code: z
          .any()
          .optional()
          .describe(
            "Python code string to execute in Blender. " +
              "Must be a plain string, e.g. \"import bpy\\nresult = bpy.data.objects.keys()\". " +
              "Do NOT pass an object or array.",
          ),
        command: z
          .any()
          .optional()
          .describe("Alias for code — Python code string to execute (prefer 'code')."),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const args = input as Record<string, unknown>;
        // LLMs sometimes use alternative parameter names (e.g., "command", "script", "python")
        // instead of the expected "code". Try the canonical name first, then fall back to aliases.
        const rawCode = args.code ?? args.command ?? args.script ?? args.python ?? args.text;
        const code = normalizeCodeParam(rawCode);

        if (code === null) {
          return validationError(buildDiagnosticError(rawCode, "code"));
        }

        const codeError = validateStringParam(code, "code", 100000);
        if (codeError) {
          return validationError(codeError);
        }

        try {
          const result = await client.callTool("execute_blender_code", { code });
          return formatPassthroughResult(result);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_cli_execute_code",
      description:
        "Executes Python code in a background Blender process. " +
        "Opens the specified blend file with `blender --background` and runs the code. " +
        "Assign a dict to `result` to return data.",
      inputSchema: z.object({
        blend_file: z.string().describe("Path to the .blend file to open in background mode"),
        code: z.string().describe("Python code to execute in the background Blender process"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { blend_file, code } = input as { blend_file: string; code: string };

        const blendFileError = validateStringParam(blend_file, "blend_file", 1024);
        if (blendFileError) {
          return validationError(blendFileError);
        }

        const codeError = validateStringParam(code, "code", 100000);
        if (codeError) {
          return validationError(codeError);
        }

        try {
          const result = await client.callTool("execute_blender_code_for_cli", {
            blend_file,
            code,
          });
          return formatPassthroughResult(result);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          return connectionError(message);
        }
      },
    },
  ];
}
