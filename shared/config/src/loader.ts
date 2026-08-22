/**
 * Config Loader - Reads, validates, and caches the unified configuration.
 *
 * Resolution priority: environment variables > config file > schema defaults
 *
 * @module @shared/config/loader
 */

import * as fs from "fs";
import * as path from "path";
import { parse as parseYaml } from "yaml";

import type { Config } from "./schema";
import { configSchema } from "./schema";
import { schemaMeta } from "./schema-meta";
import type { ConfigLoaderOptions, ConfigValidationIssue, IConfigLoader } from "./types";
import { ConfigFileNotFoundError, ConfigParseError, ConfigValidationError } from "./types";

// ─── Config File Resolution ──────────────────────────────────────────────────

/**
 * Resolves and parses the configuration file based on the resolution algorithm:
 *
 * 1. If `LLM_TOOLKIT_CONFIG` env var is set → use that path (error if not readable)
 * 2. Else check basePath for `llm-toolkit.config.yaml`, then `.json`
 * 3. If both exist → use YAML, warn about ignored JSON to stderr
 * 4. If neither exists → return null (no file source)
 *
 * @param basePath - Base directory to search for config files (defaults to process.cwd())
 * @returns Parsed config data and the file path it came from, or null if no file found
 * @throws {ConfigFileNotFoundError} If LLM_TOOLKIT_CONFIG points to a non-existent/unreadable path
 * @throws {ConfigParseError} If the config file has syntax errors
 */
export function resolveConfigFile(basePath?: string): { data: unknown; filePath: string } | null {
  const envPath = process.env.LLM_TOOLKIT_CONFIG;

  // Case 1: Explicit path via environment variable
  if (envPath) {
    const resolvedPath = path.resolve(envPath);
    if (!isFileReadable(resolvedPath)) {
      throw new ConfigFileNotFoundError(resolvedPath);
    }
    return parseConfigFile(resolvedPath);
  }

  // Case 2: Search in basePath (or cwd) for default config files
  const root = basePath ?? process.cwd();
  const yamlPath = path.join(root, "llm-toolkit.config.yaml");
  const jsonPath = path.join(root, "llm-toolkit.config.json");

  const yamlExists = isFileReadable(yamlPath);
  const jsonExists = isFileReadable(jsonPath);

  // Case 2c: Both exist → use YAML, warn about JSON
  if (yamlExists && jsonExists) {
    process.stderr.write(
      `[config] Warning: Both llm-toolkit.config.yaml and llm-toolkit.config.json exist. Using YAML; ignoring ${path.basename(jsonPath)}.\n`,
    );
    return parseConfigFile(yamlPath);
  }

  // Use whichever exists
  if (yamlExists) {
    return parseConfigFile(yamlPath);
  }
  if (jsonExists) {
    return parseConfigFile(jsonPath);
  }

  // Case 2d: Neither exists → no file source
  return null;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Checks if a file exists and is readable.
 */
function isFileReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses a config file (YAML or JSON) based on its extension.
 *
 * @throws {ConfigParseError} If the file content has syntax errors
 */
function parseConfigFile(filePath: string): { data: unknown; filePath: string } {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".yaml" || ext === ".yml") {
    return { data: parseYamlContent(content, filePath), filePath };
  }

  if (ext === ".json") {
    return { data: parseJsonContent(content, filePath), filePath };
  }

  // If extension is ambiguous, try YAML first (it's a superset of JSON)
  return { data: parseYamlContent(content, filePath), filePath };
}

/**
 * Parses YAML content, throwing ConfigParseError on syntax errors.
 */
function parseYamlContent(content: string, filePath: string): unknown {
  try {
    return parseYaml(content);
  } catch (err: unknown) {
    const location = extractYamlErrorLocation(err);
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigParseError(filePath, location, message);
  }
}

/**
 * Parses JSON content, throwing ConfigParseError on syntax errors.
 */
function parseJsonContent(content: string, filePath: string): unknown {
  try {
    return JSON.parse(content);
  } catch (err: unknown) {
    const location = extractJsonErrorLocation(err, content);
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigParseError(filePath, location, message);
  }
}

/**
 * Extracts line/column info from a YAML parse error.
 * The `yaml` package includes position data in its error objects.
 */
function extractYamlErrorLocation(err: unknown): string {
  if (err && typeof err === "object") {
    // The yaml package attaches linePos or pos info
    const yamlErr = err as {
      linePos?: Array<{ line: number; col: number }>;
      pos?: [number, number];
    };
    if (yamlErr.linePos && yamlErr.linePos.length > 0) {
      const { line, col } = yamlErr.linePos[0];
      return `line ${line}, column ${col}`;
    }
  }
  return "unknown location";
}

