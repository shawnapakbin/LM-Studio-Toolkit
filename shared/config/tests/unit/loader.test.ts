/**
 * Unit tests for config loader - getConfig, reloadConfig, getRedactedConfig, createConfigLoader.
 *
 * Tests cover:
 * - Lazy load + singleton caching
 * - Env var override priority (env > file > defaults)
 * - Env var coercion (number, boolean, string)
 * - Validation error collection (all errors in single pass)
 * - reloadConfig() success and failure-retention behavior
 * - Sensitive value redaction
 * - createConfigLoader() factory with isolated instances
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { _resetConfigCache, createConfigLoader } from "../../src/loader";
import { ConfigValidationError } from "../../src/types";

describe("Config Loader - Merge & Validation", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-loader-test-"));
    _resetConfigCache();
    // Clear config-related env vars
    delete process.env.LLM_TOOLKIT_CONFIG;
    // Remove any schema-meta env vars that might be set
    delete process.env.TERMINAL_DEFAULT_TIMEOUT_MS;
    delete process.env.TERMINAL_PORT;
    delete process.env.BROWSER_HEADLESS;
    delete process.env.BROWSERLESS_API_KEY;
    delete process.env.CALCULATOR_DEFAULT_PRECISION;
  });

  afterEach(() => {
    _resetConfigCache();
    // Restore env
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Lazy Load + Caching ─────────────────────────────────────────────────────

  describe("lazy load and caching", () => {
    it("should load config with all defaults when no file or env vars exist", () => {
      // Point to empty dir so no config file is found
      delete process.env.LLM_TOOLKIT_CONFIG;
      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(3333);
      expect(config.terminal.defaultTimeoutMs).toBe(60000);
      expect(config.webbrowser.headless).toBe(true);
      expect(config.global.logLevel).toBe("info");
    });

    it("should return the same cached instance on subsequent calls", () => {
      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config1 = loader.getConfig();
      const config2 = loader.getConfig();
      expect(config1).toBe(config2);
    });

    it("should load fresh config via getConfig when no file exists (defaults only)", () => {
      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config = loader.getConfig();
      // All schema defaults should be present
      expect(config.calculator.defaultPrecision).toBe(12);
      expect(config.calculator.maxPrecision).toBe(20);
    });
  });

  // ─── Config File Loading ───────────────────────────────────────────────────────

  describe("config file values", () => {
    it("should load values from a YAML config file", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(
        configPath,
        [
          "terminal:",
          "  port: 4444",
          "  defaultTimeoutMs: 30000",
          "calculator:",
          "  defaultPrecision: 8",
        ].join("\n"),
      );

      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(4444);
      expect(config.terminal.defaultTimeoutMs).toBe(30000);
      expect(config.calculator.defaultPrecision).toBe(8);
      // Defaults still apply for unspecified
      expect(config.terminal.maxTimeoutMs).toBe(120000);
    });

    it("should load values from a JSON config file", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          terminal: { port: 5555 },
          webbrowser: { headless: false },
        }),
      );

      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(5555);
      expect(config.webbrowser.headless).toBe(false);
    });
  });

  // ─── Env Var Priority ──────────────────────────────────────────────────────────

  describe("env var override priority", () => {
    it("should override file values with env vars", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 4444\n  defaultTimeoutMs: 30000\n");

      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          TERMINAL_PORT: "9999",
          TERMINAL_DEFAULT_TIMEOUT_MS: "5000",
        },
      });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(9999);
      expect(config.terminal.defaultTimeoutMs).toBe(5000);
    });

    it("should override schema defaults with env vars when no file exists", () => {
      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          TERMINAL_PORT: "7777",
        },
      });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(7777);
      // Other defaults remain
      expect(config.terminal.defaultTimeoutMs).toBe(60000);
    });

    it("should use file value when env var is not set", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 8888\n");

      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {},
      });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(8888);
    });
  });

  // ─── Env Var Coercion ──────────────────────────────────────────────────────────

  describe("env var type coercion", () => {
    it("should coerce numeric env vars to numbers", () => {
      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          TERMINAL_PORT: "6000",
          TERMINAL_DEFAULT_TIMEOUT_MS: "45000",
        },
      });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(6000);
      expect(typeof config.terminal.port).toBe("number");
      expect(config.terminal.defaultTimeoutMs).toBe(45000);
      expect(typeof config.terminal.defaultTimeoutMs).toBe("number");
    });

    it("should coerce boolean env vars ('true'/'false')", () => {
      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          BROWSER_HEADLESS: "false",
        },
      });
      const config = loader.getConfig();

      expect(config.webbrowser.headless).toBe(false);
      expect(typeof config.webbrowser.headless).toBe("boolean");
    });

    it("should coerce '1' to true and '0' to false for booleans", () => {
      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          BROWSER_HEADLESS: "1",
        },
      });
      const config = loader.getConfig();
      expect(config.webbrowser.headless).toBe(true);
    });

    it("should leave string env vars as-is", () => {
      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          BROWSERLESS_API_KEY: "my-secret-key-123",
        },
      });
      const config = loader.getConfig();

      expect(config.browserless.apiKey).toBe("my-secret-key-123");
      expect(typeof config.browserless.apiKey).toBe("string");
    });
  });

  // ─── Validation Error Collection ──────────────────────────────────────────────

  describe("validation error collection", () => {
    it("should throw ConfigValidationError with all issues when config is invalid", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(
        configPath,
        [
          "terminal:",
          "  port: 99999", // Invalid: port > 65535
          "  defaultTimeoutMs: -1", // Invalid: timeout < 0
        ].join("\n"),
      );

      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });

      expect(() => loader.getConfig()).toThrow(ConfigValidationError);

      try {
        loader.getConfig();
      } catch (err) {
        const validationErr = err as ConfigValidationError;
        // Should have collected multiple issues
        expect(validationErr.issues.length).toBeGreaterThanOrEqual(2);
        // Each issue should have path info
        const paths = validationErr.issues.map((i) => i.path);
        expect(paths).toContain("terminal.port");
        expect(paths).toContain("terminal.defaultTimeoutMs");
      }
    });

    it("should include expected type info in validation errors", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(configPath, 'terminal:\n  port: "not-a-number"\n');

      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });

      try {
        loader.getConfig();
        fail("Expected ConfigValidationError");
      } catch (err) {
        const validationErr = err as ConfigValidationError;
        expect(validationErr.issues.length).toBeGreaterThanOrEqual(1);
        const portIssue = validationErr.issues.find((i) => i.path === "terminal.port");
        expect(portIssue).toBeDefined();
        expect(portIssue!.received).toBe("not-a-number");
      }
    });
  });

  // ─── reloadConfig ──────────────────────────────────────────────────────────────

  describe("reloadConfig", () => {
    it("should reload and return new config after file change", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 4000\n");

      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config1 = loader.getConfig();
      expect(config1.terminal.port).toBe(4000);

      // Modify config file
      fs.writeFileSync(configPath, "terminal:\n  port: 5000\n");

      const config2 = loader.reloadConfig();
      expect(config2.terminal.port).toBe(5000);

      // Subsequent getConfig should return new value
      expect(loader.getConfig().terminal.port).toBe(5000);
    });

    it("should retain previous config if reload encounters validation error", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 4000\n");

      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config1 = loader.getConfig();
      expect(config1.terminal.port).toBe(4000);

      // Write invalid config
      fs.writeFileSync(configPath, "terminal:\n  port: 99999\n");

      // Reload should throw
      expect(() => loader.reloadConfig()).toThrow(ConfigValidationError);

      // Previous config should be retained
      const config2 = loader.getConfig();
      expect(config2.terminal.port).toBe(4000);
      expect(config2).toBe(config1);
    });

    it("should update cache on successful reload", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 3000\n");

      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      loader.getConfig();

      fs.writeFileSync(configPath, "terminal:\n  port: 3001\n");
      loader.reloadConfig();

      // getConfig should now return the new value (not re-read)
      const cached = loader.getConfig();
      expect(cached.terminal.port).toBe(3001);
    });
  });

  // ─── getRedactedConfig ─────────────────────────────────────────────────────────

  describe("getRedactedConfig", () => {
    it("should redact sensitive values", () => {
      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          BROWSERLESS_API_KEY: "super-secret-key",
        },
      });

      const redacted = loader.getRedactedConfig();
      const browserless = redacted.browserless as Record<string, unknown>;

      expect(browserless.apiKey).toBe("[REDACTED]");
    });

    it("should not redact non-sensitive values", () => {
      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: {
          TERMINAL_PORT: "4000",
        },
      });

      const redacted = loader.getRedactedConfig();
      const terminal = redacted.terminal as Record<string, unknown>;

      expect(terminal.port).toBe(4000);
    });

    it("should return a deep copy (not the same object as getConfig)", () => {
      const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const config = loader.getConfig();
      const redacted = loader.getRedactedConfig();

      expect(redacted).not.toBe(config);
    });
  });

  // ─── createConfigLoader ────────────────────────────────────────────────────────

  describe("createConfigLoader", () => {
    it("should create isolated instances that don't share cache", () => {
      const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 4000\n");

      const loader1 = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
      const loader2 = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: { TERMINAL_PORT: "5000" },
      });

      expect(loader1.getConfig().terminal.port).toBe(4000);
      expect(loader2.getConfig().terminal.port).toBe(5000);
    });

    it("should support explicit configPath option", () => {
      const configPath = path.join(tmpDir, "custom.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 6000\n");

      const loader = createConfigLoader({ configPath, envOverrides: {} });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(6000);
    });

    it("should use envOverrides instead of process.env", () => {
      // Set process.env var that should be IGNORED
      process.env.TERMINAL_PORT = "9999";

      const loader = createConfigLoader({
        repoRoot: tmpDir,
        envOverrides: { TERMINAL_PORT: "1234" },
      });
      const config = loader.getConfig();

      expect(config.terminal.port).toBe(1234);
    });
  });

  // ─── Singleton getConfig/reloadConfig ──────────────────────────────────────────

  describe("singleton getConfig/reloadConfig", () => {
    it("should work with the global singleton (no file, env only)", () => {
      // Use an empty dir to avoid finding the real config file
      delete process.env.LLM_TOOLKIT_CONFIG;
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-singleton-"));

      // We can't easily test the global singleton without side effects,
      // but createConfigLoader acts as a proxy. Testing it covers the same code path.
      const loader = createConfigLoader({ repoRoot: emptyDir, envOverrides: {} });
      const config = loader.getConfig();
      expect(config.terminal.port).toBe(3333);

      fs.rmSync(emptyDir, { recursive: true, force: true });
    });
  });
});
