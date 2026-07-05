/**
 * Navigation passthrough tools.
 * These tools forward workspace/viewport navigation commands to the upstream Blender MCP server,
 * allowing programmatic switching of workspace tabs, space types, and viewport focus.
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
 * Creates the 4 navigation passthrough tools:
 * - blender_switch_tab: switches active workspace tab by name
 * - blender_switch_workspace: switches to workspace matching a space type
 * - blender_focus_object: focuses 3D viewport on an object by name
 * - blender_focus_object_data: focuses 3D viewport on object by data block name
 */
export function createNavigationTools(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler[] {
  return [
    {
      name: "blender_switch_tab",
      description:
        "Switches the active workspace tab to the specified name in the running Blender instance.",
      inputSchema: z.object({
        name: z.string().describe("Name of the workspace tab to switch to"),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { name } = input as { name: string };
        const error = validateStringParam(name, "name", 256);
        if (error) return validationError(error);

        try {
          const result = await client.callTool("jump_to_tab_by_name", { name });

          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (
              errorText.toLowerCase().includes("not found") ||
              errorText.toLowerCase().includes("does not exist")
            ) {
              return upstreamError(
                errorText,
                undefined,
                "The specified workspace tab does not exist in the current Blender session.",
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
      name: "blender_switch_workspace",
      description:
        "Switches to a workspace whose main area matches the specified space type. Optionally creates a new workspace if none matches.",
      inputSchema: z.object({
        space_type: z.string().describe("The space type to match (e.g. VIEW_3D, PROPERTIES)"),
        allow_edits: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, a new workspace may be created by duplicating the current one when no match exists",
          ),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { space_type, allow_edits } = input as {
          space_type: string;
          allow_edits?: boolean;
        };
        const error = validateStringParam(space_type, "space_type", 256);
        if (error) return validationError(error);

        const allowEdits = allow_edits ?? false;

        try {
          const result = await client.callTool("jump_to_tab_by_space_type", {
            space_type,
            allow_edits: allowEdits,
          });

          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (
              errorText.toLowerCase().includes("not found") ||
              errorText.toLowerCase().includes("does not exist")
            ) {
              return upstreamError(
                errorText,
                undefined,
                "The specified workspace space type does not exist in the current Blender session.",
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
      name: "blender_focus_object",
      description:
        "Moves the 3D viewport to focus on a specific object by name. Optionally un-hides the object if allow_edits is true.",
      inputSchema: z.object({
        name: z.string().describe("Name of the object to focus on"),
        allow_edits: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, the object may be un-hidden and its collections enabled to make it visible",
          ),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { name, allow_edits } = input as {
          name: string;
          allow_edits?: boolean;
        };
        const error = validateStringParam(name, "name", 256);
        if (error) return validationError(error);

        const allowEdits = allow_edits ?? false;

        try {
          const result = await client.callTool("jump_to_view3d_object_by_name", {
            name,
            allow_edits: allowEdits,
          });

          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (
              errorText.toLowerCase().includes("not found") ||
              errorText.toLowerCase().includes("does not exist")
            ) {
              return upstreamError(
                errorText,
                undefined,
                "The specified object does not exist in the current Blender session.",
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
      name: "blender_focus_object_data",
      description:
        "Moves the 3D viewport to focus on the object whose data block matches the specified name. Optionally un-hides if allow_edits is true.",
      inputSchema: z.object({
        name: z.string().describe("Name of the data block to find and focus on"),
        allow_edits: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, the object may be un-hidden and its collections enabled to make it visible",
          ),
      }),
      handler: async (input: unknown): Promise<ToolResult> => {
        const { name, allow_edits } = input as {
          name: string;
          allow_edits?: boolean;
        };
        const error = validateStringParam(name, "name", 256);
        if (error) return validationError(error);

        const allowEdits = allow_edits ?? false;

        try {
          const result = await client.callTool("jump_to_view3d_object_data_by_name", {
            name,
            allow_edits: allowEdits,
          });

          if (result.isError) {
            const errorText = result.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
            if (
              errorText.toLowerCase().includes("not found") ||
              errorText.toLowerCase().includes("does not exist")
            ) {
              return upstreamError(
                errorText,
                undefined,
                "The specified data block does not exist in the current Blender session.",
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
