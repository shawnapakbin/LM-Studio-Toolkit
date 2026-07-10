/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_render_preview orchestration tool.
 * Generates Python code to configure 480×270 render resolution,
 * renders a PNG preview, and returns the file path.
 *
 * Requirement 4.4: Configures 480×270, renders PNG, returns file path.
 */

import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { generateRenderPreviewCode } from "../codegen/render-preview.py";
import { generateRenderStatsCode } from "../codegen/render-stats.py";
import {
  formatPeakMemory,
  formatRenderTime,
  validateResolution,
  validateSamples,
  validateScenePolygonCount,
} from "../type-validation-helpers";
import { BlenderBridgeConfig, RenderStatistics } from "../types";

export interface ToolResult {
  isError: boolean;
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
}

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (input: unknown) => Promise<ToolResult>;
}

/**
 * Creates the blender_render_preview tool handler.
 * Renders a 480×270 PNG preview and returns the file path.
 */
export function createRenderPreviewTool(
  config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler {
  return {
    name: "blender_render_preview",
    description:
      "Renders a 480×270 pixel PNG preview of the current Blender scene " +
      "and returns the absolute file path of the saved image.",
    inputSchema: z.object({
      outputDir: z
        .string()
        .optional()
        .describe(
          "Optional output directory for the rendered image. Defaults to system temp directory.",
        ),
    }),
    handler: async (input: unknown): Promise<ToolResult> => {
      const params = (input || {}) as { outputDir?: string };
      const outputDir = params.outputDir || os.tmpdir();
      const timestamp = Date.now();
      const outputPath = path.join(outputDir, `blender_preview_${timestamp}.png`);

      const pythonCode = generateRenderPreviewCode({
        outputPath,
        width: 480,
        height: 270,
      });

      const result = await client.executeCode(pythonCode, config.renderTimeoutMs, "render");

      if (!result.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: result.error,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Parse the execution result to extract file path and base64 image data
      let filePath = outputPath;
      let imageData = "";
      try {
        const parsed = JSON.parse(result.output || "{}");
        filePath = parsed.filePath || outputPath;
        imageData = parsed.imageData || "";
      } catch {
        /* keep defaults */
      }

      // Collect render statistics (best-effort, does not block render result)
      let renderStatistics: Partial<RenderStatistics> | undefined;
      try {
        const statsCode = generateRenderStatsCode();
        const statsResult = await client.executeCode(statsCode, config.operationTimeoutMs);

        if (statsResult.success && statsResult.output) {
          const rawStats = JSON.parse(statsResult.output);
          const stats: RenderStatistics = {
            renderTimeSeconds: formatRenderTime(rawStats.renderTimeSeconds),
            samples: validateSamples(rawStats.samples),
            peakMemoryMB: formatPeakMemory(rawStats.peakMemoryMB),
            engineName: rawStats.engineName,
            resolutionWidth: validateResolution(rawStats.resolutionWidth),
            resolutionHeight: validateResolution(rawStats.resolutionHeight),
            scenePolygonCount: validateScenePolygonCount(rawStats.scenePolygonCount),
            gpuAvailable: rawStats.gpuAvailable,
          };

          // Only include GPU fields when GPU is available
          if (rawStats.gpuAvailable) {
            if (rawStats.gpuDeviceName) {
              stats.gpuDeviceName = rawStats.gpuDeviceName;
            }
            if (rawStats.gpuMemoryMB != null) {
              stats.gpuMemoryMB = formatPeakMemory(rawStats.gpuMemoryMB);
            }
          }

          renderStatistics = stats;
        }
      } catch {
        // Stats collection failed — still return the render result without stats
      }

      const responsePayload: Record<string, unknown> = {
        success: true,
        filePath,
        resolution: { width: 480, height: 270 },
      };

      if (renderStatistics) {
        responsePayload.renderStatistics = renderStatistics;
      }

      const content: ToolResult["content"] = [
        {
          type: "text",
          text: JSON.stringify(responsePayload, null, 2),
        },
      ];

      if (imageData) {
        content.push({ type: "image", data: imageData, mimeType: "image/png" });
      }

      return { isError: false, content };
    },
  };
}
