/**
 * blender_health_check orchestration tool.
 * Delegates to the health-check module to verify Blender add-on
 * connectivity and MCP server availability.
 */

import { z } from "zod";
import { GetBlenderInfoFn, runHealthCheck } from "../health-check";
import { BlenderBridgeConfig, HealthCheckResult } from "../types";

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
 * Creates the blender_health_check tool handler.
 * Verifies Blender add-on TCP connectivity and MCP server process availability.
 */
export function createHealthCheckTool(
  config: BlenderBridgeConfig,
  getBlenderInfo?: GetBlenderInfoFn,
): ToolHandler {
  return {
    name: "blender_health_check",
    description:
      "Verifies Blender add-on TCP connectivity and MCP server process availability. " +
      "Returns connection status, Blender version, and scene information.",
    inputSchema: z.object({}),
    handler: async (): Promise<ToolResult> => {
      const result: HealthCheckResult = await runHealthCheck(config, getBlenderInfo);

      return {
        isError: result.status === "error",
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
