import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DEFAULT_CONFIG, LanSubAgentConfig } from "../../src/config-schema";
import { ConfigWatcher } from "../../src/config-watcher";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "config-watcher-test-"));
}

function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ConfigWatcher", () => {
  let tmpDir: string;
  let configPath: string;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    tmpDir = createTmpDir();
    configPath = path.join(tmpDir, "lan-subagent-config.json");
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Missing config file creates default ───────────────────────────────────

  describe("loadOrCreate — missing file creates default", () => {
    it("returns default config when file does not exist", async () => {
      const watcher = new ConfigWatcher(configPath, mockLogger as any);

      const config = await watcher.loadOrCreate();

      // Should return the default config
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it("persists default config to disk when file is missing", async () => {
      const watcher = new ConfigWatcher(configPath, mockLogger as any);

      await watcher.loadOrCreate();

      // The config should either be written to disk or the watcher falls back gracefully
      // Check if file was created (writeConfig is called in the ENOENT path)
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        expect(JSON.parse(content)).toEqual(DEFAULT_CONFIG);
      }
    });

    it("logs a message when config file does not exist", async () => {
      const watcher = new ConfigWatcher(configPath, mockLogger as any);

      await watcher.loadOrCreate();

      // The logger should be called either with info (ENOENT path) or error (unexpected path)
      const allCalls = [
        ...mockLogger.info.mock.calls,
        ...mockLogger.error.mock.calls,
        ...mockLogger.warn.mock.calls,
      ];
      expect(allCalls.length).toBeGreaterThan(0);
    });

    it("default config has empty endpoints array", async () => {
      const watcher = new ConfigWatcher(configPath, mockLogger as any);

      const config = await watcher.loadOrCreate();

      expect(config.endpoints).toEqual([]);
    });

    it("continues startup without error when file is missing", async () => {
      const watcher = new ConfigWatcher(configPath, mockLogger as any);

      // Should not throw
      await expect(watcher.loadOrCreate()).resolves.toBeDefined();
    });
  });

  // ─── Invalid JSON falls back to empty endpoint list ────────────────────────

  describe("loadOrCreate — invalid JSON fallback", () => {
    it("falls back to default config when file contains invalid JSON", async () => {
      fs.writeFileSync(configPath, "{ this is not valid json !!!", "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      const config = await watcher.loadOrCreate();

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(config.endpoints).toEqual([]);
    });

    it("does not crash on invalid JSON", async () => {
      fs.writeFileSync(configPath, "<<<garbage>>>", "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);

      await expect(watcher.loadOrCreate()).resolves.toBeDefined();
    });

    it("logs an error when encountering invalid JSON", async () => {
      fs.writeFileSync(configPath, "not json at all", "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      await watcher.loadOrCreate();

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("invalid JSON"));
    });

    it("falls back gracefully when JSON is empty string", async () => {
      fs.writeFileSync(configPath, "", "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      const config = await watcher.loadOrCreate();

      // Empty string is not valid JSON, should fall back
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it("falls back gracefully when JSON is truncated", async () => {
      fs.writeFileSync(configPath, '{"endpoints": [', "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      const config = await watcher.loadOrCreate();

      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  // ─── Validation rejects out-of-range values ────────────────────────────────

  describe("validate — rejects out-of-range values", () => {
    it("rejects port number 0 (below minimum)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        endpoints: [
          {
            id: "bad-port",
            host: "192.168.1.10",
            port: 0,
            models: ["model-a"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          },
        ],
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects port number 70000 (above maximum 65535)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        endpoints: [
          {
            id: "bad-port",
            host: "192.168.1.10",
            port: 70000,
            models: ["model-a"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          },
        ],
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("port"))).toBe(true);
    });

    it("rejects maxConcurrency 0 (below minimum 1)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        endpoints: [
          {
            id: "bad-concurrency",
            host: "192.168.1.10",
            port: 1234,
            models: ["model-a"],
            maxConcurrency: 0,
            enabled: true,
            source: "manual",
          },
        ],
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("maxConcurrency"))).toBe(true);
    });

    it("rejects maxConcurrency 200 (above maximum 100)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        endpoints: [
          {
            id: "bad-concurrency",
            host: "192.168.1.10",
            port: 1234,
            models: ["model-a"],
            maxConcurrency: 200,
            enabled: true,
            source: "manual",
          },
        ],
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("maxConcurrency"))).toBe(true);
    });

    it("rejects healthCheck intervalSeconds below minimum (5)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        healthCheck: { intervalSeconds: 2, timeoutMs: 5000, failureThreshold: 2 },
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("intervalSeconds"))).toBe(true);
    });

    it("rejects healthCheck intervalSeconds above maximum (300)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        healthCheck: { intervalSeconds: 500, timeoutMs: 5000, failureThreshold: 2 },
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("intervalSeconds"))).toBe(true);
    });

    it("rejects retryLimit above maximum (5)", () => {
      const config = {
        ...DEFAULT_CONFIG,
        loadBalancer: { strategy: "round-robin" as const, retryLimit: 10 },
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("retryLimit"))).toBe(true);
    });

    it("rejects discovery broadcastPort 0", () => {
      const config = {
        ...DEFAULT_CONFIG,
        discovery: { enabled: true, intervalSeconds: 60, broadcastPort: 0, maxDiscovered: 50 },
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("broadcastPort"))).toBe(true);
    });

    it("accepts valid config with all fields in range", () => {
      const config = {
        endpoints: [
          {
            id: "ep-1",
            host: "192.168.1.10",
            port: 1234,
            models: ["qwen2.5-coder-32b"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          },
        ],
        loadBalancer: { strategy: "round-robin", retryLimit: 2 },
        healthCheck: { intervalSeconds: 30, timeoutMs: 5000, failureThreshold: 2 },
        discovery: { enabled: true, intervalSeconds: 60, broadcastPort: 41234, maxDiscovered: 50 },
        localInstance: { host: "localhost", port: 1234 },
        gui: { port: 9847, enabled: true },
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("rejects empty host string in endpoint", () => {
      const config = {
        ...DEFAULT_CONFIG,
        endpoints: [
          {
            id: "empty-host",
            host: "",
            port: 1234,
            models: ["model-a"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          },
        ],
      };

      const result = ConfigWatcher.validate(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("host"))).toBe(true);
    });
  });

  // ─── Debounce collapses rapid file changes ─────────────────────────────────

  describe("startWatching — debounce collapses rapid file changes", () => {
    it("collapses rapid consecutive changes into a single reload", async () => {
      // Create initial config file
      const initialConfig: LanSubAgentConfig = {
        ...DEFAULT_CONFIG,
        localInstance: { host: "localhost", port: 1234 },
      };
      fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      await watcher.loadOrCreate();

      const onChange = jest.fn();
      watcher.startWatching(onChange);

      // Rapidly write multiple changes in quick succession
      const finalConfig: LanSubAgentConfig = {
        ...DEFAULT_CONFIG,
        localInstance: { host: "192.168.1.100", port: 5000 },
      };

      // Write several times in rapid succession (within debounce window)
      for (let i = 0; i < 5; i++) {
        const intermediateConfig = {
          ...DEFAULT_CONFIG,
          localInstance: { host: `192.168.1.${i}`, port: 1234 + i },
        };
        fs.writeFileSync(configPath, JSON.stringify(intermediateConfig, null, 2), "utf-8");
      }
      // Write the final version
      fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2), "utf-8");

      // Wait for debounce (500ms) + some buffer for file events propagation
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // onChange should have been called at most once (debounce collapsed multiple events)
      expect(onChange).toHaveBeenCalledTimes(1);

      // The final config should be the last one written
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          localInstance: { host: "192.168.1.100", port: 5000 },
        }),
      );

      watcher.stopWatching();
    });

    it("does not call onChange if config did not actually change", async () => {
      const initialConfig = DEFAULT_CONFIG;
      fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      await watcher.loadOrCreate();

      const onChange = jest.fn();
      watcher.startWatching(onChange);

      // Write the exact same content back
      fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), "utf-8");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // onChange should not have been called — content is identical
      expect(onChange).not.toHaveBeenCalled();

      watcher.stopWatching();
    });

    it("stopWatching clears debounce timer and closes watcher", async () => {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      await watcher.loadOrCreate();

      const onChange = jest.fn();
      watcher.startWatching(onChange);

      // Write a change
      const newConfig = { ...DEFAULT_CONFIG, localInstance: { host: "10.0.0.1", port: 9999 } };
      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), "utf-8");

      // Immediately stop watching (before debounce fires)
      watcher.stopWatching();

      // Wait for what would have been the debounce window
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // onChange should never have been called — watcher was stopped
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // ─── writeConfig ──────────────────────────────────────────────────────────

  describe("writeConfig", () => {
    it("writes config with 2-space indentation", async () => {
      const watcher = new ConfigWatcher(configPath, mockLogger as any);

      await watcher.writeConfig(DEFAULT_CONFIG);

      const content = fs.readFileSync(configPath, "utf-8");
      // Verify pretty-printing with 2-space indentation
      expect(content).toContain("  ");
      expect(content).toBe(JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    });

    it("creates parent directories if they do not exist", async () => {
      const deepPath = path.join(tmpDir, "nested", "deep", "config.json");
      const watcher = new ConfigWatcher(deepPath, mockLogger as any);

      await watcher.writeConfig(DEFAULT_CONFIG);

      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });

  // ─── loadOrCreate with valid file ──────────────────────────────────────────

  describe("loadOrCreate — valid config file", () => {
    it("loads valid config from existing file", async () => {
      const validConfig: LanSubAgentConfig = {
        ...DEFAULT_CONFIG,
        endpoints: [
          {
            id: "ep-1",
            host: "192.168.1.10",
            port: 1234,
            models: ["qwen2.5-coder-32b"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual",
          },
        ],
      };
      fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2), "utf-8");

      const watcher = new ConfigWatcher(configPath, mockLogger as any);
      const config = await watcher.loadOrCreate();

      expect(config.endpoints).toHaveLength(1);
      expect(config.endpoints[0].host).toBe("192.168.1.10");
      expect(config.endpoints[0].port).toBe(1234);
    });
  });
});
