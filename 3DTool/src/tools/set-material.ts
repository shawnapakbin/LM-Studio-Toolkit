import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sceneManager } from "../shared-state";
import type { MaterialProps } from "../types";

export async function handleSetMaterial(args: {
  objectId: string;
  meshName?: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
}): Promise<CallToolResult> {
  try {
    const props: Partial<MaterialProps> = {};
    if (args.color !== undefined) props.color = args.color;
    if (args.roughness !== undefined) props.roughness = args.roughness;
    if (args.metalness !== undefined) props.metalness = args.metalness;
    if (args.emissive !== undefined) props.emissive = args.emissive;

    sceneManager.setMaterial(args.objectId, props);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            objectId: args.objectId,
            applied: props,
          }),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${message}` }],
    };
  }
}
