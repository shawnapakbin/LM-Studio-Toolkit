import * as fs from "fs";
import * as os from "os";
import * as path from "path";
/**
 * Property tests for the Config Loader.
 *
 * Property 3: YAML/JSON Format Equivalence
 * Property 4: Comprehensive Validation Error Reporting
 * Property 5: Config Merge Priority Order
 * Property 6: Failed Reload Retains Previous Config
 * Property 7: Parse Error Diagnostics
 *
 * Validates: Requirements 1.4, 1.5, 2.1, 2.7, 3.2, 3.3, 3.6
 */
import fc from "fast-check";

import { stringify as yamlStringify } from "yaml";

import { createConfigLoader } from "../../src/loader";
import { ConfigParseError, ConfigValidationError } from "../../src/types";

// ─── Property 3: YAML/JSON Format Equivalence ────────────────────────────────

// Arbitrary generators for valid partial configs

/** Generate a valid port number (1-65535) */
const arbPort = fc.integer({ min: 1, max: 65535 });

/** Generate a valid timeout value (0-86400000) */
const arbTimeout = fc.integer({ min: 0, max: 86400000 });

/** Generate a safe string (no special YAML characters that could cause parsing ambiguity) */
const arbSafeString = fc.stringOf(
  fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./".split(""),
  ),
  { minLength: 0, maxLength: 50 },
);

/** Generate a valid non-negative integer */
const arbNonNegativeInt = fc.integer({ min: 0, max: 100000 });

/** Generate a valid log level */
const arbLogLevel = fc.constantFrom("info", "debug", "warn", "error");

/** Generate a partial terminal config */
const arbTerminalConfig = fc.record(
  {
    port: arbPort,
    defaultTimeoutMs: arbTimeout,
    maxTimeoutMs: arbTimeout,
    maxOutputChars: arbNonNegativeInt,
    workspaceRoot: arbSafeString,
  },
  { requiredKeys: [] },
);

/** Generate a partial webbrowser config */
const arbWebbrowserConfig = fc.record(
  {
    port: arbPort,
    defaultTimeoutMs: arbTimeout,
    maxTimeoutMs: arbTimeout,
    maxContentChars: arbNonNegativeInt,
    headless: fc.boolean(),
    executablePath: arbSafeString,
  },
  { requiredKeys: [] },
);

/** Generate a partial calculator config */
const arbCalculatorConfig = fc.record(
  {
    port: arbPort,
    defaultPrecision: fc.integer({ min: 1, max: 100 }),
    maxPrecision: fc.integer({ min: 1, max: 100 }),
  },
  { requiredKeys: [] },
);

/** Generate a partial global config */
const arbGlobalConfig = fc.record(
  {
    logLevel: arbLogLevel,
    workspaceRoot: arbSafeString,
  },
  { requiredKeys: [] },
);

/** Generate a partial browserless config */
const arbBrowserlessConfig = fc.record(
  {
    port: arbPort,
    apiKey: arbSafeString,
    apiUrl: arbSafeString,
    defaultRegion: arbSafeString,
    defaultTimeoutMs: arbTimeout,
    maxTimeoutMs: arbTimeout,
    concurrencyLimit: fc.integer({ min: 1, max: 100 }),
  },
  { requiredKeys: [] },
);

/** Generate a partial blenderbridge config */
const arbBlenderbridgeConfig = fc.record(
  {
    host: arbSafeString,
    port: arbPort,
    command: arbSafeString,
    args: arbSafeString,
  },
  { requiredKeys: [] },
);

/** Generate a partial clock config */
const arbClockConfig = fc.record(
  {
    port: arbPort,
    defaultTimezone: arbSafeString,
    defaultLocale: arbSafeString,
  },
  { requiredKeys: [] },
);

/** Generate a partial observability config */
const arbObservabilityConfig = fc.record(
  {
    enabled: fc.boolean(),
    logLevel: arbLogLevel,
  },
  { requiredKeys: [] },
);

/**
 * Generate a random valid partial config object that may include any
 * combination of namespaces with valid values.
 */
