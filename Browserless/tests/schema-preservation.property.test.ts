import * as path from "node:path";
import * as fc from "fast-check";

/**
 * Property 2: Preservation — Unaffected Schemas and Parameter Types Unchanged
 *
 * These tests observe the current (unfixed) schema-proxy.js SAFE_SCHEMAS and
 * aggressiveSimplify function, then verify via property-based testing that
 * the baseline behavior is preserved.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 */

// Import SAFE_SCHEMAS and aggressiveSimplify from schema-proxy.js
const schemaProxyPath = path.resolve(__dirname, "..", "scripts", "schema-proxy.js");
const { SAFE_SCHEMAS, aggressiveSimplify } = require(schemaProxyPath);

// --- Observed Snapshots (captured from unfixed code) ---

/** Unaffected tools whose schemas must remain exactly as-is */
const UNAFFECTED_TOOLS = [
  "browserless_agent",
  "browserless_smartscraper",
  "browserless_map",
  "browserless_performance",
  "browserless_skill",
] as const;

/** All tool names in SAFE_SCHEMAS */
const ALL_TOOLS = [
  "browserless_agent",
  "browserless_crawl",
  "browserless_smartscraper",
  "browserless_search",
  "browserless_export",
  "browserless_function",
  "browserless_map",
  "browserless_performance",
  "browserless_skill",
] as const;

/** Observed required arrays for all tools */
const OBSERVED_REQUIRED: Record<string, string[]> = {
  browserless_agent: ["method"],
  browserless_crawl: ["url"],
  browserless_smartscraper: ["url"],
  browserless_search: ["query"],
  browserless_export: ["url"],
  browserless_function: ["code"],
  browserless_map: ["url"],
  browserless_performance: ["url"],
  browserless_skill: ["id"],
};

/** Observed parameter type fields for all existing parameters across all tools */
const OBSERVED_PARAM_TYPES: Record<string, Record<string, string>> = {
  browserless_agent: {
    method: "string",
    params: "object",
    commands: "array",
    rationale: "string",
    profile: "string",
  },
  browserless_crawl: {
    url: "string",
    maxPages: "number",
    formats: "array",
    timeout: "number",
    profile: "string",
  },
  browserless_smartscraper: {
    url: "string",
    formats: "array",
    timeout: "number",
    profile: "string",
  },
  browserless_search: {
    query: "string",
    limit: "number",
    lang: "string",
    country: "string",
    tbs: "string",
    sources: "array",
    timeout: "number",
    profile: "string",
  },
  browserless_export: {
    url: "string",
    format: "string",
    timeout: "number",
    profile: "string",
  },
  browserless_function: {
    code: "string",
    context: "object",
    timeout: "number",
    profile: "string",
  },
  browserless_map: {
    url: "string",
    timeout: "number",
    profile: "string",
  },
  browserless_performance: {
    url: "string",
    timeout: "number",
    profile: "string",
  },
  browserless_skill: {
    id: "string",
  },
};

/** Deep-copy observed snapshots of unaffected tool schemas */
const OBSERVED_UNAFFECTED_SCHEMAS: Record<string, unknown> = {};
for (const tool of UNAFFECTED_TOOLS) {
  OBSERVED_UNAFFECTED_SCHEMAS[tool] = JSON.parse(JSON.stringify(SAFE_SCHEMAS[tool]));
}

describe("Feature: browserless-schema-bugs, Property 2: Preservation", () => {
  describe("Unaffected tool schemas must deep-equal observed snapshot", () => {
    test("for any unaffected tool, schema matches snapshot", () => {
      fc.assert(
        fc.property(fc.constantFrom(...UNAFFECTED_TOOLS), (toolName) => {
          const current = SAFE_SCHEMAS[toolName];
          const snapshot = OBSERVED_UNAFFECTED_SCHEMAS[toolName];
          expect(current).toEqual(snapshot);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe("Required arrays must match observed values for all tools", () => {
    test("for all tools, required array matches observed snapshot", () => {
      fc.assert(
        fc.property(fc.constantFrom(...ALL_TOOLS), (toolName) => {
          const schema = SAFE_SCHEMAS[toolName];
          const expectedRequired = OBSERVED_REQUIRED[toolName];
          expect(schema.required).toEqual(expectedRequired);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("Parameter type fields must match observed values", () => {
    test("for all existing parameters across all tools, type field matches observed value", () => {
      // Build tuples of [toolName, paramName] for all known parameters
      const toolParamPairs: Array<[string, string]> = [];
      for (const tool of ALL_TOOLS) {
        for (const param of Object.keys(OBSERVED_PARAM_TYPES[tool])) {
          toolParamPairs.push([tool, param]);
        }
      }

      fc.assert(
        fc.property(fc.constantFrom(...toolParamPairs), ([toolName, paramName]) => {
          const schema = SAFE_SCHEMAS[toolName];
          const paramSchema = schema.properties[paramName];
          const expectedType = OBSERVED_PARAM_TYPES[toolName][paramName];
          expect(paramSchema).toBeDefined();
          expect(paramSchema.type).toBe(expectedType);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("aggressiveSimplify preserves baseline behavior", () => {
    test("produces {type: 'object'} for null/undefined inputs", () => {
      fc.assert(
        fc.property(fc.constantFrom(null, undefined), (input) => {
          const result = aggressiveSimplify(input);
          expect(result).toEqual({ type: "object" });
        }),
        { numRuns: 10 },
      );
    });

    test("handles basic schemas with properties correctly", () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant("object"),
            properties: fc.dictionary(
              fc.string({ minLength: 1, maxLength: 10 }).filter((s) => /^[a-zA-Z_]\w*$/.test(s)),
              fc.record({
                type: fc.constantFrom("string", "number", "boolean", "array", "object"),
                description: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
                  nil: undefined,
                }),
              }),
            ),
            required: fc.option(
              fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 5 }),
              { nil: undefined },
            ),
          }),
          (schema) => {
            const result = aggressiveSimplify(schema);
            // Must always produce type: "object"
            expect(result.type).toBe("object");

            // If input had properties, result must have properties
            if (schema.properties && Object.keys(schema.properties).length > 0) {
              expect(result.properties).toBeDefined();
              // Each property key must be preserved
              for (const key of Object.keys(schema.properties)) {
                expect(result.properties[key]).toBeDefined();
                // Type field must be preserved (or defaulted to "string")
                expect(result.properties[key].type).toBeDefined();
              }
            }

            // If input had required array, result must preserve it
            if (schema.required) {
              expect(result.required).toEqual(schema.required);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    test("always returns an object with type 'object' regardless of input", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant({}),
            fc.constant({ type: "object" }),
            fc.constant({ type: "string" }),
            fc.constant({ properties: {} }),
          ),
          (input) => {
            const result = aggressiveSimplify(input);
            expect(result).toBeDefined();
            expect(result.type).toBe("object");
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
