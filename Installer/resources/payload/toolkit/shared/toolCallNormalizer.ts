// toolCallNormalizer.ts
// Normalizes tool call payloads from various formats to the canonical ToolCall format.
// Place in a shared location (e.g., shared/).

import { ToolCall } from "./types";

/**
 * Normalize a raw tool call payload (string or object) to the canonical ToolCall format.
 * Throws if the payload cannot be parsed or is missing required fields.
 */
export function normalizeToolCall(raw: unknown, context: { taskRunId: string }): ToolCall {
  // If already a ToolCall, return as-is
  if (typeof raw === "object" && raw !== null && "tool_name" in raw && "input_params" in raw) {
    return raw as ToolCall;
  }

  // If string, try to parse as JSON
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "tool_name" in parsed &&
        "input_params" in parsed
      ) {
        return parsed as ToolCall;
      }
    } catch {}
  }

  // Try to parse legacy XML-like format
  if (typeof raw === "string" && raw.includes("<tool_call>")) {
    // Very basic extraction for <tool_call> <function=...> <parameter=...> ...
    const toolNameMatch = raw.match(/<function=([\w-]+)>/);
    const paramMatch = raw.match(/<parameter=([\w-]+)>\s*([^<]+)/);
    if (toolNameMatch && paramMatch) {
      const toolName = toolNameMatch[1];
      const paramKey = paramMatch[1];
      const paramValue = paramMatch[2].trim();
      return {
        id: "", // to be filled by caller
        task_run_id: context.taskRunId,
        tool_name: toolName,
        input_params: JSON.stringify({ [paramKey]: paramValue }),
        output_result: "",
        success: false,
        timestamp: new Date().toISOString(),
      };
    }
  }

  throw new Error("Unrecognized tool call format");
}
