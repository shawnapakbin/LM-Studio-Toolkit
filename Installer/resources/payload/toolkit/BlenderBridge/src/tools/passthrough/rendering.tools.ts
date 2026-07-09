/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Passthrough tools for rendering scenes in Blender.
 * Provides blender_render_thumbnail (low-quality preview) and blender_render_full (current render settings).
 */

import { z } from "zod";
import { BlenderClient } from "../../blender-client";
import { BlenderBridgeConfig } from "../../types";
import { ToolHandler, ToolResult } from "../health-check.tool";
import {
  connectionError,
  formatPassthroughResult,
  upstreamError,
  validateNonWhitespaceParam,
  validationError,
} from "./passthrough-helpers";

/**
 * Creates the rendering passthrough tools.
 *
 * @param config - BlenderBridge configuration
 * @param client - BlenderClient instance with callTool delegate configured
 * @returns Array of ToolHandler definitions for rendering tools
 */
export function createRenderingTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_render_thumbnail",
      description:
        "Renders a low-quality thumbnail of the current scene to the specified output path (480x270 resolution).",
      inputSchema: z.object({
        output_path: z.string().describe("File path for the rendered thumbnail image"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { output_path } = input as { output_path: string };

        const error = validateNonWhitespaceParam(output_path, "output_path");
        if (error) return validationError(error);

        try {
          const result = await client.callTool("render_thumbnail_to_path", { output_path });

          // Check for file-system errors from upstream
          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");

            if (isFileSystemError(errorText)) {
              return upstreamError(
                errorText,
                undefined,
                "Verify the output path is writable and the directory exists.",
              );
            }
          }

          return formatPassthroughResult(result);
        } catch (e: unknown) {
          return connectionError(e instanceof Error ? e.message : String(e));
        }
      },
    },
    {
      name: "blender_render_full",
      description:
        "Renders the current scene to the specified output path using the current render settings.",
      inputSchema: z.object({
        output_path: z.string().describe("File path for the rendered output image"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { output_path } = input as { output_path: string };

        const error = validateNonWhitespaceParam(output_path, "output_path");
        if (error) return validationError(error);

        try {
          const result = await client.callTool("render_viewport_to_path", { output_path });

          // Check for file-system errors from upstream
          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");

            if (isFileSystemError(errorText)) {
              return upstreamError(
                errorText,
                undefined,
                "Verify the output path is writable and the directory exists.",
              );
            }
          }

          return formatPassthroughResult(result);
        } catch (e: unknown) {
          return connectionError(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];
}

/**
 * Detects file-system related errors in upstream error text.
 */
function isFileSystemError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return (
    lower.includes("permission") ||
    lower.includes("directory") ||
    lower.includes("path") ||
    lower.includes("writable") ||
    lower.includes("no such file") ||
    lower.includes("access denied")
  );
}
