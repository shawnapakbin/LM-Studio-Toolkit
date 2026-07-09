/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_scene_summary orchestration tool.
 * Generates Python code to extract scene hierarchy, active object,
 * and render settings, then executes via BlenderClient.
 *
 * Requirement 4.3: Returns scene hierarchy, active object, render settings
 * in a single call.
 */

import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { generateSceneSummaryCode } from "../codegen/scene-summary.py";
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
 * Creates the blender_scene_summary tool handler.
 * Retrieves the current scene hierarchy, active object, and render settings.
 */
export function createSceneSummaryTool(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler {
  return {
    name: "blender_scene_summary",
    description:
      "Returns the current Blender scene hierarchy (object names, types, parent-child relationships), " +
      "active object name, and render settings (resolution, engine, output format) in a single call.",
    inputSchema: z.object({}),
    handler: async (): Promise<ToolResult> => {
      const pythonCode = generateSceneSummaryCode();
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

      // Parse the scene data from execution output
      let sceneData: Record<string, unknown>;
      try {
        sceneData = JSON.parse(result.output || "{}");
      } catch {
        // If we can't parse, return raw output
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  rawOutput: result.output,
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
                objects: sceneData.objects || [],
                activeObject: sceneData.activeObject || null,
                renderSettings: sceneData.renderSettings || {},
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
