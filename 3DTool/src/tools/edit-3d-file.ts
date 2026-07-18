import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { editFile } from "../file-editor";
import { detectFormat } from "../types";

/**
 * edit_3d_file tool handler.
 *
 * Determines format from the filePath extension, decodes base64 content for GLB,
 * and writes the file via FileEditor (which handles validation for OBJ and backup creation).
 *
 * Requirements: 2.4, 2.5, 3.4, 3.5
 */
export async function handleEdit3dFile(args: {
  filePath: string;
  workspaceRoot: string;
  content: string;
  format: "obj" | "glb";
}): Promise<CallToolResult> {
  const { filePath, workspaceRoot, content, format } = args;

  // Validate format from extension
  const detectedFormat = detectFormat(filePath);
  if (!detectedFormat) {
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

  // For GLB, decode content from base64 to Buffer
  let fileContent: string | Buffer;
  if (format === "glb") {
    try {
      fileContent = Buffer.from(content, "base64");
    } catch (_err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error: Failed to decode base64 content for GLB file`,
          },
        ],
      };
    }
  } else {
    fileContent = content;
  }

  // Write via FileEditor (handles validation for OBJ and backup creation)
  const result = editFile(filePath, workspaceRoot, fileContent, format);

  if (!result.success) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${result.error}`,
        },
      ],
    };
  }

  // Build response including validation report if present
  const response: Record<string, unknown> = {
    success: true,
    filePath,
    format,
  };

  if (result.backupPath) {
    response.backupPath = result.backupPath;
  }

  if (result.validation) {
    response.validation = result.validation;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(response),
      },
    ],
  };
}
