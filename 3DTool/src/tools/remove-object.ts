import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sceneManager } from "../shared-state";

interface RemoveObjectArgs {
  id: string;
}

export async function handleRemoveObject(args: RemoveObjectArgs): Promise<CallToolResult> {
  try {
    sceneManager.removeObject(args.id);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, objectId: args.id }),
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
