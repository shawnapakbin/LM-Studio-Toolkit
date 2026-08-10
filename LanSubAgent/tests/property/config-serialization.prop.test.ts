/**
 * Property-based tests for config serialization (Property 1) and endpoint validation (Property 2).
 *
 * Property 1: Configuration serialization round-trip.
 * - Generate arbitrary valid LanSubAgentConfig objects.
 * - Assert: JSON.parse(JSON.stringify(config, null, 2)) deeply equals original.
 * Validates: Requirements 8.3, 1.1, 1.3
 *
 * Property 2: Endpoint validation preserves valid entries and discards invalid.
 * - Generate arrays of endpoint-like objects with arbitrary host/port values.
 * - Assert: validation returns exactly the subset with non-empty host and port in [1, 65535].
 * - Assert: validation never throws regardless of input.
 * Validates: Requirements 1.5, 4.3
 *
 * @tag Feature: lan-sub-agent, Property 1: Configuration serialization round-trip
 * @tag Feature: lan-sub-agent, Property 2: Endpoint validation preserves valid entries and discards invalid
 */

import * as fc from "fast-check";
import type { LanSubAgentConfig, LoadBalancerStrategy } from "../../src/config-schema";
import { validateEndpoints } from "../../src/validation";

// ─── Property 1: Configuration Serialization Round-Trip ──────────────────────

/** Arbitrary for a valid LoadBalancerStrategy */
const strategyArb: fc.Arbitrary<LoadBalancerStrategy> = fc.constantFrom(
  "round-robin" as const,
  "least-connections" as const,
  "weighted" as const,
);

/** Arbitrary for a valid EndpointDefinition within config */
const configEndpointArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  host: fc.stringOf(fc.char(), { minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  port: fc.integer({ min: 1, max: 65535 }),
  models: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 10 }),
  maxConcurrency: fc.integer({ min: 1, max: 100 }),
  enabled: fc.boolean(),
  source: fc.constantFrom("manual" as const, "discovered" as const),
});

/** Arbitrary for a valid LanSubAgentConfig */
const lanSubAgentConfigArb: fc.Arbitrary<LanSubAgentConfig> = fc.record({
  endpoints: fc.array(configEndpointArb, { minLength: 0, maxLength: 10 }),
  loadBalancer: fc.record({
    strategy: strategyArb,
    retryLimit: fc.integer({ min: 0, max: 5 }),
  }),
  healthCheck: fc.record({
    intervalSeconds: fc.integer({ min: 5, max: 300 }),
    timeoutMs: fc.integer({ min: 1000, max: 30000 }),
    failureThreshold: fc.integer({ min: 1, max: 10 }),
  }),
  discovery: fc.record({
    enabled: fc.boolean(),
    intervalSeconds: fc.integer({ min: 10, max: 300 }),
    broadcastPort: fc.integer({ min: 1, max: 65535 }),
    maxDiscovered: fc.integer({ min: 1, max: 200 }),
  }),
  localInstance: fc.record({
    host: fc
      .stringOf(fc.char(), { minLength: 1, maxLength: 50 })
      .filter((s) => s.trim().length > 0),
    port: fc.integer({ min: 1, max: 65535 }),
  }),
  gui: fc.record({
    port: fc.integer({ min: 1, max: 65535 }),
    enabled: fc.boolean(),
  }),
});

