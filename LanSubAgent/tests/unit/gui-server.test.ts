import http from "http";
import { jest } from "@jest/globals";
import { DEFAULT_CONFIG, LanSubAgentConfig } from "../../src/config-schema";
import { ConfigWatcher } from "../../src/config-watcher";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { GuiServer, GuiServerConfig, validateEndpointInput } from "../../src/gui/gui-server";
import { HealthChecker, HealthCheckerConfig } from "../../src/health-checker";
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
    id: "test-ep-1",
    host: "192.168.1.10",
    port: 1234,
    models: ["qwen2.5-coder-32b"],
    maxConcurrency: 4,
    enabled: true,
    source: "manual",
    ...overrides,
  };
}

function makeRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ statusCode: res.statusCode ?? 0, body: parsed });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ─── Test Setup ──────────────────────────────────────────────────────────────

describe("GuiServer", () => {
  let server: GuiServer;
  let registry: EndpointRegistry;
  let configWatcher: ConfigWatcher;
  let healthChecker: HealthChecker;
  let logger: any;
  let testPort: number;
  let mockConfig: LanSubAgentConfig;

  beforeEach(async () => {
    logger = createMockLogger();
    testPort = 19847 + Math.floor(Math.random() * 1000);

    // Set environment vars so self-exclusion doesn't interfere
    process.env.SUBAGENT_LOCAL_HOST = "localhost";
    process.env.SUBAGENT_LOCAL_PORT = "9999";

    const endpoint = createTestEndpoint();
    registry = new EndpointRegistry([endpoint]);

    mockConfig = {
      ...DEFAULT_CONFIG,
      endpoints: [endpoint],
    };

    // Create a real ConfigWatcher pointing at a temp path, then mock writeConfig
    configWatcher = new ConfigWatcher("/tmp/test-config.json", logger);
    // Set the internal lastConfig
    (configWatcher as any).lastConfig = mockConfig;

    // Mock writeConfig to just update lastConfig
    (configWatcher as any).writeConfig = jest
      .fn<(config: LanSubAgentConfig) => Promise<void>>()
      .mockImplementation(async (config: LanSubAgentConfig) => {
        (configWatcher as any).lastConfig = config;
      });

    const hcConfig: HealthCheckerConfig = {
      intervalMs: 30000,
      timeoutMs: 5000,
      failureThreshold: 2,
    };
    healthChecker = new HealthChecker(registry, hcConfig, logger);

    const guiConfig: GuiServerConfig = { port: testPort, enabled: true };

    server = new GuiServer({
      config: guiConfig,
      configWatcher,
      healthChecker,
      registry,
      logger,
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    delete process.env.SUBAGENT_LOCAL_HOST;
    delete process.env.SUBAGENT_LOCAL_PORT;
  });

  // ─── GET /api/endpoints ──────────────────────────────────────────────────────

  describe("GET /api/endpoints", () => {
    it("returns all registered endpoints with health info", async () => {
      const { statusCode, body } = await makeRequest(testPort, "GET", "/api/endpoints");
      expect(statusCode).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0]).toHaveProperty("id", "test-ep-1");
      expect(body[0]).toHaveProperty("health", "unknown");
      expect(body[0]).toHaveProperty("host", "192.168.1.10");
      expect(body[0]).toHaveProperty("port", 1234);
    });
  });

  // ─── POST /api/endpoints ─────────────────────────────────────────────────────

  describe("POST /api/endpoints", () => {
    it("adds a valid endpoint and persists config", async () => {
      const newEndpoint = {
        id: "new-ep",
        host: "10.0.0.5",
        port: 5000,
        models: ["llama-3.1-8b"],
        maxConcurrency: 2,
        enabled: true,
      };

      const { statusCode, body } = await makeRequest(
        testPort,
        "POST",
        "/api/endpoints",
        newEndpoint,
      );
      expect(statusCode).toBe(201);
      expect(body.id).toBe("new-ep");
      expect(body.host).toBe("10.0.0.5");
      expect(body.source).toBe("manual");
      expect(configWatcher.writeConfig).toHaveBeenCalled();
    });

    it("rejects endpoint with empty host", async () => {
      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/endpoints", {
        host: "",
        port: 1234,
        models: ["m1"],
        maxConcurrency: 4,
      });
      expect(statusCode).toBe(400);
      expect(body.error).toBe("Validation failed");
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "host" })]),
      );
    });

    it("rejects endpoint with port out of range", async () => {
      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/endpoints", {
        host: "10.0.0.1",
        port: 70000,
        models: ["m1"],
        maxConcurrency: 4,
      });
      expect(statusCode).toBe(400);
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "port" })]),
      );
    });

    it("rejects endpoint with no models", async () => {
      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/endpoints", {
        host: "10.0.0.1",
        port: 1234,
        models: [],
        maxConcurrency: 4,
      });
      expect(statusCode).toBe(400);
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "models" })]),
      );
    });

    it("rejects endpoint with maxConcurrency > 32", async () => {
      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/endpoints", {
        host: "10.0.0.1",
        port: 1234,
        models: ["m1"],
        maxConcurrency: 33,
      });
      expect(statusCode).toBe(400);
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "maxConcurrency" })]),
      );
    });

    it("rejects endpoint with maxConcurrency < 1", async () => {
      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/endpoints", {
        host: "10.0.0.1",
        port: 1234,
        models: ["m1"],
        maxConcurrency: 0,
      });
      expect(statusCode).toBe(400);
      expect(body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "maxConcurrency" })]),
      );
    });

    it("returns 500 if writeConfig fails", async () => {
      (configWatcher as any).writeConfig = jest
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("disk full"));

      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/endpoints", {
        host: "10.0.0.1",
        port: 1234,
        models: ["m1"],
        maxConcurrency: 4,
      });
      expect(statusCode).toBe(500);
      expect(body.error).toContain("Failed to persist");
    });
  });

  // ─── PUT /api/endpoints/:id ──────────────────────────────────────────────────

  describe("PUT /api/endpoints/:id", () => {
    it("updates an existing endpoint", async () => {
      const updatedData = {
        host: "192.168.1.20",
        port: 5555,
        models: ["new-model"],
        maxConcurrency: 8,
        enabled: false,
      };

      const { statusCode, body } = await makeRequest(
        testPort,
        "PUT",
        "/api/endpoints/test-ep-1",
        updatedData,
      );
      expect(statusCode).toBe(200);
      expect(body.host).toBe("192.168.1.20");
      expect(body.port).toBe(5555);
      expect(body.models).toEqual(["new-model"]);
      expect(body.maxConcurrency).toBe(8);
      expect(configWatcher.writeConfig).toHaveBeenCalled();
    });

    it("returns 404 for non-existent endpoint", async () => {
      const { statusCode, body } = await makeRequest(
        testPort,
        "PUT",
        "/api/endpoints/nonexistent",
        {
          host: "10.0.0.1",
          port: 1234,
          models: ["m1"],
          maxConcurrency: 4,
        },
      );
      expect(statusCode).toBe(404);
      expect(body.error).toContain("not found");
    });

    it("validates input before updating", async () => {
      const { statusCode } = await makeRequest(testPort, "PUT", "/api/endpoints/test-ep-1", {
        host: "",
        port: 1234,
        models: ["m1"],
        maxConcurrency: 4,
      });
      expect(statusCode).toBe(400);
    });
  });

  // ─── DELETE /api/endpoints/:id ───────────────────────────────────────────────

  describe("DELETE /api/endpoints/:id", () => {
    it("deletes an existing endpoint", async () => {
      const { statusCode, body } = await makeRequest(
        testPort,
        "DELETE",
        "/api/endpoints/test-ep-1",
      );
      expect(statusCode).toBe(200);
      expect(body.deleted).toBe("test-ep-1");
      expect(configWatcher.writeConfig).toHaveBeenCalled();
    });

    it("returns 404 for non-existent endpoint", async () => {
      const { statusCode } = await makeRequest(testPort, "DELETE", "/api/endpoints/nonexistent");
      expect(statusCode).toBe(404);
    });
  });

  // ─── POST /api/endpoints/:id/test ────────────────────────────────────────────

  describe("POST /api/endpoints/:id/test", () => {
    it("returns 404 for non-existent endpoint", async () => {
      const { statusCode } = await makeRequest(testPort, "POST", "/api/endpoints/nonexistent/test");
      expect(statusCode).toBe(404);
    });

    it("returns failure for unreachable endpoint", async () => {
      // The test endpoint points to 192.168.1.10:1234 which is not reachable in tests
      const { statusCode, body } = await makeRequest(
        testPort,
        "POST",
        "/api/endpoints/test-ep-1/test",
      );
      expect(statusCode).toBe(200);
      expect(body.success).toBe(false);
      expect(body.reason).toBeDefined();
    }, 15000);
  });

  // ─── GET /api/discovery/status ───────────────────────────────────────────────

  describe("GET /api/discovery/status", () => {
    it("returns discovery configuration status", async () => {
      const { statusCode, body } = await makeRequest(testPort, "GET", "/api/discovery/status");
      expect(statusCode).toBe(200);
      expect(body).toHaveProperty("enabled", true);
      expect(body).toHaveProperty("intervalSeconds", 60);
      expect(body).toHaveProperty("broadcastPort", 41234);
      expect(body).toHaveProperty("maxDiscovered", 50);
      expect(body).toHaveProperty("currentDiscovered");
    });
  });

  // ─── POST /api/discovery/toggle ──────────────────────────────────────────────

  describe("POST /api/discovery/toggle", () => {
    it("toggles discovery mode (true → false)", async () => {
      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/discovery/toggle", {});
      expect(statusCode).toBe(200);
      expect(body.enabled).toBe(false);
      expect(configWatcher.writeConfig).toHaveBeenCalled();
    });

    it("sets discovery to explicit value", async () => {
      const { statusCode, body } = await makeRequest(testPort, "POST", "/api/discovery/toggle", {
        enabled: false,
      });
      expect(statusCode).toBe(200);
      expect(body.enabled).toBe(false);
    });
  });

  // ─── GET /api/health ─────────────────────────────────────────────────────────

  describe("GET /api/health", () => {
    it("returns health status for all endpoints", async () => {
      const { statusCode, body } = await makeRequest(testPort, "GET", "/api/health");
      expect(statusCode).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toHaveProperty("id");
      expect(body[0]).toHaveProperty("health");
      expect(body[0]).toHaveProperty("host");
      expect(body[0]).toHaveProperty("port");
      expect(body[0]).toHaveProperty("consecutiveFailures");
    });
  });

  // ─── Unknown route ───────────────────────────────────────────────────────────

  describe("Unknown API routes", () => {
    it("returns 404 for unknown API path", async () => {
      const { statusCode, body } = await makeRequest(testPort, "GET", "/api/unknown");
      expect(statusCode).toBe(404);
      expect(body.error).toBe("Not found");
    });
  });

  // ─── Server lifecycle ────────────────────────────────────────────────────────

  describe("Server lifecycle", () => {
    it("does not start when disabled", async () => {
      await server.stop();

      const disabledServer = new GuiServer({
        config: { port: testPort + 1, enabled: false },
        configWatcher,
        healthChecker,
        registry,
        logger,
      });

      await disabledServer.start();
      // Should not throw and should not be listening
      expect(logger.info).toHaveBeenCalledWith("GUI server disabled via config");
      await disabledServer.stop();
    });
  });
});

