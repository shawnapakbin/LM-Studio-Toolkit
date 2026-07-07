/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Feature: blender-mcp-full-integration, Property 2: Invalid inputs are rejected without delegate invocation
 *
 * Generate random invalid inputs (empty strings, strings > maxLength, out-of-range numbers, invalid enum values).
 * Verify all invalid inputs produce non-null error messages.
 * Verify all valid inputs produce null (no error).
 *
 * Validates: Requirements 2.3, 4.3, 5.4, 5.6, 6.4, 7.5, 8.4, 12.7, 12.8
 */

import * as fc from "fast-check";
import {
  validateEnum,
  validateNonWhitespaceParam,
  validateNumericRange,
  validateStringParam,
} from "../src/tools/passthrough/passthrough-helpers";

describe("passthrough-helpers property tests — Property 2: Invalid inputs are rejected without delegate invocation", () => {
  const MAX_LENGTH = 256;

  // --- validateStringParam ---

  describe("validateStringParam", () => {
    /**
     * 1. validateStringParam rejects all empty strings or strings exceeding maxLength.
     * Generate empty string or strings exceeding maxLength. Assert result is non-null error string.
     */
    it("rejects empty strings and strings exceeding maxLength", () => {
      // Generator: either empty string or string longer than maxLength
      const invalidStringArb = fc.oneof(
        fc.constant(""),
        fc.stringOf(fc.char(), { minLength: MAX_LENGTH + 1, maxLength: MAX_LENGTH + 200 }),
      );

      fc.assert(
        fc.property(invalidStringArb, (value) => {
          const result = validateStringParam(value, "testParam", MAX_LENGTH);
          expect(result).not.toBeNull();
          expect(typeof result).toBe("string");
          expect(result!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * 2. validateStringParam accepts valid strings.
     * Generate non-empty strings within maxLength. Assert result is null.
     */
    it("accepts non-empty strings within maxLength", () => {
      const validStringArb = fc.stringOf(fc.char(), {
        minLength: 1,
        maxLength: MAX_LENGTH,
      });

      fc.assert(
        fc.property(validStringArb, (value) => {
          const result = validateStringParam(value, "testParam", MAX_LENGTH);
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });

  // --- validateNonWhitespaceParam ---

  describe("validateNonWhitespaceParam", () => {
    /**
     * 3. validateNonWhitespaceParam rejects whitespace-only strings.
     * Generate whitespace-only strings (spaces, tabs, newlines). Assert result is non-null.
     */
    it("rejects whitespace-only strings", () => {
      const whitespaceArb = fc.oneof(
        fc.constant(""),
        fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r", "\f", "\v"), {
          minLength: 1,
          maxLength: 100,
        }),
      );

      fc.assert(
        fc.property(whitespaceArb, (value) => {
          const result = validateNonWhitespaceParam(value, "testParam");
          expect(result).not.toBeNull();
          expect(typeof result).toBe("string");
          expect(result!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * 4. validateNonWhitespaceParam accepts strings with at least one non-whitespace char.
     * Generate strings with at least one non-whitespace char. Assert result is null.
     */
    it("accepts strings with at least one non-whitespace character", () => {
      // Generate a string that has at least one non-whitespace character
      const nonWhitespaceCharArb = fc.char().filter((c) => c.trim().length > 0);
      const validStringArb = fc
        .tuple(
          fc.stringOf(fc.constantFrom(" ", "\t", "\n"), { minLength: 0, maxLength: 10 }),
          nonWhitespaceCharArb,
          fc.string({ minLength: 0, maxLength: 50 }),
        )
        .map(([prefix, middle, suffix]) => prefix + middle + suffix);

      fc.assert(
        fc.property(validStringArb, (value) => {
          const result = validateNonWhitespaceParam(value, "testParam");
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });

  // --- validateNumericRange ---

  describe("validateNumericRange", () => {
    const MIN = 1;
    const MAX = 100;

    /**
     * 5. validateNumericRange rejects out-of-range values or non-integers.
     * Generate numbers outside [min, max] or non-integers. Assert result is non-null.
     */
    it("rejects out-of-range values and non-integers", () => {
      const outOfRangeArb = fc.oneof(
        // Below min
        fc.integer({ min: -10000, max: MIN - 1 }),
        // Above max
        fc.integer({ min: MAX + 1, max: 10000 }),
        // Non-integer (floating point)
        fc
          .double({ min: MIN, max: MAX, noNaN: true })
          .filter((n) => !Number.isInteger(n)),
      );

      fc.assert(
        fc.property(outOfRangeArb, (value) => {
          const result = validateNumericRange(value, "testParam", MIN, MAX);
          expect(result).not.toBeNull();
          expect(typeof result).toBe("string");
          expect(result!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * 6. validateNumericRange accepts in-range integers.
     * Generate integers within [min, max]. Assert result is null.
     */
    it("accepts integers within [min, max]", () => {
      const validIntArb = fc.integer({ min: MIN, max: MAX });

      fc.assert(
        fc.property(validIntArb, (value) => {
          const result = validateNumericRange(value, "testParam", MIN, MAX);
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });

  // --- validateEnum ---

  describe("validateEnum", () => {
    const ALLOWED_VALUES = ["cube", "sphere", "cylinder", "cone", "torus", "plane"] as const;

    /**
     * 7. validateEnum rejects invalid values.
     * Generate strings not in the allowed set. Assert result is non-null.
     */
    it("rejects strings not in the allowed set", () => {
      const invalidEnumArb = fc
        .string({ minLength: 1, maxLength: 50 })
        .filter((s) => !(ALLOWED_VALUES as readonly string[]).includes(s));

      fc.assert(
        fc.property(invalidEnumArb, (value) => {
          const result = validateEnum(value, "testParam", ALLOWED_VALUES);
          expect(result).not.toBeNull();
          expect(typeof result).toBe("string");
          expect(result!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    /**
     * 8. validateEnum accepts valid values from the allowed set.
     * Pick from the allowed set. Assert result is null.
     */
    it("accepts values from the allowed set", () => {
      const validEnumArb = fc.constantFrom(...ALLOWED_VALUES);

      fc.assert(
        fc.property(validEnumArb, (value) => {
          const result = validateEnum(value, "testParam", ALLOWED_VALUES);
          expect(result).toBeNull();
        }),
        { numRuns: 100 },
      );
    });
  });
});
