import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { acknowledgeInteraction } from "./tools/acknowledge-interaction";
import { handleAddObject } from "./tools/add-object";
import { handleEdit3dFile } from "./tools/edit-3d-file";
import { handleGetModelMetadata } from "./tools/get-model-metadata";
// Tool handler imports
import { handleLaunchViewer } from "./tools/launch-viewer";
import { listHistory } from "./tools/list-history";
import { handleListMaterials } from "./tools/list-materials";
import { handleListObjects } from "./tools/list-objects";
import { handlePollInteractions } from "./tools/poll-interactions";
import { handleRemoveObject } from "./tools/remove-object";
import { rollback } from "./tools/rollback";
import { handleSetMaterial } from "./tools/set-material";
import { handleTransformObject } from "./tools/transform-object";

// Reusable Vec3 schema
const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "3dtool-viewer",
    version: "2.3.0",
  });

  // --- launch_viewer ---
  // @ts-expect-error - MCP SDK registerTool generic causes deep type instantiation with Zod schemas
  server.registerTool(
    "launch_viewer",
    {
      description: "Set active 3D file and open the browser viewer",
      inputSchema: {
        filePath: z.string().describe("Path to the 3D model file to view"),
        workspaceRoot: z.string().describe("Absolute path to the workspace root"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleLaunchViewer(args)) as any,
  );

  // --- edit_3d_file ---
  server.registerTool(
    "edit_3d_file",
    {
      description: "Write content to a 3D model file with optional validation",
      inputSchema: {
        filePath: z.string().describe("Relative path to the model file"),
        workspaceRoot: z.string().describe("Absolute workspace root path"),
        content: z.string().describe("File content (string for OBJ, base64 for GLB)"),
        format: z.enum(["obj", "glb"]).describe("File format"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleEdit3dFile(args)) as any,
  );

  // --- poll_interactions ---
  server.registerTool(
    "poll_interactions",
    {
      description: "Drain the interaction queue and return pending annotation events",
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async () => handlePollInteractions()) as any,
  );

  // --- get_model_metadata ---
  server.registerTool(
    "get_model_metadata",
    {
      description: "Extract metadata (vertex count, faces, materials) from a 3D model file",
      inputSchema: {
        filePath: z.string().describe("Path to the model file"),
        workspaceRoot: z.string().describe("Absolute workspace root path"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleGetModelMetadata(args)) as any,
  );

  // --- add_object ---
  // @ts-expect-error - MCP SDK registerTool generic causes deep type instantiation with nested Zod schemas
  server.registerTool(
    "add_object",
    {
      description: "Add a 3D object to the scene",
      inputSchema: {
        id: z.string().min(1).max(64).describe("Unique object identifier"),
        filePath: z.string().describe("Relative path to the model file"),
        workspaceRoot: z.string().describe("Absolute workspace root path"),
        position: Vec3Schema.optional().describe("Initial position"),
        rotation: Vec3Schema.optional().describe("Initial rotation in degrees"),
        scale: Vec3Schema.optional().describe("Initial scale"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleAddObject(args)) as any,
  );

  // --- remove_object ---
  server.registerTool(
    "remove_object",
    {
      description: "Remove a 3D object from the scene",
      inputSchema: {
        id: z.string().describe("Object identifier to remove"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleRemoveObject(args)) as any,
  );

  // --- transform_object ---
  server.registerTool(
    "transform_object",
    {
      description: "Update the transform (position, rotation, scale) of a scene object",
      inputSchema: {
        id: z.string().describe("Object identifier to transform"),
        position: Vec3Schema.optional().describe("New position"),
        rotation: Vec3Schema.optional().describe("New rotation in degrees"),
        scale: Vec3Schema.optional().describe("New scale"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleTransformObject(args)) as any,
  );

  // --- list_objects ---
  server.registerTool(
    "list_objects",
    {
      description: "List all objects currently in the scene",
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async () => handleListObjects()) as any,
  );

  // --- set_material ---
  // @ts-expect-error - MCP SDK registerTool generic causes deep type instantiation with many optional Zod fields
  server.registerTool(
    "set_material",
    {
      description: "Apply material properties to a scene object",
      inputSchema: {
        objectId: z.string().describe("Object identifier to apply material to"),
        meshName: z.string().optional().describe("Optional specific mesh name within the object"),
        color: z.string().optional().describe("Hex color string (e.g. '#8899bb')"),
        roughness: z.number().min(0).max(1).optional().describe("Roughness value (0.0 - 1.0)"),
        metalness: z.number().min(0).max(1).optional().describe("Metalness value (0.0 - 1.0)"),
        emissive: z.string().optional().describe("Emissive hex color string"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => handleSetMaterial(args)) as any,
  );

  // --- list_materials ---
  server.registerTool(
    "list_materials",
    {
      description: "List all materials currently applied in the scene",
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async () => handleListMaterials()) as any,
  );

  // --- list_history ---
  server.registerTool(
    "list_history",
    {
      description: "List backup history entries for a model file",
      inputSchema: {
        filePath: z.string().describe("Path to the model file"),
        workspaceRoot: z.string().describe("Absolute workspace root path"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum entries to return (default 50)"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => listHistory(args)) as any,
  );

  // --- rollback ---
  server.registerTool(
    "rollback",
    {
      description: "Restore a model file from a backup entry",
      inputSchema: {
        backupId: z.string().describe("Backup entry identifier"),
        filePath: z.string().describe("Path to the model file to restore"),
        workspaceRoot: z.string().describe("Absolute workspace root path"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => rollback(args)) as any,
  );

  // --- acknowledge_interaction ---
  server.registerTool(
    "acknowledge_interaction",
    {
      description: "Mark an interaction annotation as resolved",
      inputSchema: {
        id: z.string().describe("Interaction event ID to acknowledge"),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => acknowledgeInteraction(args)) as any,
  );

  return server;
}

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("3DTool MCP server running on stdio");

  // Start the HTTP server for the browser-based viewer
  try {
    const { startHttpServer } = await import("./http-server");
    startHttpServer({ openBrowser: false });
  } catch (err) {
    console.error("Failed to start HTTP server:", err);
    // Non-fatal: MCP server continues working without the viewer HTTP server
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("3DTool MCP server startup failed:", error);
    process.exit(1);
  });
}
