/**
 * Integration test for full LAN dispatch flow.
 * Tests end-to-end task dispatch across multiple LAN endpoints,
 * verifying load distribution, dedup cache, checkpoints, and telemetry.
 *
 * Validates: Requirements 5.5, 5.7, 9.4
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import nock from "nock";

import { EndpointRegistry } from "../../src/endpoint-registry";
import { HealthChecker, HealthCheckerConfig } from "../../src/health-checker";
import { FileCheckpointStore, InMemoryDedupCache, LanDispatcher } from "../../src/lan-dispatcher";
import { LanTelemetryTracker } from "../../src/lan-telemetry";
import { LoadBalancer, LoadBalancerConfig } from "../../src/load-balancer";
import { EndpointDefinition, TaskManifest } from "../../src/types";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeEndpoint(id: string, host: string, port: number): EndpointDefinition {
  return {
    id,
    host,
    port,
    models: ["test-model"],
    maxConcurrency: 10,
    enabled: true,
    source: "manual",
  };
}

function makeLbConfig(): LoadBalancerConfig {
  return {
    strategy: "round-robin",
    retryLimit: 2,
    localHost: "localhost",
    localPort: 9999,
  };
}

function makeHealthConfig(): HealthCheckerConfig {
  return {
    intervalMs: 60000,
    timeoutMs: 5000,
    failureThreshold: 2,
  };
}

function mockChatCompletionResponse(taskContent: string) {
  return {
    choices: [{ message: { content: taskContent } }],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Integration: Full Dispatch Flow", () => {
  let tmpDir: string;

  beforeEach(() => {
    // Set env vars so test endpoints aren't excluded as local
    process.env.SUBAGENT_LOCAL_HOST = "localhost";
    process.env.SUBAGENT_LOCAL_PORT = "9999";

    // Create a temp directory for checkpoints
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lan-dispatch-test-"));

    // Clean up any leftover nock interceptors
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.restore();
    nock.activate();

    // Clean up temp checkpoint directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dispatches tasks across multiple endpoints with correct distribution and telemetry", async () => {
    // ─── 1. Create endpoint definitions ───────────────────────────────
    const endpoints: EndpointDefinition[] = [
      makeEndpoint("ep-alpha", "192.168.1.10", 1234),
      makeEndpoint("ep-beta", "192.168.1.11", 1234),
      makeEndpoint("ep-gamma", "192.168.1.12", 5000),
    ];

    // ─── 2. Create EndpointRegistry and mark all healthy ──────────────
    const registry = new EndpointRegistry(endpoints);
    registry.updateHealth("ep-alpha", true);
    registry.updateHealth("ep-beta", true);
    registry.updateHealth("ep-gamma", true);

    // ─── 3. Set up nock interceptors ──────────────────────────────────
    const interceptorCalls: Record<string, number> = {
      "ep-alpha": 0,
      "ep-beta": 0,
      "ep-gamma": 0,
    };

    const _alphaScope = nock("http://192.168.1.10:1234")
      .post("/v1/chat/completions")
      .times(6)
      .reply(200, (_uri: string, body: any) => {
        interceptorCalls["ep-alpha"]++;
        const userMsg = body.messages?.find((m: any) => m.role === "user");
        return mockChatCompletionResponse(
          `mock response from alpha for: ${userMsg?.content ?? "unknown"}`,
        );
      });

    const _betaScope = nock("http://192.168.1.11:1234")
      .post("/v1/chat/completions")
      .times(6)
      .reply(200, (_uri: string, body: any) => {
        interceptorCalls["ep-beta"]++;
        const userMsg = body.messages?.find((m: any) => m.role === "user");
        return mockChatCompletionResponse(
          `mock response from beta for: ${userMsg?.content ?? "unknown"}`,
        );
      });

    const _gammaScope = nock("http://192.168.1.12:5000")
      .post("/v1/chat/completions")
      .times(6)
      .reply(200, (_uri: string, body: any) => {
        interceptorCalls["ep-gamma"]++;
        const userMsg = body.messages?.find((m: any) => m.role === "user");
        return mockChatCompletionResponse(
          `mock response from gamma for: ${userMsg?.content ?? "unknown"}`,
        );
      });

    // ─── 4. Create components ─────────────────────────────────────────
    const loadBalancer = new LoadBalancer(registry, makeLbConfig());
    const healthChecker = new HealthChecker(registry, makeHealthConfig());
    const telemetry = new LanTelemetryTracker();
    const dedupCache = new InMemoryDedupCache();
    const checkpointStore = new FileCheckpointStore(tmpDir);

    // ─── 5. Create LanDispatcher wired to all components ──────────────
    const dispatcher = new LanDispatcher({
      registry,
      loadBalancer,
      healthChecker,
      telemetry,
      dedupCache,
      checkpointStore,
    });

    // ─── 6. Dispatch a manifest with 6 tasks ─────────────────────────
    const manifest: TaskManifest = {
      tasks: [
        { taskId: "task-1", prompt: "Summarize chapter 1" },
        { taskId: "task-2", prompt: "Summarize chapter 2" },
        { taskId: "task-3", prompt: "Summarize chapter 3" },
        { taskId: "task-4", prompt: "Summarize chapter 4" },
        { taskId: "task-5", prompt: "Summarize chapter 5" },
        { taskId: "task-6", prompt: "Summarize chapter 6" },
      ],
      concurrency: 3,
    };

    const result = await dispatcher.dispatch(manifest);

    // ─── 7. Verify results ────────────────────────────────────────────

    // 7a. All tasks complete successfully
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(6);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(result.dispatchId).toBeTruthy();

    // 7b. Tasks were distributed across endpoints (round-robin should spread them)
    const totalNockCalls =
      interceptorCalls["ep-alpha"] + interceptorCalls["ep-beta"] + interceptorCalls["ep-gamma"];
    expect(totalNockCalls).toBe(6);

    // With round-robin and 6 tasks across 3 endpoints, each should get 2
    expect(interceptorCalls["ep-alpha"]).toBe(2);
    expect(interceptorCalls["ep-beta"]).toBe(2);
    expect(interceptorCalls["ep-gamma"]).toBe(2);

    // 7c. Each result has a valid endpointId matching one of the configured endpoints
    const validEndpointIds = new Set(["ep-alpha", "ep-beta", "ep-gamma"]);
    for (const taskResult of result.results) {
      expect(validEndpointIds.has(taskResult.endpointId)).toBe(true);
      expect(taskResult.endpointId).toBeTruthy();
    }

    // Verify endpoint attribution in results (endpointsUsed field)
    expect(result.endpointsUsed.length).toBeGreaterThanOrEqual(2);
    for (const epId of result.endpointsUsed) {
      expect(validEndpointIds.has(epId)).toBe(true);
    }

    // 7d. Telemetry shows per-endpoint breakdown
    const summary = telemetry.computeLanSummary();
    expect(summary.totalTasks).toBe(6);
    expect(summary.totalFailures).toBe(0);
    expect(summary.endpointBreakdown.length).toBe(3);

    // Each endpoint should have 2 requests recorded in telemetry
    for (const epTelemetry of summary.endpointBreakdown) {
      expect(validEndpointIds.has(epTelemetry.endpointId)).toBe(true);
      expect(epTelemetry.totalRequests).toBe(2);
      expect(epTelemetry.totalFailures).toBe(0);
    }

    // 7e. Checkpoint files were created in the temp directory
    const dispatchDirs = fs.readdirSync(tmpDir);
    expect(dispatchDirs.length).toBe(1); // One dispatch directory

    const checkpointDir = path.join(tmpDir, dispatchDirs[0]);
    const checkpointFiles = fs.readdirSync(checkpointDir);
    expect(checkpointFiles.length).toBe(6); // One checkpoint per task

    // Verify checkpoint file content
    const sampleCheckpoint = JSON.parse(
      fs.readFileSync(path.join(checkpointDir, checkpointFiles[0]), "utf-8"),
    );
    expect(sampleCheckpoint).toHaveProperty("taskId");
    expect(sampleCheckpoint).toHaveProperty("inputHash");
    expect(sampleCheckpoint).toHaveProperty("result");
    expect(sampleCheckpoint).toHaveProperty("endpointId");
    expect(validEndpointIds.has(sampleCheckpoint.endpointId)).toBe(true);

    // 7f. Verify dedup cache is populated (dispatch same manifest again should use cache)
    // We can verify by checking that re-dispatching doesn't hit nock again
    nock.cleanAll(); // Remove all interceptors

    const cachedResult = await dispatcher.dispatch(manifest);
    expect(cachedResult.success).toBe(true);
    expect(cachedResult.results).toHaveLength(6);
    // Tasks were served from dedup cache — no new HTTP calls needed
  });

  it("records correct endpoint host and port in task results", async () => {
    const endpoints: EndpointDefinition[] = [
      makeEndpoint("ep-alpha", "192.168.1.10", 1234),
      makeEndpoint("ep-beta", "192.168.1.11", 1234),
    ];

    const registry = new EndpointRegistry(endpoints);
    registry.updateHealth("ep-alpha", true);
    registry.updateHealth("ep-beta", true);

    nock("http://192.168.1.10:1234")
      .post("/v1/chat/completions")
      .times(4)
      .reply(200, () => mockChatCompletionResponse("response from alpha"));

    nock("http://192.168.1.11:1234")
      .post("/v1/chat/completions")
      .times(4)
      .reply(200, () => mockChatCompletionResponse("response from beta"));

    const loadBalancer = new LoadBalancer(registry, makeLbConfig());
    const healthChecker = new HealthChecker(registry, makeHealthConfig());
    const telemetry = new LanTelemetryTracker();

    const dispatcher = new LanDispatcher({
      registry,
      loadBalancer,
      healthChecker,
      telemetry,
      checkpointDir: tmpDir,
    });

    const manifest: TaskManifest = {
      tasks: [
        { taskId: "t-1", prompt: "Task one" },
        { taskId: "t-2", prompt: "Task two" },
        { taskId: "t-3", prompt: "Task three" },
        { taskId: "t-4", prompt: "Task four" },
      ],
      concurrency: 2,
    };

    const result = await dispatcher.dispatch(manifest);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(4);

    // Verify endpoint host/port attribution
    for (const taskResult of result.results) {
      if (taskResult.endpointId === "ep-alpha") {
        expect(taskResult.endpointHost).toBe("192.168.1.10");
        expect(taskResult.endpointPort).toBe(1234);
      } else if (taskResult.endpointId === "ep-beta") {
        expect(taskResult.endpointHost).toBe("192.168.1.11");
        expect(taskResult.endpointPort).toBe(1234);
      } else {
        throw new Error(`Unexpected endpointId: ${taskResult.endpointId}`);
      }
    }

    // Verify responses contain expected content
    for (const taskResult of result.results) {
      expect(taskResult.response).toBeDefined();
      expect(taskResult.response!.length).toBeGreaterThan(0);
    }
  });

  it("handles retry and distributes to healthy endpoints when one fails", async () => {
    const endpoints: EndpointDefinition[] = [
      makeEndpoint("ep-good", "192.168.1.10", 1234),
      makeEndpoint("ep-bad", "192.168.1.11", 1234),
    ];

    const registry = new EndpointRegistry(endpoints);
    registry.updateHealth("ep-good", true);
    registry.updateHealth("ep-bad", true);

    // ep-bad returns 500 errors
    nock("http://192.168.1.11:1234")
      .post("/v1/chat/completions")
      .times(6)
      .reply(500, { error: "Internal Server Error" });

    // ep-good succeeds
    nock("http://192.168.1.10:1234")
      .post("/v1/chat/completions")
      .times(6)
      .reply(200, () => mockChatCompletionResponse("success from good endpoint"));

    const loadBalancer = new LoadBalancer(registry, {
      ...makeLbConfig(),
      retryLimit: 2,
    });
    const healthChecker = new HealthChecker(registry, makeHealthConfig());
    const telemetry = new LanTelemetryTracker();

    const dispatcher = new LanDispatcher({
      registry,
      loadBalancer,
      healthChecker,
      telemetry,
      checkpointDir: tmpDir,
    });

    const manifest: TaskManifest = {
      tasks: [
        { taskId: "retry-1", prompt: "Retry task 1" },
        { taskId: "retry-2", prompt: "Retry task 2" },
      ],
      concurrency: 1,
    };

    const result = await dispatcher.dispatch(manifest);

    // Tasks should still succeed after retry to good endpoint
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);

    // Telemetry should show failures on ep-bad
    const summary = telemetry.computeLanSummary();
    expect(summary.totalFailures).toBeGreaterThan(0);

    // ep-good should be in the endpoints used
    expect(result.endpointsUsed).toContain("ep-good");
  });
});
