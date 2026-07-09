/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * CLI file-info passthrough tools.
 * These tools forward file-information queries to the upstream Blender MCP server
 * in background (CLI) mode, requiring a `blend_file` path parameter.
 * Each tool validates the blend_file input and delegates to the corresponding
 * upstream `_for_cli` tool variant.
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
 * Creates the 5 CLI file-info passthrough tools.
 * Each tool requires a `blend_file` parameter and delegates to the corresponding
 * upstream Blender MCP CLI tool via client.callTool.
 */
export function createCliFileInfoTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_cli_file_datablocks",
      description:
        "Returns data-block counts, active workspace, and render engine for a .blend file opened in background mode.",
      inputSchema: z.object({
        blend_file: z.string().describe("Path to the .blend file to analyze"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { blend_file } = input as { blend_file: string };
        const error = validateStringParam(blend_file, "blend_file", 1024);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("get_blendfile_summary_datablocks_for_cli", {
            blend_file,
          });
          return formatPassthroughResult(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_cli_file_missing_refs",
      description:
        "Reports missing external file references for a .blend file opened in background mode.",
      inputSchema: z.object({
        blend_file: z.string().describe("Path to the .blend file to analyze"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { blend_file } = input as { blend_file: string };
        const error = validateStringParam(blend_file, "blend_file", 1024);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("get_blendfile_summary_missing_files_for_cli", {
            blend_file,
          });
          return formatPassthroughResult(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_cli_file_linked_libraries",
      description: "Returns the linked library tree for a .blend file opened in background mode.",
      inputSchema: z.object({
        blend_file: z.string().describe("Path to the .blend file to analyze"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { blend_file } = input as { blend_file: string };
        const error = validateStringParam(blend_file, "blend_file", 1024);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("get_blendfile_summary_of_linked_libraries_for_cl", {
            blend_file,
          });
          return formatPassthroughResult(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_cli_file_path_info",
      description:
        "Returns path, save status, age, and backup info for a .blend file opened in background mode.",
      inputSchema: z.object({
        blend_file: z.string().describe("Path to the .blend file to analyze"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { blend_file } = input as { blend_file: string };
        const error = validateStringParam(blend_file, "blend_file", 1024);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("get_blendfile_summary_path_info_for_cli", {
            blend_file,
          });
          return formatPassthroughResult(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_cli_file_usage_guess",
      description:
        "Guesses primary use-cases of a .blend file opened in background mode with certainty scores.",
      inputSchema: z.object({
        blend_file: z.string().describe("Path to the .blend file to analyze"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { blend_file } = input as { blend_file: string };
        const error = validateStringParam(blend_file, "blend_file", 1024);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("get_blendfile_summary_usage_guess_for_cli", {
            blend_file,
          });
          return formatPassthroughResult(result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return connectionError(message);
        }
      },
    },
  ];
}