describe("Feature: lan-sub-agent, Property 1: Configuration serialization round-trip", () => {
  /**
   * **Validates: Requirements 8.3, 1.1, 1.3**
   *
   * For any valid LanSubAgentConfig object, serializing to JSON with
   * JSON.stringify(config, null, 2) and parsing with JSON.parse SHALL
   * produce a deeply equal object.
   */
  it("serializing then parsing any valid LanSubAgentConfig produces a deeply equal object", () => {
    fc.assert(
      fc.property(lanSubAgentConfigArb, (config) => {
        const serialized = JSON.stringify(config, null, 2);
        const deserialized = JSON.parse(serialized);

        expect(deserialized).toEqual(config);
      }),
      { numRuns: 100 },
    );
  });

  it("serialized output is valid JSON (parseable without error)", () => {
    fc.assert(
      fc.property(lanSubAgentConfigArb, (config) => {
        const serialized = JSON.stringify(config, null, 2);

        expect(() => JSON.parse(serialized)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it("round-trip preserves all endpoint definitions exactly", () => {
    fc.assert(
      fc.property(lanSubAgentConfigArb, (config) => {
        const serialized = JSON.stringify(config, null, 2);
        const deserialized = JSON.parse(serialized) as LanSubAgentConfig;

        expect(deserialized.endpoints.length).toBe(config.endpoints.length);
        for (let i = 0; i < config.endpoints.length; i++) {
          expect(deserialized.endpoints[i].id).toBe(config.endpoints[i].id);
          expect(deserialized.endpoints[i].host).toBe(config.endpoints[i].host);
          expect(deserialized.endpoints[i].port).toBe(config.endpoints[i].port);
          expect(deserialized.endpoints[i].models).toEqual(config.endpoints[i].models);
          expect(deserialized.endpoints[i].maxConcurrency).toBe(config.endpoints[i].maxConcurrency);
          expect(deserialized.endpoints[i].enabled).toBe(config.endpoints[i].enabled);
          expect(deserialized.endpoints[i].source).toBe(config.endpoints[i].source);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("round-trip preserves all config sections", () => {
    fc.assert(
      fc.property(lanSubAgentConfigArb, (config) => {
        const serialized = JSON.stringify(config, null, 2);
        const deserialized = JSON.parse(serialized) as LanSubAgentConfig;

        expect(deserialized.loadBalancer).toEqual(config.loadBalancer);
        expect(deserialized.healthCheck).toEqual(config.healthCheck);
        expect(deserialized.discovery).toEqual(config.discovery);
        expect(deserialized.localInstance).toEqual(config.localInstance);
        expect(deserialized.gui).toEqual(config.gui);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for a valid host (non-empty string) */
const validHost = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a valid port (integer 1–65535) */
const validPort = fc.integer({ min: 1, max: 65535 });

/** Arbitrary for a valid models array (0–50 entries) */
const validModels = fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
  minLength: 0,
  maxLength: 50,
});

/** Arbitrary for a valid maxConcurrency (integer 1–100) */
const validMaxConcurrency = fc.integer({ min: 1, max: 100 });

/** Arbitrary for a fully valid endpoint-like object */
const validEndpointArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  host: validHost,
  port: validPort,
  models: validModels,
  maxConcurrency: validMaxConcurrency,
  enabled: fc.boolean(),
  source: fc.constantFrom("manual" as const, "discovered" as const),
});

/** Arbitrary for an invalid host (empty string or non-string) */
const invalidHost = fc.oneof(
  fc.constant(""),
  fc.constant("   "), // whitespace-only
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.constant([]),
);

/** Arbitrary for an invalid port (outside 1–65535 or non-integer) */
const invalidPort = fc.oneof(
  fc.constant(0),
  fc.constant(-1),
  fc.constant(65536),
  fc.constant(99999),
  fc.double(), // floating point
  fc.constant(null),
  fc.constant(undefined),
  fc.constant("1234"), // string port
  fc.constant(NaN),
);

/** Arbitrary for an endpoint-like object with an invalid host */
const endpointWithInvalidHost = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  host: invalidHost,
  port: validPort,
  models: validModels,
  maxConcurrency: validMaxConcurrency,
  enabled: fc.boolean(),
  source: fc.constantFrom("manual" as const, "discovered" as const),
});

/** Arbitrary for an endpoint-like object with an invalid port */
const endpointWithInvalidPort = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  host: validHost,
  port: invalidPort,
  models: validModels,
  maxConcurrency: validMaxConcurrency,
  enabled: fc.boolean(),
  source: fc.constantFrom("manual" as const, "discovered" as const),
});

/** Arbitrary for completely arbitrary values (to test never-throws) */
const arbitraryValue = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.constant([]),
  fc.constant({}),
  fc.record({
    host: fc.anything(),
    port: fc.anything(),
    models: fc.anything(),
    maxConcurrency: fc.anything(),
  }),
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 2: Endpoint validation preserves valid entries and discards invalid", () => {
  it("valid endpoints are always preserved in the result", () => {
    fc.assert(
      fc.property(fc.array(validEndpointArb, { minLength: 0, maxLength: 20 }), (endpoints) => {
        const result = validateEndpoints(endpoints);

        // Every valid endpoint should appear in the valid array
        expect(result.valid.length).toBe(endpoints.length);
        expect(result.errors.length).toBe(0);

        // Each valid result should match the input
        for (let i = 0; i < endpoints.length; i++) {
          expect(result.valid[i].host).toBe(endpoints[i].host);
          expect(result.valid[i].port).toBe(endpoints[i].port);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("endpoints with invalid host are always discarded", () => {
    fc.assert(
      fc.property(
        fc.array(endpointWithInvalidHost, { minLength: 1, maxLength: 10 }),
        (endpoints) => {
          const result = validateEndpoints(endpoints);

          // None should pass validation (host is invalid)
          expect(result.valid.length).toBe(0);
          expect(result.errors.length).toBe(endpoints.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("endpoints with invalid port are always discarded", () => {
    fc.assert(
      fc.property(
        fc.array(endpointWithInvalidPort, { minLength: 1, maxLength: 10 }),
        (endpoints) => {
          const result = validateEndpoints(endpoints);

          // None should pass validation (port is invalid)
          expect(result.valid.length).toBe(0);
          expect(result.errors.length).toBe(endpoints.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("mixed valid/invalid arrays return exactly the valid subset", () => {
    fc.assert(
      fc.property(
        fc.array(validEndpointArb, { minLength: 0, maxLength: 10 }),
        fc.array(endpointWithInvalidHost, { minLength: 0, maxLength: 5 }),
        fc.array(endpointWithInvalidPort, { minLength: 0, maxLength: 5 }),
        (validEntries, invalidHostEntries, invalidPortEntries) => {
          // Interleave valid and invalid entries
          const all = [...validEntries, ...invalidHostEntries, ...invalidPortEntries];
          // Shuffle deterministically by interleaving
          const shuffled = all.sort((a, b) => {
            const aStr = JSON.stringify(a);
            const bStr = JSON.stringify(b);
            return aStr.localeCompare(bStr);
          });

          const result = validateEndpoints(shuffled);

          // The number of valid results should equal the number of valid inputs
          expect(result.valid.length).toBe(validEntries.length);

          // Each valid result should have non-empty host and port in [1, 65535]
          for (const ep of result.valid) {
            expect(typeof ep.host).toBe("string");
            expect(ep.host.trim().length).toBeGreaterThan(0);
            expect(ep.port).toBeGreaterThanOrEqual(1);
            expect(ep.port).toBeLessThanOrEqual(65535);
            expect(Number.isInteger(ep.port)).toBe(true);
          }

          // Total should add up
          expect(result.valid.length + result.errors.length).toBe(shuffled.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("validation never throws regardless of input", () => {
    fc.assert(
      fc.property(fc.array(arbitraryValue, { minLength: 0, maxLength: 20 }), (entries) => {
        // Should never throw, regardless of what junk we pass in
        expect(() => validateEndpoints(entries as unknown[])).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("validation correctly identifies entries based on host non-empty AND port in range", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 10 }),
            host: fc.oneof(validHost, fc.constant(""), fc.constant("   ")),
            port: fc.oneof(validPort, fc.constant(0), fc.constant(70000), fc.constant(-5)),
            models: validModels,
            maxConcurrency: validMaxConcurrency,
            enabled: fc.boolean(),
            source: fc.constantFrom("manual" as const, "discovered" as const),
          }),
          { minLength: 0, maxLength: 15 },
        ),
        (entries) => {
          const result = validateEndpoints(entries);

          // Compute expected valid subset manually
          const expectedValid = entries.filter(
            (e) =>
              typeof e.host === "string" &&
              e.host.trim().length > 0 &&
              typeof e.port === "number" &&
              Number.isInteger(e.port) &&
              e.port >= 1 &&
              e.port <= 65535,
          );

          expect(result.valid.length).toBe(expectedValid.length);

          // Verify each valid entry matches expected criteria
          for (const ep of result.valid) {
            expect(ep.host.trim().length).toBeGreaterThan(0);
            expect(ep.port).toBeGreaterThanOrEqual(1);
            expect(ep.port).toBeLessThanOrEqual(65535);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
