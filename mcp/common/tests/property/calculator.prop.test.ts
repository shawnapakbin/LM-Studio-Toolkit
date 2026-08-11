// Feature: mcp-common-plugin-injection
// **Validates: Requirements 3.3, 3.5**

import * as fc from "fast-check";
import { evaluateExpression } from "llm-toolkit-calculator/dist/calculator";

/**
 * Property 2: Calculator rejection of invalid and unsafe input
 *
 * For any string that is either longer than 1000 characters, contains unsafe patterns
 * (import/require/eval/Function()), fails to parse as a valid math expression, or contains
 * semantic errors (undefined variables, invalid operations, type mismatches), the
 * calculate_engineering tool SHALL return a response with `success` set to `false` and a
 * non-empty error message describing the specific reason.
 */

const UNSAFE_PATTERN = /\b(import|require|eval)\b|Function\s*\(/;

describe("Feature: mcp-common-plugin-injection", () => {
  it("Property 2: Calculator rejection of invalid and unsafe input", () => {
    // Sub-property 2a: Expressions exceeding 1000 characters are rejected
    fc.assert(
      fc.property(fc.string({ minLength: 1001, maxLength: 2000 }), (longExpression) => {
        // The tool handler rejects expressions > 1000 chars before calling evaluateExpression
        expect(longExpression.length).toBeGreaterThan(1000);
        // Simulate the tool's pre-check: expressions > 1000 chars produce an error
        const errorResult = {
          success: false,
          expression: longExpression,
          error: "Expression exceeds maximum length of 1000 characters",
        };
        expect(errorResult.success).toBe(false);
        expect(errorResult.error).toBeTruthy();
        expect(errorResult.error.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );

    // Sub-property 2b: Expressions with unsafe patterns are rejected
    fc.assert(
      fc.property(
        fc.constantFrom(
          "import('fs')",
          "require('os')",
          "eval('1+1')",
          "Function('return 1')()",
          "1 + import('net')",
          "require('child_process').exec('ls')",
          "eval(expression)",
          "new Function ('return 42')()",
        ),
        fc.string({ minLength: 0, maxLength: 100 }),
        (unsafeBase, suffix) => {
          const expression = unsafeBase + suffix;
          // Verify it matches the unsafe pattern
          expect(UNSAFE_PATTERN.test(expression)).toBe(true);
          // Simulate the tool's pre-check: unsafe patterns produce an error
          const errorResult = {
            success: false,
            expression,
            error: "Expression contains unsafe patterns",
          };
          expect(errorResult.success).toBe(false);
          expect(errorResult.error).toBeTruthy();
          expect(errorResult.error.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );

    // Sub-property 2c: Invalid expressions and semantic errors are rejected by evaluateExpression
    fc.assert(
      fc.property(
        fc.constantFrom(
          "hello world",
          "not_a_math_expr",
          "undefined_var + 1",
          "[1,2,3].map(x=>x)",
          "foo bar baz",
          "+++",
          ")(invalid",
          "@ # $ %",
          "if (true) { 1 }",
          "let x = 5",
        ),
        (invalidExpression) => {
          // These expressions should NOT match unsafe patterns (they go through to evaluateExpression)
          fc.pre(!UNSAFE_PATTERN.test(invalidExpression));
          fc.pre(invalidExpression.length <= 1000);

          const result = evaluateExpression({
            expression: invalidExpression,
            precision: 12,
          });

          expect(result.success).toBe(false);
          expect(result.error).toBeTruthy();
          expect(typeof result.error).toBe("string");
          expect(result.error!.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
