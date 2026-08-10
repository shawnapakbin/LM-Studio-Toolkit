import * as os from "os";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { EndpointDefinition } from "../../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<EndpointDefinition> = {}): EndpointDefinition {
  return {
    id: "ep-1",
    host: "192.168.1.10",
    port: 1234,
    models: ["qwen2.5-coder-32b"],
    maxConcurrency: 4,
    enabled: true,
    source: "manual" as const,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("EndpointRegistry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUBAGENT_LOCAL_HOST: "localhost",
      SUBAGENT_LOCAL_PORT: "1234",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("acquireSlot", () => {
    it("returns false when endpoint is at capacity", () => {
      const ep = makeEndpoint({ id: "ep-cap", maxConcurrency: 2 });
      const registry = new EndpointRegistry([ep]);

      // Acquire all available slots
      expect(registry.acquireSlot("ep-cap")).toBe(true);
      expect(registry.acquireSlot("ep-cap")).toBe(true);

      // Third acquire should fail — at capacity
      expect(registry.acquireSlot("ep-cap")).toBe(false);
    });

    it("returns false for a non-existent endpoint", () => {
      const registry = new EndpointRegistry([]);
      expect(registry.acquireSlot("non-existent")).toBe(false);
    });

    it("returns true after releasing a slot at capacity", () => {
      const ep = makeEndpoint({ id: "ep-release", maxConcurrency: 1 });
      const registry = new EndpointRegistry([ep]);

      expect(registry.acquireSlot("ep-release")).toBe(true);
      expect(registry.acquireSlot("ep-release")).toBe(false);

      registry.releaseSlot("ep-release");
      expect(registry.acquireSlot("ep-release")).toBe(true);
    });
  });

  describe("isLocalInstance", () => {
    it("resolves localhost as local instance", () => {
      const registry = new EndpointRegistry([]);
      expect(registry.isLocalInstance("localhost", 1234)).toBe(true);
    });

    it("resolves 127.0.0.1 as local instance", () => {
      const registry = new EndpointRegistry([]);
      expect(registry.isLocalInstance("127.0.0.1", 1234)).toBe(true);
    });

    it("resolves machine LAN IP as local instance", () => {
      // Find a non-internal address from os.networkInterfaces()
      const interfaces = os.networkInterfaces();
      let lanIp: string | null = null;
      for (const iface of Object.values(interfaces)) {
        if (!iface) continue;
        for (const addr of iface) {
          if (!addr.internal) {
            lanIp = addr.address;
            break;
          }
        }
        if (lanIp) break;
      }

      // Skip test if no LAN IP found (unlikely but defensive)
      if (!lanIp) {
        console.warn("No non-internal network interface found; skipping LAN IP test");
        return;
      }

      const registry = new EndpointRegistry([]);
      expect(registry.isLocalInstance(lanIp, 1234)).toBe(true);
    });

    it("does not resolve a different port as local instance", () => {
      const registry = new EndpointRegistry([]);
      expect(registry.isLocalInstance("localhost", 9999)).toBe(false);
    });

    it("does not resolve a remote IP as local instance", () => {
      const registry = new EndpointRegistry([]);
      expect(registry.isLocalInstance("10.0.0.99", 1234)).toBe(false);
    });

    it("is case-insensitive for host comparison", () => {
      const registry = new EndpointRegistry([]);
      expect(registry.isLocalInstance("LOCALHOST", 1234)).toBe(true);
      expect(registry.isLocalInstance("LocalHost", 1234)).toBe(true);
    });
  });

  describe("registerDiscovered — duplicate host:port prevention", () => {
    it("returns false and does not add a duplicate host:port", () => {
      const manual = makeEndpoint({ id: "manual-1", host: "192.168.1.50", port: 5000 });
      const registry = new EndpointRegistry([manual]);

      const duplicate = makeEndpoint({
        id: "discovered-dup",
        host: "192.168.1.50",
        port: 5000,
        source: "discovered",
      });

      expect(registry.registerDiscovered(duplicate)).toBe(false);
      expect(registry.getEndpoint("discovered-dup")).toBeUndefined();
    });

    it("returns false for case-insensitive duplicate host:port", () => {
      const manual = makeEndpoint({ id: "manual-upper", host: "MyServer", port: 4000 });
      const registry = new EndpointRegistry([manual]);

      const duplicate = makeEndpoint({
        id: "discovered-lower",
        host: "myserver",
        port: 4000,
        source: "discovered",
      });

      expect(registry.registerDiscovered(duplicate)).toBe(false);
      expect(registry.getEndpoint("discovered-lower")).toBeUndefined();
    });

    it("allows registration when host matches but port differs", () => {
      const manual = makeEndpoint({ id: "manual-port", host: "192.168.1.50", port: 5000 });
      const registry = new EndpointRegistry([manual]);

      const different = makeEndpoint({
        id: "discovered-diff-port",
        host: "192.168.1.50",
        port: 6000,
        source: "discovered",
      });

      expect(registry.registerDiscovered(different)).toBe(true);
      expect(registry.getEndpoint("discovered-diff-port")).toBeDefined();
    });
  });

  describe("getEndpoints — filter combinations", () => {
    let registry: EndpointRegistry;

    beforeEach(() => {
      const endpoints = [
        makeEndpoint({
          id: "ep-a",
          host: "192.168.1.10",
          port: 1000,
          models: ["modelA"],
          enabled: true,
        }),
        makeEndpoint({
          id: "ep-b",
          host: "192.168.1.11",
          port: 2000,
          models: ["modelB"],
          enabled: true,
        }),
        makeEndpoint({
          id: "ep-c",
          host: "192.168.1.12",
          port: 3000,
          models: ["modelA", "modelB"],
          enabled: false,
        }),
        makeEndpoint({
          id: "ep-d",
          host: "192.168.1.13",
          port: 4000,
          models: ["modelC"],
          enabled: true,
        }),
      ];
      registry = new EndpointRegistry(endpoints);

      // Set health states
      registry.updateHealth("ep-a", true);
      registry.updateHealth("ep-b", true);
      registry.updateHealth("ep-c", true);
      registry.updateHealth("ep-d", false);
    });

    it("filters by healthy only", () => {
      const results = registry.getEndpoints({ healthy: true });
      expect(results).toHaveLength(3);
      const ids = results.map((r) => r.definition.id);
      expect(ids).toContain("ep-a");
      expect(ids).toContain("ep-b");
      expect(ids).toContain("ep-c");
    });

    it("filters by enabled only", () => {
      const results = registry.getEndpoints({ enabled: true });
      expect(results).toHaveLength(3);
      const ids = results.map((r) => r.definition.id);
      expect(ids).toContain("ep-a");
      expect(ids).toContain("ep-b");
      expect(ids).toContain("ep-d");
    });

    it("filters by model only", () => {
      const results = registry.getEndpoints({ model: "modelA" });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.definition.id);
      expect(ids).toContain("ep-a");
      expect(ids).toContain("ep-c");
    });

    it("combines healthy + enabled filters", () => {
      const results = registry.getEndpoints({ healthy: true, enabled: true });
      expect(results).toHaveLength(2);
      const ids = results.map((r) => r.definition.id);
      expect(ids).toContain("ep-a");
      expect(ids).toContain("ep-b");
    });

    it("combines healthy + enabled + model filters", () => {
      const results = registry.getEndpoints({ healthy: true, enabled: true, model: "modelA" });
      expect(results).toHaveLength(1);
      expect(results[0].definition.id).toBe("ep-a");
    });

    it("returns empty array when no endpoints match all filters", () => {
      const results = registry.getEndpoints({ healthy: true, enabled: true, model: "modelC" });
      expect(results).toHaveLength(0);
    });

    it("returns all endpoints when no filter is specified", () => {
      const results = registry.getEndpoints();
      expect(results).toHaveLength(4);
    });
  });
});
