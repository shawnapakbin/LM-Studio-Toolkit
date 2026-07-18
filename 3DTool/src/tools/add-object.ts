import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sceneManager } from "../shared-state";
import type { SceneObject, Vec3 } from "../types";

interface AddObjectArgs {
  id: string;
  filePath: string;
  workspaceRoot: string;
  position?: { x?: number; y?: number; z?: number };
  rotation?: { x?: number; y?: number; z?: number };
  scale?: { x?: number; y?: number; z?: number };
}

function parseVec3(
  input: { x?: number; y?: number; z?: number } | undefined,
  defaults: Vec3,
): Vec3 {
  if (!input) return defaults;
  return {
    x: input.x ?? defaults.x,
    y: input.y ?? defaults.y,
    z: input.z ?? defaults.z,
  };
}

export async function handleAddObject(args: AddObjectArgs): Promise<CallToolResult> {
  try {
    const { id, filePath, workspaceRoot } = args;

    // Validate id length
    if (!id || id.length < 1 || id.length > 64) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Error: Object id must be between 1 and 64 characters",
          },
        ],
      };
    }

    const position = parseVec3(args.position, { x: 0, y: 0, z: 0 });
    const rotation = parseVec3(args.rotation, { x: 0, y: 0, z: 0 });
    const scale = parseVec3(args.scale, { x: 1, y: 1, z: 1 });

    const obj: SceneObject = {
      id,
      filePath,
      workspaceRoot,
      position,
      rotation,
      scale,
      materials: [],
    };

    sceneManager.addObject(obj);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            objectId: id,
            position,
            rotation,
            scale,
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
