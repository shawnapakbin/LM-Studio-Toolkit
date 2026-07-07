/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * blender_export_to_viewer orchestration tool.
 * Exports the active Blender object as OBJ, probes 3DTool /health,
 * and POSTs to /api/load if the viewer is available.
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
 * Probes the 3DTool /health endpoint with a 3-second timeout.
 * Returns true if the viewer is reachable.
 *
 * Requirement 8.2: 3DTool /health probe on port 3344 within 3s.
 */
async function probe3DToolHealth(threeDToolHost: string, httpClient: HttpClient): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await httpClient.fetch(`${threeDToolHost}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * POSTs the exported file path to 3DTool /api/load.
 */
async function post3DToolLoad(
  threeDToolHost: string,
  filePath: string,
  workspace: string,
  httpClient: HttpClient,
): Promise<boolean> {
  try {
    const response = await httpClient.fetch(`${threeDToolHost}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath, workspace }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Creates the blender_export_to_viewer tool handler.
 * Exports the active object as OBJ and optionally triggers 3DTool viewer.
 */
export function createExportToViewerTool(
  config: BlenderBridgeConfig,
  client: BlenderClient,
  httpClient: HttpClient = defaultHttpClient,
): ToolHandler {
  return {
    name: "blender_export_to_viewer",
    description:
      "Exports the active Blender object as OBJ to the tmp/ directory and " +
      "triggers the 3DTool viewer to load it. Returns the file path and viewer status.",
    inputSchema: z.object({}),
    handler: async (): Promise<ToolResult> => {
      // First, check for active object by running a quick query
      const checkResult = await client.executeCode(
        `import bpy\nimport json\nobj = bpy.context.active_object\nresult = json.dumps({"hasActive": obj is not None, "name": obj.name if obj else None})`,
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

      // Requirement 8.2: BOTH conditions must pass before POSTing to /api/load:
      // a. Probe 3DTool /health on :3344 (3s timeout)
      // b. Verify OBJ file exists on disk (fs.existsSync)
      const viewerAvailable = await probe3DToolHealth(config.threeDToolHost, httpClient);
      const fileExists = fs.existsSync(outputPath);

      let viewerTriggered = false;

      if (viewerAvailable && fileExists) {
        // Requirement 8.1: POST to /api/load with file path and workspace
        const workspace = path.dirname(outputPath);
        viewerTriggered = await post3DToolLoad(
          config.threeDToolHost,
          outputPath,
          workspace,
          httpClient,
        );
      }

      // Requirement 8.3: If viewer not reachable, return file path with "viewer unavailable" message
      const response: Record<string, unknown> = {
        success: true,
        filePath: outputPath,
        viewerTriggered,
      };

      if (!viewerAvailable) {
        response.message = "3DTool viewer is not running. File exported successfully.";
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
