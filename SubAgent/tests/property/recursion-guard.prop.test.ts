/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Feature: sub-agent-mcp
// **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 5.3**

import * as fc from "fast-check";
import { RecursionGuard } from "../../src/recursion-guard";

/**
 * Property 4: Recursion Guard Blocks Nested Dispatch
 *
 * For any execution context where dispatch depth >= 1,
 * isBlocked() returns true.
 *
 * **Validates: Requirements 4.1, 4.3**
 */
describe("Property 4: Recursion Guard Blocks Nested Dispatch", () => {
  // Generator for depths >= 1 (blocked territory)
  const blockedDepth = fc.integer({ min: 1, max: 100 });

  it("isBlocked() returns true for any depth >= 1", () => {
    fc.assert(
      fc.property(blockedDepth, (depth) => {
        const guard = new RecursionGuard(depth);
        expect(guard.isBlocked()).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it("isBlocked() returns false only at depth 0", () => {
    const guard = new RecursionGuard(0);
    expect(guard.isBlocked()).toBe(false);
  });

  it("createChildGuard() always produces a blocked guard", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (depth) => {
        const parent = new RecursionGuard(depth);
        const child = parent.createChildGuard();
        // Child is at depth+1 which is always >= 1
        expect(child.isBlocked()).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it("getDepthMessage() contains current depth and max depth for any blocked guard", () => {
    fc.assert(
      fc.property(blockedDepth, (depth) => {
        const guard = new RecursionGuard(depth);
        const message = guard.getDepthMessage();
        expect(message).toContain(String(depth));
        expect(message).toContain("1");
      }),
      { numRuns: 25 },
    );
  });
});

/**
 * Property 5: dispatch_sub_tasks Always Filtered from Sub_Session Tools
 *
 * For any allowed_tools list, getFilteredTools() never includes
 * "dispatch_sub_tasks" while preserving all other tools.
 *
 * **Validates: Requirements 4.5, 5.3**
 */
describe("Property 5: dispatch_sub_tasks Always Filtered from Sub_Session Tools", () => {
  // Generator for arbitrary tool name strings (not "dispatch_sub_tasks")
  const arbitraryToolName = fc
    .string({ minLength: 1, maxLength: 64 })
    .filter((s) => s !== "dispatch_sub_tasks");

  // Generator for tool lists that may or may not include dispatch_sub_tasks
  const arbitraryToolList = fc.array(
    fc.oneof(fc.constant("dispatch_sub_tasks"), arbitraryToolName),
    { minLength: 0, maxLength: 50 },
  );

  it("filtered tools never contain dispatch_sub_tasks regardless of input", () => {
    fc.assert(
      fc.property(arbitraryToolList, fc.integer({ min: 0, max: 100 }), (tools, depth) => {
        const guard = new RecursionGuard(depth);
        const filtered = guard.getFilteredTools(tools);
        expect(filtered).not.toContain("dispatch_sub_tasks");
      }),
      { numRuns: 25 },
    );
  });

  it("all non-dispatch_sub_tasks tools are preserved in their original order", () => {
    fc.assert(
      fc.property(arbitraryToolList, fc.integer({ min: 0, max: 100 }), (tools, depth) => {
        const guard = new RecursionGuard(depth);
        const filtered = guard.getFilteredTools(tools);
        const expected = tools.filter((t) => t !== "dispatch_sub_tasks");
        expect(filtered).toEqual(expected);
      }),
      { numRuns: 25 },
    );
  });

  it("filtered result length equals original length minus dispatch_sub_tasks occurrences", () => {
    fc.assert(
      fc.property(arbitraryToolList, (tools) => {
        const guard = new RecursionGuard(0);
        const filtered = guard.getFilteredTools(tools);
        const dispatchCount = tools.filter((t) => t === "dispatch_sub_tasks").length;
        expect(filtered.length).toBe(tools.length - dispatchCount);
      }),
      { numRuns: 25 },
    );
  });
});

/**
 * Property 6: Recursion Depth Prompt Injection
 *
 * For any system prompt, injectDepthPrompt() appends depth instruction
 * containing both original content and depth message.
 *
 * **Validates: Requirements 4.2**
 */
describe("Property 6: Recursion Depth Prompt Injection", () => {
  // Generator for arbitrary system prompts
  const arbitrarySystemPrompt = fc.string({ minLength: 0, maxLength: 1000 });

  it("injected prompt starts with the original system prompt content", () => {
    fc.assert(
      fc.property(arbitrarySystemPrompt, (prompt) => {
        const guard = new RecursionGuard(1);
        const result = guard.injectDepthPrompt(prompt);
        expect(result.startsWith(prompt)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });

  it("injected prompt contains depth-1 instruction about sub-agent unavailability", () => {
    fc.assert(
      fc.property(arbitrarySystemPrompt, (prompt) => {
        const guard = new RecursionGuard(1);
        const result = guard.injectDepthPrompt(prompt);
        expect(result).toContain("depth 1");
        expect(result).toContain("dispatch_sub_tasks");
      }),
      { numRuns: 25 },
    );
  });

  it("injected prompt is always longer than the original prompt", () => {
    fc.assert(
      fc.property(arbitrarySystemPrompt, (prompt) => {
        const guard = new RecursionGuard(1);
        const result = guard.injectDepthPrompt(prompt);
        expect(result.length).toBeGreaterThan(prompt.length);
      }),
      { numRuns: 25 },
    );
  });

  it("original prompt content is fully preserved (not modified) in the result", () => {
    fc.assert(
      fc.property(arbitrarySystemPrompt, (prompt) => {
        const guard = new RecursionGuard(1);
        const result = guard.injectDepthPrompt(prompt);
        // The original content must appear intact at the start
        expect(result.substring(0, prompt.length)).toBe(prompt);
      }),
      { numRuns: 25 },
    );
  });
});
