/**
 * Calculator Policy Module
 *
 * Validates expressions and enforces calculation constraints.
 */

/**
 * Maximum allowed precision for calculations.
 */
export const MAX_PRECISION = 20;

/**
 * Default precision when none is specified.
 */
export const DEFAULT_PRECISION = 12;

/**
 * Minimum allowed precision for calculations.
 */
export const MIN_PRECISION = 2;

/**
 * Validates precision value and clamps it within allowed range.
 *
 * @param precision - The requested precision value
 * @param defaultPrecision - The default precision to use for invalid values
 * @returns A valid precision value within [MIN_PRECISION, MAX_PRECISION]
 */
export function validatePrecision(
  precision: number | undefined,
  defaultPrecision: number = DEFAULT_PRECISION,
): number {
  const precisionValue = Number(precision ?? defaultPrecision);

  if (!Number.isFinite(precisionValue)) {
    return defaultPrecision;
  }

  return Math.min(Math.max(Math.trunc(precisionValue), MIN_PRECISION), MAX_PRECISION);
}

/**
 * Checks if an expression is empty or invalid.
 *
 * @param expression - The expression to validate
 * @returns true if the expression is valid (non-empty after trimming)
 */
export function isValidExpression(expression: string | undefined): boolean {
  return typeof expression === "string" && expression.trim().length > 0;
}

/**
 * Maximum allowed expression length to prevent DoS attacks.
 */
export const MAX_EXPRESSION_LENGTH = 1000;

/**
 * Checks if an expression exceeds maximum allowed length.
 *
 * @param expression - The expression to check
 * @returns true if the expression is too long
 */
export function isExpressionTooLong(expression: string): boolean {
  return expression.length > MAX_EXPRESSION_LENGTH;
}

/**
 * Patterns that might indicate unsafe operations.
 * Currently, math.js has limited side effects, but this provides a safety layer.
 */
const POTENTIALLY_UNSAFE_PATTERNS = [
  /import\s+/i,
  /require\s*\(/i,
  /eval\s*\(/i,
  /function\s*\(/i,
  /=>/, // Arrow functions
  /\bthis\b/,
];

/**
 * Checks if an expression contains potentially unsafe patterns.
 *
 * @param expression - The expression to check
 * @returns true if the expression contains unsafe patterns
 */
export function hasUnsafePatterns(expression: string): boolean {
  return POTENTIALLY_UNSAFE_PATTERNS.some((pattern) => pattern.test(expression));
}
