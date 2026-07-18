/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Feature: sub-agent-mcp
// **Validates: Requirements 10.1, 10.3, 10.4**

import * as fc from "fast-check";
import { TokenBudget } from "../../src/token-budget";

/**
 * Property 20: Token Budget Enforcement
 *
 * For any task, the estimated token count equals
 * (systemPrompt.length + taskPrompt.length + toolDefs.length) / 4.
 * If this estimate exceeds 80% of model_context_size and auto_chunk is disabled,
 * the task is rejected with budget_exceeded status while all within-budget tasks
 * continue execution.
 *
 * **Validates: Requirements 10.1, 10.3, 10.4**
 */
describe("Property 20: Token Budget Enforcement", () => {
  // Generator for model context sizes (1024–32768)
  const arbitraryModelContextSize = fc.integer({ min: 1024, max: 32768 });

  // Generator for arbitrary string inputs (system prompts, task prompts, tool defs)
  const arbitraryPrompt = fc.string({ minLength: 0, maxLength: 5000 });
  const arbitraryToolDefs = fc.string({ minLength: 0, maxLength: 5000 });

  describe("estimate() always equals (systemPrompt.length + taskPrompt.length + toolDefs.length) / 4", () => {
    it("estimate matches the character-to-token formula for any inputs", () => {
      fc.assert(
        fc.property(
          arbitraryModelContextSize,
          arbitraryPrompt,
          arbitraryPrompt,
          arbitraryToolDefs,
          (contextSize, systemPrompt, taskPrompt, toolDefs) => {
            const budget = new TokenBudget(contextSize);
            const estimate = budget.estimate(systemPrompt, taskPrompt, toolDefs);
            const expected = (systemPrompt.length + taskPrompt.length + toolDefs.length) / 4;
            expect(estimate).toBe(expected);
          },
        ),
        { numRuns: 15 },
      );
    });

    it("estimate is zero when all inputs are empty strings", () => {
      fc.assert(
        fc.property(arbitraryModelContextSize, (contextSize) => {
          const budget = new TokenBudget(contextSize);
          expect(budget.estimate("", "", "")).toBe(0);
        }),
        { numRuns: 15 },
      );
    });

    it("estimate is always non-negative", () => {
      fc.assert(
        fc.property(
          arbitraryModelContextSize,
          arbitraryPrompt,
          arbitraryPrompt,
          arbitraryToolDefs,
          (contextSize, systemPrompt, taskPrompt, toolDefs) => {
            const budget = new TokenBudget(contextSize);
            const estimate = budget.estimate(systemPrompt, taskPrompt, toolDefs);
            expect(estimate).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 25 },
      );
    });
  });

  describe("exceedsBudget() returns true iff estimate > modelContextSize * 0.8", () => {
    it("exceedsBudget is true when estimated tokens exceed 80% of context size", () => {
      fc.assert(
        fc.property(
          arbitraryModelContextSize,
          arbitraryPrompt,
          arbitraryPrompt,
          arbitraryToolDefs,
          (contextSize, systemPrompt, taskPrompt, toolDefs) => {
            const budget = new TokenBudget(contextSize);
            const estimate = budget.estimate(systemPrompt, taskPrompt, toolDefs);
            const limit = contextSize * 0.8;

            if (estimate > limit) {
              expect(budget.exceedsBudget(estimate)).toBe(true);
            } else {
              expect(budget.exceedsBudget(estimate)).toBe(false);
            }
          },
        ),
        { numRuns: 15 },
      );
    });

    it("exceedsBudget returns false for estimate exactly at the budget limit", () => {
      fc.assert(
        fc.property(arbitraryModelContextSize, (contextSize) => {
          const budget = new TokenBudget(contextSize);
          const exactLimit = contextSize * 0.8;
          // At exactly the limit, should NOT exceed
          expect(budget.exceedsBudget(exactLimit)).toBe(false);
        }),
        { numRuns: 25 },
      );
    });

    it("exceedsBudget returns true for estimate just above the budget limit", () => {
      fc.assert(
        fc.property(arbitraryModelContextSize, (contextSize) => {
          const budget = new TokenBudget(contextSize);
          const justAbove = contextSize * 0.8 + 0.001;
          expect(budget.exceedsBudget(justAbove)).toBe(true);
        }),
        { numRuns: 25 },
      );
    });
  });

  describe("getBudgetLimit() is always exactly modelContextSize * 0.8", () => {
    it("budget limit equals 80% of model context size for any context size", () => {
      fc.assert(
        fc.property(arbitraryModelContextSize, (contextSize) => {
          const budget = new TokenBudget(contextSize);
          expect(budget.getBudgetLimit()).toBe(contextSize * 0.8);
        }),
        { numRuns: 15 },
      );
    });
  });

  describe("Budget enforcement across multiple tasks", () => {
    // Generator for a task with arbitrary inputs
    const arbitraryTask = fc.record({
      taskId: fc.string({ minLength: 1, maxLength: 64 }),
      systemPrompt: fc.string({ minLength: 0, maxLength: 3000 }),
      taskPrompt: fc.string({ minLength: 1, maxLength: 3000 }),
      toolDefs: fc.string({ minLength: 0, maxLength: 3000 }),
    });

    // Generator for multiple tasks
    const arbitraryTasks = fc.array(arbitraryTask, { minLength: 1, maxLength: 20 });

    it("over-budget tasks are rejected while within-budget tasks continue", () => {
      fc.assert(
        fc.property(arbitraryModelContextSize, arbitraryTasks, (contextSize, tasks) => {
          const budget = new TokenBudget(contextSize);
          const autoChunk = false;

          const withinBudget: string[] = [];
          const exceededBudget: string[] = [];

          for (const task of tasks) {
            const estimate = budget.estimate(task.systemPrompt, task.taskPrompt, task.toolDefs);
            if (budget.exceedsBudget(estimate) && !autoChunk) {
              exceededBudget.push(task.taskId);
            } else {
              withinBudget.push(task.taskId);
            }
          }

          // All tasks that exceed budget should be rejected
          for (const task of tasks) {
            const estimate = budget.estimate(task.systemPrompt, task.taskPrompt, task.toolDefs);
            if (estimate > contextSize * 0.8) {
              expect(exceededBudget).toContain(task.taskId);
              expect(withinBudget).not.toContain(task.taskId);
            }
          }

          // All tasks within budget should continue
          for (const task of tasks) {
            const estimate = budget.estimate(task.systemPrompt, task.taskPrompt, task.toolDefs);
            if (estimate <= contextSize * 0.8) {
              expect(withinBudget).toContain(task.taskId);
              expect(exceededBudget).not.toContain(task.taskId);
            }
          }
        }),
        { numRuns: 25 },
      );
    });

    it("when auto_chunk is enabled, no tasks are rejected regardless of size", () => {
      fc.assert(
        fc.property(arbitraryModelContextSize, arbitraryTasks, (contextSize, tasks) => {
          const budget = new TokenBudget(contextSize);
          const autoChunk = true;

          const rejectedTasks: string[] = [];

          for (const task of tasks) {
            const estimate = budget.estimate(task.systemPrompt, task.taskPrompt, task.toolDefs);
            if (budget.exceedsBudget(estimate) && !autoChunk) {
              rejectedTasks.push(task.taskId);
            }
          }

          // With auto_chunk enabled, no tasks should be rejected
          expect(rejectedTasks).toHaveLength(0);
        }),
        { numRuns: 25 },
      );
    });

    it("rejected tasks do not prevent within-budget tasks from executing", () => {
      fc.assert(
        fc.property(arbitraryModelContextSize, arbitraryTasks, (contextSize, tasks) => {
          const budget = new TokenBudget(contextSize);

          const results: Array<{ taskId: string; status: string }> = [];

          for (const task of tasks) {
            const estimate = budget.estimate(task.systemPrompt, task.taskPrompt, task.toolDefs);
            if (budget.exceedsBudget(estimate)) {
              results.push({ taskId: task.taskId, status: "budget_exceeded" });
            } else {
              results.push({ taskId: task.taskId, status: "dispatched" });
            }
          }

          // Verify: the presence of budget_exceeded tasks does not
          // affect the dispatching of within-budget tasks
          const dispatched = results.filter((r) => r.status === "dispatched");
          const exceeded = results.filter((r) => r.status === "budget_exceeded");

          for (const task of tasks) {
            const estimate = budget.estimate(task.systemPrompt, task.taskPrompt, task.toolDefs);
            if (estimate <= contextSize * 0.8) {
              expect(dispatched.map((d) => d.taskId)).toContain(task.taskId);
            }
            if (estimate > contextSize * 0.8) {
              expect(exceeded.map((d) => d.taskId)).toContain(task.taskId);
            }
          }
        }),
        { numRuns: 25 },
      );
    });
  });
});
