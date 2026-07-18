/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * Token estimation and budget validation for sub-task inputs.
 *
 * Uses a simple character-to-token approximation (4 chars ≈ 1 token) to estimate
 * whether a sub-task's input will fit within the model's context window, reserving
 * 20% of the context for the completion response.
 */
export class TokenBudget {
  private readonly modelContextSize: number;

  constructor(modelContextSize: number) {
    this.modelContextSize = modelContextSize;
  }

  /**
   * Estimate the token count for a sub-task's input by summing the character
   * lengths of the system prompt, task prompt, and tool definitions, then
   * dividing by 4 (approximating 4 characters per token).
   */
  estimate(systemPrompt: string, taskPrompt: string, toolDefs: string): number {
    const totalChars = systemPrompt.length + taskPrompt.length + toolDefs.length;
    return this.charToTokens(totalChars);
  }

  /**
   * Returns true when the estimated token count exceeds 80% of the model's
   * context window size (the budget limit).
   */
  exceedsBudget(estimatedTokens: number): boolean {
    return estimatedTokens > this.getBudgetLimit();
  }

  /**
   * Returns the budget limit: 80% of the model's context window size.
   * The remaining 20% is reserved for the completion response.
   */
  getBudgetLimit(): number {
    return this.modelContextSize * 0.8;
  }

  /**
   * Approximate token count from character count.
   * Uses the heuristic of 4 characters per token.
   */
  private charToTokens(chars: number): number {
    return chars / 4;
  }
}
