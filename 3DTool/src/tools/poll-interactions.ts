import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sceneManager } from "../shared-state";

/**
 * poll_interactions tool handler.
 *
 * Drains the interaction queue from the shared SceneManager singleton
 * and returns the events along with the current camera position.
 *
 * Requirements: 4.5, 10.2
 */
export async function handlePollInteractions(): Promise<CallToolResult> {
  const pollResult = sceneManager.pollInteractions();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          events: pollResult.events,
          camera_position: pollResult.cameraPosition,
        }),
      },
    ],
  };
}
