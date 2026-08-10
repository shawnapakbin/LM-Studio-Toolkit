/**
 * Property-based tests for graceful degradation — task redistribution on endpoint failure.
 *
 * Property 17: Task redistribution on endpoint failure
 * - Generate active dispatch states where an endpoint becomes unhealthy mid-dispatch
 * - Assert: pending tasks reassigned to other healthy endpoints; no task left unassigned
 *
 * @tag Feature: lan-sub-agent, Property 17: Task redistribution on endpoint failure
 *
 * **Validates: Requirements 10.1**
 */

import * as fc from "fast-check";
import nock from "nock";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { HealthChecker, HealthCheckerConfig } from "../../src/health-checker";
import {
  CheckpointStore,
  InMemoryDedupCache,
  LanDispatcher,
  LanTelemetryTracker as TelemetryInterface,
} from "../../src/lan-dispatcher";
import {
  LoadBalancer,
  LoadBalancerConfig,
  LoadBalancerStrategy,
  isSelectionError,
} from "../../src/load-balancer";
import { EndpointDefinition, LanCheckpointFile } from "../../src/types";

// ─── Test Doubles ────────────────────────────────────────────────────────────

class NoOpCheckpointStore implements CheckpointStore {
  save(_dispatchId: string, _checkpoint: LanCheckpointFile): void {}
  load(_dispatchId: string): LanCheckpointFile[] {
    return [];
  }
  clear(_dispatchId: string): void {}
}

