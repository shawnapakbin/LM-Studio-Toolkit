import { ToolCall } from "./types";
/**
 * Normalize a raw tool call payload (string or object) to the canonical ToolCall format.
 * Throws if the payload cannot be parsed or is missing required fields.
 */
export declare function normalizeToolCall(
  raw: unknown,
  context: {
    taskRunId: string;
  },
): ToolCall;
//# sourceMappingURL=toolCallNormalizer.d.ts.map
