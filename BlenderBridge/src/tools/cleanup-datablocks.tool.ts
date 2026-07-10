/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_cleanup_datablocks orchestration tool.
 * Detects and removes orphaned datablocks from the Blender file.
 *
 * Requirement 1: Datablock Cleanup
 */

import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { generateCleanupDatablocksCode } from "../codegen/cleanup-datablocks.py";
import { BlenderBridgeConfig, CleanupDatablocksResult } from "../types";

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
 * Creates the blender_cleanup_datablocks tool handler.
 * Identifies and removes orphaned datablocks (zero users, not fake-user)
 * across all Blender datablock registries.
 */
export function createCleanupDatablocksTool(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler {
  return {
    name: "blender_cleanup_datablocks",
    description:
      "Detects and removes orphaned datablocks (zero users, not marked as fake user) " +
      "from the current Blender file. Supports dry-run mode to preview without removing.",
    inputSchema: z.object({
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "When true, reports orphaned datablocks without removing them. Defaults to false.",
        ),
    }),
    handler: async (input: unknown): Promise<ToolResult> => {
      const params = (input || {}) as { dryRun?: boolean };
      const dryRun = params.dryRun ?? false;

      const pythonCode = generateCleanupDatablocksCode(dryRun);
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

      try {
        const parsed = JSON.parse(result.output || "{}");

        const cleanupResult: CleanupDatablocksResult = {
          success: true,
          dryRun,
          totalRemoved: dryRun ? 0 : (parsed.totalRemoved ?? 0),
          totalFound: parsed.totalFound ?? 0,
          removedByType: parsed.removedByType ?? {},
          removed: parsed.removed ?? [],
        };

        if (parsed.errors && parsed.errors.length > 0) {
          cleanupResult.errors = parsed.errors;
        }

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(cleanupResult, null, 2),
            },
          ],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: {
                    code: "PARSE_ERROR",
                    message: "Failed to parse cleanup datablocks result",
                    rawOutput: result.output,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  };
}
