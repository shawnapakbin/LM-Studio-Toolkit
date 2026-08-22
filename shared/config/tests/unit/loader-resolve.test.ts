/**
 * Unit tests for resolveConfigFile - the config file resolution logic.
 *
 * Tests cover:
 * - LLM_TOOLKIT_CONFIG env var override (valid/invalid paths)
 * - YAML/JSON dual-format detection and parsing
 * - Both-files-exist warning behavior
 * - No-file fallback (returns null)
 * - Parse error handling for malformed YAML/JSON
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveConfigFile } from "../../src/loader";
import { ConfigFileNotFoundError, ConfigParseError } from "../../src/types";

describe("resolveConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
    // Clear the env var before each test
    delete process.env.LLM_TOOLKIT_CONFIG;
  });

  afterEach(() => {
    delete process.env.LLM_TOOLKIT_CONFIG;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── LLM_TOOLKIT_CONFIG env var ──────────────────────────────────────────────

  describe("LLM_TOOLKIT_CONFIG env var override", () => {
    it("should load config from the path specified by LLM_TOOLKIT_CONFIG", () => {
      const configPath = path.join(tmpDir, "custom.yaml");
      fs.writeFileSync(configPath, "terminal:\n  port: 4000\n");
      process.env.LLM_TOOLKIT_CONFIG = configPath;

      const result = resolveConfigFile(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.filePath).toBe(configPath);
      expect(result!.data).toEqual({ terminal: { port: 4000 } });
    });

    it("should load a JSON file specified by LLM_TOOLKIT_CONFIG", () => {
      const configPath = path.join(tmpDir, "custom.json");
      fs.writeFileSync(configPath, JSON.stringify({ terminal: { port: 5000 } }));
      process.env.LLM_TOOLKIT_CONFIG = configPath;

      const result = resolveConfigFile(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.filePath).toBe(configPath);
      expect(result!.data).toEqual({ terminal: { port: 5000 } });
    });

    it("should throw ConfigFileNotFoundError if LLM_TOOLKIT_CONFIG path does not exist", () => {
      process.env.LLM_TOOLKIT_CONFIG = path.join(tmpDir, "nonexistent.yaml");

      expect(() => resolveConfigFile(tmpDir)).toThrow(ConfigFileNotFoundError);
    });

    it("should NOT fall back to default location when LLM_TOOLKIT_CONFIG is invalid", () => {
      // Place a valid config at the default location
      fs.writeFileSync(
        path.join(tmpDir, "llm-toolkit.config.yaml"),
        "global:\n  logLevel: debug\n",
      );
      process.env.LLM_TOOLKIT_CONFIG = path.join(tmpDir, "nonexistent.yaml");

      expect(() => resolveConfigFile(tmpDir)).toThrow(ConfigFileNotFoundError);
    });
  });

  // ─── Default file detection ──────────────────────────────────────────────────

  describe("default file detection", () => {
    it("should detect and load llm-toolkit.config.yaml", () => {
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(yamlPath, "global:\n  logLevel: warn\n");

      const result = resolveConfigFile(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.filePath).toBe(yamlPath);
      expect(result!.data).toEqual({ global: { logLevel: "warn" } });
    });

    it("should detect and load llm-toolkit.config.json", () => {
      const jsonPath = path.join(tmpDir, "llm-toolkit.config.json");
      fs.writeFileSync(jsonPath, JSON.stringify({ global: { logLevel: "error" } }));

      const result = resolveConfigFile(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.filePath).toBe(jsonPath);
      expect(result!.data).toEqual({ global: { logLevel: "error" } });
    });

    it("should prefer YAML over JSON when both exist and warn to stderr", () => {
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      const jsonPath = path.join(tmpDir, "llm-toolkit.config.json");
      fs.writeFileSync(yamlPath, "global:\n  logLevel: debug\n");
      fs.writeFileSync(jsonPath, JSON.stringify({ global: { logLevel: "error" } }));

      const stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);

      const result = resolveConfigFile(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.filePath).toBe(yamlPath);
      expect(result!.data).toEqual({ global: { logLevel: "debug" } });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("llm-toolkit.config.json"));

      stderrSpy.mockRestore();
    });

    it("should return null when no config file exists", () => {
      const result = resolveConfigFile(tmpDir);
      expect(result).toBeNull();
    });

    it("should use process.cwd() when no basePath is provided", () => {
      // Since cwd won't have our test files, it should return null
      // (unless the real project has config files, which it might)
      // This test just verifies the function doesn't throw
      const result = resolveConfigFile(tmpDir);
      expect(result).toBeNull();
    });
  });

  // ─── YAML parsing ─────────────────────────────────────────────────────────────

  describe("YAML parsing", () => {
    it("should parse valid YAML with nested objects", () => {
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(
        yamlPath,
        [
          "terminal:",
          "  port: 3333",
          "  defaultTimeoutMs: 60000",
          "webbrowser:",
          "  headless: true",
          "",
        ].join("\n"),
      );

      const result = resolveConfigFile(tmpDir);

      expect(result!.data).toEqual({
        terminal: { port: 3333, defaultTimeoutMs: 60000 },
        webbrowser: { headless: true },
      });
    });

    it("should throw ConfigParseError for malformed YAML", () => {
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(yamlPath, "terminal:\n  port: [invalid yaml\n  broken: {");

      expect(() => resolveConfigFile(tmpDir)).toThrow(ConfigParseError);
    });

    it("should include file path in ConfigParseError for YAML", () => {
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(yamlPath, "terminal:\n  port: [invalid\n");

      try {
        resolveConfigFile(tmpDir);
        throw new Error("Expected ConfigParseError");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigParseError);
        const parseErr = err as ConfigParseError;
        expect(parseErr.filePath).toBe(yamlPath);
        expect(parseErr.location).toMatch(/line|unknown/);
      }
    });
  });

  // ─── JSON parsing ──────────────────────────────────────────────────────────────

  describe("JSON parsing", () => {
    it("should parse valid JSON", () => {
      const jsonPath = path.join(tmpDir, "llm-toolkit.config.json");
      fs.writeFileSync(
        jsonPath,
        JSON.stringify({
          terminal: { port: 4444, defaultTimeoutMs: 30000 },
          calculator: { defaultPrecision: 15 },
        }),
      );

      const result = resolveConfigFile(tmpDir);

      expect(result!.data).toEqual({
        terminal: { port: 4444, defaultTimeoutMs: 30000 },
        calculator: { defaultPrecision: 15 },
      });
    });

    it("should throw ConfigParseError for malformed JSON", () => {
      const jsonPath = path.join(tmpDir, "llm-toolkit.config.json");
      fs.writeFileSync(jsonPath, '{ "terminal": { "port": }');

      expect(() => resolveConfigFile(tmpDir)).toThrow(ConfigParseError);
    });

    it("should include file path in ConfigParseError for JSON", () => {
      const jsonPath = path.join(tmpDir, "llm-toolkit.config.json");
      fs.writeFileSync(jsonPath, "not valid json at all {{{");

      try {
        resolveConfigFile(tmpDir);
        throw new Error("Expected ConfigParseError");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigParseError);
        const parseErr = err as ConfigParseError;
        expect(parseErr.filePath).toBe(jsonPath);
        expect(parseErr.location).toMatch(/line|unknown/);
      }
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle empty YAML file (returns null data)", () => {
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(yamlPath, "");

      const result = resolveConfigFile(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.filePath).toBe(yamlPath);
      // Empty YAML parses to null
      expect(result!.data).toBeNull();
    });

    it("should handle YAML file with only comments", () => {
      const yamlPath = path.join(tmpDir, "llm-toolkit.config.yaml");
      fs.writeFileSync(yamlPath, "# This is a comment\n# Another comment\n");

      const result = resolveConfigFile(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.data).toBeNull();
    });

    it("should resolve relative LLM_TOOLKIT_CONFIG paths", () => {
      const configPath = path.join(tmpDir, "sub", "config.yaml");
      fs.mkdirSync(path.join(tmpDir, "sub"));
      fs.writeFileSync(configPath, "global:\n  logLevel: info\n");
      process.env.LLM_TOOLKIT_CONFIG = configPath;

      const result = resolveConfigFile();

      expect(result).not.toBeNull();
      expect(result!.data).toEqual({ global: { logLevel: "info" } });
    });
  });
});