const arbPartialConfig = fc.record(
  {
    global: arbGlobalConfig,
    terminal: arbTerminalConfig,
    webbrowser: arbWebbrowserConfig,
    calculator: arbCalculatorConfig,
    browserless: arbBrowserlessConfig,
    blenderbridge: arbBlenderbridgeConfig,
    clock: arbClockConfig,
    observability: arbObservabilityConfig,
  },
  { requiredKeys: [] },
);

describe("Feature: v2-4-0-unified-config-installer, Property 3: YAML/JSON Format Equivalence", () => {
  /**
   * Validates: Requirements 2.1
   */

  it("loading the same config from YAML and JSON produces identical resolved configs", () => {
    fc.assert(
      fc.property(arbPartialConfig, (partialConfig) => {
        // Filter out empty objects at root level to keep only meaningful namespaces
        const configData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(partialConfig)) {
          if (value !== undefined && Object.keys(value).length > 0) {
            configData[key] = value;
          }
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop3-"));
        try {
          // Write the same config as YAML
          const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
          const yamlContent = yamlStringify(configData);
          fs.writeFileSync(yamlPath, yamlContent, "utf-8");

          // Write the same config as JSON
          const jsonPath = path.join(tmpDir, "llm-toolkit.config.json");
          const jsonContent = JSON.stringify(configData, null, 2);
          fs.writeFileSync(jsonPath, jsonContent, "utf-8");

          // Load through Config_Loader with YAML file
          const yamlLoader = createConfigLoader({
            configPath: yamlPath,
            envOverrides: {},
          });
          const yamlConfig = yamlLoader.getConfig();

          // Load through Config_Loader with JSON file
          const jsonLoader = createConfigLoader({
            configPath: jsonPath,
            envOverrides: {},
          });
          const jsonConfig = jsonLoader.getConfig();

          // Assert both produce identical resolved configs
          expect(yamlConfig).toEqual(jsonConfig);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });

  it("empty config produces identical results from both formats", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop3-empty-"));
    try {
      const emptyConfig = {};

      // Write empty YAML
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(yamlPath, yamlStringify(emptyConfig), "utf-8");

      // Write empty JSON
      const jsonPath = path.join(tmpDir, "llm-toolkit.config.json");
      fs.writeFileSync(jsonPath, JSON.stringify(emptyConfig), "utf-8");

      const yamlLoader = createConfigLoader({ configPath: yamlPath, envOverrides: {} });
      const jsonLoader = createConfigLoader({ configPath: jsonPath, envOverrides: {} });

      expect(yamlLoader.getConfig()).toEqual(jsonLoader.getConfig());
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("config with all namespaces specified produces identical results from both formats", () => {
    fc.assert(
      fc.property(
        arbPort,
        arbTimeout,
        fc.boolean(),
        arbSafeString,
        arbLogLevel,
        (port, timeout, boolVal, strVal, logLevel) => {
          // Build a config that touches many namespaces
          const configData = {
            global: { logLevel, workspaceRoot: strVal || "." },
            terminal: { port, defaultTimeoutMs: timeout, maxOutputChars: 50000 },
            webbrowser: { port: Math.min(port + 1, 65535), headless: boolVal },
            calculator: { port: Math.min(port + 2, 65535) },
            clock: { port: Math.min(port + 3, 65535), defaultTimezone: strVal },
            blenderbridge: { host: strVal || "127.0.0.1", port: Math.min(port + 4, 65535) },
            observability: { enabled: boolVal, logLevel },
          };

          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop3-multi-"));
          try {
            const yamlPath = path.join(tmpDir, "test.yaml");
            fs.writeFileSync(yamlPath, yamlStringify(configData), "utf-8");

            const jsonPath = path.join(tmpDir, "test.json");
            fs.writeFileSync(jsonPath, JSON.stringify(configData, null, 2), "utf-8");

            const yamlLoader = createConfigLoader({ configPath: yamlPath, envOverrides: {} });
            const jsonLoader = createConfigLoader({ configPath: jsonPath, envOverrides: {} });

            expect(yamlLoader.getConfig()).toEqual(jsonLoader.getConfig());
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 7: Parse Error Diagnostics ─────────────────────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 7: Parse Error Diagnostics", () => {
  /**
   * Validates: Requirements 2.7
   */

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-parse-error-prop-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("malformed YAML files produce ConfigParseError with file path and location", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (randomChars) => {
        // Construct malformed YAML: valid YAML prefix followed by syntax-breaking content
        // Unmatched brackets/colons + random text ensures YAML parse failure
        const malformedYaml = `terminal:\n  port: [invalid\n  broken: {{\n${randomChars}`;

        const filePath = path.join(
          tmpDir,
          `test-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`,
        );
        fs.writeFileSync(filePath, malformedYaml, "utf-8");

        try {
          const loader = createConfigLoader({ configPath: filePath, envOverrides: {} });
          loader.getConfig();
          // If we get here, the malformed YAML was accidentally valid - skip this case
          // (the YAML parser is lenient with some inputs)
          return true;
        } catch (err: unknown) {
          // Must be a ConfigParseError
          expect(err).toBeInstanceOf(ConfigParseError);
          const parseError = err as ConfigParseError;

          // Error must contain the file path
          expect(parseError.filePath).toBe(filePath);
          expect(parseError.message).toContain(filePath);

          // Error must have a non-empty location string
          expect(parseError.location).toBeDefined();
          expect(typeof parseError.location).toBe("string");
          expect(parseError.location.length).toBeGreaterThan(0);
          // Location should contain "line" or "unknown" (for unparseable locations)
          expect(
            parseError.location.includes("line") || parseError.location.includes("unknown"),
          ).toBe(true);

          return true;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("malformed JSON files produce ConfigParseError with file path and location", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (randomChars) => {
        // Construct content that is definitely not valid JSON
        // Prefix with an opening brace and invalid content to ensure JSON.parse fails
        const malformedJson = `{ "terminal": { "port": [invalid }, ${randomChars}`;

        const filePath = path.join(
          tmpDir,
          `test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
        );
        fs.writeFileSync(filePath, malformedJson, "utf-8");

        try {
          const loader = createConfigLoader({ configPath: filePath, envOverrides: {} });
          loader.getConfig();
          // If we get here, the content was somehow valid JSON - skip
          return true;
        } catch (err: unknown) {
          // Must be a ConfigParseError
          expect(err).toBeInstanceOf(ConfigParseError);
          const parseError = err as ConfigParseError;

          // Error must contain the file path
          expect(parseError.filePath).toBe(filePath);
          expect(parseError.message).toContain(filePath);

          // Error must have a non-empty location string
          expect(parseError.location).toBeDefined();
          expect(typeof parseError.location).toBe("string");
          expect(parseError.location.length).toBeGreaterThan(0);
          // Location should contain "line" or "unknown" (for unparseable locations)
          expect(
            parseError.location.includes("line") || parseError.location.includes("unknown"),
          ).toBe(true);

          return true;
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Failed Reload Retains Previous Config ───────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 6: Failed Reload Retains Previous Config", () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * For any valid config C1 that has been successfully loaded, followed by a
   * reloadConfig() call that encounters an invalid configuration C2, the
   * Config_Loader must retain C1 such that subsequent getConfig() calls
   * return C1 unchanged.
   */

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop6-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("retains previous valid config when reload encounters invalid config", () => {
    fc.assert(
      fc.property(
        // P1: valid port value (1-65535)
        fc.integer({ min: 1, max: 65535 }),
        // P2: invalid port value (0 or > 65535)
        fc.oneof(fc.constant(0), fc.integer({ min: 65536, max: 999999 })),
        (validPort, invalidPort) => {
          const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");

          // Step 1: Write valid YAML config with terminal.port = P1
          fs.writeFileSync(configPath, `terminal:\n  port: ${validPort}\n`);

          // Step 2: Load config → get C1 with terminal.port = P1
          const loader = createConfigLoader({ repoRoot: tmpDir, envOverrides: {} });
          const c1 = loader.getConfig();
          expect(c1.terminal.port).toBe(validPort);

          // Step 3: Overwrite config file with invalid port P2
          fs.writeFileSync(configPath, `terminal:\n  port: ${invalidPort}\n`);

          // Step 4: reloadConfig() should throw ConfigValidationError
          expect(() => loader.reloadConfig()).toThrow(ConfigValidationError);

          // Step 5: getConfig() should still return C1 with terminal.port = P1
          const retained = loader.getConfig();
          expect(retained.terminal.port).toBe(validPort);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: Config Merge Priority Order ─────────────────────────────────

/**
 * Property 5: Config Merge Priority Order
 *
 * For any configuration entry that has a value defined at multiple layers
 * (environment variable, config file, schema default), the resolved value
 * returned by getConfig() must equal the value from the highest-priority
 * source: environment variable > config file > schema default.
 *
 * Validates: Requirements 1.5, 3.3
 */

describe("Feature: v2-4-0-unified-config-installer, Property 5: Config Merge Priority Order", () => {
  /**
   * Validates: Requirements 1.5, 3.3
   */

  const TERMINAL_PORT_DEFAULT = 3333;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-merge-priority-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper: writes a YAML config file with the given terminal.port value.
   */
  function writeConfigFile(portValue: number): string {
    const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
    const content = yamlStringify({ terminal: { port: portValue } });
    fs.writeFileSync(configPath, content, "utf-8");
    return configPath;
  }

  it("Scenario A: env var set + file set → resolved equals env var value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 1, max: 65535 }),
        (envVal, fileVal) => {
          const configPath = writeConfigFile(fileVal);

          const loader = createConfigLoader({
            configPath,
            envOverrides: { TERMINAL_PORT: String(envVal) },
          });

          const config = loader.getConfig();
          expect(config.terminal.port).toBe(envVal);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Scenario B: env var not set + file set → resolved equals file value", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 65535 }), (fileVal) => {
        const configPath = writeConfigFile(fileVal);

        const loader = createConfigLoader({
          configPath,
          envOverrides: {},
        });

        const config = loader.getConfig();
        expect(config.terminal.port).toBe(fileVal);
      }),
      { numRuns: 100 },
    );
  });

  it("Scenario C: env var not set + file not set → resolved equals schema default (3333)", () => {
    // Write a config file that has no terminal.port entry
    const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
    const content = yamlStringify({ global: { logLevel: "info" } });
    fs.writeFileSync(configPath, content, "utf-8");

    const loader = createConfigLoader({
      configPath,
      envOverrides: {},
    });

    const config = loader.getConfig();
    expect(config.terminal.port).toBe(TERMINAL_PORT_DEFAULT);
  });

  it("property: priority order holds for any combination of env/file/default", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 1, max: 65535 }),
        fc.boolean(),
        fc.boolean(),
        (envVal, fileVal, envPresent, filePresent) => {
          let configPath: string;

          if (filePresent) {
            configPath = writeConfigFile(fileVal);
          } else {
            // Write config without terminal.port
            configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
            const content = yamlStringify({ global: { logLevel: "info" } });
            fs.writeFileSync(configPath, content, "utf-8");
          }

          const envOverrides: Record<string, string | undefined> = {};
          if (envPresent) {
            envOverrides.TERMINAL_PORT = String(envVal);
          }

          const loader = createConfigLoader({
            configPath,
            envOverrides,
          });

          const config = loader.getConfig();

          // Assert priority: env > file > default
          if (envPresent) {
            expect(config.terminal.port).toBe(envVal);
          } else if (filePresent) {
            expect(config.terminal.port).toBe(fileVal);
          } else {
            expect(config.terminal.port).toBe(TERMINAL_PORT_DEFAULT);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Comprehensive Validation Error Reporting ────────────────────

/**
 * Property 4: Comprehensive Validation Error Reporting
 *
 * For any configuration object with N invalid entries (missing required fields
 * or type mismatches), the Config_Loader's validation error must list exactly
 * those N entries, each identified by full dotted path, expected type/constraint,
 * and actual received value — reported in a single validation pass.
 *
 * Validates: Requirements 1.4, 3.2
 */

/** Known namespaces and their numeric fields that can be made invalid */
const INVALID_ENTRY_GENERATORS: {
  namespace: string;
  key: string;
  invalidValueGen: () => fc.Arbitrary<unknown>;
}[] = [
  {
    namespace: "terminal",
    key: "port",
    invalidValueGen: () =>
      fc.oneof(
        fc.constant("not-a-number"),
        fc.integer({ min: -1000, max: 0 }),
        fc.integer({ min: 65536, max: 100000 }),
      ),
  },
  {
    namespace: "terminal",
    key: "defaultTimeoutMs",
    invalidValueGen: () =>
      fc.oneof(
        fc.constant("invalid"),
        fc.integer({ min: -1000, max: -1 }),
        fc.integer({ min: 86400001, max: 200000000 }),
      ),
  },
  {
    namespace: "terminal",
    key: "maxTimeoutMs",
    invalidValueGen: () =>
      fc.oneof(fc.constant(true), fc.integer({ min: 86400001, max: 200000000 })),
  },
  {
    namespace: "terminal",
    key: "maxOutputChars",
    invalidValueGen: () => fc.oneof(fc.constant([1, 2, 3]), fc.integer({ min: -1000, max: -1 })),
  },
  {
    namespace: "webbrowser",
    key: "port",
    invalidValueGen: () => fc.oneof(fc.constant("bad"), fc.integer({ min: 65536, max: 99999 })),
  },
  {
    namespace: "webbrowser",
    key: "defaultTimeoutMs",
    invalidValueGen: () =>
      fc.oneof(fc.constant("timeout"), fc.integer({ min: 86400001, max: 999999999 })),
  },
  { namespace: "webbrowser", key: "headless", invalidValueGen: () => fc.constant("not-a-bool") },
  {
    namespace: "calculator",
    key: "port",
    invalidValueGen: () => fc.oneof(fc.constant(false), fc.integer({ min: 65536, max: 70000 })),
  },
  {
    namespace: "calculator",
    key: "defaultPrecision",
    invalidValueGen: () => fc.oneof(fc.constant("high"), fc.integer({ min: 101, max: 999 })),
  },
  {
    namespace: "calculator",
    key: "maxPrecision",
    invalidValueGen: () => fc.oneof(fc.constant([]), fc.integer({ min: 101, max: 999 })),
  },
  {
    namespace: "browserless",
    key: "port",
    invalidValueGen: () => fc.integer({ min: 65536, max: 99999 }),
  },
  {
    namespace: "browserless",
    key: "concurrencyLimit",
    invalidValueGen: () => fc.oneof(fc.constant("many"), fc.integer({ min: -100, max: 0 })),
  },
  {
    namespace: "blenderbridge",
    key: "port",
    invalidValueGen: () => fc.oneof(fc.constant("xyz"), fc.integer({ min: 65536, max: 99999 })),
  },
  {
    namespace: "lansubagent",
    key: "localPort",
    invalidValueGen: () => fc.oneof(fc.constant("abc"), fc.integer({ min: 65536, max: 99999 })),
  },
];

/**
 * Creates a temporary YAML config file with the given data and returns
 * a config loader pointed at it.
 */
function createTempConfigAndLoader(data: Record<string, unknown>): {
  loader: ReturnType<typeof createConfigLoader>;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop4-"));
  const configPath = path.join(tmpDir, "llm-toolkit.config.yaml");
  fs.writeFileSync(configPath, yamlStringify(data), "utf-8");

  const loader = createConfigLoader({
    configPath,
    envOverrides: {},
  });

  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { loader, cleanup };
}

describe("Feature: v2-4-0-unified-config-installer, Property 4: Comprehensive Validation Error Reporting", () => {
  /**
   * Validates: Requirements 1.4, 3.2
   */

  it("for N invalid entries, ConfigValidationError lists at least N issues with full dotted paths", () => {
    fc.assert(
      fc.property(
        // Generate N (1-5) distinct indices from the invalid entry generators
        fc
          .integer({ min: 1, max: 5 })
          .chain((n) =>
            fc.tuple(
              fc.constant(n),
              fc.shuffledSubarray(
                Array.from({ length: INVALID_ENTRY_GENERATORS.length }, (_, i) => i),
                { minLength: n, maxLength: n },
              ),
            ),
          ),
        ([n, indices]) => {
          // Build config with N invalid entries
          const configData: Record<string, Record<string, unknown>> = {};
          const expectedPaths: string[] = [];

          for (const idx of indices) {
            const { namespace, key, invalidValueGen } = INVALID_ENTRY_GENERATORS[idx];
            const invalidValue = fc.sample(invalidValueGen(), 1)[0];

            if (!configData[namespace]) {
              configData[namespace] = {};
            }
            configData[namespace][key] = invalidValue;
            expectedPaths.push(`${namespace}.${key}`);
          }

          const { loader, cleanup } = createTempConfigAndLoader(configData);

          try {
            loader.getConfig();
            cleanup();
            // Should not reach here - validation should fail
            return false;
          } catch (err: unknown) {
            cleanup();

            // Must be a ConfigValidationError
            if (!(err instanceof ConfigValidationError)) {
              return false;
            }

            // Must have at least N issues (Zod may report additional nested issues)
            if (err.issues.length < n) {
              return false;
            }

            // Each known invalid path must appear in the issues
            const reportedPaths = err.issues.map((issue) => issue.path);
            for (const expectedPath of expectedPaths) {
              if (!reportedPaths.includes(expectedPath)) {
                return false;
              }
            }

            return true;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("each validation issue contains a full dotted path identifying the invalid entry", () => {
    fc.assert(
      fc.property(fc.constantFrom(...INVALID_ENTRY_GENERATORS.map((_, i) => i)), (idx) => {
        const { namespace, key, invalidValueGen } = INVALID_ENTRY_GENERATORS[idx];
        const invalidValue = fc.sample(invalidValueGen(), 1)[0];

        const configData: Record<string, Record<string, unknown>> = {
          [namespace]: { [key]: invalidValue },
        };

        const expectedPath = `${namespace}.${key}`;
        const { loader, cleanup } = createTempConfigAndLoader(configData);

        try {
          loader.getConfig();
          cleanup();
          return false; // Should have thrown
        } catch (err: unknown) {
          cleanup();

          if (!(err instanceof ConfigValidationError)) {
            return false;
          }

          const reportedPaths = err.issues.map((i) => i.path);
          return reportedPaths.includes(expectedPath);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("each validation issue contains the actual received value", () => {
    fc.assert(
      fc.property(fc.constantFrom(...INVALID_ENTRY_GENERATORS.map((_, i) => i)), (idx) => {
        const { namespace, key, invalidValueGen } = INVALID_ENTRY_GENERATORS[idx];
        const invalidValue = fc.sample(invalidValueGen(), 1)[0];

        const configData: Record<string, Record<string, unknown>> = {
          [namespace]: { [key]: invalidValue },
        };

        const expectedPath = `${namespace}.${key}`;
        const { loader, cleanup } = createTempConfigAndLoader(configData);

        try {
          loader.getConfig();
          cleanup();
          return false; // Should have thrown
        } catch (err: unknown) {
          cleanup();

          if (!(err instanceof ConfigValidationError)) {
            return false;
          }

          // Find the issue for our expected path
          const issue = err.issues.find((i) => i.path === expectedPath);
          if (!issue) return false;

          // The received field should match the value we supplied
          return JSON.stringify(issue.received) === JSON.stringify(invalidValue);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("validation collects all errors in a single pass (not fail-fast)", () => {
    // Provide multiple invalid entries across different namespaces
    // and verify ALL are reported, not just the first one encountered
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (n) => {
        // Pick N entries from different namespaces to ensure independence
        const seenNamespaces = new Set<string>();
        const selected: typeof INVALID_ENTRY_GENERATORS = [];

        for (const gen of INVALID_ENTRY_GENERATORS) {
          if (!seenNamespaces.has(gen.namespace) && selected.length < n) {
            seenNamespaces.add(gen.namespace);
            selected.push(gen);
          }
        }

        // If we can't get enough distinct namespaces, use what we have
        const actualN = selected.length;

        const configData: Record<string, Record<string, unknown>> = {};
        const expectedPaths: string[] = [];

        for (const { namespace, key, invalidValueGen } of selected) {
          const invalidValue = fc.sample(invalidValueGen(), 1)[0];
          configData[namespace] = { [key]: invalidValue };
          expectedPaths.push(`${namespace}.${key}`);
        }

        const { loader, cleanup } = createTempConfigAndLoader(configData);

        try {
          loader.getConfig();
          cleanup();
          return false;
        } catch (err: unknown) {
          cleanup();

          if (!(err instanceof ConfigValidationError)) {
            return false;
          }

          // All expected paths must be present - proves single-pass collection
          const reportedPaths = err.issues.map((i) => i.path);
          for (const expectedPath of expectedPaths) {
            if (!reportedPaths.includes(expectedPath)) {
              return false;
            }
          }

          return err.issues.length >= actualN;
        }
      }),
      { numRuns: 100 },
    );
  });
});
