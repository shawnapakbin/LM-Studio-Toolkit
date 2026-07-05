/**
 * File-info passthrough tools.
 * These tools forward file-information queries to the upstream Blender MCP server
 * with no input parameters, returning data-block summaries, missing references,
 * linked libraries, path info, and usage guesses.
 */

import { z } from "zod";
import { BlenderClient } from "../../blender-client";
import { BlenderBridgeConfig } from "../../types";
import { ToolHandler, ToolResult } from "../health-check.tool";
import { connectionError, formatPassthroughResult } from "./passthrough-helpers";

/**
 * Creates the 5 file-info passthrough tools.
 * Each tool has no input parameters and delegates to the corresponding
 * upstream Blender MCP tool via client.callTool.
 */
export function createFileInfoTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_file_datablocks",
      description:
        "Returns data-block counts, active workspace, and render engine for the current Blender file.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const result = await client.callTool("get_blendfile_summary_datablocks", {});
          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_file_missing_refs",
      description:
        "Reports external file references that are missing from disk (images, libraries, fonts, sounds).",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const result = await client.callTool("get_blendfile_summary_missing_files", {});
          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_file_linked_libraries",
      description:
        "Returns the tree of directly and indirectly linked library files in the current Blender file.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const result = await client.callTool("get_blendfile_summary_of_linked_libraries", {});
          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_file_path_info",
      description: "Returns the blend file path, save status, age, and backup information.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const result = await client.callTool("get_blendfile_summary_path_info", {});
          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_file_usage_guess",
      description:
        "Guesses the primary use-cases of the current blend file with certainty scores from 0-100.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const result = await client.callTool("get_blendfile_summary_usage_guess", {});
          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
  ];
}
