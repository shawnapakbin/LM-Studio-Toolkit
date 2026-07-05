/**
 * Screenshot passthrough tools.
 * These tools forward screenshot/viewport capture requests to the upstream Blender MCP server,
 * returning PNG images of specific areas, the full window, or a JSON layout description.
 */

import { z } from "zod";
import { BlenderClient } from "../../blender-client";
import { BlenderBridgeConfig } from "../../types";
import { ToolHandler, ToolResult } from "../health-check.tool";
import {
  connectionError,
  formatPassthroughResult,
  upstreamError,
  validateEnum,
  validateNumericRange,
  validationError,
} from "./passthrough-helpers";

const AREA_UI_TYPES = [
  "VIEW_3D",
  "IMAGE_EDITOR",
  "UV",
  "ShaderNodeTree",
  "CompositorNodeTree",
  "GeometryNodeTree",
  "TextureNodeTree",
  "SEQUENCE_EDITOR",
  "CLIP_EDITOR",
  "DOPESHEET_EDITOR",
  "GRAPH_EDITOR",
  "NLA_EDITOR",
  "TEXT_EDITOR",
  "CONSOLE",
  "INFO",
  "TOPBAR",
  "STATUSBAR",
  "OUTLINER",
  "PROPERTIES",
  "FILE_BROWSER",
  "SPREADSHEET",
  "PREFERENCES",
] as const;

/**
 * Creates the 3 screenshot passthrough tools:
 * - blender_screenshot_area: captures a single Blender area as PNG
 * - blender_screenshot_window: captures the entire Blender window as PNG
 * - blender_window_layout: returns JSON description of window layout
 */
export function createScreenshotTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_screenshot_area",
      description:
        "Takes a screenshot of a single Blender area and returns it as a PNG image. Specify the area type to capture.",
      inputSchema: z.object({
        area_ui_type: z.string().describe("The Blender area UI type to capture"),
        size_limit_in_bytes: z
          .number()
          .optional()
          .describe("Max image size in bytes (0 = MCP limit, max 10485760)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { area_ui_type, size_limit_in_bytes } = input as {
          area_ui_type: string;
          size_limit_in_bytes?: number;
        };

        const enumError = validateEnum(area_ui_type, "area_ui_type", AREA_UI_TYPES);
        if (enumError) return validationError(enumError);

        const sizeLimit = size_limit_in_bytes ?? 0;
        if (size_limit_in_bytes !== undefined) {
          const rangeError = validateNumericRange(sizeLimit, "size_limit_in_bytes", 0, 10485760);
          if (rangeError) return validationError(rangeError);
        }

        try {
          const result = await client.callTool("get_screenshot_of_area_as_image", {
            area_ui_type,
            size_limit_in_bytes: sizeLimit,
          });

          // Check for image-too-large upstream error with helpful suggestion
          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (
              errorText.toLowerCase().includes("size") ||
              errorText.toLowerCase().includes("limit") ||
              errorText.toLowerCase().includes("too large")
            ) {
              return upstreamError(
                errorText,
                undefined,
                "Reduce the area scope or increase the size_limit_in_bytes parameter.",
              );
            }
          }

          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_screenshot_window",
      description: "Takes a screenshot of the entire Blender window and returns it as a PNG image.",
      inputSchema: z.object({
        size_limit_in_bytes: z
          .number()
          .optional()
          .describe("Max image size in bytes (0 = MCP limit, max 10485760)"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { size_limit_in_bytes } = input as {
          size_limit_in_bytes?: number;
        };

        const sizeLimit = size_limit_in_bytes ?? 0;
        if (size_limit_in_bytes !== undefined) {
          const rangeError = validateNumericRange(sizeLimit, "size_limit_in_bytes", 0, 10485760);
          if (rangeError) return validationError(rangeError);
        }

        try {
          const result = await client.callTool("get_screenshot_of_window_as_image", {
            size_limit_in_bytes: sizeLimit,
          });

          // Check for image-too-large upstream error with helpful suggestion
          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (
              errorText.toLowerCase().includes("size") ||
              errorText.toLowerCase().includes("limit") ||
              errorText.toLowerCase().includes("too large")
            ) {
              return upstreamError(
                errorText,
                undefined,
                "Reduce the window size or increase the size_limit_in_bytes parameter.",
              );
            }
          }

          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
    {
      name: "blender_window_layout",
      description:
        "Returns a JSON description of the Blender window layout, areas, active object, and selection state.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const result = await client.callTool("get_screenshot_of_window_as_json", {});
          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
  ];
}
