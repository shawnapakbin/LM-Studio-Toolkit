// Feature: 3dtool-viewer-improvements, Property 15: Text Truncation
// **Validates: Requirements 9.2, 9.3**

import * as fc from "fast-check";
import { truncateText } from "../../src/text-utils";

/**
 * Property 15: Text Truncation
 *
 * For any string and a maximum length N, the truncation function SHALL return
 * the full string if its length ≤ N, or the first N characters followed by "…"
 * if its length > N.
 */

// Generator for arbitrary strings (0-200 characters)
const arbitraryText = fc.string({ minLength: 0, maxLength: 200 });

// Generator for max lengths (1-100)
const arbitraryMaxLength = fc.integer({ min: 1, max: 100 });

describe("Property 15: Text Truncation", () => {
  it("returns the full string when text length ≤ maxLength", () => {
    fc.assert(
      fc.property(arbitraryMaxLength, (maxLength) => {
        // Generate a string that is at most maxLength characters
        const text = "a".repeat(fc.sample(fc.integer({ min: 0, max: maxLength }), 1)[0]);
        const result = truncateText(text, maxLength);

        expect(result).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it("returns truncated string with ellipsis when text length > maxLength", () => {
    fc.assert(
      fc.property(arbitraryText, arbitraryMaxLength, (text, maxLength) => {
        fc.pre(text.length > maxLength);

        const result = truncateText(text, maxLength);

        expect(result).toBe(text.substring(0, maxLength) + "\u2026");
      }),
      { numRuns: 100 },
    );
  });

  it("result length is always ≤ maxLength + 1 (accounting for ellipsis character)", () => {
    fc.assert(
      fc.property(arbitraryText, arbitraryMaxLength, (text, maxLength) => {
        const result = truncateText(text, maxLength);

        // Result should never exceed maxLength + 1 (the +1 for the ellipsis "…")
        expect(result.length).toBeLessThanOrEqual(maxLength + 1);
      }),
      { numRuns: 100 },
    );
  });

  it("for any string and maxLength, either returns the original or first N chars + ellipsis", () => {
    fc.assert(
      fc.property(arbitraryText, arbitraryMaxLength, (text, maxLength) => {
        const result = truncateText(text, maxLength);

        if (text.length <= maxLength) {
          // Must return the full original string
          expect(result).toBe(text);
        } else {
          // Must return first N characters + ellipsis
          expect(result).toBe(text.substring(0, maxLength) + "\u2026");
        }
      }),
      { numRuns: 100 },
    );
  });
});
