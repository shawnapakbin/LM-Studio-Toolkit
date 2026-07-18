import { sceneManager } from "../shared-state";

/**
 * acknowledge_interaction tool handler.
 * Marks an interaction as resolved and broadcasts an SSE pin_state event.
 *
 * Validates: Requirements 10.3, 10.4
 */
export function acknowledgeInteraction(args: {
  id: string;
}): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  const { id } = args;

  const found = sceneManager.acknowledgeInteraction(id);

  if (!found) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: interaction not found: ${id}` }],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, id, state: "resolved" }) }],
  };
}
