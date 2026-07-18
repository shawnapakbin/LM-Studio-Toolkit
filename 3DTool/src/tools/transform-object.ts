import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sceneManager } from "../shared-state";
import type { Vec3 } from "../types";

interface TransformObjectArgs {
  id: string;
  position?: { x?: number; y?: number; z?: number };
  rotation?: { x?: number; y?: number; z?: number };
  scale?: { x?: number; y?: number; z?: number };
}

export async function handleTransformObject(args: TransformObjectArgs): Promise<CallToolResult> {
  try {
    const transform: Partial<{ position: Vec3; rotation: Vec3; scale: Vec3 }> = {};

    if (args.position !== undefined) {
      transform.position = {
        x: args.position.x ?? 0,
        y: args.position.y ?? 0,
        z: args.position.z ?? 0,
      };
    }

    if (args.rotation !== undefined) {
      transform.rotation = {
        x: args.rotation.x ?? 0,
        y: args.rotation.y ?? 0,
        z: args.rotation.z ?? 0,
      };
    }

    if (args.scale !== undefined) {
      transform.scale = {
        x: args.scale.x ?? 1,
        y: args.scale.y ?? 1,
        z: args.scale.z ?? 1,
      };
    }

    sceneManager.transformObject(args.id, transform);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            objectId: args.id,
            applied: transform,
          }),
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
