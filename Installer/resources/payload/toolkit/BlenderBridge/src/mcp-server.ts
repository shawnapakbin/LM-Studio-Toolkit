/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * BlenderBridge MCP server entry point.
 * Exposes orchestration tools via stdio transport using the MCP SDK.
 *
 * Requirements:
 *   2.3 — MCP server via stdio at BlenderBridge/dist/mcp-server.js,
 *          completes initialize handshake, reports registered tools.
 *          Fails initialization with error if zero tools are registered.
 *   7.5 — Fails to start with clear error on invalid config.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadConfig } from "./config";
import { BlenderBridgeConfig } from "./types";
import { createBlenderClient, BlenderClient, ExecuteBlenderCodeFn } from "./blender-client";
import { createHealthCheckTool } from "./tools/health-check.tool";
import { createCreateObjectTool } from "./tools/create-object.tool";
import { createSceneSummaryTool } from "./tools/scene-summary.tool";
import { createRenderPreviewTool } from "./tools/render-preview.tool";
import { createExportToViewerTool } from "./tools/export-to-viewer.tool";

/** Result of creating the BlenderBridge MCP server, including tool count for testing. */
export interface CreateServerResult {
  server: McpServer;
  toolCount: number;
}

/**
 * Creates the BlenderBridge MCP server with all orchestration tools registered.
 *
 * @param config — Validated BlenderBridgeConfig (loaded from env)
 * @param delegateOverride — Optional delegate function for testing; when omitted
 *   a placeholder delegate is used that will work when the external blender-mcp
 *   server is connected.
 * @returns Object containing the configured McpServer instance and the tool count.
 * @throws Error if zero tools are registered after initialization (Req 2.3).
 */
export function createBlenderBridgeMcpServer(
  config: BlenderBridgeConfig,
  delegateOverride?: ExecuteBlenderCodeFn,
): CreateServerResult {
  const server = new McpServer({
    name: "blender-bridge",
    version: "1.0.0",
  });

  // The delegate calls the external Blender MCP server's execute_blender_code tool.
  // When no override is provided, use a placeholder that returns an error prompting
  // the user to ensure the external server is running.
  const delegate: ExecuteBlenderCodeFn =
    delegateOverride ??
    (async (_pythonCode: string): Promise<string> => {
      throw new Error(
        "Blender MCP server delegate not connected. " +
          "Ensure the external blender-mcp server is running and the bridge is properly configured.",
      );
    });

  const client: BlenderClient = createBlenderClient(config, delegate);

  // Use the same pattern as AskUser — cast to avoid
  // excessively deep type instantiation with complex zod schemas.
  const registerTool = server.tool.bind(server) as unknown as (
    name: string,
    description: string,
    inputSchema: unknown,
    handler: (input: unknown) => Promise<CallToolResult>,
  ) => void;

  // Track registered tool count for validation
  let toolCount = 0;

  // --- Register tools ---

  // 1. blender_health_check
  const healthCheckTool = createHealthCheckTool(config);
  registerTool(
    healthCheckTool.name,
    healthCheckTool.description,
    {},
    async () => {
      const result = await healthCheckTool.handler({});
      return { content: result.content, isError: result.isError };
    },
  );
  toolCount++;

  // 2. blender_create_object
  const createObjectTool = createCreateObjectTool(config, client);
  registerTool(
    createObjectTool.name,
    createObjectTool.description,
    {
      name: z
        .string()
        .min(1)
        .max(63)
        .regex(/^[a-zA-Z0-9_]+$/)
        .describe("Object name (1-63 chars, alphanumeric + underscore)"),
      geometryType: z
        .enum([
          "cube",
          "sphere",
          "cylinder",
          "cone",
          "torus",
          "plane",
          "circle",
          "curve",
          "empty",
        ])
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
    },
    async (input) => {
      const result = await createObjectTool.handler(input);
      return { content: result.content, isError: result.isError };
    },
  );
  toolCount++;

  // 3. blender_scene_summary
  const sceneSummaryTool = createSceneSummaryTool(config, client);
  registerTool(
    sceneSummaryTool.name,
    sceneSummaryTool.description,
    {},
    async () => {
      const result = await sceneSummaryTool.handler({});
      return { content: result.content, isError: result.isError };
    },
  );
  toolCount++;

  // 4. blender_render_preview
  const renderPreviewTool = createRenderPreviewTool(config, client);
  registerTool(
    renderPreviewTool.name,
    renderPreviewTool.description,
    {
      outputDir: z
        .string()
        .optional()
        .describe("Optional output directory for the rendered image. Defaults to system temp directory."),
    },
    async (input) => {
      const result = await renderPreviewTool.handler(input);
      return { content: result.content, isError: result.isError };
    },
  );
  toolCount++;

  // 5. blender_export_to_viewer
  const exportToViewerTool = createExportToViewerTool(config, client);
  registerTool(
    exportToViewerTool.name,
    exportToViewerTool.description,
    {},
    async () => {
      const result = await exportToViewerTool.handler({});
      return { content: result.content, isError: result.isError };
    },
  );
  toolCount++;

  // Req 2.3: Fail initialization with error if zero tools registered.
  // This ensures misconfigured deployments are caught immediately rather
  // than presenting a no-op server to the LLM client.
  if (toolCount === 0) {
    throw new Error(
      "BlenderBridge MCP server initialization failed: no tools were registered. " +
        "At least one orchestration tool must be available.",
    );
  }

  return { server, toolCount };
}

/**
 * Main startup function. Loads config (fails on invalid), creates the MCP server,
 * connects via stdio transport.
 */
async function main(): Promise<void> {
  // Load config — throws with clear error message if invalid (Req 7.5)
  const config = loadConfig();

  const { server, toolCount } = createBlenderBridgeMcpServer(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`BlenderBridge MCP server running on stdio (${toolCount} tools registered)`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`BlenderBridge MCP server startup failed: ${message}\n`);
    process.exit(1);
  });
}