// ─── Validation Unit Tests ───────────────────────────────────────────────────

describe("validateEndpointInput", () => {
  const validInput = {
    host: "192.168.1.10",
    port: 1234,
    models: ["model-a"],
    maxConcurrency: 4,
  };

  it("accepts valid input", () => {
    const result = validateEndpointInput(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null input", () => {
    const result = validateEndpointInput(null);
    expect(result.valid).toBe(false);
  });

  it("rejects empty host", () => {
    const result = validateEndpointInput({ ...validInput, host: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "host")).toBe(true);
  });

  it("rejects whitespace-only host", () => {
    const result = validateEndpointInput({ ...validInput, host: "   " });
    expect(result.valid).toBe(false);
  });

  it("rejects port 0", () => {
    const result = validateEndpointInput({ ...validInput, port: 0 });
    expect(result.valid).toBe(false);
  });

  it("rejects port > 65535", () => {
    const result = validateEndpointInput({ ...validInput, port: 65536 });
    expect(result.valid).toBe(false);
  });

  it("accepts port at boundaries (1 and 65535)", () => {
    expect(validateEndpointInput({ ...validInput, port: 1 }).valid).toBe(true);
    expect(validateEndpointInput({ ...validInput, port: 65535 }).valid).toBe(true);
  });

  it("rejects empty models array", () => {
    const result = validateEndpointInput({ ...validInput, models: [] });
    expect(result.valid).toBe(false);
  });

  it("rejects model string longer than 200 chars", () => {
    const result = validateEndpointInput({ ...validInput, models: ["a".repeat(201)] });
    expect(result.valid).toBe(false);
  });

  it("rejects maxConcurrency 0", () => {
    const result = validateEndpointInput({ ...validInput, maxConcurrency: 0 });
    expect(result.valid).toBe(false);
  });

  it("rejects maxConcurrency > 32", () => {
    const result = validateEndpointInput({ ...validInput, maxConcurrency: 33 });
    expect(result.valid).toBe(false);
  });

  it("accepts maxConcurrency at boundaries (1 and 32)", () => {
    expect(validateEndpointInput({ ...validInput, maxConcurrency: 1 }).valid).toBe(true);
    expect(validateEndpointInput({ ...validInput, maxConcurrency: 32 }).valid).toBe(true);
  });
});
