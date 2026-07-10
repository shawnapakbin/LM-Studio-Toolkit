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
import { BlenderBridgeConfig } from "../types";

export interface ToolResult {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
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
  _config: BlenderBridgeConfig,
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

      const result = await client.executeCode(pythonCode);

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

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                filePath: outputPath,
                resolution: { width: 480, height: 270 },
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
}
