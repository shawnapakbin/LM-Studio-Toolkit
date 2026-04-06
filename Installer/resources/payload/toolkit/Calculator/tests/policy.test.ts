/**
 * Calculator Policy Tests
 *
 * Unit tests for expression validation and calculation constraints.
 */

import {
  DEFAULT_PRECISION,
  MAX_EXPRESSION_LENGTH,
  MAX_PRECISION,
  MIN_PRECISION,
  hasUnsafePatterns,
  isExpressionTooLong,
  isValidExpression,
  validatePrecision,
} from "../src/policy";

describe("Calculator Policy", () => {
  describe("validatePrecision", () => {
    it("should return valid precision within range", () => {
      expect(validatePrecision(10)).toBe(10);
      expect(validatePrecision(2)).toBe(MIN_PRECISION);
      expect(validatePrecision(20)).toBe(MAX_PRECISION);
    });

    it("should clamp precision to MIN_PRECISION", () => {
      expect(validatePrecision(1)).toBe(MIN_PRECISION);
      expect(validatePrecision(0)).toBe(MIN_PRECISION);
      expect(validatePrecision(-5)).toBe(MIN_PRECISION);
    });

    it("should clamp precision to MAX_PRECISION", () => {
      expect(validatePrecision(25)).toBe(MAX_PRECISION);
      expect(validatePrecision(100)).toBe(MAX_PRECISION);
    });

    it("should use default for invalid values", () => {
      expect(validatePrecision(undefined)).toBe(DEFAULT_PRECISION);
      expect(validatePrecision(Number.NaN)).toBe(DEFAULT_PRECISION);
      expect(validatePrecision(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PRECISION);
    });

    it("should use custom default when provided", () => {
      expect(validatePrecision(undefined, 15)).toBe(15);
      expect(validatePrecision(Number.NaN, 8)).toBe(8);
    });

    it("should truncate decimal precision values", () => {
      expect(validatePrecision(10.7)).toBe(10);
      expect(validatePrecision(15.2)).toBe(15);
    });
  });

  describe("isValidExpression", () => {
    it("should accept valid expressions", () => {
      expect(isValidExpression("2 + 2")).toBe(true);
      expect(isValidExpression("sin(30°)")).toBe(true);
      expect(isValidExpression("  sqrt(16)  ")).toBe(true);
    });

    it("should reject empty expressions", () => {
      expect(isValidExpression("")).toBe(false);
      expect(isValidExpression("   ")).toBe(false);
      expect(isValidExpression(undefined)).toBe(false);
    });

    it("should reject non-string inputs", () => {
      expect(isValidExpression(null as unknown as string)).toBe(false);
      expect(isValidExpression(123 as unknown as string)).toBe(false);
      expect(isValidExpression({} as unknown as string)).toBe(false);
    });
  });

  describe("isExpressionTooLong", () => {
    it("should accept expressions under limit", () => {
      expect(isExpressionTooLong("2 + 2")).toBe(false);
      expect(isExpressionTooLong("a".repeat(MAX_EXPRESSION_LENGTH))).toBe(false);
    });

    it("should reject expressions over limit", () => {
      expect(isExpressionTooLong("a".repeat(MAX_EXPRESSION_LENGTH + 1))).toBe(true);
      expect(isExpressionTooLong("a".repeat(2000))).toBe(true);
    });
  });

  describe("hasUnsafePatterns", () => {
    it("should accept safe mathematical expressions", () => {
      expect(hasUnsafePatterns("2 + 2")).toBe(false);
      expect(hasUnsafePatterns("sin(pi/4)")).toBe(false);
      expect(hasUnsafePatterns("sqrt(16) * log(10)")).toBe(false);
      expect(hasUnsafePatterns("10 Ω * 2 A")).toBe(false);
    });

    it("should reject expressions with import", () => {
      expect(hasUnsafePatterns("import fs")).toBe(true);
      expect(hasUnsafePatterns("import fs from 'fs'")).toBe(true);
    });

    it("should reject expressions with require", () => {
      expect(hasUnsafePatterns("require('fs')")).toBe(true);
      expect(hasUnsafePatterns("const x = require('./module')")).toBe(true);
    });

    it("should reject expressions with eval", () => {
      expect(hasUnsafePatterns("eval('2 + 2')")).toBe(true);
      expect(hasUnsafePatterns("window.eval('code')")).toBe(true);
    });

    it("should reject expressions with function", () => {
      expect(hasUnsafePatterns("function() { return 1; }")).toBe(true);
      expect(hasUnsafePatterns("function (x) { return x; }")).toBe(true);
    });

    it("should reject expressions with arrow functions", () => {
      expect(hasUnsafePatterns("() => 42")).toBe(true);
      expect(hasUnsafePatterns("x => x * 2")).toBe(true);
    });

    it("should reject expressions with 'this' keyword", () => {
      expect(hasUnsafePatterns("this.value")).toBe(true);
      expect(hasUnsafePatterns("return this")).toBe(true);
    });
  });
});
