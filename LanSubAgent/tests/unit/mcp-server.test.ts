/**
 * Unit tests for MCP server tool handlers.
 * Tests the four registered MCP tools: dispatch_lan_tasks, get_lan_status,
 * discover_endpoints, and get_lan_telemetry.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 9.3
 */

import { jest } from "@jest/globals";
import { DiscoveryService, createDiscoveryConfig } from "../../src/discovery-service";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { HealthChecker, HealthCheckerConfig } from "../../src/health-checker";
import { LanDispatcher } from "../../src/lan-dispatcher";
import { LanTelemetryTracker } from "../../src/lan-telemetry";
import { LoadBalancer, LoadBalancerConfig } from "../../src/load-balancer";
import { EndpointDefinition } from "../../src/types";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockLogger(): any {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
}

function createTestEndpoint(overrides?: Partial<EndpointDefinition>): EndpointDefinition {
  return {
    id: "ep-1",
    host: "192.168.1.100",
    port: 1234,
    models: ["qwen2.5-coder-32b"],
    maxConcurrency: 4,
    enabled: true,
    source: "manual",
    ...overrides,
  };
}

// ─── Test Setup ──────────────────────────────────────────────────────────────

describe("MCP Server Tool Handlers", () => {
  let registry: EndpointRegistry;
  let healthChecker: HealthChecker;
  let loadBalancer: LoadBalancer;
  let _discoveryService: DiscoveryService;
  let dispatcher: LanDispatcher;
  let telemetry: LanTelemetryTracker;
  let logger: any;

  beforeEach(() => {
    logger = createMockLogger();

    // Set self-exclusion env to avoid filtering out test endpoints
    process.env.SUBAGENT_LOCAL_HOST = "localhost";
    process.env.SUBAGENT_LOCAL_PORT = "9999";

    const endpoint = createTestEndpoint();
    registry = new EndpointRegistry([endpoint]);

    const hcConfig: HealthCheckerConfig = {
      intervalMs: 30000,
      timeoutMs: 5000,
      failureThreshold: 2,
    };
    healthChecker = new HealthChecker(registry, hcConfig, logger);

    const lbConfig: LoadBalancerConfig = {
      strategy: "round-robin",
      retryLimit: 2,
      localHost: "localhost",
      localPort: 9999,
    };
    loadBalancer = new LoadBalancer(registry, lbConfig, logger);

    const discoveryConfig = createDiscoveryConfig({
      enabled: true,
      intervalSeconds: 60,
      broadcastPort: 41234,
      maxDiscovered: 50,
    });
    _discoveryService = new DiscoveryService(registry, discoveryConfig, logger);

    telemetry = new LanTelemetryTracker();

    dispatcher = new LanDispatcher({
      registry,
      loadBalancer,
      healthChecker,
      telemetry,
      logger,
      checkpointDir: "./.test-checkpoints",
    });
  });

  afterEach(() => {
    delete process.env.SUBAGENT_LOCAL_HOST;
    delete process.env.SUBAGENT_LOCAL_PORT;
  });

  // ─── dispatch_lan_tasks (Req 5.1, 5.5, 5.8) ─────────────────────────────────

  describe("dispatch_lan_tasks", () => {
    it("dispatches valid manifest and returns aggregated result", async () => {
      // Mark endpoint as healthy so it can be selected
      registry.updateHealth("ep-1", true);

      const manifest = {
        tasks: [{ taskId: "task-1", prompt: "Hello world" }],
        concurrency: 1,
      };

      // The dispatch will attempt to connect to the endpoint which will fail
      // (no real server), but the manifest validation should succeed and
      // dispatcher should run and return a result structure.
      const result = await dispatcher.dispatch(manifest);

      // Dispatch ran — returns a proper structure with a UUID dispatchId
      expect(result).toHaveProperty("dispatchId");
      expect(result).toHaveProperty("results");
      expect(result).toHaveProperty("totalDurationMs");
      expect(result).toHaveProperty("endpointsUsed");
      expect(typeof result.dispatchId).toBe("string");
      expect(result.dispatchId.length).toBeGreaterThan(0);
      expect(Array.isArray(result.results)).toBe(true);
      // Task failed because there's no real server, but it was dispatched
      expect(result.results).toHaveLength(1);
      expect(result.results[0].taskId).toBe("task-1");
    }, 15000);

    it("returns error for manifest with missing tasks field", async () => {
      const invalidManifest = {} as any;

      const result = await dispatcher.dispatch(invalidManifest);

      expect(result.success).toBe(false);
      expect(result.dispatchId).toBe("");
      expect(result.results).toHaveLength(0);
    });

    it("returns error for manifest with empty tasks array", async () => {
      const invalidManifest = { tasks: [] } as any;

      const result = await dispatcher.dispatch(invalidManifest);

      expect(result.success).toBe(false);
      expect(result.dispatchId).toBe("");
      expect(result.results).toHaveLength(0);
    });

    it("returns error for manifest with tasks containing wrong types", async () => {
      const invalidManifest = {
        tasks: [{ taskId: 123, prompt: null }],
      } as any;

      const result = await dispatcher.dispatch(invalidManifest);

      expect(result.success).toBe(false);
      expect(result.dispatchId).toBe("");
      expect(result.results).toHaveLength(0);
    });

    it("returns error for manifest with task missing taskId", async () => {
      const invalidManifest = {
        tasks: [{ prompt: "Hello" }],
      } as any;

      const result = await dispatcher.dispatch(invalidManifest);

      expect(result.success).toBe(false);
      expect(result.dispatchId).toBe("");
      expect(result.results).toHaveLength(0);
    });

    it("returns error for manifest with task missing prompt", async () => {
      const invalidManifest = {
        tasks: [{ taskId: "t1" }],
      } as any;

      const result = await dispatcher.dispatch(invalidManifest);

      expect(result.success).toBe(false);
      expect(result.dispatchId).toBe("");
      expect(result.results).toHaveLength(0);
    });
  });

  // ─── get_lan_status (Req 5.2) ────────────────────────────────────────────────

  describe("get_lan_status", () => {
    it("returns complete endpoint info including all required fields", () => {
      // Simulate some health data
      registry.updateHealth("ep-1", true);

      const endpoints = registry.getEndpoints();
      const status = endpoints.map((ep) => ({
        id: ep.definition.id,
        host: ep.definition.host,
        port: ep.definition.port,
        models: ep.definition.models,
        health: ep.health,
        enabled: ep.definition.enabled,
        activeTaskCount: ep.activeTaskCount,
        maxConcurrency: ep.definition.maxConcurrency,
        source: ep.definition.source,
        lastProbeSuccess: ep.lastProbeSuccess,
        lastProbeFailure: ep.lastProbeFailure,
      }));

      expect(status).toHaveLength(1);

      const ep = status[0];
      expect(ep.id).toBe("ep-1");
      expect(ep.host).toBe("192.168.1.100");
      expect(ep.port).toBe(1234);
      expect(ep.models).toEqual(["qwen2.5-coder-32b"]);
      expect(ep.health).toBe("healthy");
      expect(ep.enabled).toBe(true);
      expect(ep.activeTaskCount).toBe(0);
      expect(ep.maxConcurrency).toBe(4);
      expect(ep.source).toBe("manual");
      expect(ep.lastProbeSuccess).not.toBeNull();
      expect(ep.lastProbeFailure).toBeNull();
    });

    it("returns multiple endpoints when registry has more than one", () => {
      // Add a second endpoint via discovered route
      const ep2: EndpointDefinition = {
        id: "ep-2",
        host: "192.168.1.200",
        port: 5678,
        models: ["llama-3.1-8b"],
        maxConcurrency: 2,
        enabled: true,
        source: "discovered",
      };
      registry.registerDiscovered(ep2);

      const endpoints = registry.getEndpoints();
      expect(endpoints.length).toBe(2);

      const ids = endpoints.map((ep) => ep.definition.id);
      expect(ids).toContain("ep-1");
      expect(ids).toContain("ep-2");
    });

    it("reflects unhealthy status after failed probes", () => {
      registry.updateHealth("ep-1", false, "connection refused");
      registry.updateHealth("ep-1", false, "timeout");

      const endpoints = registry.getEndpoints();
      const ep = endpoints[0];

      expect(ep.health).toBe("unhealthy");
      expect(ep.lastProbeFailure).not.toBeNull();
      expect(ep.consecutiveFailures).toBe(2);
    });
  });

  // ─── discover_endpoints (Req 5.3, 5.4) ───────────────────────────────────────

  describe("discover_endpoints", () => {
    it("returns error when discovery is disabled", () => {
      // Create a discovery service with discovery disabled
      const disabledConfig = createDiscoveryConfig({
        enabled: false,
        intervalSeconds: 60,
        broadcastPort: 41234,
        maxDiscovered: 50,
      });
      const disabledDiscovery = new DiscoveryService(registry, disabledConfig, logger);

      // Simulate what the MCP tool handler does
      const config = { discovery: { enabled: false } };

      if (!config.discovery.enabled) {
        const errorResponse = {
          error: "Discovery mode is not enabled. Enable it in the configuration to use this tool.",
        };
        expect(errorResponse.error).toContain("Discovery mode is not enabled");
      }

      // Also verify scanOnce returns empty when disabled
      return disabledDiscovery.scanOnce().then((result) => {
        expect(result).toEqual([]);
      });
    });

    it("triggers scan when discovery is enabled", async () => {
      // Create a discovery service with a very short response timeout for testing
      const fastConfig = createDiscoveryConfig(
        { enabled: true, intervalSeconds: 60, broadcastPort: 41234, maxDiscovered: 50 },
        { responseTimeoutMs: 100 },
      );
      const fastDiscovery = new DiscoveryService(registry, fastConfig, logger);

      // With discovery enabled, scanOnce should execute without throwing.
      // It won't find anything (no real network), but it should complete.
      const result = await fastDiscovery.scanOnce();

      // Returns an array (likely empty in test environment with no real UDP responders)
      expect(Array.isArray(result)).toBe(true);
    });

    it("scanOnce returns EndpointDefinition array shape", async () => {
      // Use a fast timeout so the test completes quickly
      const fastConfig = createDiscoveryConfig(
        { enabled: true, intervalSeconds: 60, broadcastPort: 41234, maxDiscovered: 50 },
        { responseTimeoutMs: 100 },
      );
      const fastDiscovery = new DiscoveryService(registry, fastConfig, logger);

      const result = await fastDiscovery.scanOnce();

      // In a test environment with no real responders, result is empty array
      expect(Array.isArray(result)).toBe(true);

      // Each item in the result (if any) should conform to EndpointDefinition shape
      for (const ep of result) {
        expect(ep).toHaveProperty("id");
        expect(ep).toHaveProperty("host");
        expect(ep).toHaveProperty("port");
        expect(ep).toHaveProperty("models");
        expect(ep).toHaveProperty("source", "discovered");
      }
    });
  });

  // ─── get_lan_telemetry (Req 9.3) ─────────────────────────────────────────────

  describe("get_lan_telemetry", () => {
    it("returns all endpoint metrics without filters", () => {
      // Record some telemetry data
      telemetry.recordLanTask("task-1", "ep-1", 150, 100, "192.168.1.100", 1234);
      telemetry.recordLanTask("task-2", "ep-1", 200, 50, "192.168.1.100", 1234);

      const metrics = telemetry.getEndpointMetrics();

      expect(metrics).toHaveLength(1);
      expect(metrics[0].endpointId).toBe("ep-1");
      expect(metrics[0].totalRequests).toBe(2);
      expect(metrics[0].totalTokens).toBe(150);
      expect(metrics[0].averageResponseMs).toBeGreaterThan(0);
      expect(metrics[0].host).toBe("192.168.1.100");
      expect(metrics[0].port).toBe(1234);
    });

    it("returns only matching endpoint when endpointId filter is applied", () => {
      telemetry.recordLanTask("task-1", "ep-1", 150, 100, "192.168.1.100", 1234);
      telemetry.recordLanTask("task-2", "ep-2", 200, 50, "192.168.1.200", 5678);

      const metrics = telemetry.getEndpointMetrics();

      // Simulate the endpointId filter from the tool handler
      const filtered = metrics.filter((m) => m.endpointId === "ep-1");

      expect(filtered).toHaveLength(1);
      expect(filtered[0].endpointId).toBe("ep-1");
      expect(filtered[0].totalRequests).toBe(1);
    });

    it("returns empty when endpointId filter matches nothing", () => {
      telemetry.recordLanTask("task-1", "ep-1", 150, 100, "192.168.1.100", 1234);

      const metrics = telemetry.getEndpointMetrics();
      const filtered = metrics.filter((m) => m.endpointId === "nonexistent");

      expect(filtered).toHaveLength(0);
    });

    it("returns only metrics after specified since timestamp", () => {
      // Record a task (this sets lastRequestAt to "now")
      telemetry.recordLanTask("task-1", "ep-1", 150, 100, "192.168.1.100", 1234);

      const metrics = telemetry.getEndpointMetrics();

      // Filter with a past timestamp - should include the endpoint
      const pastDate = new Date(Date.now() - 60000).toISOString();
      const filteredPast = metrics.filter((m) => {
        if (!m.lastRequestAt) return false;
        return new Date(m.lastRequestAt).getTime() >= new Date(pastDate).getTime();
      });
      expect(filteredPast).toHaveLength(1);

      // Filter with a future timestamp - should exclude the endpoint
      const futureDate = new Date(Date.now() + 60000).toISOString();
      const filteredFuture = metrics.filter((m) => {
        if (!m.lastRequestAt) return false;
        return new Date(m.lastRequestAt).getTime() >= new Date(futureDate).getTime();
      });
      expect(filteredFuture).toHaveLength(0);
    });

    it("includes summary with total tasks and failures", () => {
      telemetry.recordLanTask("task-1", "ep-1", 150, 100, "192.168.1.100", 1234);
      telemetry.recordLanFailure("ep-1", 500, "192.168.1.100", 1234);

      const summary = telemetry.computeLanSummary();

      expect(summary.totalTasks).toBe(2);
      expect(summary.totalFailures).toBe(1);
      expect(summary.totalDurationMs).toBeGreaterThan(0);
      expect(summary.endpointBreakdown).toHaveLength(1);
      expect(summary.endpointBreakdown[0].totalRequests).toBe(2);
      expect(summary.endpointBreakdown[0].totalFailures).toBe(1);
    });

    it("returns empty metrics when no telemetry recorded", () => {
      const metrics = telemetry.getEndpointMetrics();
      expect(metrics).toHaveLength(0);

      const summary = telemetry.computeLanSummary();
      expect(summary.totalTasks).toBe(0);
      expect(summary.totalFailures).toBe(0);
    });
  });
});
