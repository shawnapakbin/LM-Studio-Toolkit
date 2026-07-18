import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { extractMetadata } from "../metadata-extractor";

/**
 * get_model_metadata tool handler.
 *
 * Calls MetadataExtractor to extract structured metadata from a 3D model file
 * and returns it as JSON.
 *
 * Requirements: 2.3
 */
export async function handleGetModelMetadata(args: {
  filePath: string;
  workspaceRoot: string;
}): Promise<CallToolResult> {
  const { filePath, workspaceRoot } = args;

  try {
    const metadata = await extractMetadata(filePath, workspaceRoot);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(metadata),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error extracting metadata";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${message}`,
        },
      ],
    };
  }
}
