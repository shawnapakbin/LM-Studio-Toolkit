/**
 * Property-based tests for the HealthChecker component.
 *
 * Property 3: Successful health probe resets failure state.
 * - Generate endpoints with arbitrary consecutiveFailures and health states.
 * - Simulate successful probe via registry.updateHealth(id, true).
 * - Assert: health becomes "healthy" and consecutiveFailures becomes 0.
 *
 * @tag Feature: lan-sub-agent, Property 3: Successful health probe resets failure state
 *
 * **Validates: Requirements 2.2**
 *
 * Property 5: Health status query returns complete information.
 * - Generate sets of endpoints in mixed health states (healthy, unhealthy, unknown).
 * - Register them in an EndpointRegistry and query via getEndpoints().
 * - Assert: status query returns an entry for each registered endpoint containing:
 *   identifier, health status, and lastProbeSuccess timestamp.
 *
 * @tag Feature: lan-sub-agent, Property 5: Health status query returns complete information
 *
 * **Validates: Requirements 2.6**
 */

import * as fc from "fast-check";
import nock from "nock";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { HealthChecker, HealthCheckerConfig } from "../../src/health-checker";
import { EndpointDefinition } from "../../src/types";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Health state arbitrary */
const healthArb = fc.constantFrom("healthy" as const, "unhealthy" as const, "unknown" as const);

/** Generate a valid, non-local endpoint definition with a unique id */
const endpointDefinitionArb = (index: number): fc.Arbitrary<EndpointDefinition> =>
  fc.record({
    id: fc.constant(`ep-${index}`),
    host: fc.constant(`192.168.1.${10 + index}`), // non-local IPs
    port: fc.integer({ min: 1, max: 65535 }),
    models: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
      minLength: 1,
      maxLength: 5,
    }),
    maxConcurrency: fc.integer({ min: 1, max: 100 }),
    enabled: fc.boolean(),
    source: fc.constant("manual" as const),
  });

/** Generate a set of endpoints with associated target health states */
const endpointsWithHealthArb = fc
  .integer({ min: 1, max: 15 })
  .chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_, i) => fc.tuple(endpointDefinitionArb(i), healthArb)),
    ),
  );

/** ISO timestamp arbitrary for lastProbeSuccess */
const isoTimestampArb = fc
  .date({
    min: new Date("2020-01-01T00:00:00Z"),
    max: new Date("2030-12-31T23:59:59Z"),
  })
  .map((d) => d.toISOString());

/** Generate endpoints with health + optional lastProbeSuccess */
const endpointsWithFullStateArb = fc
  .integer({ min: 1, max: 15 })
  .chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_, i) =>
        fc.tuple(endpointDefinitionArb(i), healthArb, fc.option(isoTimestampArb, { nil: null })),
      ),
    ),
  );

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set environment variables to avoid self-exclusion matching our test IPs.
 * We use a port that won't match our generated endpoints.
 */
function setupEnv(): void {
  process.env.SUBAGENT_LOCAL_HOST = "10.0.0.1";
  process.env.SUBAGENT_LOCAL_PORT = "9999";
}

function cleanupEnv(): void {
  delete process.env.SUBAGENT_LOCAL_HOST;
  delete process.env.SUBAGENT_LOCAL_PORT;
}

// ─── Property 3 Arbitraries ──────────────────────────────────────────────────

/** Generate an initial state for an endpoint (consecutiveFailures + health) */
const initialStateArb = fc.record({
  consecutiveFailures: fc.integer({ min: 0, max: 20 }),
  health: fc.constantFrom("healthy" as const, "unhealthy" as const, "unknown" as const),
});

