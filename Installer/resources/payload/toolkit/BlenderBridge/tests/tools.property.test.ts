/**
 * Feature: blender-mcp-integration, Property 5: Invalid create-object parameters are rejected without code generation
 * Feature: blender-mcp-integration, Property 6: Execution errors always produce structured responses with traceback
 *
 * Validates: Requirements 4.2, 4.5
 */

import * as fc from "fast-check";
import { validateCreateObjectInput } from "../src/tools/create-object.tool";
import { formatExecutionError } from "../src/blender-client";

/** The 9 allowed geometry types. */
const VALID_GEOMETRY_TYPES = [
  "cube",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "circle",
  "curve",
  "empty",
];

/** Characters allowed in valid names. */
const VALID_NAME_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

/** Characters NOT allowed in names. */
const INVALID_NAME_CHARS = "!@#$%^&*()-+=[]{}|;:',.<>?/`~ \t\n\"\\";

describe("tools property tests", () => {
  /**
   * Feature: blender-mcp-integration, Property 5: Invalid create-object parameters are rejected without code generation
   *
   * Validates: Requirements 4.2
   */
  describe("Property 5: Invalid create-object parameters are rejected without code generation", () => {
    // --- Generators for valid base inputs (used to construct partially-invalid inputs) ---

    const validNameArb = fc.stringOf(
      fc.constantFrom(...VALID_NAME_CHARS.split("")),
      { minLength: 1, maxLength: 63 }
    );

    const validGeometryTypeArb = fc.constantFrom(...VALID_GEOMETRY_TYPES);

    const validFloatTripleArb = fc.tuple(
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.double({ noNaN: true, noDefaultInfinity: true })
    );

    const validScaleTripleArb = fc.tuple(
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true })
    );

    // --- Generators for invalid inputs ---

    // Names that are too long (64+ chars)
    const tooLongNameArb = fc.stringOf(
      fc.constantFrom(...VALID_NAME_CHARS.split("")),
      { minLength: 64, maxLength: 200 }
    );

    // Names containing invalid characters
    const nameWithInvalidCharsArb = fc.tuple(
      fc.stringOf(
        fc.constantFrom(...VALID_NAME_CHARS.split("")),
        { minLength: 0, maxLength: 30 }
      ),
      fc.stringOf(
        fc.constantFrom(...INVALID_NAME_CHARS.split("")),
        { minLength: 1, maxLength: 5 }
      ),
      fc.stringOf(
        fc.constantFrom(...VALID_NAME_CHARS.split("")),
        { minLength: 0, maxLength: 30 }
      )
    ).map(([prefix, invalid, suffix]) => prefix + invalid + suffix);

    // Invalid geometry types (random strings not in allowed set)
    const invalidGeometryTypeArb = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => !VALID_GEOMETRY_TYPES.includes(s));

    // Float triples with NaN values
    const tripleWithNaNArb = fc.tuple(
      fc.constantFrom(0, 1, 2),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.double({ noNaN: true, noDefaultInfinity: true })
    ).map(([nanIndex, a, b]) => {
      const arr: [number, number, number] = [a, b, a];
      arr[nanIndex] = NaN;
      return arr;
    });

    // Float triples with Infinity values
    const tripleWithInfinityArb = fc.tuple(
      fc.constantFrom(0, 1, 2),
      fc.constantFrom(Infinity, -Infinity),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.double({ noNaN: true, noDefaultInfinity: true })
    ).map(([infIndex, infValue, a, b]) => {
      const arr: [number, number, number] = [a, b, a];
      arr[infIndex as number] = infValue;
      return arr;
    });

    // Scale triples with zero or negative values
    const scaleWithNonPositiveArb = fc.tuple(
      fc.constantFrom(0, 1, 2),
      fc.oneof(
        fc.constant(0),
        fc.double({ min: -1e10, max: 0, noNaN: true, noDefaultInfinity: true }).filter((v) => v <= 0)
      ),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true })
    ).map(([badIndex, badValue, a, b]) => {
      const arr: [number, number, number] = [a, b, a];
      arr[badIndex as number] = badValue;
      return arr;
    });

    // Scale triples with NaN
    const scaleWithNaNArb = fc.tuple(
      fc.constantFrom(0, 1, 2),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true })
    ).map(([nanIndex, a, b]) => {
      const arr: [number, number, number] = [a, b, a];
      arr[nanIndex as number] = NaN;
      return arr;
    });

    // Scale triples with Infinity
    const scaleWithInfinityArb = fc.tuple(
      fc.constantFrom(0, 1, 2),
      fc.constantFrom(Infinity, -Infinity),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true })
    ).map(([infIndex, infValue, a, b]) => {
      const arr: [number, number, number] = [a, b, a];
      arr[infIndex as number] = infValue;
      return arr;
    });

    // --- Property Tests ---

    it("rejects names exceeding 63 characters", () => {
      fc.assert(
        fc.property(
          tooLongNameArb,
          validGeometryTypeArb,
          (name, geometryType) => {
            const result = validateCreateObjectInput({ name, geometryType });
            expect(result).not.toBeNull();
            expect(result).toContain("name");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects names with characters outside [a-zA-Z0-9_]", () => {
      fc.assert(
        fc.property(
          nameWithInvalidCharsArb,
          validGeometryTypeArb,
          (name, geometryType) => {
            const result = validateCreateObjectInput({ name, geometryType });
            expect(result).not.toBeNull();
            expect(result).toContain("name");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects empty string names", () => {
      fc.assert(
        fc.property(validGeometryTypeArb, (geometryType) => {
          const result = validateCreateObjectInput({ name: "", geometryType });
          expect(result).not.toBeNull();
          expect(result).toContain("name");
        }),
        { numRuns: 100 }
      );
    });

    it("rejects geometry types not in the allowed set", () => {
      fc.assert(
        fc.property(
          validNameArb,
          invalidGeometryTypeArb,
          (name, geometryType) => {
            const result = validateCreateObjectInput({ name, geometryType });
            expect(result).not.toBeNull();
            expect(result).toContain("geometryType");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects location arrays containing NaN", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          tripleWithNaNArb,
          (name, geometryType, location) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              location,
            });
            expect(result).not.toBeNull();
            expect(result).toContain("location");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects location arrays containing Infinity", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          tripleWithInfinityArb,
          (name, geometryType, location) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              location,
            });
            expect(result).not.toBeNull();
            expect(result).toContain("location");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects rotation arrays containing NaN", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          tripleWithNaNArb,
          (name, geometryType, rotation) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              rotation,
            });
            expect(result).not.toBeNull();
            expect(result).toContain("rotation");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects rotation arrays containing Infinity", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          tripleWithInfinityArb,
          (name, geometryType, rotation) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              rotation,
            });
            expect(result).not.toBeNull();
            expect(result).toContain("rotation");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects scale arrays with zero or negative values", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          scaleWithNonPositiveArb,
          (name, geometryType, scale) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              scale,
            });
            expect(result).not.toBeNull();
            expect(result).toContain("scale");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects scale arrays containing NaN", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          scaleWithNaNArb,
          (name, geometryType, scale) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              scale,
            });
            expect(result).not.toBeNull();
            expect(result).toContain("scale");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("rejects scale arrays containing Infinity", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          scaleWithInfinityArb,
          (name, geometryType, scale) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              scale,
            });
            expect(result).not.toBeNull();
            expect(result).toContain("scale");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("returns null for valid inputs (sanity check)", () => {
      fc.assert(
        fc.property(
          validNameArb,
          validGeometryTypeArb,
          validFloatTripleArb,
          validFloatTripleArb,
          validScaleTripleArb,
          (name, geometryType, location, rotation, scale) => {
            const result = validateCreateObjectInput({
              name,
              geometryType,
              location,
              rotation,
              scale,
            });
            expect(result).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: blender-mcp-integration, Property 6: Execution errors always produce structured responses with traceback
   *
   * For any Blender execution error containing a traceback string and error message,
   * the orchestration tool error response SHALL include both the original traceback text
   * and a non-empty human-readable suggestion string in the structured error format.
   *
   * Validates: Requirements 4.5
   */
  describe("Property 6: Execution errors always produce structured responses with traceback", () => {
    /** Common Python error types that might appear in Blender tracebacks. */
    const PYTHON_ERROR_TYPES = [
      "ModuleNotFoundError",
      "AttributeError",
      "TypeError",
      "NameError",
      "RuntimeError",
      "ValueError",
      "KeyError",
      "IndexError",
      "ImportError",
      "SyntaxError",
      "OSError",
      "FileNotFoundError",
      "ZeroDivisionError",
      "StopIteration",
      "PermissionError",
    ];

    /** Generator: random Python file path */
    const pythonFilePathArb = fc
      .array(
        fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz_".split("")), {
          minLength: 1,
          maxLength: 10,
        }),
        { minLength: 1, maxLength: 4 }
      )
      .map((parts) => `/usr/lib/python3.11/${parts.join("/")}.py`);

    /** Generator: random line number */
    const lineNumberArb = fc.integer({ min: 1, max: 9999 });

    /** Generator: a random Python traceback frame */
    const tracebackFrameArb = fc
      .tuple(
        pythonFilePathArb,
        lineNumberArb,
        fc.constantFrom("in <module>", "in execute", "in run_code", "in main")
      )
      .map(
        ([file, line, context]) =>
          `  File "${file}", line ${line}, ${context}\n    some_function_call()`
      );

    /** Generator: a random Python error type */
    const errorTypeArb = fc.constantFrom(...PYTHON_ERROR_TYPES);

    /** Generator: a random error detail message */
    const errorDetailArb = fc.stringOf(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.'\"()[]{}".split("")
      ),
      { minLength: 1, maxLength: 80 }
    );

    /** Generator: a full Python traceback string */
    const tracebackArb = fc
      .tuple(
        fc.array(tracebackFrameArb, { minLength: 1, maxLength: 5 }),
        errorTypeArb,
        errorDetailArb
      )
      .map(([frames, errorType, detail]) => {
        const header = "Traceback (most recent call last):";
        const body = frames.join("\n");
        const errorLine = `${errorType}: ${detail}`;
        return `${header}\n${body}\n${errorLine}`;
      });

    /** Generator: optional prefix text before the traceback */
    const prefixArb = fc.oneof(
      fc.constant(""),
      fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz :".split("")), {
        minLength: 1,
        maxLength: 40,
      }).map((s) => s + "\n")
    );

    /** Generator: a full error message containing a traceback */
    const errorMessageWithTracebackArb = fc
      .tuple(prefixArb, tracebackArb)
      .map(([prefix, traceback]) => prefix + traceback);

    it("result.success is false for any error with traceback", () => {
      fc.assert(
        fc.property(errorMessageWithTracebackArb, (errorMsg) => {
          const error = new Error(errorMsg);
          const result = formatExecutionError(error);
          expect(result.success).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("result.error is defined for any error with traceback", () => {
      fc.assert(
        fc.property(errorMessageWithTracebackArb, (errorMsg) => {
          const error = new Error(errorMsg);
          const result = formatExecutionError(error);
          expect(result.error).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    it("result.error.traceback contains the original traceback text", () => {
      fc.assert(
        fc.property(
          fc.tuple(prefixArb, tracebackArb),
          ([prefix, traceback]) => {
            const errorMsg = prefix + traceback;
            const error = new Error(errorMsg);
            const result = formatExecutionError(error);

            // The traceback field must contain the full traceback starting from "Traceback..."
            expect(result.error!.traceback).toBeDefined();
            expect(result.error!.traceback).toContain(
              "Traceback (most recent call last):"
            );
            // The extracted traceback should equal the original traceback
            expect(result.error!.traceback).toBe(traceback);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("result.error.suggestion is a non-empty string", () => {
      fc.assert(
        fc.property(errorMessageWithTracebackArb, (errorMsg) => {
          const error = new Error(errorMsg);
          const result = formatExecutionError(error);
          expect(typeof result.error!.suggestion).toBe("string");
          expect(result.error!.suggestion!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it("result.error.message is a non-empty string", () => {
      fc.assert(
        fc.property(errorMessageWithTracebackArb, (errorMsg) => {
          const error = new Error(errorMsg);
          const result = formatExecutionError(error);
          expect(typeof result.error!.message).toBe("string");
          expect(result.error!.message.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it("works with string errors (non-Error objects)", () => {
      fc.assert(
        fc.property(errorMessageWithTracebackArb, (errorMsg) => {
          // Pass a raw string instead of an Error object
          const result = formatExecutionError(errorMsg);
          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.traceback).toBeDefined();
          expect(result.error!.traceback).toContain(
            "Traceback (most recent call last):"
          );
          expect(result.error!.suggestion).toBeDefined();
          expect(result.error!.suggestion!.length).toBeGreaterThan(0);
          expect(result.error!.message.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it("result.error.traceback preserves the full traceback content from the error", () => {
      fc.assert(
        fc.property(
          fc.tuple(prefixArb, tracebackArb),
          ([prefix, traceback]) => {
            const errorMsg = prefix + traceback;
            const error = new Error(errorMsg);
            const result = formatExecutionError(error);

            // The traceback field should equal the original traceback
            // (formatExecutionError extracts from "Traceback..." onwards)
            expect(result.error!.traceback).toBe(traceback);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
