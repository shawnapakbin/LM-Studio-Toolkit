/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_file_integrity orchestration tool.
 * Checks the integrity of the current Blender file including
 * unsaved changes and missing external references.
 *
 * Requirement 5: File Integrity Checker
 */

import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { generateFileIntegrityCode } from "../codegen/file-integrity.py";
import { BlenderBridgeConfig, FileIntegrityResult } from "../types";

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
 * Creates the blender_file_integrity tool handler.
 * Validates file path, modification status, and external references.
 */
export function createFileIntegrityTool(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler {
  return {
    name: "blender_file_integrity",
    description:
      "Checks the integrity of the current Blender file, reporting file path, " +
      "size, unsaved changes, external modification detection, and missing references.",
    inputSchema: z.object({}),
    handler: async (): Promise<ToolResult> => {
      const pythonCode = generateFileIntegrityCode();
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

        const integrityResult: FileIntegrityResult = {
          success: true,
          filePath: parsed.filePath || null,
          fileSizeBytes: parsed.fileSizeBytes ?? null,
          lastModified: parsed.lastModified || null,
          hasUnsavedChanges: parsed.hasUnsavedChanges ?? false,
          missingReferences: {
            total: parsed.missingReferences?.total ?? 0,
            byType: parsed.missingReferences?.byType ?? {},
            items: (parsed.missingReferences?.items ?? []).slice(0, 500),
          },
        };

        if (parsed.externalModificationDetected != null) {
          integrityResult.externalModificationDetected = parsed.externalModificationDetected;
        }

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(integrityResult, null, 2),
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
                    message: "Failed to parse file integrity result",
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
