import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sceneManager } from "../shared-state";

export async function handleListObjects(): Promise<CallToolResult> {
  try {
    const objects = sceneManager.listObjects();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(objects),
        },
      ],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${message}` }],
    };
  }
}