// ─── Property 3 Tests ────────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 3: Successful health probe resets failure state", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /**
   * **Validates: Requirements 2.2**
   *
   * For any endpoint with arbitrary consecutiveFailures (0-20) and any health state
   * (healthy, unhealthy, unknown), a successful health probe (updateHealth(id, true))
   * SHALL reset the endpoint to healthy with consecutiveFailures = 0 and set
   * lastProbeSuccess to a non-null ISO timestamp.
   */
  it("successful probe resets health to healthy, consecutiveFailures to 0, and sets lastProbeSuccess", () => {
    fc.assert(
      fc.property(initialStateArb, (initialState) => {
        // Create an endpoint
        const definition: EndpointDefinition = {
          id: "ep-probe-reset",
          host: "192.168.1.50",
          port: 1234,
          models: ["test-model"],
          maxConcurrency: 10,
          enabled: true,
          source: "manual",
        };

        const registry = new EndpointRegistry([definition]);
        const endpoint = registry.getEndpoint(definition.id);
        if (!endpoint) throw new Error("Endpoint not registered");

        // Apply the generated initial state
        endpoint.consecutiveFailures = initialState.consecutiveFailures;

        // Set health state: if unhealthy, call updateHealth(false) to set it;
        // if healthy, call updateHealth(true); unknown is default
        if (initialState.health === "unhealthy") {
          registry.updateHealth(definition.id, false, "simulated failure");
        } else if (initialState.health === "healthy") {
          registry.updateHealth(definition.id, true);
        }
        // For "unknown", leave as-is (but override consecutiveFailures again since updateHealth may reset it)
        endpoint.consecutiveFailures = initialState.consecutiveFailures;

        // Now simulate a successful probe
        registry.updateHealth(definition.id, true);

        // Assert the property: health is "healthy", consecutiveFailures is 0, lastProbeSuccess is set
        expect(endpoint.health).toBe("healthy");
        expect(endpoint.consecutiveFailures).toBe(0);
        expect(endpoint.lastProbeSuccess).not.toBeNull();
        expect(typeof endpoint.lastProbeSuccess).toBe("string");
      }),
      { numRuns: 100 },
    );
  });

  it("successful probe resets failure state regardless of how many prior failures occurred", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (priorFailures) => {
        const definition: EndpointDefinition = {
          id: "ep-failures-reset",
          host: "192.168.1.51",
          port: 2345,
          models: ["model-a"],
          maxConcurrency: 5,
          enabled: true,
          source: "manual",
        };

        const registry = new EndpointRegistry([definition]);
        const endpoint = registry.getEndpoint(definition.id);
        if (!endpoint) throw new Error("Endpoint not registered");

        // Accumulate N consecutive failures
        for (let i = 0; i < priorFailures; i++) {
          registry.updateHealth(definition.id, false, `failure ${i + 1}`);
        }

        // Verify failures were accumulated
        if (priorFailures > 0) {
          expect(endpoint.consecutiveFailures).toBe(priorFailures);
          expect(endpoint.health).toBe("unhealthy");
        }

        // Successful probe should reset everything
        registry.updateHealth(definition.id, true);

        expect(endpoint.health).toBe("healthy");
        expect(endpoint.consecutiveFailures).toBe(0);
        expect(endpoint.lastProbeSuccess).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("lastProbeSuccess is a valid ISO timestamp after successful probe", () => {
    fc.assert(
      fc.property(initialStateArb, (initialState) => {
        const definition: EndpointDefinition = {
          id: "ep-timestamp-check",
          host: "192.168.1.52",
          port: 3456,
          models: ["model-b"],
          maxConcurrency: 8,
          enabled: true,
          source: "manual",
        };

        const registry = new EndpointRegistry([definition]);
        const endpoint = registry.getEndpoint(definition.id);
        if (!endpoint) throw new Error("Endpoint not registered");

        // Apply initial state
        endpoint.consecutiveFailures = initialState.consecutiveFailures;
        if (initialState.health === "unhealthy") {
          registry.updateHealth(definition.id, false, "setup failure");
        }
        endpoint.consecutiveFailures = initialState.consecutiveFailures;

        // Successful probe
        registry.updateHealth(definition.id, true);

        // Verify the timestamp is a valid ISO date string
        expect(endpoint.lastProbeSuccess).not.toBeNull();
        const parsed = new Date(endpoint.lastProbeSuccess!);
        expect(parsed.getTime()).not.toBeNaN();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5 Tests ────────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 5: Health status query returns complete information", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /**
   * **Validates: Requirements 2.6**
   *
   * For any set of endpoints registered in the EndpointRegistry (in any
   * combination of healthy/unhealthy/unknown states), the status query SHALL
   * return an entry for each endpoint containing: identifier, health status,
   * and last successful probe timestamp.
   */
  it("status query returns an entry for every registered endpoint with id, health, and lastProbeSuccess", () => {
    fc.assert(
      fc.property(endpointsWithFullStateArb, (endpointsWithState) => {
        // Register endpoints in the registry
        const definitions = endpointsWithState.map(([def]) => def);
        const registry = new EndpointRegistry(definitions);

        // Apply health states to each endpoint
        for (const [def, health, lastProbeSuccess] of endpointsWithState) {
          const endpoint = registry.getEndpoint(def.id);
          if (!endpoint) continue;

          // Set health state by calling updateHealth
          if (health === "healthy") {
            registry.updateHealth(def.id, true);
          } else if (health === "unhealthy") {
            registry.updateHealth(def.id, false, "test failure");
          }
          // "unknown" is the default state, no action needed

          // Manually set lastProbeSuccess if provided
          if (lastProbeSuccess !== null) {
            endpoint.lastProbeSuccess = lastProbeSuccess;
          }
        }

        // Query all endpoints (no filter)
        const results = registry.getEndpoints();

        // Assert: one entry per registered endpoint
        expect(results.length).toBe(definitions.length);

        // Assert: each result has the required fields
        for (const result of results) {
          // identifier exists and is a non-empty string
          expect(result.definition.id).toBeDefined();
          expect(typeof result.definition.id).toBe("string");
          expect(result.definition.id.length).toBeGreaterThan(0);

          // health status is one of the valid values
          expect(result.health).toBeDefined();
          expect(["healthy", "unhealthy", "unknown"]).toContain(result.health);

          // lastProbeSuccess field exists (can be null or a string)
          expect("lastProbeSuccess" in result).toBe(true);
          if (result.lastProbeSuccess !== null) {
            expect(typeof result.lastProbeSuccess).toBe("string");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("each endpoint's id in status query matches one of the registered endpoints", () => {
    fc.assert(
      fc.property(endpointsWithFullStateArb, (endpointsWithState) => {
        const definitions = endpointsWithState.map(([def]) => def);
        const registry = new EndpointRegistry(definitions);

        // Apply mixed health states
        for (const [def, health] of endpointsWithState) {
          if (health === "healthy") {
            registry.updateHealth(def.id, true);
          } else if (health === "unhealthy") {
            registry.updateHealth(def.id, false, "test");
          }
        }

        const results = registry.getEndpoints();
        const registeredIds = new Set(definitions.map((d) => d.id));
        const resultIds = new Set(results.map((r) => r.definition.id));

        // Every registered id appears in the results
        for (const id of registeredIds) {
          expect(resultIds.has(id)).toBe(true);
        }

        // Every result id is one of the registered ids
        for (const id of resultIds) {
          expect(registeredIds.has(id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("health status correctly reflects the applied state for each endpoint", () => {
    fc.assert(
      fc.property(endpointsWithHealthArb, (endpointsWithState) => {
        const definitions = endpointsWithState.map(([def]) => def);
        const registry = new EndpointRegistry(definitions);

        // Track expected health for each endpoint
        const expectedHealth = new Map<string, "healthy" | "unhealthy" | "unknown">();

        for (const [def, health] of endpointsWithState) {
          if (health === "healthy") {
            registry.updateHealth(def.id, true);
            expectedHealth.set(def.id, "healthy");
          } else if (health === "unhealthy") {
            registry.updateHealth(def.id, false, "test");
            expectedHealth.set(def.id, "unhealthy");
          } else {
            // "unknown" is default — no update needed
            expectedHealth.set(def.id, "unknown");
          }
        }

        const results = registry.getEndpoints();

        for (const result of results) {
          const expected = expectedHealth.get(result.definition.id);
          expect(result.health).toBe(expected);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("lastProbeSuccess is set when endpoint has had a successful probe", () => {
    fc.assert(
      fc.property(endpointsWithFullStateArb, (endpointsWithState) => {
        const definitions = endpointsWithState.map(([def]) => def);
        const registry = new EndpointRegistry(definitions);

        // Track which endpoints should have lastProbeSuccess
        const shouldHaveTimestamp = new Map<string, boolean>();

        for (const [def, health, lastProbeSuccess] of endpointsWithState) {
          if (health === "healthy") {
            // updateHealth with true sets lastProbeSuccess automatically
            registry.updateHealth(def.id, true);
            shouldHaveTimestamp.set(def.id, true);
          } else if (health === "unhealthy") {
            registry.updateHealth(def.id, false, "test");
            // If we also inject a lastProbeSuccess, set it manually
            if (lastProbeSuccess !== null) {
              const endpoint = registry.getEndpoint(def.id);
              if (endpoint) endpoint.lastProbeSuccess = lastProbeSuccess;
              shouldHaveTimestamp.set(def.id, true);
            } else {
              shouldHaveTimestamp.set(def.id, false);
            }
          } else {
            // unknown state
            if (lastProbeSuccess !== null) {
              const endpoint = registry.getEndpoint(def.id);
              if (endpoint) endpoint.lastProbeSuccess = lastProbeSuccess;
              shouldHaveTimestamp.set(def.id, true);
            } else {
              shouldHaveTimestamp.set(def.id, false);
            }
          }
        }

        const results = registry.getEndpoints();

        for (const result of results) {
          const shouldHave = shouldHaveTimestamp.get(result.definition.id);
          if (shouldHave) {
            expect(result.lastProbeSuccess).not.toBeNull();
            expect(typeof result.lastProbeSuccess).toBe("string");
          } else {
            expect(result.lastProbeSuccess).toBeNull();
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4 Tests ────────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 4: Consecutive failures trigger unhealthy transition", () => {
  beforeAll(() => {
    process.env.SUBAGENT_LOCAL_HOST = "10.0.0.1";
    process.env.SUBAGENT_LOCAL_PORT = "9999";
  });

  afterAll(() => {
    delete process.env.SUBAGENT_LOCAL_HOST;
    delete process.env.SUBAGENT_LOCAL_PORT;
  });

  afterEach(() => {
    nock.cleanAll();
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * For any generated threshold T (1-5) and failure count N (0-10):
   * - If N >= T: endpoint health SHALL be "unhealthy"
   * - If N < T: endpoint health SHALL NOT be "unhealthy"
   *
   * Strategy: pre-set consecutiveFailures to (N-1) on the endpoint state,
   * then run ONE probe cycle that fails. After that single cycle the
   * internal failure count is N. This avoids N HTTP calls per iteration.
   * When N == 0, we skip the probe (no failures) and verify health is not unhealthy.
   */
  it("endpoint is unhealthy iff consecutiveFailures >= threshold", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }), // threshold T
        fc.integer({ min: 0, max: 10 }), // target failure count N
        async (threshold, targetFailures) => {
          const endpoint: EndpointDefinition = {
            id: "test-ep-prop4",
            host: "192.168.50.100",
            port: 11434,
            models: ["test-model"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          };

          const registry = new EndpointRegistry([endpoint]);
          const config: HealthCheckerConfig = {
            intervalMs: 30000,
            timeoutMs: 5000,
            failureThreshold: threshold,
          };
          const healthChecker = new HealthChecker(registry, config);

          if (targetFailures === 0) {
            // Zero failures: endpoint stays at "unknown" (initial state)
            const ep = registry.getEndpoint("test-ep-prop4");
            expect(ep).toBeDefined();
            expect(ep!.health).not.toBe("unhealthy");
          } else {
            // Pre-set consecutiveFailures to (targetFailures - 1)
            // Then run one probe cycle that fails, bringing total to targetFailures
            const ep = registry.getEndpoint("test-ep-prop4");
            expect(ep).toBeDefined();
            ep!.consecutiveFailures = targetFailures - 1;

            // Mock one failed probe
            nock(`http://192.168.50.100:11434`)
              .get("/v1/models")
              .reply(500, "Internal Server Error");

            await healthChecker.runCycle();

            if (targetFailures >= threshold) {
              expect(ep!.health).toBe("unhealthy");
            } else {
              expect(ep!.health).not.toBe("unhealthy");
              expect(ep!.consecutiveFailures).toBe(targetFailures);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("endpoint stays non-unhealthy when failures remain below threshold", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }), // threshold T (at least 2 to have room below)
        fc.integer({ min: 1, max: 4 }), // failures below threshold
        async (threshold, rawFailures) => {
          // Ensure failures < threshold
          const targetFailures = rawFailures % threshold || 1;
          if (targetFailures >= threshold) return; // skip edge case

          const endpoint: EndpointDefinition = {
            id: "test-ep-below",
            host: "192.168.50.101",
            port: 11434,
            models: ["test-model"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          };

          const registry = new EndpointRegistry([endpoint]);
          const config: HealthCheckerConfig = {
            intervalMs: 30000,
            timeoutMs: 5000,
            failureThreshold: threshold,
          };
          const healthChecker = new HealthChecker(registry, config);

          // Pre-set to (targetFailures - 1), then one failed probe brings it to targetFailures
          const ep = registry.getEndpoint("test-ep-below");
          expect(ep).toBeDefined();
          ep!.consecutiveFailures = targetFailures - 1;

          nock(`http://192.168.50.101:11434`).get("/v1/models").reply(500, "Internal Server Error");

          await healthChecker.runCycle();

          // Below threshold: should NOT be unhealthy
          expect(ep!.health).not.toBe("unhealthy");
          expect(ep!.consecutiveFailures).toBe(targetFailures);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reaching exact threshold marks endpoint unhealthy", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }), // threshold T
        async (threshold) => {
          const endpoint: EndpointDefinition = {
            id: "test-ep-exact",
            host: "192.168.50.102",
            port: 11434,
            models: ["test-model"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          };

          const registry = new EndpointRegistry([endpoint]);
          const config: HealthCheckerConfig = {
            intervalMs: 30000,
            timeoutMs: 5000,
            failureThreshold: threshold,
          };
          const healthChecker = new HealthChecker(registry, config);

          // Pre-set to (threshold - 1), one more failure reaches threshold
          const ep = registry.getEndpoint("test-ep-exact");
          expect(ep).toBeDefined();
          ep!.consecutiveFailures = threshold - 1;

          nock(`http://192.168.50.102:11434`).get("/v1/models").reply(500, "Internal Server Error");

          await healthChecker.runCycle();

          // Exactly at threshold: MUST be unhealthy
          expect(ep!.health).toBe("unhealthy");
        },
      ),
      { numRuns: 100 },
    );
  });
});
