/**
 * Passthrough tools for executing Python code in Blender.
 * Provides blender_execute_code (interactive) and blender_cli_execute_code (background/CLI).
 */

import { z } from "zod";
import { BlenderClient } from "../../blender-client";
import { BlenderBridgeConfig } from "../../types";
import { ToolHandler, ToolResult } from "../health-check.tool";
import {
  connectionError,
  formatPassthroughResult,
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
        "To return data, assign a JSON-serialisable dict to a variable named `result`.",
      inputSchema: z.object({
        code: z.string().describe("Python code to execute in Blender"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { code } = input as { code: string };

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