/**
 * Extracts approximate location from a JSON parse error message.
 * JSON.parse errors typically include "at position N".
 */
function extractJsonErrorLocation(err: unknown, content: string): string {
  if (err instanceof SyntaxError) {
    // Modern V8: "... at position 42" or "at line X column Y"
    const posMatch = err.message.match(/position\s+(\d+)/i);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const { line, col } = offsetToLineCol(content, pos);
      return `line ${line}, column ${col}`;
    }
    const lineColMatch = err.message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineColMatch) {
      return `line ${lineColMatch[1]}, column ${lineColMatch[2]}`;
    }
  }
  return "unknown location";
}

/**
 * Converts a character offset to line and column numbers (1-based).
 */
function offsetToLineCol(content: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: offset - lastNewline };
}

// ─── Env Var Coercion ─────────────────────────────────────────────────────────

/**
 * Coerces a string environment variable value to the appropriate JS type
 * based on the expected schema type at the given path.
 *
 * - number → parseInt/parseFloat
 * - boolean → "true"/"1" → true, "false"/"0" → false
 * - string/enum → use as-is
 */
function coerceEnvValue(value: string, schemaPath: string): unknown {
  // Determine the expected type by inspecting the schema shape
  const expectedType = getExpectedType(schemaPath);

  switch (expectedType) {
    case "number":
      // Try integer first, fall back to float
      if (/^-?\d+$/.test(value)) {
        return parseInt(value, 10);
      }
      return parseFloat(value);
    case "boolean":
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      return value; // Let Zod validation catch invalid booleans
    default:
      return value;
  }
}

/**
 * Determines the expected type for a dotted schema path by inspecting
 * the Zod schema shape.
 */
function getExpectedType(schemaPath: string): "string" | "number" | "boolean" {
  const parts = schemaPath.split(".");
  if (parts.length !== 2) return "string";

  const [namespace, key] = parts;
  try {
    // Access the namespace shape in the schema
    const shape = (
      configSchema.shape as Record<
        string,
        { _def?: { innerType?: { shape?: Record<string, unknown> }; typeName?: string } }
      >
    )[namespace];
    if (!shape?._def) return "string";

    // Get the inner type (unwrap default wrapper)
    const innerType = shape._def.innerType;
    if (!innerType?.shape) return "string";

    const field = innerType.shape[key] as
      | {
          _def?: {
            innerType?: {
              _def?: { typeName?: string; innerType?: { _def?: { typeName?: string } } };
            };
            typeName?: string;
          };
        }
      | undefined;
    if (!field) return "string";

    // Unwrap .default() wrapper(s) to get to the underlying type
    const typeName = resolveZodTypeName(field);

    if (typeName === "ZodNumber") return "number";
    if (typeName === "ZodBoolean") return "boolean";
    return "string";
  } catch {
    return "string";
  }
}

/**
 * Recursively unwraps Zod type wrappers (ZodDefault, ZodOptional) to get
 * the underlying type name.
 */
function resolveZodTypeName(field: unknown): string {
  const f = field as { _def?: { typeName?: string; innerType?: unknown } };
  if (!f?._def) return "unknown";

  const typeName = f._def.typeName;
  if (typeName === "ZodDefault" || typeName === "ZodOptional") {
    return resolveZodTypeName(f._def.innerType);
  }
  return typeName ?? "unknown";
}

// ─── Merge Logic ─────────────────────────────────────────────────────────────

/**
 * Applies environment variable overrides to a config data object.
 * For each entry in schemaMeta that has an `env` property, checks if
 * that env var is set and overlays the coerced value onto the data.
 *
 * @param data - The parsed file config data (or empty object)
 * @param envSource - The environment variables to read from (defaults to process.env)
 * @returns The merged data object with env var overrides applied
 */
function applyEnvOverrides(
  data: Record<string, unknown>,
  envSource: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  const result = deepClone(data);

  for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
    if (!meta.env) continue;

    const envValue = envSource[meta.env];
    if (envValue === undefined) continue;

    // Set the coerced value at the dotted path
    const parts = dottedPath.split(".");
    setNestedValue(result, parts, coerceEnvValue(envValue, dottedPath));
  }

  return result;
}

/**
 * Deep clones a plain object/value (JSON-safe).
 */
function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Sets a value at a nested path in an object, creating intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, parts: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === undefined || current[key] === null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validates merged config data against the schema using safeParse to collect
 * ALL errors in a single pass.
 *
 * @throws {ConfigValidationError} with all issues if validation fails
 */
