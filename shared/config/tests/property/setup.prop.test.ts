import * as fs from "fs";
import * as os from "os";
import * as path from "path";
/**
 * Property tests for the Setup Script / Config Generator.
 *
 * Property 11: Setup Repair Preserves Custom Values
 * Property 12: Generated .env Backward Compatibility
 *
 * Validates: Requirements 5.3, 5.6
 */
import fc from "fast-check";
import { parse as yamlParse } from "yaml";

import { generateConfigFile } from "../../src/generate";
import { configSchema } from "../../src/schema";
import { schemaMeta } from "../../src/schema-meta";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Gets the value at a dotted path from a nested object.
 */
function getNestedValue(obj: unknown, dottedPath: string): unknown {
  const parts = dottedPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Parses a .env file content into a Record<envVarName, value>.
 * Handles basic KEY=VALUE parsing, skipping comments and blank lines.
 * Also handles quoted values (double quotes).
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx);
    let value = trimmed.substring(eqIdx + 1);
    // Strip surrounding double quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    result[key] = value;
  }
  return result;
}

/**
 * Formats a config value the same way the generator does, for comparison.
 * Booleans and numbers are stringified; arrays are JSON-encoded.
 */
function formatValueForEnv(value: unknown): string {
  if (typeof value === "string") {
    // The generator quotes strings containing spaces, #, or quotes
    if (/[\s#"']/.test(value)) {
      return value; // We strip the quotes during parsing, so compare raw
    }
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

// ─── Property 11: Setup Repair Preserves Custom Values ───────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 11: Setup Repair Preserves Custom Values", () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any existing Config_File with user-customized values that differ from
   * previous schema defaults, running the Setup_Script with --repair preserves
   * those custom values while applying new schema defaults for newly-added entries.
   *
   * The `generateConfigFile` function from `../../src/generate` accepts
   * `existingValues` for repair mode.
   */

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop11-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("property: repair mode preserves custom terminal.port, terminal.defaultTimeoutMs, and browserless.apiKey values", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 0, max: 86400000 }),
        fc.stringOf(
          fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
          ),
          { minLength: 1, maxLength: 100 },
        ),
        (customPort, customTimeout, customApiKey) => {
          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");
          const envOutputPath = path.join(tmpDir, ".env");

          // Simulate repair mode: existingValues are the user's customized config
          const existingValues = {
            terminal: {
              port: customPort,
              defaultTimeoutMs: customTimeout,
            },
            browserless: {
              apiKey: customApiKey,
            },
          };

          // Generate config in repair mode (existingValues overlay)
          generateConfigFile({
            format: "yaml",
            outputPath,
            envOutputPath,
            existingValues,
          });

          // Read the generated config file
          const generated = yamlParse(fs.readFileSync(outputPath, "utf-8")) as Record<
            string,
            unknown
          >;

          // Assert custom values are preserved
          const terminal = generated.terminal as Record<string, unknown>;
          expect(terminal.port).toBe(customPort);
          expect(terminal.defaultTimeoutMs).toBe(customTimeout);

          const browserless = generated.browserless as Record<string, unknown>;
          expect(browserless.apiKey).toBe(customApiKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: entries NOT in existingValues still receive schema defaults", () => {
    // Get schema defaults for comparison
    const defaults = configSchema.parse({});

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.stringOf(
          fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
          ),
          { minLength: 1, maxLength: 50 },
        ),
        (customPort, customApiKey) => {
          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");
          const envOutputPath = path.join(tmpDir, ".env");

          // Only provide custom values for a few entries
          const existingValues = {
            terminal: {
              port: customPort,
            },
            browserless: {
              apiKey: customApiKey,
            },
          };

          generateConfigFile({
            format: "yaml",
            outputPath,
            envOutputPath,
            existingValues,
          });

          const generated = yamlParse(fs.readFileSync(outputPath, "utf-8")) as Record<
            string,
            unknown
          >;

          // Custom values are preserved
          expect((generated.terminal as Record<string, unknown>).port).toBe(customPort);
          expect((generated.browserless as Record<string, unknown>).apiKey).toBe(customApiKey);

          // Entries NOT in existingValues should have schema defaults
          expect((generated.terminal as Record<string, unknown>).maxTimeoutMs).toBe(
            defaults.terminal.maxTimeoutMs,
          );
          expect((generated.terminal as Record<string, unknown>).maxOutputChars).toBe(
            defaults.terminal.maxOutputChars,
          );
          expect((generated.terminal as Record<string, unknown>).workspaceRoot).toBe(
            defaults.terminal.workspaceRoot,
          );
          expect((generated.webbrowser as Record<string, unknown>).headless).toBe(
            defaults.webbrowser.headless,
          );
          expect((generated.calculator as Record<string, unknown>).defaultPrecision).toBe(
            defaults.calculator.defaultPrecision,
          );
          expect((generated.global as Record<string, unknown>).logLevel).toBe(
            defaults.global.logLevel,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: generated config always passes schema validation after repair", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 0, max: 86400000 }),
        fc.integer({ min: 1, max: 65535 }),
        fc.boolean(),
        (customPort, customTimeout, customBrowserlessPort, customHeadless) => {
          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");
          const envOutputPath = path.join(tmpDir, ".env");

          const existingValues = {
            terminal: {
              port: customPort,
              defaultTimeoutMs: customTimeout,
            },
            webbrowser: {
              headless: customHeadless,
            },
            browserless: {
              port: customBrowserlessPort,
            },
          };

          generateConfigFile({
            format: "yaml",
            outputPath,
            envOutputPath,
            existingValues,
          });

          // The generated config must pass full schema validation
          const generated = yamlParse(fs.readFileSync(outputPath, "utf-8")) as Record<
            string,
            unknown
          >;
          const result = configSchema.safeParse(generated);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: repair with diverse custom values across multiple namespaces preserves all", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 0, max: 86400000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 65535 }),
        fc.stringOf(
          fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
          ),
          { minLength: 0, maxLength: 80 },
        ),
        (portVal, timeoutVal, precisionVal, ragPort, customApiKey) => {
          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");
          const envOutputPath = path.join(tmpDir, ".env");

          const existingValues = {
            terminal: { port: portVal, defaultTimeoutMs: timeoutVal },
            calculator: { defaultPrecision: precisionVal },
            rag: { port: ragPort },
            browserless: { apiKey: customApiKey },
          };

          generateConfigFile({
            format: "yaml",
            outputPath,
            envOutputPath,
            existingValues,
          });

          const generated = yamlParse(fs.readFileSync(outputPath, "utf-8")) as Record<
            string,
            unknown
          >;

          // All custom values preserved
          expect((generated.terminal as Record<string, unknown>).port).toBe(portVal);
          expect((generated.terminal as Record<string, unknown>).defaultTimeoutMs).toBe(timeoutVal);
          expect((generated.calculator as Record<string, unknown>).defaultPrecision).toBe(
            precisionVal,
          );
          expect((generated.rag as Record<string, unknown>).port).toBe(ragPort);
          expect((generated.browserless as Record<string, unknown>).apiKey).toBe(customApiKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: repair with JSON format also preserves custom values", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 0, max: 86400000 }),
        fc.stringOf(
          fc.constantFrom(
            ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
          ),
          { minLength: 1, maxLength: 50 },
        ),
        (customPort, customTimeout, customApiKey) => {
          const outputPath = path.join(tmpDir, "llm-toolkit.config.json");
          const envOutputPath = path.join(tmpDir, ".env");

          const existingValues = {
            terminal: {
              port: customPort,
              defaultTimeoutMs: customTimeout,
            },
            browserless: {
              apiKey: customApiKey,
            },
          };

          generateConfigFile({
            format: "json",
            outputPath,
            envOutputPath,
            existingValues,
          });

          // Read as JSON
          const content = fs.readFileSync(outputPath, "utf-8");
          const generated = JSON.parse(content) as Record<string, unknown>;

          // Custom values preserved
          expect((generated.terminal as Record<string, unknown>).port).toBe(customPort);
          expect((generated.terminal as Record<string, unknown>).defaultTimeoutMs).toBe(
            customTimeout,
          );
          expect((generated.browserless as Record<string, unknown>).apiKey).toBe(customApiKey);

          // Validate against schema
          const result = configSchema.safeParse(generated);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 12: Generated .env Backward Compatibility ──────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 12: Generated .env Backward Compatibility", () => {
  /**
   * **Validates: Requirements 5.6**
   *
   * For any generated Config_File, the companion .env file produced by the
   * Setup_Script must contain environment variable mappings for all config
   * entries that have an `env` annotation in the schema metadata, with values
   * matching the Config_File.
   */

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop12-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generated .env contains mappings for all schemaMeta entries with env annotations, values matching the config", () => {
    fc.assert(
      fc.property(
        // Generate random overrides for terminal.port (number), browserless.apiKey (string), webbrowser.headless (boolean)
        fc.record({
          terminalPort: fc.integer({ min: 1, max: 65535 }),
          browserlessApiKey: fc.stringOf(
            fc.constantFrom(
              ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
            ),
            { minLength: 1, maxLength: 40 },
          ),
          webbrowserHeadless: fc.boolean(),
        }),
        ({ terminalPort, browserlessApiKey, webbrowserHeadless }) => {
          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");
          const envOutputPath = path.join(tmpDir, ".env");

          const overrides = {
            terminal: { port: terminalPort },
            browserless: { apiKey: browserlessApiKey },
            webbrowser: { headless: webbrowserHeadless },
          };

          // Suppress stderr during generation
          const stderrWrite = process.stderr.write;
          process.stderr.write = (() => true) as typeof process.stderr.write;
          try {
            generateConfigFile({
              format: "yaml",
              outputPath,
              envOutputPath,
              overrides,
            });
          } finally {
            process.stderr.write = stderrWrite;
          }

          // Read the generated .env file
          expect(fs.existsSync(envOutputPath)).toBe(true);
          const envContent = fs.readFileSync(envOutputPath, "utf-8");
          const envMap = parseEnvFile(envContent);

          // Read the generated config file to get the actual resolved config
          const configContent = fs.readFileSync(outputPath, "utf-8");
          const configObj = yamlParse(configContent) as Record<string, unknown>;
          const validatedConfig = configSchema.parse(configObj);

          // For EVERY entry in schemaMeta that has an `env` field,
          // the .env file must contain a line with that env var name
          for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
            if (!meta.env) continue;

            const configValue = getNestedValue(validatedConfig, dottedPath);

            // The .env must have this key
            expect(envMap).toHaveProperty(meta.env);

            // The value must match the config value (formatted for .env)
            if (configValue !== undefined && configValue !== null) {
              const expectedEnvValue = formatValueForEnv(configValue);
              expect(envMap[meta.env]).toBe(expectedEnvValue);
            }
          }

          // Spot-check: the overridden values must appear correctly
          expect(envMap["TERMINAL_PORT"]).toBe(String(terminalPort));
          expect(envMap["BROWSERLESS_API_KEY"]).toBe(browserlessApiKey);
          expect(envMap["BROWSER_HEADLESS"]).toBe(String(webbrowserHeadless));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("generated .env in JSON mode also contains all env-annotated mappings", () => {
    fc.assert(
      fc.property(
        fc.record({
          terminalPort: fc.integer({ min: 1, max: 65535 }),
          browserlessApiKey: fc.stringOf(
            fc.constantFrom(
              ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
            ),
            { minLength: 1, maxLength: 40 },
          ),
          webbrowserHeadless: fc.boolean(),
        }),
        ({ terminalPort, browserlessApiKey, webbrowserHeadless }) => {
          const outputPath = path.join(tmpDir, "llm-toolkit.config.json");
          const envOutputPath = path.join(tmpDir, ".env");

          const overrides = {
            terminal: { port: terminalPort },
            browserless: { apiKey: browserlessApiKey },
            webbrowser: { headless: webbrowserHeadless },
          };

          // Suppress stderr during generation
          const stderrWrite = process.stderr.write;
          process.stderr.write = (() => true) as typeof process.stderr.write;
          try {
            generateConfigFile({
              format: "json",
              outputPath,
              envOutputPath,
              overrides,
            });
          } finally {
            process.stderr.write = stderrWrite;
          }

          // Read the generated .env file
          expect(fs.existsSync(envOutputPath)).toBe(true);
          const envContent = fs.readFileSync(envOutputPath, "utf-8");
          const envMap = parseEnvFile(envContent);

          // Read the generated config file as JSON
          const configContent = fs.readFileSync(outputPath, "utf-8");
          const configObj = JSON.parse(configContent) as Record<string, unknown>;
          const validatedConfig = configSchema.parse(configObj);

          // Verify all env-annotated entries exist in .env with matching values
          for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
            if (!meta.env) continue;

            const configValue = getNestedValue(validatedConfig, dottedPath);

            expect(envMap).toHaveProperty(meta.env);

            if (configValue !== undefined && configValue !== null) {
              const expectedEnvValue = formatValueForEnv(configValue);
              expect(envMap[meta.env]).toBe(expectedEnvValue);
            }
          }

          // Spot-check overridden values
          expect(envMap["TERMINAL_PORT"]).toBe(String(terminalPort));
          expect(envMap["BROWSERLESS_API_KEY"]).toBe(browserlessApiKey);
          expect(envMap["BROWSER_HEADLESS"]).toBe(String(webbrowserHeadless));
        },
      ),
      { numRuns: 100 },
    );
  });
});
