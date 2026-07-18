import { exec } from "child_process";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { setActiveModel } from "../http-server";
import { detectFormat } from "../types";

const VIEWER_URL = "http://localhost:3344";

/**
 * launch_viewer tool handler.
 *
 * Detects format from filePath extension, sets the active model on the HTTP server,
 * and opens the browser to the viewer URL.
 *
 * Requirements: 2.1, 2.5
 */
export async function handleLaunchViewer(args: {
  filePath: string;
  workspaceRoot: string;
}): Promise<CallToolResult> {
  const { filePath, workspaceRoot } = args;

  // Detect format from extension
  const format = detectFormat(filePath);
  if (!format) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: Unsupported format. File extension must be one of: .obj, .glb, .gltf`,
        },
      ],
    };
  }

  // Set active model on the HTTP server
  setActiveModel(filePath, workspaceRoot);

  // Open browser (platform-specific)
  openBrowser(VIEWER_URL);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          format,
          url: VIEWER_URL,
          filePath,
        }),
      },
    ],
  };
}

function openBrowser(url: string): void {
  const platform = process.platform;

  let command: string;
  if (platform === "win32") {
    command = `start "" "${url}"`;
  } else if (platform === "darwin") {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      console.error(`Failed to open browser: ${err.message}`);
    }
  });
}
