/**
 * Property-based tests for the LoadBalancer component.
 *
 * Property 15: Load balancer strategy distribution
 * - Generate N endpoints and K > N tasks
 * - Assert round-robin: each gets ⌊K/N⌋ to ⌈K/N⌉ tasks
 * - Assert least-connections: active task difference ≤ 1 at any point
 * - Assert weighted: proportional to maxConcurrency weight (±1 task)
 *
 * @tag Feature: lan-sub-agent, Property 15: Load balancer strategy distribution
 *
 * **Validates: Requirements 3.2**
 */

import * as fc from "fast-check";
import { EndpointRegistry } from "../../src/endpoint-registry";
import {
  LoadBalancer,
  LoadBalancerConfig,
  LoadBalancerStrategy,
  isSelectionError,
} from "../../src/load-balancer";
import { EndpointDefinition } from "../../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupEnv(): void {
  process.env.SUBAGENT_LOCAL_HOST = "10.0.0.1";
  process.env.SUBAGENT_LOCAL_PORT = "9999";
}

function cleanupEnv(): void {
  delete process.env.SUBAGENT_LOCAL_HOST;
  delete process.env.SUBAGENT_LOCAL_PORT;
}

function makeConfig(strategy: LoadBalancerStrategy): LoadBalancerConfig {
  return {
    strategy,
    retryLimit: 2,
    localHost: "10.0.0.1",
    localPort: 9999,
  };
}

