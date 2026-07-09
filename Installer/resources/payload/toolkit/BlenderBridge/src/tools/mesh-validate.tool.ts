/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_mesh_validate orchestration tool.
 * Generates Python code using bmesh to validate mesh geometry,
 * reporting inverted faces, non-manifold edges, loose vertices,
 * and face orientation issues.
 *
 * Requirement 2.6: Mesh validation before export.
 */

import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { generateMeshValidateCode } from "../codegen/mesh-validate.py";
import { BlenderBridgeConfig, MeshValidationResult } from "../types";

export interface ToolResult {
  isError: boolean;
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
}

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (input: unknown) => Promise<ToolResult>;
}

/**
 * Creates the blender_mesh_validate tool handler.
 * Validates mesh geometry for a given object, reporting inverted faces,
 * non-manifold edges, loose vertices, and face orientation issues.
 */
export function createMeshValidateTool(
  config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler {
  return {
    name: "blender_mesh_validate",
    description:
      "Validates mesh geometry for a given object, reporting inverted faces, " +
      "non-manifold edges, loose vertices, and face orientation issues.",
    inputSchema: z.object({
      objectName: z.string().describe("Name of the Blender mesh object to validate"),
    }),
    handler: async (input: unknown): Promise<ToolResult> => {
      const params = (input || {}) as { objectName: string };
      const { objectName } = params;

      if (!objectName) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: { code: "INVALID_INPUT", message: "objectName is required" },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const pythonCode = generateMeshValidateCode(objectName);

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

      // Parse the structured validation result from Python output
      try {
        const parsed = JSON.parse(result.output || "{}");

        // Check if the Python code reported an error (object not found, not a mesh)
        if (parsed.error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: { code: "VALIDATION_ERROR", message: parsed.error },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const validation: MeshValidationResult = {
          invertedFaces: parsed.invertedFaces ?? 0,
          nonManifoldEdges: parsed.nonManifoldEdges ?? 0,
          looseVertices: parsed.looseVertices ?? 0,
          faceOrientationIssues: parsed.faceOrientationIssues ?? 0,
          isValid: parsed.isValid ?? false,
        };

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  objectName,
                  validation,
                },
                null,
                2,
              ),
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
                    message: `Failed to parse mesh validation result for object '${objectName}'`,
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
