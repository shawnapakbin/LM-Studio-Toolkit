import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sceneManager } from "../shared-state";

export async function handleListMaterials(): Promise<CallToolResult> {
  try {
    const materials = sceneManager.listMaterials();
    return {
      content: [{ type: "text", text: JSON.stringify(materials) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${message}` }],
    };
  }
}
