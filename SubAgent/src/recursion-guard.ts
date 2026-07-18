/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * RecursionGuard enforces a hard depth limit of 1 for sub-agent dispatch.
 *
 * Sub-sessions initiated by dispatch_sub_tasks cannot trigger another
 * dispatch_sub_tasks call. The guard works at the application layer by:
 * 1. Tracking current dispatch depth
 * 2. Filtering dispatch_sub_tasks from available tool definitions
 * 3. Injecting depth-awareness into sub-session system prompts
 */

const BLOCKED_TOOL = "dispatch_sub_tasks";
const MAX_DEPTH = 1;

export class RecursionGuard {
  private currentDepth: number;

  constructor(depth: number = 0) {
    this.currentDepth = depth;
  }

  /**
   * Returns true when the current depth equals or exceeds the maximum
   * allowed depth, meaning dispatch_sub_tasks calls should be rejected.
   */
  isBlocked(): boolean {
    return this.currentDepth >= MAX_DEPTH;
  }

  /**
   * Removes `dispatch_sub_tasks` from the provided tool list.
   * This ensures sub-sessions never see the dispatch tool in their
   * available tool definitions, regardless of allowed_tools config.
   */
  getFilteredTools(allowedTools: string[]): string[] {
    return allowedTools.filter((tool) => tool !== BLOCKED_TOOL);
  }

  /**
   * Appends a depth-awareness instruction to the system prompt,
   * informing the sub-session that it operates at depth 1 and
   * sub-agent dispatch tools are unavailable.
   */
  injectDepthPrompt(systemPrompt: string): string {
    const depthInstruction =
      "\n\n[SYSTEM: You are a sub-agent operating at depth 1. " +
      "Sub-agent dispatch tools (dispatch_sub_tasks) are unavailable at this depth. " +
      "Do not attempt to delegate work to additional sub-agents.]";
    return systemPrompt + depthInstruction;
  }

  /**
   * Returns an error message indicating the current and maximum depth,
   * used when rejecting a blocked dispatch_sub_tasks call.
   */
  getDepthMessage(): string {
    return (
      `Recursion blocked: current dispatch depth is ${this.currentDepth}, ` +
      `maximum allowed depth is ${MAX_DEPTH}. ` +
      `Sub-sessions cannot dispatch their own sub-agents.`
    );
  }

  /**
   * Returns the current dispatch depth.
   */
  getCurrentDepth(): number {
    return this.currentDepth;
  }

  /**
   * Creates a new RecursionGuard for a sub-session (depth + 1).
   */
  createChildGuard(): RecursionGuard {
    return new RecursionGuard(this.currentDepth + 1);
  }
}
