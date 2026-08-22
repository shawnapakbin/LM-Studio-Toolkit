import * as fs from "fs";
import * as os from "os";
import * as path from "path";
/**
 * Property tests for the Migration CLI.
 *
 * Property 8: Legacy .env Migration Round Trip
 * Property 9: Unknown .env Keys Placed in Custom Section
 * Property 10: Malformed .env Lines Handled Gracefully
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6
 */
import fc from "fast-check";

import { parse as yamlParse } from "yaml";

import { createConfigLoader } from "../../src/loader";
import { migrateConfig } from "../../src/migrate";
import { schemaMeta } from "../../src/schema-meta";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Collect a subset of known legacy env keys for generating valid KEY=VALUE lines.
 * We pick entries that have a legacyEnvKey defined and are string-typed to
 * avoid type coercion issues in the test.
 */
function getKnownLegacyKeys(): Array<{ legacyEnvKey: string; dottedPath: string }> {
  const keys: Array<{ legacyEnvKey: string; dottedPath: string }> = [];
  const seen = new Set<string>();
  for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
    if (meta.legacyEnvKey && !seen.has(meta.legacyEnvKey)) {
      seen.add(meta.legacyEnvKey);
      keys.push({ legacyEnvKey: meta.legacyEnvKey, dottedPath });
    }
  }
  return keys;
}

const KNOWN_KEYS = getKnownLegacyKeys();

/**
 * Arbitrary: a valid KEY=VALUE line using a known schemaMeta legacy key.
 * Returns both the line text and the key/value pair used.
 */
const arbValidLine = fc
  .tuple(
    fc.integer({ min: 0, max: KNOWN_KEYS.length - 1 }),
    // Generate safe values: alphanumeric strings that won't confuse parsers
    fc.stringOf(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./: ".split(""),
      ),
      { minLength: 1, maxLength: 30 },
    ),
  )
  .map(([idx, value]) => {
    const { legacyEnvKey } = KNOWN_KEYS[idx];
    return { line: `${legacyEnvKey}=${value}`, key: legacyEnvKey, value };
  });

/**
 * Arbitrary: a malformed line that does NOT contain an '=' separator.
 * These should be non-empty, non-comment lines without '='.
 */
const arbMalformedLine = fc
  .stringOf(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ ".split(""),
    ),
    { minLength: 1, maxLength: 50 },
  )
  .filter((s) => !s.includes("=") && !s.trim().startsWith("#") && s.trim().length > 0);

// ─── Property 8: Legacy .env Migration Round Trip ─────────────────────────────

/**
 * Known test keys from schemaMeta covering different types:
 * - TERMINAL_DEFAULT_TIMEOUT_MS → terminal.defaultTimeoutMs (number, timeout)
 * - BROWSERLESS_API_KEY → browserless.apiKey (string, sensitive)
 * - BROWSERLESS_API_URL → browserless.apiUrl (string)
 * - BLENDER_MCP_HOST → blenderbridge.host (string)
 * - BLENDER_MCP_PORT → blenderbridge.port (number, port)
 */
interface TestKeySpec {
  envKey: string;
  schemaPath: string;
  arbitrary: fc.Arbitrary<string>;
  coerce: (envValue: string) => unknown;
}

const roundTripTestKeys: TestKeySpec[] = [
  {
    envKey: "TERMINAL_DEFAULT_TIMEOUT_MS",
    schemaPath: "terminal.defaultTimeoutMs",
    arbitrary: fc.integer({ min: 0, max: 86400000 }).map(String),
    coerce: (v) => parseInt(v, 10),
  },
  {
    envKey: "BROWSERLESS_API_KEY",
    schemaPath: "browserless.apiKey",
    arbitrary: fc.stringOf(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
      ),
      { minLength: 1, maxLength: 40 },
    ),
    coerce: (v) => v,
  },
  {
    envKey: "BROWSERLESS_API_URL",
    schemaPath: "browserless.apiUrl",
    arbitrary: fc
      .tuple(
        fc.constantFrom("http", "https"),
        fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), {
          minLength: 3,
          maxLength: 20,
        }),
        fc.constantFrom(".com", ".io", ".org", ".net"),
      )
      .map(([scheme, host, tld]) => `${scheme}://${host}${tld}`),
    coerce: (v) => v,
  },
  {
    envKey: "BLENDER_MCP_HOST",
    schemaPath: "blenderbridge.host",
    arbitrary: fc.constantFrom("127.0.0.1", "localhost", "0.0.0.0", "192.168.1.100"),
    coerce: (v) => v,
  },
  {
    envKey: "BLENDER_MCP_PORT",
    schemaPath: "blenderbridge.port",
    arbitrary: fc.integer({ min: 1, max: 65535 }).map(String),
    coerce: (v) => parseInt(v, 10),
  },
];

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

