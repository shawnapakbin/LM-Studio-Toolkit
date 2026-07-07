/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_create_object orchestration tool.
 * Validates input parameters, generates Python code for object creation,
 * and executes it via the BlenderClient.
 *
 * Requirements: 4.1, 4.2
 */

import { z } from "zod";
import { BlenderBridgeConfig, CreateObjectParams } from "../types";
import { BlenderClient } from "../blender-client";
import { generateCreateObjectCode } from "../codegen/create-object.py";

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

/** Valid geometry types for object creation. */
const VALID_GEOMETRY_TYPES = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "circle",
  "curve",
  "empty",
] as const;

/** Regex for valid object names: 1-63 chars, alphanumeric + underscore. */
const NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Validates that a value is a finite float. */
function isFiniteFloat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validates a 3-tuple of finite floats. */
function isValidVector3(arr: unknown): arr is [number, number, number] {
  if (!Array.isArray(arr) || arr.length !== 3) return false;
  return arr.every(isFiniteFloat);
}

/** Validates a 3-tuple of positive finite floats (for scale). */
function isValidScale(arr: unknown): arr is [number, number, number] {
  if (!isValidVector3(arr)) return false;
  return arr.every((v) => v > 0);
}

/**
 * Validates create-object parameters and returns an error message if invalid.
 * Returns null if valid.
 *
 * Requirement 4.2: If unrecognized geometry type or invalid floats,
 * return structured error WITHOUT executing code in Blender.
 */
export function validateCreateObjectInput(input: unknown): string | null {
  if (typeof input !== "object" || input === null) {
    return "Input must be an object with name, geometryType, and optional transforms.";
  }

  const params = input as Record<string, unknown>;

  // Validate name
  if (typeof params.name !== "string") {
    return "Parameter 'name' is required and must be a string.";
  }
  if (params.name.length === 0 || params.name.length > 63) {
    return `Parameter 'name' must be 1-63 characters, got ${params.name.length} characters.`;
  }
  if (!NAME_PATTERN.test(params.name)) {
    return `Parameter 'name' must contain only alphanumeric characters and underscores (a-z, A-Z, 0-9, _), got "${params.name}".`;
  }

  // Validate geometryType
  if (typeof params.geometryType !== "string") {
    return "Parameter 'geometryType' is required and must be a string.";
  }
  if (!VALID_GEOMETRY_TYPES.includes(params.geometryType as CreateObjectParams["geometryType"])) {
    return `Parameter 'geometryType' must be one of: ${VALID_GEOMETRY_TYPES.join(", ")}. Got "${params.geometryType}".`;
  }

  // Validate location (optional)
  if (params.location !== undefined) {
    if (!isValidVector3(params.location)) {
      return "Parameter 'location' must be an array of 3 finite floats [x, y, z].";
    }
  }

  // Validate rotation (optional)
  if (params.rotation !== undefined) {
    if (!isValidVector3(params.rotation)) {
      return "Parameter 'rotation' must be an array of 3 finite floats [x, y, z] in radians.";
    }
  }

  // Validate scale (optional)
  if (params.scale !== undefined) {
    if (!isValidScale(params.scale)) {
      return "Parameter 'scale' must be an array of 3 positive finite floats [x, y, z].";
    }
  }

  return null;
}

/**
 * Creates the blender_create_object tool handler.
 * Validates input, generates Python code, and executes via BlenderClient.
 */
export function createCreateObjectTool(
  config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler {
  return {
    name: "blender_create_object",
    description:
      "Creates a named object in Blender with specified geometry type and transforms. " +
      "Name must be 1-63 alphanumeric/underscore characters. " +
      "Geometry types: cube, sphere, cylinder, cone, torus, plane, circle, curve, empty.",
    inputSchema: z.object({
      name: z
        .string()
        .min(1)
        .max(63)
        .regex(/^[a-zA-Z0-9_]+$/)
        .describe("Object name (1-63 chars, alphanumeric + underscore)"),
      geometryType: z
        .enum(VALID_GEOMETRY_TYPES)
        .describe("Type of geometry to create"),
      location: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("Position [x, y, z]"),
      rotation: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("Euler rotation [x, y, z] in radians"),
      scale: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("Scale [x, y, z] (positive values)"),
    }),
    handler: async (input: unknown): Promise<ToolResult> => {
      // Custom validation with detailed error messages (Req 4.2)
      const validationError = validateCreateObjectInput(input);
      if (validationError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: {
                    code: "INVALID_INPUT",
                    message: validationError,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const params = input as CreateObjectParams;

      // Generate Python code
      const pythonCode = generateCreateObjectCode(params);

      // Execute via BlenderClient
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

      // Parse output and build success response
      let responseData: Record<string, unknown>;
      try {
        responseData = JSON.parse(result.output || "{}");
      } catch {
        responseData = { name: params.name, type: params.geometryType };
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                objectName: responseData.name || params.name,
                geometryType: params.geometryType,
                transforms: {
                  location: params.location || [0, 0, 0],
                  rotation: params.rotation || [0, 0, 0],
                  scale: params.scale || [1, 1, 1],
                },
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