class NoOpTelemetry implements TelemetryInterface {
  recordLanTask(): void {}
  recordLanFailure(): void {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupEnv(): void {
  process.env.SUBAGENT_LOCAL_HOST = "10.0.0.1";
  process.env.SUBAGENT_LOCAL_PORT = "9999";
}

function cleanupEnv(): void {
  delete process.env.SUBAGENT_LOCAL_HOST;
  delete process.env.SUBAGENT_LOCAL_PORT;
}

function makeConfig(strategy: LoadBalancerStrategy, retryLimit = 2): LoadBalancerConfig {
  return {
    strategy,
    retryLimit,
    localHost: "10.0.0.1",
    localPort: 9999,
  };
}

function makeEndpoints(count: number, maxConcurrency: number): EndpointDefinition[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ep-${i}`,
    host: `192.168.1.${10 + i}`,
    port: 1234 + i,
    models: ["test-model"],
    maxConcurrency,
    enabled: true,
    source: "manual" as const,
  }));
}

function createRegistry(endpoints: EndpointDefinition[]): EndpointRegistry {
  const registry = new EndpointRegistry(endpoints);
  for (const ep of endpoints) {
    registry.updateHealth(ep.id, true);
  }
  return registry;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate endpoint count (2-4) and task count (1-4) for dispatcher tests */
const dispatchScenarioArb = fc.record({
  endpointCount: fc.integer({ min: 2, max: 4 }),
  taskCount: fc.integer({ min: 1, max: 4 }),
  maxConcurrency: fc.integer({ min: 2, max: 10 }),
  strategy: fc.constantFrom(
    "round-robin" as const,
    "least-connections" as const,
    "weighted" as const,
  ),
});

/** Generate endpoint count (2-6) for LoadBalancer redistribution logic tests */
const redistributionArb = fc.record({
  endpointCount: fc.integer({ min: 2, max: 6 }),
  failIndex: fc.integer({ min: 0, max: 5 }),
  strategy: fc.constantFrom(
    "round-robin" as const,
    "least-connections" as const,
    "weighted" as const,
  ),
});

// ─── Property 17 Tests ──────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 17: Task redistribution on endpoint failure", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  afterEach(() => {
    nock.cleanAll();
    nock.restore();
    nock.activate();
  });

  /**
   * **Validates: Requirements 10.1**
   *
   * Test 1 — LoadBalancer redistribution logic (pure, no HTTP):
   * When an endpoint becomes unhealthy, getCandidates excludes it and
   * returns other healthy endpoints, proving redistribution is possible.
   */
  it("getCandidates excludes unhealthy endpoints and returns remaining healthy ones", () => {
    fc.assert(
      fc.property(redistributionArb, ({ endpointCount, failIndex, strategy }) => {
        const count = endpointCount;
        const endpoints = makeEndpoints(count, 10);
        const registry = createRegistry(endpoints);
        const lb = new LoadBalancer(registry, makeConfig(strategy));

        // Simulate initial selection — pick endpoint that will "fail"
        const targetIdx = failIndex % count;
        const failedId = endpoints[targetIdx].id;

        // Mark the target endpoint as unhealthy (simulating mid-dispatch failure)
        registry.updateHealth(failedId, false, "simulated connection failure");

        // Get candidates excluding the failed endpoint
        const candidates = lb.getCandidates(undefined, [failedId]);

        // Assert: failed endpoint is NOT in candidates
        const candidateIds = candidates.map((c) => c.definition.id);
        expect(candidateIds).not.toContain(failedId);

        // Assert: all candidates are healthy
        for (const candidate of candidates) {
          expect(candidate.health).toBe("healthy");
        }

        // Assert: at least one candidate exists (since N >= 2 and only one failed)
        expect(candidates.length).toBeGreaterThanOrEqual(1);

        // Assert: no candidate is at max capacity
        for (const candidate of candidates) {
          expect(candidate.activeTaskCount).toBeLessThan(candidate.definition.maxConcurrency);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.1**
   *
   * Test 2 — Dispatcher retry redistributes tasks to healthy endpoints via HTTP:
   * When one endpoint returns HTTP 500, the dispatcher retries the task on
   * a different healthy endpoint that responds successfully.
   * All tasks complete, and successful results come from non-failing endpoints.
   */
  it("dispatcher redistributes tasks from failing endpoint to healthy ones", () => {
    fc.assert(
      fc.asyncProperty(
        dispatchScenarioArb,
        async ({ endpointCount, taskCount, maxConcurrency, strategy }) => {
          nock.cleanAll();

          const endpoints = makeEndpoints(endpointCount, maxConcurrency);
          const registry = createRegistry(endpoints);
          const lb = new LoadBalancer(registry, makeConfig(strategy, 2));
          const healthCheckerConfig: HealthCheckerConfig = {
            intervalMs: 30000,
            timeoutMs: 5000,
            failureThreshold: 2,
          };
          const healthChecker = new HealthChecker(registry, healthCheckerConfig);

          const dispatcher = new LanDispatcher({
            registry,
            loadBalancer: lb,
            healthChecker,
            telemetry: new NoOpTelemetry(),
            dedupCache: new InMemoryDedupCache(),
            checkpointStore: new NoOpCheckpointStore(),
          });

          // First endpoint (ep-0) always fails with HTTP 500
          const failingEndpoint = endpoints[0];
          nock(`http://${failingEndpoint.host}:${failingEndpoint.port}`)
            .post("/v1/chat/completions")
            .times(taskCount * 3) // Allow multiple retry attempts
            .reply(500, { error: "Internal Server Error" });

          // All other endpoints succeed
          for (let i = 1; i < endpointCount; i++) {
            const ep = endpoints[i];
            nock(`http://${ep.host}:${ep.port}`)
              .post("/v1/chat/completions")
              .times(taskCount * 3) // Allow for retries
              .reply(200, {
                choices: [{ message: { content: `Response from ep-${i}` } }],
              });
          }

          // Build task manifest
          const tasks = Array.from({ length: taskCount }, (_, i) => ({
            taskId: `task-${i}`,
            prompt: `Test prompt ${i}`,
          }));

          const result = await dispatcher.dispatch({ tasks, concurrency: 2 });

          // Assert: all tasks have a result (no task left unassigned)
          expect(result.results.length).toBe(taskCount);

          // Assert: successful results come from non-failing endpoints
          const successfulResults = result.results.filter((r) => r.success);
          for (const r of successfulResults) {
            expect(r.endpointId).not.toBe(failingEndpoint.id);
          }

          // Assert: if tasks succeeded, they were redistributed
          // (the failing endpoint appears in retryEndpoints for redistributed tasks)
          for (const r of successfulResults) {
            if (r.retryEndpoints && r.retryEndpoints.length > 0) {
              expect(r.retryEndpoints).toContain(failingEndpoint.id);
            }
          }

          // Assert: all tasks either succeeded or have a final status (no pending)
          for (const r of result.results) {
            expect(r.status === "success" || r.status === "failed").toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.1**
   *
   * Test 3 — Multiple failures: when several endpoints fail, pending tasks
   * still get assigned to remaining healthy endpoints.
   */
  it("getCandidates handles multiple failed endpoints correctly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 6 }),
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom("round-robin" as const, "least-connections" as const, "weighted" as const),
        (endpointCount, failCount, strategy) => {
          // Ensure failCount < endpointCount so at least one healthy remains
          const actualFailCount = Math.min(failCount, endpointCount - 1);

          const endpoints = makeEndpoints(endpointCount, 10);
          const registry = createRegistry(endpoints);
          const lb = new LoadBalancer(registry, makeConfig(strategy));

          // Mark first N endpoints as failed
          const failedIds: string[] = [];
          for (let i = 0; i < actualFailCount; i++) {
            registry.updateHealth(endpoints[i].id, false, "simulated failure");
            failedIds.push(endpoints[i].id);
          }

          // Get candidates excluding all failed endpoints
          const candidates = lb.getCandidates(undefined, failedIds);

          // Assert: no failed endpoint appears in candidates
          for (const failedId of failedIds) {
            const candidateIds = candidates.map((c) => c.definition.id);
            expect(candidateIds).not.toContain(failedId);
          }

          // Assert: at least one healthy candidate remains
          expect(candidates.length).toBeGreaterThanOrEqual(1);

          // Assert: all returned candidates are healthy and enabled
          for (const c of candidates) {
            expect(c.health).toBe("healthy");
            expect(c.definition.enabled).toBe(true);
          }

          // Assert: total candidates = endpointCount - failedCount
          expect(candidates.length).toBe(endpointCount - actualFailCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 18 Arbitraries ─────────────────────────────────────────────────

/** Strategy arbitrary for Property 18 */
const p18StrategyArb: fc.Arbitrary<LoadBalancerStrategy> = fc.constantFrom(
  "round-robin" as const,
  "least-connections" as const,
  "weighted" as const,
);

/**
 * Generate N >= 2 endpoint configs with a target index for the endpoint
 * that will transition unhealthy→healthy, plus the number of selection
 * attempts to perform while the endpoint is unhealthy.
 */
const p18RecoveredEndpointArb = fc.integer({ min: 2, max: 6 }).chain((n) =>
  fc.tuple(
    fc.array(fc.record({ maxConcurrency: fc.integer({ min: 5, max: 50 }) }), {
      minLength: n,
      maxLength: n,
    }),
    fc.integer({ min: 0, max: n - 1 }), // index of endpoint to mark unhealthy
    p18StrategyArb,
    fc.integer({ min: 10, max: 30 }), // number of selectEndpoint calls while unhealthy
  ),
);

// ─── Property 18 Helpers ─────────────────────────────────────────────────────

function makeP18Endpoints(configs: { maxConcurrency: number }[]): EndpointDefinition[] {
  return configs.map((cfg, i) => ({
    id: `p18-ep-${i}`,
    host: `192.168.${Math.floor(i / 256) + 2}.${(i % 256) + 10}`,
    port: 1234,
    models: ["test-model"],
    maxConcurrency: cfg.maxConcurrency,
    enabled: true,
    source: "manual" as const,
  }));
}

function createP18Registry(endpoints: EndpointDefinition[]): EndpointRegistry {
  const registry = new EndpointRegistry(endpoints);
  for (const ep of endpoints) {
    registry.updateHealth(ep.id, true);
  }
  return registry;
}

function makeP18Config(strategy: LoadBalancerStrategy): LoadBalancerConfig {
  return {
    strategy,
    retryLimit: 2,
    localHost: "10.0.0.1",
    localPort: 9999,
  };
}

// ─── Property 18 Tests ──────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 18: Recovered endpoint requires health verification", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /**
   * **Validates: Requirements 10.3**
   *
   * For any endpoint that was marked unhealthy, no call to selectEndpoint()
   * returns that endpoint until updateHealth(id, true) is explicitly called.
   * This ensures "recovered endpoint requires health verification" — the endpoint
   * must pass a health probe (which calls updateHealth) before getting new tasks.
   */
  it("unhealthy endpoint is never selected until updateHealth(id, true) is called", () => {
    fc.assert(
      fc.property(
        p18RecoveredEndpointArb,
        ([endpointConfigs, unhealthyIndex, strategy, selectionCount]) => {
          // Step 1: Generate N >= 2 endpoints, all initially healthy
          const definitions = makeP18Endpoints(endpointConfigs);
          const registry = createP18Registry(definitions);
          const lb = new LoadBalancer(registry, makeP18Config(strategy));

          const unhealthyId = definitions[unhealthyIndex].id;

          // Step 2: Mark one endpoint as unhealthy (simulating a failed health probe)
          registry.updateHealth(unhealthyId, false, "simulated failure");

          // Step 3: Call selectEndpoint() multiple times
          // Verify: the unhealthy endpoint is NEVER selected
          for (let i = 0; i < selectionCount; i++) {
            const result = lb.selectEndpoint();
            if (!isSelectionError(result)) {
              expect(result.endpoint.definition.id).not.toBe(unhealthyId);
            }
          }

          // Step 4: Call updateHealth(id, true) — simulating a successful health probe
          registry.updateHealth(unhealthyId, true);

          // Step 5: Now the endpoint is back in the healthy pool and eligible for selection.
          // Verify via getCandidates (which filters on healthy+enabled) that it's in the pool.
          const recoveredCandidates = lb.getCandidates();
          const recoveredIds = recoveredCandidates.map((c) => c.definition.id);
          expect(recoveredIds).toContain(unhealthyId);

          // Additionally verify the endpoint state is now "healthy"
          const recoveredState = registry.getEndpoint(unhealthyId);
          expect(recoveredState?.health).toBe("healthy");
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * getCandidates() also respects the health invariant: an unhealthy endpoint
   * never appears in retry candidates until explicitly recovered via updateHealth.
   */
  it("unhealthy endpoint never appears in getCandidates results until recovered", () => {
    fc.assert(
      fc.property(p18RecoveredEndpointArb, ([endpointConfigs, unhealthyIndex, strategy]) => {
        const definitions = makeP18Endpoints(endpointConfigs);
        const registry = createP18Registry(definitions);
        const lb = new LoadBalancer(registry, makeP18Config(strategy));

        const unhealthyId = definitions[unhealthyIndex].id;

        // Mark the target endpoint as unhealthy
        registry.updateHealth(unhealthyId, false, "simulated failure");

        // getCandidates should never include the unhealthy endpoint
        const candidates = lb.getCandidates();
        const candidateIds = candidates.map((c) => c.definition.id);
        expect(candidateIds).not.toContain(unhealthyId);

        // After recovery via updateHealth(id, true), it should appear in candidates
        registry.updateHealth(unhealthyId, true);
        const recoveredCandidates = lb.getCandidates();
        const recoveredIds = recoveredCandidates.map((c) => c.definition.id);
        expect(recoveredIds).toContain(unhealthyId);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.3**
   *
   * The invariant holds across all three load balancing strategies:
   * between the time an endpoint is marked unhealthy and when updateHealth(id, true)
   * is called, that endpoint is NEVER selected regardless of strategy.
   */
  it("invariant holds across all strategies: unhealthy endpoints are excluded from selection", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }).chain((n) =>
          fc.tuple(
            fc.array(fc.record({ maxConcurrency: fc.integer({ min: 5, max: 30 }) }), {
              minLength: n,
              maxLength: n,
            }),
            fc.integer({ min: 0, max: n - 1 }),
          ),
        ),
        ([endpointConfigs, unhealthyIndex]) => {
          const definitions = makeP18Endpoints(endpointConfigs);
          const unhealthyId = definitions[unhealthyIndex].id;

          // Test across all three strategies
          const strategies: LoadBalancerStrategy[] = [
            "round-robin",
            "least-connections",
            "weighted",
          ];

          for (const strategy of strategies) {
            const registry = createP18Registry(definitions);

            // Mark one endpoint unhealthy
            registry.updateHealth(unhealthyId, false, "simulated failure");

            const lb = new LoadBalancer(registry, makeP18Config(strategy));

            // Call selectEndpoint 20 times per strategy
            for (let i = 0; i < 20; i++) {
              const result = lb.selectEndpoint();
              if (!isSelectionError(result)) {
                expect(result.endpoint.definition.id).not.toBe(unhealthyId);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
