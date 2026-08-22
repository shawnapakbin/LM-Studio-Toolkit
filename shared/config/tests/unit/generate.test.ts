/**
 * Unit tests for config file generator.
 *
 * Tests cover:
 * - Generating a YAML config file with schema defaults
 * - Generating a JSON config file
 * - Applying overrides on top of defaults
 * - Generating companion .env file with env var mappings
 * - Validation failure reporting with path + expected type
 * - Repair mode: preserving existingValues
 * - skipEnv option
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parse as parseYaml } from "yaml";

import { generateConfigFile } from "../../src/generate";
import { configSchema } from "../../src/schema";
import { ConfigValidationError } from "../../src/types";

describe("Config File Generator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-generate-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateConfigFile - YAML output", () => {
    it("generates a valid YAML config file from schema defaults", () => {
      const outputPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      const envOutputPath = path.join(tmpDir, ".env");

      generateConfigFile({ outputPath, envOutputPath });

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      const parsed = parseYaml(content);

      // Should match schema defaults
      const defaults = configSchema.parse({});
      expect(parsed).toEqual(defaults);
    });

    it("uses YAML format by default", () => {
      const outputPath = path.join(tmpDir, "config.yaml");
      generateConfigFile({ outputPath, envOutputPath: path.join(tmpDir, ".env") });

      const content = fs.readFileSync(outputPath, "utf-8");
      // YAML content should not start with { (JSON-like)
      expect(content.startsWith("{")).toBe(false);
      // Should be parseable as YAML
      expect(() => parseYaml(content)).not.toThrow();
    });
  });

  describe("generateConfigFile - JSON output", () => {
    it("generates a valid JSON config file when format is json", () => {
      const outputPath = path.join(tmpDir, "llm-toolkit.config.json");

      generateConfigFile({
        format: "json",
        outputPath,
        envOutputPath: path.join(tmpDir, ".env"),
      });

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      const parsed = JSON.parse(content);

      const defaults = configSchema.parse({});
      expect(parsed).toEqual(defaults);
    });
  });

  describe("generateConfigFile - overrides", () => {
    it("merges overrides on top of schema defaults", () => {
      const outputPath = path.join(tmpDir, "config.yaml");

      generateConfigFile({
        outputPath,
        envOutputPath: path.join(tmpDir, ".env"),
        overrides: {
          terminal: { defaultTimeoutMs: 30000 },
          browserless: { apiKey: "my-secret-key" },
        },
      });

      const content = fs.readFileSync(outputPath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.terminal.defaultTimeoutMs).toBe(30000);
      expect(parsed.browserless.apiKey).toBe("my-secret-key");
      // Other defaults should still be present
      expect(parsed.terminal.maxTimeoutMs).toBe(120000);
    });
  });

  describe("generateConfigFile - existingValues (repair mode)", () => {
    it("preserves existingValues and overlays overrides", () => {
      const outputPath = path.join(tmpDir, "config.yaml");

      generateConfigFile({
        outputPath,
        envOutputPath: path.join(tmpDir, ".env"),
        existingValues: {
          terminal: { defaultTimeoutMs: 45000 },
        },
        overrides: {
          calculator: { defaultPrecision: 15 },
        },
      });

      const content = fs.readFileSync(outputPath, "utf-8");
      const parsed = parseYaml(content);

      // existingValues preserved
      expect(parsed.terminal.defaultTimeoutMs).toBe(45000);
      // overrides applied
      expect(parsed.calculator.defaultPrecision).toBe(15);
    });

    it("overrides take precedence over existingValues", () => {
      const outputPath = path.join(tmpDir, "config.yaml");

      generateConfigFile({
        outputPath,
        envOutputPath: path.join(tmpDir, ".env"),
        existingValues: {
          terminal: { defaultTimeoutMs: 45000 },
        },
        overrides: {
          terminal: { defaultTimeoutMs: 10000 },
        },
      });

      const content = fs.readFileSync(outputPath, "utf-8");
      const parsed = parseYaml(content);

      // overrides win over existingValues
      expect(parsed.terminal.defaultTimeoutMs).toBe(10000);
    });
  });

  describe("generateConfigFile - validation errors", () => {
    it("throws ConfigValidationError when overrides produce invalid config", () => {
      const outputPath = path.join(tmpDir, "config.yaml");
      const stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);

      expect(() => {
        generateConfigFile({
          outputPath,
          envOutputPath: path.join(tmpDir, ".env"),
          overrides: {
            terminal: { port: 99999 }, // exceeds max port 65535
          },
        });
      }).toThrow(ConfigValidationError);

      // Should have written error details to stderr
      expect(stderrSpy).toHaveBeenCalled();
      const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(stderrOutput).toContain("terminal.port");

      stderrSpy.mockRestore();
    });

    it("does not write config file when validation fails", () => {
      const outputPath = path.join(tmpDir, "config.yaml");

      try {
        generateConfigFile({
          outputPath,
          envOutputPath: path.join(tmpDir, ".env"),
          overrides: {
            terminal: { port: 99999 },
          },
        });
      } catch {
        // expected
      }

      expect(fs.existsSync(outputPath)).toBe(false);
    });
  });

  describe("generateConfigFile - companion .env file", () => {
    it("generates .env file with env var mappings from schemaMeta", () => {
      const outputPath = path.join(tmpDir, "config.yaml");
      const envOutputPath = path.join(tmpDir, ".env");

      generateConfigFile({ outputPath, envOutputPath });

      expect(fs.existsSync(envOutputPath)).toBe(true);
      const envContent = fs.readFileSync(envOutputPath, "utf-8");

      // Should contain known env vars from schemaMeta
      expect(envContent).toContain("TERMINAL_DEFAULT_TIMEOUT_MS=60000");
      expect(envContent).toContain("TERMINAL_MAX_TIMEOUT_MS=120000");
      expect(envContent).toContain("BROWSERLESS_API_KEY=");
    });

    it("writes override values into the .env file", () => {
      const outputPath = path.join(tmpDir, "config.yaml");
      const envOutputPath = path.join(tmpDir, ".env");

      generateConfigFile({
        outputPath,
        envOutputPath,
        overrides: {
          browserless: { apiKey: "test-key-123" },
        },
      });

      const envContent = fs.readFileSync(envOutputPath, "utf-8");
      expect(envContent).toContain("BROWSERLESS_API_KEY=test-key-123");
    });

    it("does not generate .env file when skipEnv is true", () => {
      const outputPath = path.join(tmpDir, "config.yaml");
      const envOutputPath = path.join(tmpDir, ".env");

      generateConfigFile({ outputPath, envOutputPath, skipEnv: true });

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.existsSync(envOutputPath)).toBe(false);
    });

    it("includes header comments in .env file", () => {
      const outputPath = path.join(tmpDir, "config.yaml");
      const envOutputPath = path.join(tmpDir, ".env");

      generateConfigFile({ outputPath, envOutputPath });

      const envContent = fs.readFileSync(envOutputPath, "utf-8");
      expect(envContent).toContain("# LLM Toolkit Environment Variables");
      expect(envContent).toContain("# Auto-generated");
    });
  });

  describe("generateConfigFile - directory creation", () => {
    it("creates output directories if they do not exist", () => {
      const outputPath = path.join(tmpDir, "subdir", "nested", "config.yaml");
      const envOutputPath = path.join(tmpDir, "envdir", ".env");

      generateConfigFile({ outputPath, envOutputPath });

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.existsSync(envOutputPath)).toBe(true);
    });
  });
});