function makeEndpoints(count: number, maxConcurrency: number): EndpointDefinition[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ep-${i}`,
    host: `192.168.1.${10 + i}`,
    port: 1234,
    models: ["test-model"],
    maxConcurrency,
    enabled: true,
    source: "manual" as const,
  }));
}

function makeWeightedEndpoints(concurrencies: number[]): EndpointDefinition[] {
  return concurrencies.map((maxConcurrency, i) => ({
    id: `ep-${i}`,
    host: `192.168.1.${10 + i}`,
    port: 1234,
    models: ["test-model"],
    maxConcurrency,
    enabled: true,
    source: "manual" as const,
  }));
}

function createRegistry(endpoints: EndpointDefinition[]): EndpointRegistry {
  const registry = new EndpointRegistry(endpoints);
  // Mark all endpoints healthy
  for (const ep of endpoints) {
    registry.updateHealth(ep.id, true);
  }
  return registry;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate endpoint count N (2-5) and task multiplier (3-10) */
const roundRobinInputArb = fc.record({
  n: fc.integer({ min: 2, max: 5 }),
  multiplier: fc.integer({ min: 3, max: 10 }),
});

/** Generate endpoint count N (2-5) and task count K > N */
const leastConnectionsInputArb = fc.record({
  n: fc.integer({ min: 2, max: 5 }),
  multiplier: fc.integer({ min: 3, max: 8 }),
});

/** Generate array of 2-5 distinct maxConcurrency values (large enough to avoid capacity issues) */
const weightedInputArb = fc.integer({ min: 2, max: 5 }).chain((n) =>
  fc.record({
    concurrencies: fc.array(fc.integer({ min: 10, max: 50 }), {
      minLength: n,
      maxLength: n,
    }),
  }),
);

// ─── Property 15 Tests ──────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 15: Load balancer strategy distribution", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /**
   * **Validates: Requirements 3.2**
   *
   * Round-robin strategy: for N healthy endpoints and K > N tasks,
   * each endpoint receives between ⌊K/N⌋ and ⌈K/N⌉ selections.
   */
  it("round-robin distributes tasks evenly (⌊K/N⌋ to ⌈K/N⌉ per endpoint)", () => {
    fc.assert(
      fc.property(roundRobinInputArb, ({ n, multiplier }) => {
        const k = n * multiplier;
        const endpoints = makeEndpoints(n, 100); // High maxConcurrency to avoid capacity limits
        const registry = createRegistry(endpoints);
        const lb = new LoadBalancer(registry, makeConfig("round-robin"));

        // Count selections per endpoint
        const counts = new Map<string, number>();
        for (const ep of endpoints) {
          counts.set(ep.id, 0);
        }

        for (let i = 0; i < k; i++) {
          const result = lb.selectEndpoint();
          expect(isSelectionError(result)).toBe(false);
          if (!isSelectionError(result)) {
            const id = result.endpoint.definition.id;
            counts.set(id, (counts.get(id) || 0) + 1);
          }
        }

        // Assert: each endpoint gets between floor(K/N) and ceil(K/N) tasks
        const floor = Math.floor(k / n);
        const ceil = Math.ceil(k / n);

        for (const [_id, count] of counts) {
          expect(count).toBeGreaterThanOrEqual(floor);
          expect(count).toBeLessThanOrEqual(ceil);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Least-connections strategy: at any point during dispatch, the difference
   * in active task count between any two endpoints is at most 1.
   */
  it("least-connections maintains active task difference ≤ 1 at any point", () => {
    fc.assert(
      fc.property(leastConnectionsInputArb, ({ n, multiplier }) => {
        const k = n * multiplier;
        const endpoints = makeEndpoints(n, 100); // High maxConcurrency
        const registry = createRegistry(endpoints);
        const lb = new LoadBalancer(registry, makeConfig("least-connections"));

        for (let i = 0; i < k; i++) {
          const result = lb.selectEndpoint();
          expect(isSelectionError(result)).toBe(false);
          if (!isSelectionError(result)) {
            const id = result.endpoint.definition.id;
            // Acquire a slot to simulate an active task
            registry.acquireSlot(id);
          }

          // Check invariant: max - min active task count ≤ 1
          const states = registry.getEndpoints();
          const activeCounts = states.map((s) => s.activeTaskCount);
          const maxActive = Math.max(...activeCounts);
          const minActive = Math.min(...activeCounts);
          expect(maxActive - minActive).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Weighted strategy: the proportion of tasks assigned to each endpoint
   * approximates its maxConcurrency weight relative to total weight (±1 task).
   * The weighted strategy selects the endpoint with the highest remaining capacity
   * (maxConcurrency - activeTaskCount), which distributes proportionally to weight.
   */
  it("weighted distributes proportional to maxConcurrency weight (±1 task)", () => {
    fc.assert(
      fc.property(weightedInputArb, ({ concurrencies }) => {
        const totalWeight = concurrencies.reduce((sum, c) => sum + c, 0);
        // Use K = totalWeight so the total tasks fill up all capacity exactly
        const k = totalWeight;
        const endpoints = makeWeightedEndpoints(concurrencies);
        const registry = createRegistry(endpoints);
        const lb = new LoadBalancer(registry, makeConfig("weighted"));

        // Count assignments per endpoint
        const counts = new Map<string, number>();
        for (const ep of endpoints) {
          counts.set(ep.id, 0);
        }

        for (let i = 0; i < k; i++) {
          const result = lb.selectEndpoint();
          expect(isSelectionError(result)).toBe(false);
          if (!isSelectionError(result)) {
            const id = result.endpoint.definition.id;
            counts.set(id, (counts.get(id) || 0) + 1);
            // Acquire slot to track active tasks (weighted uses remaining capacity)
            registry.acquireSlot(id);
          }
        }

        // Assert: distribution is proportional to maxConcurrency weight (±1 task)
        // Since weighted selects by highest remaining capacity, each endpoint
        // should receive approximately (maxConcurrency / totalWeight) * K tasks
        for (let i = 0; i < endpoints.length; i++) {
          const ep = endpoints[i];
          const weight = concurrencies[i] / totalWeight;
          const expectedTasks = Math.round(k * weight);
          const actualTasks = counts.get(ep.id) || 0;
          expect(Math.abs(actualTasks - expectedTasks)).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8 Tests ────────────────────────────────────────────────────────

/**
 * Property 8: Retry selects a different endpoint.
 * - Generate scenarios with multiple healthy endpoints, simulate first-choice failure.
 * - Assert: retry selects a different endpoint ID than the one that failed.
 *
 * @tag Feature: lan-sub-agent, Property 8: Retry selects a different endpoint
 *
 * **Validates: Requirements 3.5**
 */

describe("Feature: lan-sub-agent, Property 8: Retry selects a different endpoint", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /** Strategy arbitrary */
  const strategyArb: fc.Arbitrary<LoadBalancerStrategy> = fc.constantFrom(
    "round-robin" as const,
    "least-connections" as const,
    "weighted" as const,
  );

  /**
   * Generate N >= 2 healthy, enabled, non-local endpoints with available capacity.
   * Uses unique IPs in the 192.168.x.y range to avoid self-exclusion.
   */
  const multiEndpointArb = fc.integer({ min: 2, max: 10 }).chain((count) =>
    fc.tuple(
      fc.array(
        fc.record({
          port: fc.integer({ min: 1000, max: 60000 }),
          maxConcurrency: fc.integer({ min: 2, max: 50 }),
          models: fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
            minLength: 1,
            maxLength: 5,
          }),
        }),
        { minLength: count, maxLength: count },
      ),
      strategyArb,
    ),
  );

  /**
   * **Validates: Requirements 3.5**
   *
   * For any task retry scenario where the first-choice endpoint fails and at least
   * one other healthy endpoint exists, the retry attempt SHALL select a different
   * endpoint than the one that failed.
   */
  it("retry candidates exclude the failed endpoint ID", () => {
    fc.assert(
      fc.property(multiEndpointArb, ([endpointConfigs, strategy]) => {
        // Build endpoint definitions with unique non-local IPs
        const definitions: EndpointDefinition[] = endpointConfigs.map((cfg, i) => ({
          id: `ep-${i}`,
          host: `192.168.${Math.floor(i / 256) + 1}.${(i % 256) + 10}`,
          port: cfg.port,
          models: cfg.models,
          maxConcurrency: cfg.maxConcurrency,
          enabled: true,
          source: "manual" as const,
        }));

        // Create registry and mark all endpoints healthy
        const registry = new EndpointRegistry(definitions);
        for (const def of definitions) {
          registry.updateHealth(def.id, true);
        }

        // Create load balancer with selected strategy
        const config: LoadBalancerConfig = {
          strategy,
          retryLimit: 2,
          localHost: "10.0.0.1",
          localPort: 9999,
        };
        const lb = new LoadBalancer(registry, config);

        // Step 1: Select first endpoint
        const firstResult = lb.selectEndpoint();

        // If no endpoint is selected (unexpected given our setup), skip
        if (isSelectionError(firstResult)) {
          return; // vacuously true - all endpoints should be available
        }

        const failedEndpointId = firstResult.endpoint.definition.id;

        // Step 2: Get retry candidates excluding the failed endpoint
        const retryCandidates = lb.getCandidates(undefined, [failedEndpointId]);

        // Step 3: Assert none of the retry candidates is the failed endpoint
        for (const candidate of retryCandidates) {
          expect(candidate.definition.id).not.toBe(failedEndpointId);
        }

        // Step 4: Since we have >= 2 endpoints, retry should find at least one alternative
        expect(retryCandidates.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Even with different strategies, retry always provides alternatives
   * that differ from the originally failed endpoint.
   */
  it("retry candidates always have different IDs from the excluded set", () => {
    fc.assert(
      fc.property(
        multiEndpointArb,
        fc.integer({ min: 0, max: 9 }),
        ([endpointConfigs, strategy], failIndex) => {
          // Build endpoint definitions
          const definitions: EndpointDefinition[] = endpointConfigs.map((cfg, i) => ({
            id: `ep-${i}`,
            host: `192.168.${Math.floor(i / 256) + 1}.${(i % 256) + 10}`,
            port: cfg.port,
            models: cfg.models,
            maxConcurrency: cfg.maxConcurrency,
            enabled: true,
            source: "manual" as const,
          }));

          // Create registry and mark all endpoints healthy
          const registry = new EndpointRegistry(definitions);
          for (const def of definitions) {
            registry.updateHealth(def.id, true);
          }

          // Create load balancer
          const config: LoadBalancerConfig = {
            strategy,
            retryLimit: 2,
            localHost: "10.0.0.1",
            localPort: 9999,
          };
          const lb = new LoadBalancer(registry, config);

          // Simulate a failure on a specific endpoint (use modulo to stay in bounds)
          const targetFailIndex = failIndex % definitions.length;
          const failedId = definitions[targetFailIndex].id;

          // Get retry candidates excluding the failed endpoint
          const retryCandidates = lb.getCandidates(undefined, [failedId]);

          // Assert: no candidate has the failed ID
          const candidateIds = retryCandidates.map((c) => c.definition.id);
          expect(candidateIds).not.toContain(failedId);

          // Assert: at least one alternative exists (since N >= 2)
          expect(retryCandidates.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6 Arbitraries ──────────────────────────────────────────────────

/** Health state arbitrary for Property 6 */
const healthStateArb = fc.constantFrom(
  "healthy" as const,
  "unhealthy" as const,
  "unknown" as const,
);

/** Strategy arbitrary for Property 6 */
const lbStrategyArb: fc.Arbitrary<LoadBalancerStrategy> = fc.constantFrom(
  "round-robin" as const,
  "least-connections" as const,
  "weighted" as const,
);

/** Generate a remote endpoint with varying health/enabled/capacity */
interface P6EndpointSetup {
  definition: EndpointDefinition;
  health: "healthy" | "unhealthy" | "unknown";
  activeTaskCount: number;
}

const p6RemoteEndpointSetupArb = (index: number): fc.Arbitrary<P6EndpointSetup> =>
  fc.record({
    definition: fc.record({
      id: fc.constant(`p6-remote-${index}`),
      host: fc.constant(`192.168.1.${10 + index}`),
      port: fc.integer({ min: 1000, max: 9000 }),
      models: fc.array(fc.constantFrom("model-a", "model-b", "model-c"), {
        minLength: 1,
        maxLength: 3,
      }),
      maxConcurrency: fc.integer({ min: 1, max: 10 }),
      enabled: fc.boolean(),
      source: fc.constant("manual" as const),
    }),
    health: healthStateArb,
    activeTaskCount: fc.integer({ min: 0, max: 12 }),
  });

/** Generate a mixed registry: remote endpoints + optionally local ones + strategy */
const p6MixedRegistryArb = fc
  .integer({ min: 1, max: 10 })
  .chain((remoteCount) =>
    fc.tuple(
      fc.tuple(...Array.from({ length: remoteCount }, (_, i) => p6RemoteEndpointSetupArb(i))),
      fc.integer({ min: 0, max: 2 }),
      lbStrategyArb,
    ),
  );

// ─── Property 6 Helpers ─────────────────────────────────────────────────────

function buildP6LoadBalancer(
  endpointSetups: P6EndpointSetup[],
  localCount: number,
  strategy: LoadBalancerStrategy,
): { lb: LoadBalancer; registry: EndpointRegistry } {
  // Collect all definitions
  const allDefinitions: EndpointDefinition[] = endpointSetups.map((s) => s.definition);

  // Add local endpoints (will be filtered by the registry constructor due to self-exclusion)
  for (let i = 0; i < localCount; i++) {
    allDefinitions.push({
      id: `p6-local-${i}`,
      host: i === 0 ? "10.0.0.1" : "127.0.0.1",
      port: 9999,
      models: ["model-a"],
      maxConcurrency: 5,
      enabled: true,
      source: "manual",
    });
  }

  const registry = new EndpointRegistry(allDefinitions);

  // Apply health states and activeTaskCount to remote endpoints
  for (const setup of endpointSetups) {
    const ep = registry.getEndpoint(setup.definition.id);
    if (!ep) continue;

    // Set health
    if (setup.health === "healthy") {
      registry.updateHealth(setup.definition.id, true);
    } else if (setup.health === "unhealthy") {
      registry.updateHealth(setup.definition.id, false, "simulated failure");
    }
    // "unknown" is the default — no action needed

    // Set activeTaskCount by acquiring slots (up to what's possible)
    const slotsToAcquire = Math.min(setup.activeTaskCount, setup.definition.maxConcurrency);
    for (let t = 0; t < slotsToAcquire; t++) {
      registry.acquireSlot(setup.definition.id);
    }
  }

  const config: LoadBalancerConfig = {
    strategy,
    retryLimit: 2,
    localHost: "10.0.0.1",
    localPort: 9999,
  };

  const lb = new LoadBalancer(registry, config);
  return { lb, registry };
}

// ─── Property 6 Tests ────────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 6: Endpoint selection invariant", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /**
   * **Validates: Requirements 3.1, 3.6, 6.2**
   *
   * For any invocation of selectEndpoint, the returned endpoint (if any) SHALL
   * satisfy ALL of:
   * (a) health is "healthy"
   * (b) enabled is true
   * (c) does NOT match the local instance (considering localhost/127.0.0.1/LAN IP equivalence)
   * (d) activeTaskCount is less than maxConcurrency
   */
  it("selected endpoint is always healthy, enabled, non-local, and below capacity", () => {
    fc.assert(
      fc.property(p6MixedRegistryArb, ([endpointSetups, localCount, strategy]) => {
        const { lb, registry } = buildP6LoadBalancer(endpointSetups, localCount, strategy);

        const result = lb.selectEndpoint();

        if (!isSelectionError(result)) {
          const ep = result.endpoint;

          // (a) health is "healthy"
          expect(ep.health).toBe("healthy");

          // (b) enabled is true
          expect(ep.definition.enabled).toBe(true);

          // (c) does NOT match local instance
          expect(registry.isLocalInstance(ep.definition.host, ep.definition.port)).toBe(false);

          // (d) activeTaskCount < maxConcurrency
          expect(ep.activeTaskCount).toBeLessThan(ep.definition.maxConcurrency);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.6, 6.2**
   *
   * When no healthy+enabled+remote+available endpoint exists, selectEndpoint returns an error.
   */
  it("returns an error when no valid endpoint can be selected", () => {
    fc.assert(
      fc.property(p6MixedRegistryArb, ([endpointSetups, localCount, strategy]) => {
        const { lb } = buildP6LoadBalancer(endpointSetups, localCount, strategy);

        // Determine if any remote endpoint qualifies (healthy, enabled, below capacity)
        const hasValidCandidate = endpointSetups.some(
          (setup) =>
            setup.health === "healthy" &&
            setup.definition.enabled === true &&
            setup.activeTaskCount < setup.definition.maxConcurrency,
        );

        const result = lb.selectEndpoint();

        if (!hasValidCandidate) {
          // When no valid candidate exists, we must get an error
          expect(isSelectionError(result)).toBe(true);
        } else {
          // When at least one valid candidate exists, we must get a selection
          expect(isSelectionError(result)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.6, 6.2**
   *
   * Self-exclusion: even when local endpoints are "healthy" and "enabled",
   * they are never selected.
   */
  it("local endpoints are never selected regardless of their health/enabled state", () => {
    fc.assert(
      fc.property(lbStrategyArb, (strategy) => {
        // Create a registry with ONLY local endpoints
        const definitions: EndpointDefinition[] = [
          {
            id: "p6-only-local-1",
            host: "10.0.0.1",
            port: 9999,
            models: ["model-a"],
            maxConcurrency: 10,
            enabled: true,
            source: "manual",
          },
          {
            id: "p6-only-local-2",
            host: "127.0.0.1",
            port: 9999,
            models: ["model-a"],
            maxConcurrency: 10,
            enabled: true,
            source: "manual",
          },
          {
            id: "p6-only-local-3",
            host: "localhost",
            port: 9999,
            models: ["model-a"],
            maxConcurrency: 10,
            enabled: true,
            source: "manual",
          },
        ];

        const registry = new EndpointRegistry(definitions);
        const config: LoadBalancerConfig = {
          strategy,
          retryLimit: 2,
          localHost: "10.0.0.1",
          localPort: 9999,
        };

        const lb = new LoadBalancer(registry, config);
        const result = lb.selectEndpoint();

        // Must always return an error since all endpoints are local
        expect(isSelectionError(result)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.6, 6.2**
   *
   * The selection invariant holds with model filtering across all strategies.
   */
  it("selection invariant holds with model filtering across all strategies", () => {
    fc.assert(
      fc.property(
        p6MixedRegistryArb,
        fc.constantFrom("model-a", "model-b", "model-c"),
        ([endpointSetups, localCount, strategy], modelReq) => {
          const { lb, registry } = buildP6LoadBalancer(endpointSetups, localCount, strategy);

          const result = lb.selectEndpoint(modelReq);

          if (!isSelectionError(result)) {
            const ep = result.endpoint;

            // (a) health is "healthy"
            expect(ep.health).toBe("healthy");

            // (b) enabled is true
            expect(ep.definition.enabled).toBe(true);

            // (c) does NOT match local instance
            expect(registry.isLocalInstance(ep.definition.host, ep.definition.port)).toBe(false);

            // (d) activeTaskCount < maxConcurrency
            expect(ep.activeTaskCount).toBeLessThan(ep.definition.maxConcurrency);

            // (e) model is advertised by the endpoint
            expect(ep.definition.models).toContain(modelReq);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
