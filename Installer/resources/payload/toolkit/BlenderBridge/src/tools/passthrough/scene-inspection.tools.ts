/**
 * Scene-inspection passthrough tools.
 * These tools forward scene/object inspection queries to the upstream Blender MCP server,
 * returning object detail summaries and the full scene collection hierarchy.
 */

import { z } from "zod";
import { BlenderClient } from "../../blender-client";
import { BlenderBridgeConfig } from "../../types";
import { ToolHandler, ToolResult } from "../health-check.tool";
import {
  connectionError,
  formatPassthroughResult,
  upstreamError,
  validateStringParam,
  validationError,
} from "./passthrough-helpers";

/**
 * Creates the 2 scene-inspection passthrough tools:
 * - blender_object_detail: returns detailed info about a specific object
 * - blender_objects_list: returns the full scene collection hierarchy
 */
export function createSceneInspectionTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_object_detail",
      description:
        "Returns a structured summary of a Blender object including type, transforms, parent, children, modifiers, constraints, materials, visibility, and collections.",
      inputSchema: z.object({
        name: z.string().describe("Name of the Blender object to inspect"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { name } = input as { name: string };
        const error = validateStringParam(name, "name", 256);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("get_object_detail_summary", { name });

          // Check for "object not found" in upstream error to add helpful suggestion
          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (errorText.toLowerCase().includes("not found")) {
              return upstreamError(
                errorText,
                undefined,
                "Verify object names using the blender_objects_list tool.",
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
      name: "blender_objects_list",
      description:
        "Returns the scene collection hierarchy with objects including name, type, parent, data name, selection state, and visibility.",
      inputSchema: z.object({}),
      handler: async (): Promise<ToolResult> => {
        try {
          const result = await client.callTool("get_objects_summary", {});
          return formatPassthroughResult(result);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return connectionError(message);
        }
      },
    },
  ];
}
