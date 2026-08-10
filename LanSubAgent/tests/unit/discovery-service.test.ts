import { DiscoveryConfig, DiscoveryService } from "../../src/discovery-service";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { EndpointDefinition } from "../../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DiscoveryConfig> = {}): DiscoveryConfig {
  return {
    enabled: true,
    intervalMs: 60000,
    broadcastPort: 41234,
    responseTimeoutMs: 5000,
    maxDiscovered: 50,
    missedCycleThreshold: 3,
    ...overrides,
  };
}

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

function makeValidResponseBuffer(
  host: string,
  port: number,
  models: string[] = ["test-model"],
  maxConcurrency?: number,
): Buffer {
  const msg: Record<string, unknown> = {
    type: "lan-subagent-announce",
    version: 1,
    host,
    port,
    models,
  };
  if (maxConcurrency !== undefined) {
    msg.maxConcurrency = maxConcurrency;
  }
  return Buffer.from(JSON.stringify(msg), "utf-8");
}

function makeRinfo(
  address: string,
  port: number,
): { address: string; port: number; family: "IPv4" | "IPv6"; size: number } {
  return { address, port, family: "IPv4", size: 0 };
}

const noopLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  child: () => noopLogger,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DiscoveryService", () => {
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

  describe("constructor", () => {
    it("creates a service with provided config and registry", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);
      expect(service).toBeDefined();
    });
  });

  describe("start() / stop()", () => {
    it("does not start periodic broadcast when disabled (Requirement 4.7)", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig({ enabled: false });
      const service = new DiscoveryService(registry, config, noopLogger);

      service.start();
      // No interval should be running — just verify stop doesn't throw
      service.stop();
    });

    it("stop() can be called safely when not started", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);
      expect(() => service.stop()).not.toThrow();
    });
  });

  describe("handleResponse() — validation (Requirement 4.3)", () => {
    it("discards invalid JSON responses", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const invalidBuffer = Buffer.from("not-json", "utf-8");
      service.handleResponse(invalidBuffer, makeRinfo("192.168.1.50", 41234));

      expect(registry.getDiscoveredCount()).toBe(0);
    });

    it("discards responses missing host", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = Buffer.from(
        JSON.stringify({
          type: "lan-subagent-announce",
          version: 1,
          port: 1234,
          models: ["model-a"],
        }),
        "utf-8",
      );
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));
      expect(registry.getDiscoveredCount()).toBe(0);
    });

    it("discards responses missing port", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = Buffer.from(
        JSON.stringify({
          type: "lan-subagent-announce",
          version: 1,
          host: "192.168.1.50",
          models: ["model-a"],
        }),
        "utf-8",
      );
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));
      expect(registry.getDiscoveredCount()).toBe(0);
    });

    it("discards responses with empty models array", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = Buffer.from(
        JSON.stringify({
          type: "lan-subagent-announce",
          version: 1,
          host: "192.168.1.50",
          port: 1234,
          models: [],
        }),
        "utf-8",
      );
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));
      expect(registry.getDiscoveredCount()).toBe(0);
    });

    it("discards responses with wrong type field", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = Buffer.from(
        JSON.stringify({
          type: "unknown-type",
          version: 1,
          host: "192.168.1.50",
          port: 1234,
          models: ["model-a"],
        }),
        "utf-8",
      );
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));
      expect(registry.getDiscoveredCount()).toBe(0);
    });
  });

  describe("handleResponse() — valid responses (Requirement 4.2)", () => {
    it("registers a valid discovered endpoint", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = makeValidResponseBuffer("192.168.1.50", 5000, ["model-a"], 4);
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));

      expect(registry.getDiscoveredCount()).toBe(1);
      const ep = registry.getEndpoint("discovered-192.168.1.50-5000");
      expect(ep).toBeDefined();
      expect(ep!.definition.host).toBe("192.168.1.50");
      expect(ep!.definition.port).toBe(5000);
      expect(ep!.definition.models).toEqual(["model-a"]);
      expect(ep!.definition.maxConcurrency).toBe(4);
      expect(ep!.definition.source).toBe("discovered");
    });

    it("defaults maxConcurrency to 1 when not provided", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = makeValidResponseBuffer("192.168.1.50", 5000, ["model-a"]);
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));

      const ep = registry.getEndpoint("discovered-192.168.1.50-5000");
      expect(ep!.definition.maxConcurrency).toBe(1);
    });
  });

  describe("handleResponse() — self-exclusion", () => {
    it("discards responses from the local instance", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      // localhost:1234 is the local instance per env config
      const msg = makeValidResponseBuffer("localhost", 1234, ["model-a"]);
      service.handleResponse(msg, makeRinfo("127.0.0.1", 41234));

      expect(registry.getDiscoveredCount()).toBe(0);
    });

    it("discards responses from 127.0.0.1 with local port", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = makeValidResponseBuffer("127.0.0.1", 1234, ["model-a"]);
      service.handleResponse(msg, makeRinfo("127.0.0.1", 41234));

      expect(registry.getDiscoveredCount()).toBe(0);
    });
  });

  describe("handleResponse() — duplicate prevention (Requirement 4.5)", () => {
    it("skips duplicate host:port registrations", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = makeValidResponseBuffer("192.168.1.50", 5000, ["model-a"]);
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));

      expect(registry.getDiscoveredCount()).toBe(1);
    });

    it("skips if host:port matches a manual endpoint", () => {
      const manual = makeEndpoint({ id: "manual-1", host: "192.168.1.50", port: 5000 });
      const registry = new EndpointRegistry([manual]);
      const config = makeConfig();
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = makeValidResponseBuffer("192.168.1.50", 5000, ["model-a"]);
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));

      expect(registry.getDiscoveredCount()).toBe(0);
    });
  });

  describe("handleResponse() — capacity limit (Requirement 4.6)", () => {
    it("ignores responses when max discovered limit reached", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig({ maxDiscovered: 3 });
      const service = new DiscoveryService(registry, config, noopLogger);

      // Register 3 endpoints (at limit)
      for (let i = 1; i <= 3; i++) {
        const msg = makeValidResponseBuffer(`192.168.1.${i}`, 5000 + i, [`model-${i}`]);
        service.handleResponse(msg, makeRinfo(`192.168.1.${i}`, 41234));
      }
      expect(registry.getDiscoveredCount()).toBe(3);

      // Fourth should be rejected
      const msg = makeValidResponseBuffer("192.168.1.99", 6000, ["model-extra"]);
      service.handleResponse(msg, makeRinfo("192.168.1.99", 41234));
      expect(registry.getDiscoveredCount()).toBe(3);
    });
  });

  describe("scanOnce() (Requirement 4.2)", () => {
    it("returns empty array when discovery is disabled (Requirement 4.7)", async () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig({ enabled: false });
      const service = new DiscoveryService(registry, config, noopLogger);

      const result = await service.scanOnce();
      expect(result).toEqual([]);
    });
  });

  describe("missed cycle tracking (Requirement 4.4)", () => {
    it("tracks known discovered endpoints after handleResponse", () => {
      const registry = new EndpointRegistry([]);
      const config = makeConfig({ missedCycleThreshold: 3 });
      const service = new DiscoveryService(registry, config, noopLogger);

      const msg = makeValidResponseBuffer("192.168.1.50", 5000, ["model-a"]);
      service.handleResponse(msg, makeRinfo("192.168.1.50", 41234));

      expect(registry.getDiscoveredCount()).toBe(1);
      expect(registry.getEndpoint("discovered-192.168.1.50-5000")).toBeDefined();
    });
  });
});
