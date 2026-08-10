/**
 * Property-based tests for endpoint attribution in results and checkpoints (Property 14).
 *
 * Property 14: Endpoint attribution in results and checkpoints
 * - Simulate task completions via LAN dispatch
 * - Assert: LanTaskResult and checkpoint both contain non-empty endpointId matching registry
 *
 * Validates: Requirements 5.7, 9.4
 *
 * @tag Feature: lan-sub-agent, Property 14: Endpoint attribution in results and checkpoints
 */

import * as fc from "fast-check";
import nock from "nock";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { HealthChecker } from "../../src/health-checker";
import { CheckpointStore, LanDispatcher, LanTelemetryTracker } from "../../src/lan-dispatcher";
import { LoadBalancer, LoadBalancerConfig } from "../../src/load-balancer";
import { EndpointDefinition, LanCheckpointFile, TaskManifest } from "../../src/types";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function setupEnv(): void {
  process.env.SUBAGENT_LOCAL_HOST = "10.0.0.1";
  process.env.SUBAGENT_LOCAL_PORT = "9999";
}

function cleanupEnv(): void {
  delete process.env.SUBAGENT_LOCAL_HOST;
  delete process.env.SUBAGENT_LOCAL_PORT;
}

/** Mock CheckpointStore that captures saved checkpoints */
class CapturingCheckpointStore implements CheckpointStore {
  saved: LanCheckpointFile[] = [];
  save(_dispatchId: string, checkpoint: LanCheckpointFile): void {
    this.saved.push(checkpoint);
  }
  load(_dispatchId: string): LanCheckpointFile[] {
    return [];
  }
  clear(_dispatchId: string): void {}
}

/** Mock telemetry tracker (no-op functions) */
const createMockTelemetry = (): LanTelemetryTracker => ({
  recordLanTask: () => {},
  recordLanFailure: () => {},
});

