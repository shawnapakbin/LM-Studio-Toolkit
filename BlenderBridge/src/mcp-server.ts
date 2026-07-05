/**
 * BlenderBridge MCP server entry point.
 * Exposes orchestration tools via stdio transport using the MCP SDK.
 *
 * Requirements:
 *   2.3 — MCP server via stdio at BlenderBridge/dist/mcp-server.js,
 *          completes initialize handshake, reports registered tools.
 *          Fails initialization with error if zero tools are registered.
 *   7.5 — Fails to start with clear error on invalid config.
 *   9.1 — Registers all 31 tools (5 orchestration + 26 passthrough).
 *   9.5 — Fails initialization if any tool fails to register.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createAddonCallToolDelegate, createAddonExecuteCodeDelegate } from "./addon-transport";
import { BlenderClient, ExecuteBlenderCodeFn, createBlenderClient } from "./blender-client";
import { loadConfig } from "./config";
import { createCreateObjectTool } from "./tools/create-object.tool";
import { createExportToViewerTool } from "./tools/export-to-viewer.tool";
import { createHealthCheckTool } from "./tools/health-check.tool";
import { createCliFileInfoTools } from "./tools/passthrough/cli-file-info.tools";
import { createCodeExecutionTools } from "./tools/passthrough/code-execution.tools";
import { createDocumentationTools } from "./tools/passthrough/documentation.tools";
import { createFileInfoTools } from "./tools/passthrough/file-info.tools";
import { createNavigationTools } from "./tools/passthrough/navigation.tools";
import { createRenderingTools } from "./tools/passthrough/rendering.tools";
import { createSceneInspectionTools } from "./tools/passthrough/scene-inspection.tools";
import { createScreenshotTools } from "./tools/passthrough/screenshot.tools";
import { createRenderPreviewTool } from "./tools/render-preview.tool";
import { createSceneSummaryTool } from "./tools/scene-summary.tool";
import { BlenderBridgeConfig, CallToolFn } from "./types";

/** Result of creating the BlenderBridge MCP server, including tool count for testing. */
export interface CreateServerResult {
  server: McpServer;
  toolCount: number;
}

/**
 * Creates the BlenderBridge MCP server with all orchestration and passthrough tools registered.
 *
 * @param config — Validated BlenderBridgeConfig (loaded from env)
 * @param delegateOverride — Optional delegate function for testing; when omitted
 *   a placeholder delegate is used that will work when the external blender-mcp
 *   server is connected.
 * @param callToolDelegateOverride — Optional CallToolFn delegate for passthrough tools;
 *   when omitted, passthrough tools will return an error indicating the delegate is not configured.
 * @returns Object containing the configured McpServer instance and the tool count.
 * @throws Error if zero tools are registered after initialization (Req 2.3).
 * @throws Error if any tool fails to register (Req 9.5).
 */
export function createBlenderBridgeMcpServer(
  config: BlenderBridgeConfig,
  delegateOverride?: ExecuteBlenderCodeFn,
  callToolDelegateOverride?: CallToolFn,
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

  const client: BlenderClient = createBlenderClient(config, delegate, callToolDelegateOverride);

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
  registerTool(healthCheckTool.name, healthCheckTool.description, {}, async () => {
    const result = await healthCheckTool.handler({});
    return { content: result.content, isError: result.isError };
  });
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
        .enum(["cube", "sphere", "cylinder", "cone", "torus", "plane", "circle", "curve", "empty"])
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
  registerTool(sceneSummaryTool.name, sceneSummaryTool.description, {}, async () => {
    const result = await sceneSummaryTool.handler({});
    return { content: result.content, isError: result.isError };
  });
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
        .describe(
          "Optional output directory for the rendered image. Defaults to system temp directory.",
        ),
    },
    async (input) => {
      const result = await renderPreviewTool.handler(input);
      return { content: result.content, isError: result.isError };
    },
  );
  toolCount++;

  // 5. blender_export_to_viewer
  const exportToViewerTool = createExportToViewerTool(config, client);
  registerTool(exportToViewerTool.name, exportToViewerTool.description, {}, async () => {
    const result = await exportToViewerTool.handler({});
    return { content: result.content, isError: result.isError };
  });
  toolCount++;

  // --- Register passthrough tools (Req 9.1, 9.2, 9.5) ---
  const passthroughFactories = [
    createCodeExecutionTools,
    createFileInfoTools,
    createCliFileInfoTools,
    createSceneInspectionTools,
    createDocumentationTools,
    createScreenshotTools,
    createNavigationTools,
    createRenderingTools,
  ];

  for (const factory of passthroughFactories) {
    let tools: ReturnType<typeof factory> | undefined;
    try {
      tools = factory(config, client);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `BlenderBridge MCP server initialization failed: passthrough tool factory "${factory.name}" threw an error: ${message}`,
      );
    }

    for (const tool of tools) {
      try {
        registerTool(tool.name, tool.description, tool.inputSchema, async (input) => {
          const result = await tool.handler(input);
          return { content: result.content, isError: result.isError };
        });
        toolCount++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `BlenderBridge MCP server initialization failed: tool "${tool.name}" failed to register: ${message}`,
        );
      }
    }
  }

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
 *
 * Wires up the real delegates that connect directly to the Blender add-on's
 * TCP socket (default localhost:9876), eliminating the need for the external
 * `blender-mcp` CLI binary.
 */
async function main(): Promise<void> {
  // Load config — throws with clear error message if invalid (Req 7.5)
  const config = loadConfig();

  // Create delegates that connect directly to the Blender add-on socket
  const executeCodeDelegate = createAddonExecuteCodeDelegate(config);
  const callToolDelegate = createAddonCallToolDelegate(config);

  const { server, toolCount } = createBlenderBridgeMcpServer(
    config,
    executeCodeDelegate,
    callToolDelegate,
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`BlenderBridge MCP server running on stdio (${toolCount} tools registered)`);
  console.error(`Connected to Blender add-on at ${config.blenderMcpHost}:${config.blenderMcpPort}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`BlenderBridge MCP server startup failed: ${message}\n`);
    process.exit(1);
  });
}