describe("Feature: v2-4-0-unified-config-installer, Property 8: Legacy .env Migration Round Trip", () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   *
   * For any valid .env file with known key-value pairs, running migrate-config
   * and then loading the generated Config_File must produce a config where every
   * original .env value appears at its corresponding schema path.
   */
  it("round-trips known .env values through migration and loading (YAML format)", () => {
    fc.assert(
      fc.property(
        roundTripTestKeys[0].arbitrary,
        roundTripTestKeys[1].arbitrary,
        roundTripTestKeys[2].arbitrary,
        roundTripTestKeys[3].arbitrary,
        roundTripTestKeys[4].arbitrary,
        (val0, val1, val2, val3, val4) => {
          const values = [val0, val1, val2, val3, val4];
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-prop8-"));

          try {
            // 1. Write a .env file with the generated values
            const envContent = roundTripTestKeys
              .map((spec, i) => `${spec.envKey}=${values[i]}`)
              .join("\n");
            const envPath = path.join(tempDir, ".env");
            fs.writeFileSync(envPath, envContent, "utf-8");

            // 2. Run migrateConfig to generate a YAML config file
            const outputPath = path.join(tempDir, "llm-toolkit.config.yaml");

            // Suppress stderr output during test
            const stderrWrite = process.stderr.write;
            process.stderr.write = (() => true) as typeof process.stderr.write;
            try {
              migrateConfig({ format: "yaml", envPath, outputPath });
            } finally {
              process.stderr.write = stderrWrite;
            }

            // 3. Verify the config file was created
            expect(fs.existsSync(outputPath)).toBe(true);

            // 4. Load the generated config file with createConfigLoader
            const loader = createConfigLoader({
              configPath: outputPath,
              envOverrides: {}, // empty to avoid env interference
            });
            const config = loader.getConfig();

            // 5. Assert each original .env value appears at its corresponding schema path
            for (let i = 0; i < roundTripTestKeys.length; i++) {
              const spec = roundTripTestKeys[i];
              const expectedValue = spec.coerce(values[i]);
              const actualValue = getNestedValue(config, spec.schemaPath);
              expect(actualValue).toEqual(expectedValue);
            }
          } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("round-trips known .env values through migration and loading (JSON format)", () => {
    fc.assert(
      fc.property(
        roundTripTestKeys[0].arbitrary,
        roundTripTestKeys[1].arbitrary,
        roundTripTestKeys[2].arbitrary,
        roundTripTestKeys[3].arbitrary,
        roundTripTestKeys[4].arbitrary,
        (val0, val1, val2, val3, val4) => {
          const values = [val0, val1, val2, val3, val4];
          const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-prop8-"));

          try {
            // 1. Write a .env file with the generated values
            const envContent = roundTripTestKeys
              .map((spec, i) => `${spec.envKey}=${values[i]}`)
              .join("\n");
            const envPath = path.join(tempDir, ".env");
            fs.writeFileSync(envPath, envContent, "utf-8");

            // 2. Run migrateConfig to generate a JSON config file
            const outputPath = path.join(tempDir, "llm-toolkit.config.json");

            // Suppress stderr output during test
            const stderrWrite = process.stderr.write;
            process.stderr.write = (() => true) as typeof process.stderr.write;
            try {
              migrateConfig({ format: "json", envPath, outputPath });
            } finally {
              process.stderr.write = stderrWrite;
            }

            // 3. Verify the config file was created
            expect(fs.existsSync(outputPath)).toBe(true);

            // 4. Load the generated config file with createConfigLoader
            const loader = createConfigLoader({
              configPath: outputPath,
              envOverrides: {}, // empty to avoid env interference
            });
            const config = loader.getConfig();

            // 5. Assert each original .env value appears at its corresponding schema path
            for (let i = 0; i < roundTripTestKeys.length; i++) {
              const spec = roundTripTestKeys[i];
              const expectedValue = spec.coerce(values[i]);
              const actualValue = getNestedValue(config, spec.schemaPath);
              expect(actualValue).toEqual(expectedValue);
            }
          } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10: Malformed .env Lines Handled Gracefully ────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 10: Malformed .env Lines Handled Gracefully", () => {
  /**
   * Validates: Requirements 4.6
   *
   * For any .env file containing a mix of valid KEY=VALUE lines and malformed
   * lines (missing '=' separator), the migrate-config CLI must process all
   * valid lines correctly, skip each malformed line, and emit a warning to
   * stderr identifying the line number of each skipped line.
   */

  let tmpDir: string;
  let stderrOutput: string;
  let originalStderrWrite: typeof process.stderr.write;
  let originalExitCode: string | number | null | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-prop10-"));
    stderrOutput = "";
    originalStderrWrite = process.stderr.write;
    originalExitCode = process.exitCode;
    // Capture stderr
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode as number | undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("processes valid lines and warns about malformed lines with their line numbers", () => {
    fc.assert(
      fc.property(
        // Generate 1-5 valid lines
        fc.array(arbValidLine, { minLength: 1, maxLength: 5 }),
        // Generate 1-5 malformed lines
        fc.array(arbMalformedLine, { minLength: 1, maxLength: 5 }),
        // Generate a shuffled interleaving order (true = valid, false = malformed)
        fc.func(fc.boolean()),
        (validLines, malformedLines, orderFn) => {
          // Build the .env file by interleaving valid and malformed lines
          const allLines: Array<{
            type: "valid" | "malformed";
            text: string;
            key?: string;
            value?: string;
          }> = [];

          for (const v of validLines) {
            allLines.push({ type: "valid", text: v.line, key: v.key, value: v.value });
          }
          for (const m of malformedLines) {
            allLines.push({ type: "malformed", text: m });
          }

          // Shuffle the lines deterministically using the order function
          // Use a simple Fisher-Yates style with the boolean function
          for (let i = allLines.length - 1; i > 0; i--) {
            if (orderFn(i)) {
              const j = i - 1;
              [allLines[i], allLines[j]] = [allLines[j], allLines[i]];
            }
          }

          const envContent = allLines.map((l) => l.text).join("\n");
          const envPath = path.join(tmpDir, ".env");
          fs.writeFileSync(envPath, envContent, "utf-8");

          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");

          // Reset stderr capture
          stderrOutput = "";

          // Call migrateConfig - it should NOT throw
          expect(() => {
            migrateConfig({
              format: "yaml",
              envPath,
              outputPath,
            });
          }).not.toThrow();

          // Determine which 1-indexed line numbers are malformed
          const malformedLineNumbers: number[] = [];
          for (let i = 0; i < allLines.length; i++) {
            if (allLines[i].type === "malformed") {
              malformedLineNumbers.push(i + 1); // 1-indexed
            }
          }

          // Assert: stderr contains a warning for each malformed line with its line number
          for (const lineNum of malformedLineNumbers) {
            expect(stderrOutput).toContain(`line ${lineNum}`);
          }

          // Assert: the number of "malformed line" warnings equals the number of malformed lines
          const malformedWarnings = stderrOutput
            .split("\n")
            .filter((line) => line.includes("Skipping malformed line"));
          expect(malformedWarnings.length).toBe(malformedLineNumbers.length);

          // Assert: output file was written (valid lines were processed)
          expect(fs.existsSync(outputPath)).toBe(true);

          // Assert: valid lines were NOT treated as malformed
          // Check that the exact malformed line warning pattern doesn't mention valid line numbers
          const validLineNumbers: number[] = [];
          for (let i = 0; i < allLines.length; i++) {
            if (allLines[i].type === "valid") {
              validLineNumbers.push(i + 1);
            }
          }
          for (const lineNum of validLineNumbers) {
            // Use exact pattern match to avoid substring false positives (e.g., "line 10" matching "line 1")
            const exactPattern = `malformed line ${lineNum}:`;
            expect(stderrOutput).not.toContain(exactPattern);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not crash on .env files with only malformed lines", () => {
    fc.assert(
      fc.property(fc.array(arbMalformedLine, { minLength: 1, maxLength: 10 }), (malformedLines) => {
        const envContent = malformedLines.join("\n");
        const envPath = path.join(tmpDir, ".env");
        fs.writeFileSync(envPath, envContent, "utf-8");

        const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");

        // Reset stderr capture
        stderrOutput = "";

        // Should NOT throw
        expect(() => {
          migrateConfig({
            format: "yaml",
            envPath,
            outputPath,
          });
        }).not.toThrow();

        // Output file should still be written (empty config with defaults)
        expect(fs.existsSync(outputPath)).toBe(true);

        // Each malformed line should produce a warning with its line number
        for (let i = 0; i < malformedLines.length; i++) {
          expect(stderrOutput).toContain(`line ${i + 1}`);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("correctly identifies line numbers even when interspersed with blank/comment lines", () => {
    fc.assert(
      fc.property(
        fc.array(arbValidLine, { minLength: 1, maxLength: 3 }),
        fc.array(arbMalformedLine, { minLength: 1, maxLength: 3 }),
        fc.array(fc.constantFrom("", "# a comment", "  # indented comment"), {
          minLength: 0,
          maxLength: 3,
        }),
        (validLines, malformedLines, blankOrCommentLines) => {
          // Build file with interleaved valid, malformed, blank, and comment lines
          const fileLines: Array<{ text: string; isMalformed: boolean }> = [];

          for (const v of validLines) {
            fileLines.push({ text: v.line, isMalformed: false });
          }
          for (const m of malformedLines) {
            fileLines.push({ text: m, isMalformed: true });
          }
          for (const b of blankOrCommentLines) {
            fileLines.push({ text: b, isMalformed: false });
          }

          // Simple shuffle: reverse the array
          fileLines.reverse();

          const envContent = fileLines.map((l) => l.text).join("\n");
          const envPath = path.join(tmpDir, ".env");
          fs.writeFileSync(envPath, envContent, "utf-8");

          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");

          // Reset stderr capture
          stderrOutput = "";

          // Should NOT throw
          expect(() => {
            migrateConfig({
              format: "yaml",
              envPath,
              outputPath,
            });
          }).not.toThrow();

          // Check warnings contain correct line numbers for malformed lines
          for (let i = 0; i < fileLines.length; i++) {
            if (fileLines[i].isMalformed) {
              const lineNumber = i + 1;
              expect(stderrOutput).toContain(`line ${lineNumber}`);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Helpers for Property 9 ──────────────────────────────────────────────────

/**
 * Collect all known .env keys from schemaMeta (both legacyEnvKey and env fields)
 * so we can generate keys guaranteed NOT to be in the lookup.
 */
function getKnownEnvKeys(): Set<string> {
  const keys = new Set<string>();
  for (const meta of Object.values(schemaMeta)) {
    if (meta.legacyEnvKey) keys.add(meta.legacyEnvKey);
    if (meta.env) keys.add(meta.env);
  }
  return keys;
}

const KNOWN_ENV_KEYS = getKnownEnvKeys();

/**
 * Arbitrary: generates a valid env-style key name that is NOT in schemaMeta.
 * Uses a prefix "UNKNOWN_CUSTOM_" + alphanumeric suffix to guarantee uniqueness.
 */
const arbUnknownKey = fc
  .stringOf(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split("")), {
    minLength: 1,
    maxLength: 30,
  })
  .map((suffix) => `UNKNOWN_CUSTOM_${suffix}`)
  .filter((key) => !KNOWN_ENV_KEYS.has(key));

/**
 * Arbitrary: generates a safe .env value (no newlines, no quotes that would
 * break parsing).
 */
const arbEnvValue = fc.stringOf(
  fc.constantFrom(
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./:@!#$%^&*+=".split(""),
  ),
  { minLength: 1, maxLength: 50 },
);

/**
 * Captures stderr output during a function call.
 */
function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;

  try {
    fn();
  } finally {
    process.stderr.write = originalWrite;
  }

  return chunks.join("");
}

// ─── Property 9: Unknown .env Keys Placed in Custom Section ──────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 9: Unknown .env Keys Placed in Custom Section", () => {
  /**
   * Validates: Requirements 4.4
   *
   * For any .env key that does not have a corresponding mapping in the schema
   * metadata, the migrate-config CLI must place that key-value pair under the
   * `custom` namespace in the generated Config_File and emit a warning to stderr
   * identifying the unrecognized key name.
   */

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-prop9-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unknown .env keys are placed in the custom section of the generated config", () => {
    fc.assert(
      fc.property(
        // Generate 1-5 unique unknown key-value pairs
        fc
          .array(fc.tuple(arbUnknownKey, arbEnvValue), { minLength: 1, maxLength: 5 })
          .map((pairs) => {
            // Deduplicate keys
            const seen = new Set<string>();
            return pairs.filter(([key]) => {
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }),
        (unknownPairs) => {
          // Ensure we have at least one pair after dedup
          fc.pre(unknownPairs.length > 0);

          // Write .env file with unknown keys
          const envContent = unknownPairs.map(([key, value]) => `${key}=${value}`).join("\n");
          const envPath = path.join(tmpDir, ".env");
          fs.writeFileSync(envPath, envContent, "utf-8");

          const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");

          // Run migrate, capturing stderr
          const stderr = captureStderr(() => {
            migrateConfig({
              format: "yaml",
              envPath,
              outputPath,
            });
          });

          // Read the generated config file
          const outputContent = fs.readFileSync(outputPath, "utf-8");
          const configObj = yamlParse(outputContent) as Record<string, unknown>;

          // Assert: config has a `custom` section
          expect(configObj).toHaveProperty("custom");
          const customSection = configObj["custom"] as Record<string, string>;

          // Assert: every unknown key-value pair appears in the custom section
          for (const [key, value] of unknownPairs) {
            expect(customSection[key]).toBe(value);
          }

          // Assert: stderr contains a warning for each unknown key
          for (const [key] of unknownPairs) {
            expect(stderr).toContain(key);
            expect(stderr).toContain("Warning");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("stderr warnings identify each unrecognized key by name", () => {
    fc.assert(
      fc.property(arbUnknownKey, arbEnvValue, (key, value) => {
        // Write .env with a single unknown key
        const envPath = path.join(tmpDir, ".env");
        fs.writeFileSync(envPath, `${key}=${value}\n`, "utf-8");

        const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");

        const stderr = captureStderr(() => {
          migrateConfig({
            format: "yaml",
            envPath,
            outputPath,
          });
        });

        // Stderr must contain a warning line that names the unknown key
        expect(stderr).toContain(`'${key}'`);
        expect(stderr).toMatch(/[Ww]arning/);
        expect(stderr).toContain("custom");
      }),
      { numRuns: 100 },
    );
  });

  it("unknown keys in JSON format output are also placed in the custom section", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.tuple(arbUnknownKey, arbEnvValue), { minLength: 1, maxLength: 3 })
          .map((pairs) => {
            const seen = new Set<string>();
            return pairs.filter(([key]) => {
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }),
        (unknownPairs) => {
          fc.pre(unknownPairs.length > 0);

          const envContent = unknownPairs.map(([key, value]) => `${key}=${value}`).join("\n");
          const envPath = path.join(tmpDir, ".env");
          fs.writeFileSync(envPath, envContent, "utf-8");

          const outputPath = path.join(tmpDir, "llm-toolkit.config.json");

          captureStderr(() => {
            migrateConfig({
              format: "json",
              envPath,
              outputPath,
            });
          });

          // Read JSON output
          const outputContent = fs.readFileSync(outputPath, "utf-8");
          const configObj = JSON.parse(outputContent) as Record<string, unknown>;

          // Assert custom section exists with all unknown keys
          expect(configObj).toHaveProperty("custom");
          const customSection = configObj["custom"] as Record<string, string>;

          for (const [key, value] of unknownPairs) {
            expect(customSection[key]).toBe(value);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
