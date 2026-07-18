/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { TokenBudget } from "../../src/token-budget";

describe("TokenBudget", () => {
  describe("estimate()", () => {
    it("computes token estimate as total chars / 4", () => {
      const budget = new TokenBudget(8192);
      // 100 + 200 + 100 = 400 chars → 400 / 4 = 100 tokens
      const systemPrompt = "a".repeat(100);
      const taskPrompt = "b".repeat(200);
      const toolDefs = "c".repeat(100);

      expect(budget.estimate(systemPrompt, taskPrompt, toolDefs)).toBe(100);
    });

    it("handles empty strings", () => {
      const budget = new TokenBudget(8192);
      expect(budget.estimate("", "", "")).toBe(0);
    });

    it("sums all three input lengths before dividing", () => {
      const budget = new TokenBudget(8192);
      // 12 + 8 + 4 = 24 chars → 24 / 4 = 6 tokens
      expect(budget.estimate("system prompt", "task pro", "tool")).toBe(
        ("system prompt".length + "task pro".length + "tool".length) / 4,
      );
    });

    it("returns fractional token counts for non-divisible lengths", () => {
      const budget = new TokenBudget(8192);
      // 5 + 3 + 1 = 9 chars → 9 / 4 = 2.25
      expect(budget.estimate("hello", "bye", "x")).toBe(2.25);
    });
  });

  describe("exceedsBudget()", () => {
    it("returns false when estimate is within 80% of context size", () => {
      const budget = new TokenBudget(10000);
      // 80% of 10000 = 8000
      expect(budget.exceedsBudget(7999)).toBe(false);
      expect(budget.exceedsBudget(8000)).toBe(false);
    });

    it("returns true when estimate exceeds 80% of context size", () => {
      const budget = new TokenBudget(10000);
      // 80% of 10000 = 8000
      expect(budget.exceedsBudget(8001)).toBe(true);
    });

    it("returns false when estimate equals the budget limit exactly", () => {
      const budget = new TokenBudget(8192);
      // 80% of 8192 = 6553.6
      expect(budget.exceedsBudget(6553.6)).toBe(false);
    });

    it("returns true when estimate exceeds budget limit by a tiny amount", () => {
      const budget = new TokenBudget(8192);
      // 80% of 8192 = 6553.6
      expect(budget.exceedsBudget(6553.7)).toBe(true);
    });
  });

  describe("getBudgetLimit()", () => {
    it("returns 80% of model context size", () => {
      expect(new TokenBudget(8192).getBudgetLimit()).toBe(6553.6);
      expect(new TokenBudget(10000).getBudgetLimit()).toBe(8000);
      expect(new TokenBudget(1024).getBudgetLimit()).toBe(819.2);
      expect(new TokenBudget(1048576).getBudgetLimit()).toBe(838860.8);
    });
  });

  describe("integration: estimate + exceedsBudget", () => {
    it("detects when a task exceeds the budget", () => {
      const budget = new TokenBudget(8192);
      // Budget limit: 6553.6 tokens
      // Need > 6553.6 * 4 = 26214.4 total chars to exceed
      const systemPrompt = "a".repeat(10000);
      const taskPrompt = "b".repeat(10000);
      const toolDefs = "c".repeat(7000);
      // Total: 27000 chars → 6750 tokens > 6553.6

      const estimate = budget.estimate(systemPrompt, taskPrompt, toolDefs);
      expect(budget.exceedsBudget(estimate)).toBe(true);
    });

    it("passes when a task is within budget", () => {
      const budget = new TokenBudget(8192);
      // Budget limit: 6553.6 tokens
      // Need <= 6553.6 * 4 = 26214.4 total chars
      const systemPrompt = "a".repeat(5000);
      const taskPrompt = "b".repeat(5000);
      const toolDefs = "c".repeat(5000);
      // Total: 15000 chars → 3750 tokens < 6553.6

      const estimate = budget.estimate(systemPrompt, taskPrompt, toolDefs);
      expect(budget.exceedsBudget(estimate)).toBe(false);
    });
  });
});
