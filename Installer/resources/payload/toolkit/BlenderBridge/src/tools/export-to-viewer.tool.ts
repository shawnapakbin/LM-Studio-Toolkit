/**
 * blender_export_to_viewer orchestration tool.
 * Exports the active Blender object as OBJ to the tmp/ directory.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { z } from "zod";
import { BlenderClient } from "../blender-client";
import { generateExportObjCode } from "../codegen/export-obj.py";
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
 * HTTP client abstraction for testing. Allows injecting a mock fetch.
 */
export interface HttpClient {
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

/** Default HTTP client using global fetch. */
const defaultHttpClient: HttpClient = {
  fetch: (url: string, options?: RequestInit) => fetch(url, options),
};

/**
 * Creates the blender_export_to_viewer tool handler.
 * Exports the active object as OBJ and returns the file path.
 */
export function createExportToViewerTool(
  config: BlenderBridgeConfig,
  client: BlenderClient,
  httpClient: HttpClient = defaultHttpClient,
): ToolHandler {
  return {
    name: "blender_export_to_viewer",
    description:
      "Exports the active Blender object as OBJ to the tmp/ directory. " +
      "Returns the exported file path for use with render previews or external viewers.",
    inputSchema: z.object({}),
    handler: async (): Promise<ToolResult> => {
      // First, check for active object by running a quick query
      const checkResult = await client.executeCode(
        `import bpy\nobj = bpy.context.active_object\nresult = {"hasActive": obj is not None, "name": obj.name if obj else None}`,
      );

      if (!checkResult.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: checkResult.error,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Parse active object check result
      let activeInfo: { hasActive: boolean; name: string | null };
      try {
        activeInfo = JSON.parse(checkResult.output || "{}");
      } catch {
        activeInfo = { hasActive: false, name: null };
      }

      // Requirement 8.4: If no active object, return NO_ACTIVE_OBJECT error
      if (!activeInfo.hasActive || !activeInfo.name) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: {
                    code: "NO_ACTIVE_OBJECT",
                    message:
                      "No active object selected in the Blender scene. Select an object before exporting.",
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Build output path using active object name
      const objectName = activeInfo.name;
      const outputPath = path.join(os.tmpdir(), `${objectName}.obj`);

      // Generate and execute export code
      const pythonCode = generateExportObjCode({ outputPath });
      const exportResult = await client.executeCode(pythonCode);

      // Requirement 8.5: If OBJ export fails, return structured error with traceback + suggestion
      if (!exportResult.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: exportResult.error,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Verify file was created
      const fileExists = fs.existsSync(outputPath);

      const response: Record<string, unknown> = {
        success: true,
        filePath: outputPath,
        fileExists,
        viewerTriggered: false,
      };

      if (!fileExists) {
        response.message = "Export command completed but file was not found on disk.";
      }

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  };
}
