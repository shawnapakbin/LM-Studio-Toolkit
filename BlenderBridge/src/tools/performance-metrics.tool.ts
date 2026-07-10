/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_performance_metrics orchestration tool.
 * Queries current Blender performance metrics including memory,
 * scene complexity, and GPU information.
 *
 * Requirement 7: Performance Metrics Tool
 */

import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { generatePerformanceMetricsCode } from "../codegen/performance-metrics.py";
import { validatePerformanceMetrics } from "../type-validation-helpers";
import { BlenderBridgeConfig, PerformanceMetricsResult } from "../types";

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
 * Creates the blender_performance_metrics tool handler.
 * Returns memory usage, scene complexity, and GPU information.
 */
export function createPerformanceMetricsTool(
  _config: BlenderBridgeConfig,
  client: BlenderClient,
): ToolHandler {
  return {
    name: "blender_performance_metrics",
    description:
      "Returns current Blender performance metrics including system memory usage, " +
      "scene complexity (object/polygon/vertex/material counts), and GPU information.",
    inputSchema: z.object({}),
    handler: async (): Promise<ToolResult> => {
      const pythonCode = generatePerformanceMetricsCode();
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
        const metrics: PerformanceMetricsResult = validatePerformanceMetrics(parsed);

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(metrics, null, 2),
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
                    message: "Failed to parse performance metrics result",
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