/** Minimal HealthChecker that does nothing (no probing during tests) */
function createNoopHealthChecker(registry: EndpointRegistry): HealthChecker {
  return new HealthChecker(registry, {
    intervalMs: 300000,
    timeoutMs: 5000,
    failureThreshold: 3,
  });
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate N healthy endpoints (2-5) with unique hosts and ports */
const endpointsArb = fc.integer({ min: 2, max: 5 }).chain((count) =>
  fc.tuple(
    ...Array.from({ length: count }, (_, i) =>
      fc.record({
        id: fc.constant(`ep-${i}-${192 + i}`),
        host: fc.constant(`192.168.1.${10 + i}`),
        port: fc.constant(8000 + i),
        models: fc.constant(["test-model"]),
        maxConcurrency: fc.integer({ min: 5, max: 20 }),
        enabled: fc.constant(true),
        source: fc.constant("manual" as const),
      }),
    ),
  ),
);

/** Generate K valid tasks (1-5) */
const tasksArb = fc.integer({ min: 1, max: 5 }).chain((count) =>
  fc.tuple(
    ...Array.from({ length: count }, (_, i) =>
      fc.record({
        taskId: fc.constant(`task-${i}`),
        prompt: fc.constant(`Test prompt for task ${i}`),
      }),
    ),
  ),
);

/** Combined arbitrary: endpoints + tasks */
const dispatchScenarioArb = fc.tuple(endpointsArb, tasksArb);

// ─── Property 14 Tests ───────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 14: Endpoint attribution in results and checkpoints", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());
  afterEach(() => {
    nock.cleanAll();
  });

  /**
   * **Validates: Requirements 5.7, 9.4**
   *
   * For any valid dispatch of tasks across healthy endpoints,
   * every successful LanTaskResult must contain a non-empty endpointId
   * that matches one of the registered endpoint IDs.
   */
  it("every successful LanTaskResult has a non-empty endpointId matching a registered endpoint", () => {
    return fc.assert(
      fc.asyncProperty(dispatchScenarioArb, async ([endpoints, tasks]) => {
        // Set up nock interceptors for each endpoint
        for (const ep of endpoints) {
          nock(`http://${ep.host}:${ep.port}`)
            .post("/v1/chat/completions")
            .reply(200, { choices: [{ message: { content: "response" } }] })
            .persist();
        }

        // Create registry and mark all endpoints as healthy
        const registry = new EndpointRegistry(endpoints as EndpointDefinition[]);
        for (const ep of endpoints) {
          registry.updateHealth(ep.id, true);
        }

        const lbConfig: LoadBalancerConfig = {
          strategy: "round-robin",
          retryLimit: 2,
          localHost: "10.0.0.1",
          localPort: 9999,
        };

        const loadBalancer = new LoadBalancer(registry, lbConfig);
        const healthChecker = createNoopHealthChecker(registry);
        const checkpointStore = new CapturingCheckpointStore();
        const telemetry = createMockTelemetry();

        const dispatcher = new LanDispatcher({
          registry,
          loadBalancer,
          healthChecker,
          telemetry,
          checkpointStore,
        });

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: 5,
        };

        const result = await dispatcher.dispatch(manifest);

        // Collect all registered endpoint IDs
        const registeredIds = new Set(endpoints.map((ep) => ep.id));

        // Assert: every successful result has non-empty endpointId matching registry
        const successfulResults = result.results.filter((r) => r.success);
        for (const taskResult of successfulResults) {
          expect(taskResult.endpointId).toBeTruthy();
          expect(typeof taskResult.endpointId).toBe("string");
          expect(taskResult.endpointId.length).toBeGreaterThan(0);
          expect(registeredIds.has(taskResult.endpointId)).toBe(true);
        }

        // Cleanup nock for this iteration
        nock.cleanAll();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.7, 9.4**
   *
   * For any valid dispatch of tasks across healthy endpoints,
   * every saved checkpoint must contain a non-empty endpointId
   * that matches one of the registered endpoint IDs.
   */
  it("every checkpoint saved has a non-empty endpointId matching a registered endpoint", () => {
    return fc.assert(
      fc.asyncProperty(dispatchScenarioArb, async ([endpoints, tasks]) => {
        // Set up nock interceptors for each endpoint
        for (const ep of endpoints) {
          nock(`http://${ep.host}:${ep.port}`)
            .post("/v1/chat/completions")
            .reply(200, { choices: [{ message: { content: "response" } }] })
            .persist();
        }

        // Create registry and mark all endpoints as healthy
        const registry = new EndpointRegistry(endpoints as EndpointDefinition[]);
        for (const ep of endpoints) {
          registry.updateHealth(ep.id, true);
        }

        const lbConfig: LoadBalancerConfig = {
          strategy: "round-robin",
          retryLimit: 2,
          localHost: "10.0.0.1",
          localPort: 9999,
        };

        const loadBalancer = new LoadBalancer(registry, lbConfig);
        const healthChecker = createNoopHealthChecker(registry);
        const checkpointStore = new CapturingCheckpointStore();
        const telemetry = createMockTelemetry();

        const dispatcher = new LanDispatcher({
          registry,
          loadBalancer,
          healthChecker,
          telemetry,
          checkpointStore,
        });

        const manifest: TaskManifest = {
          tasks: tasks.map((t) => ({ taskId: t.taskId, prompt: t.prompt })),
          concurrency: 5,
        };

        await dispatcher.dispatch(manifest);

        // Collect all registered endpoint IDs
        const registeredIds = new Set(endpoints.map((ep) => ep.id));

        // Assert: every checkpoint has non-empty endpointId matching registry
        for (const checkpoint of checkpointStore.saved) {
          expect(checkpoint.endpointId).toBeTruthy();
          expect(typeof checkpoint.endpointId).toBe("string");
          expect(checkpoint.endpointId.length).toBeGreaterThan(0);
          expect(registeredIds.has(checkpoint.endpointId)).toBe(true);
        }

        // Also verify checkpoints were actually saved (at least for successful tasks)
        expect(checkpointStore.saved.length).toBeGreaterThan(0);

        // Cleanup nock for this iteration
        nock.cleanAll();
      }),
      { numRuns: 100 },
    );
  });
});