function validateConfig(data: unknown): Config {
  const result = configSchema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  // Map Zod issues to our ConfigValidationIssue format
  const issues: ConfigValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    expected: issue.message,
    received: getValueAtPath(data, issue.path),
  }));

  throw new ConfigValidationError(issues);
}

/**
 * Retrieves a value at a given path from a nested object.
 */
function getValueAtPath(obj: unknown, pathParts: (string | number)[]): unknown {
  let current: unknown = obj;
  for (const part of pathParts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

// ─── Singleton State ─────────────────────────────────────────────────────────

/** Module-level cached config for the default singleton loader */
let cachedConfig: Config | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the cached config, performing a lazy load on first call.
 * Implements the singleton pattern with lazy initialization.
 *
 * Resolution algorithm:
 * 1. Resolve and parse config file (YAML/JSON)
 * 2. Overlay environment variable overrides
 * 3. Validate merged result against Zod schema
 * 4. Cache and return
 */
export function getConfig(): Config {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const fileResult = resolveConfigFile();
  const fileData = (fileResult?.data as Record<string, unknown>) ?? {};
  const merged = applyEnvOverrides(fileData);
  cachedConfig = validateConfig(merged);
  return cachedConfig;
}

/**
 * Invalidates cache, re-reads all sources, re-validates.
 * If validation fails, retains the previous config and throws.
 *
 * @returns The newly validated config
 * @throws {ConfigValidationError} if the new config is invalid (previous config is retained)
 * @throws {ConfigParseError} if the config file has syntax errors (previous config is retained)
 * @throws {ConfigFileNotFoundError} if the specified config path is invalid (previous config is retained)
 */
export function reloadConfig(): Config {
  const previousConfig = cachedConfig;

  try {
    const fileResult = resolveConfigFile();
    const fileData = (fileResult?.data as Record<string, unknown>) ?? {};
    const merged = applyEnvOverrides(fileData);
    cachedConfig = validateConfig(merged);
    return cachedConfig;
  } catch (err) {
    // On failure, retain the previous config
    cachedConfig = previousConfig;
    throw err;
  }
}

/**
 * Returns config with sensitive values redacted (for logging).
 * Replaces values marked with `sensitive: true` in schema metadata
 * with a "[REDACTED]" placeholder.
 */
export function getRedactedConfig(): Record<string, unknown> {
  const config = getConfig();
  const result = deepClone(config) as Record<string, unknown>;

  for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
    if (!meta.sensitive) continue;

    const parts = dottedPath.split(".");
    setNestedValue(result, parts, "[REDACTED]");
  }

  return result;
}

/**
 * Creates a config loader instance with custom options.
 * Useful for testing or non-default config file paths.
 *
 * @param options - Custom loader options (basePath, envOverrides)
 * @returns An isolated IConfigLoader instance
 */
export function createConfigLoader(options?: ConfigLoaderOptions): IConfigLoader {
  let instanceCache: Config | null = null;

  const resolveFile = (): { data: unknown; filePath: string } | null => {
    if (options?.configPath) {
      // Use the explicit config path
      const resolvedPath = path.resolve(options.configPath);
      if (!isFileReadable(resolvedPath)) {
        throw new ConfigFileNotFoundError(resolvedPath);
      }
      return parseConfigFile(resolvedPath);
    }
    return resolveConfigFile(options?.repoRoot);
  };

  const envSource = options?.envOverrides ?? process.env;

  const loadConfig = (): Config => {
    const fileResult = resolveFile();
    const fileData = (fileResult?.data as Record<string, unknown>) ?? {};
    const merged = applyEnvOverrides(fileData, envSource);
    return validateConfig(merged);
  };

  return {
    getConfig(): Config {
      if (instanceCache !== null) {
        return instanceCache;
      }
      instanceCache = loadConfig();
      return instanceCache;
    },

    reloadConfig(): Config {
      const previousConfig = instanceCache;
      try {
        instanceCache = loadConfig();
        return instanceCache;
      } catch (err) {
        instanceCache = previousConfig;
        throw err;
      }
    },

    getRedactedConfig(): Record<string, unknown> {
      const config = this.getConfig();
      const result = deepClone(config) as Record<string, unknown>;

      for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
        if (!meta.sensitive) continue;
        const parts = dottedPath.split(".");
        setNestedValue(result, parts, "[REDACTED]");
      }

      return result;
    },
  };
}

/**
 * Resets the singleton cache. Intended for testing only.
 * @internal
 */
export function _resetConfigCache(): void {
  cachedConfig = null;
}
