/**
 * Migration CLI - Generates a unified Config_File from legacy .env files.
 *
 * Maps known .env keys to their schema paths via schemaMeta reverse lookup.
 * Unknown keys are placed under the `custom` namespace with a stderr warning.
 *
 * @module @shared/config/migrate
 */

import * as fs from "fs";
import * as path from "path";
import { stringify as yamlStringify } from "yaml";
import { configSchema } from "./schema";
import { schemaMeta } from "./schema-meta";

/** Options for the migrate-config CLI command */
export interface MigrateOptions {
  /** Output format: YAML (default) or JSON */
  format: "yaml" | "json";
  /** Path to the .env file (default: repo_root/.env) */
  envPath?: string;
  /** Output path for the generated config file */
  outputPath?: string;
}

/**
 * Sets a value at a dotted path in a nested object.
 * Creates intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const parts = dottedPath.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Coerces a string value from a .env file to the expected type based on the
 * schema definition at the given dotted path.
 *
 * - number fields → parseInt/parseFloat
 * - boolean fields → "true"/"1" → true, "false"/"0" → false
 * - string/enum → use as-is
 */
function coerceValueForPath(value: string, dottedPath: string): unknown {
  const expectedType = getExpectedTypeForPath(dottedPath);

  switch (expectedType) {
    case "number":
      if (/^-?\d+$/.test(value)) {
        return parseInt(value, 10);
      }
      const parsed = parseFloat(value);
      return isNaN(parsed) ? value : parsed;
    case "boolean":
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      return value;
    default:
      return value;
  }
}

/**
 * Determines the expected type for a dotted schema path by inspecting
 * the Zod schema shape. Mirrors the loader's getExpectedType logic.
 */
function getExpectedTypeForPath(schemaPath: string): "string" | "number" | "boolean" {
  const parts = schemaPath.split(".");
  if (parts.length !== 2) return "string";

  const [namespace, key] = parts;
  try {
    const shape = (
      configSchema.shape as Record<
        string,
        { _def?: { innerType?: { shape?: Record<string, unknown> }; typeName?: string } }
      >
    )[namespace];
    if (!shape?._def) return "string";

    const innerType = shape._def.innerType;
    if (!innerType?.shape) return "string";

    const field = innerType.shape[key] as
      | { _def?: { typeName?: string; innerType?: unknown } }
      | undefined;
    if (!field) return "string";

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

/**
 * Builds a reverse lookup map from legacy .env key names to their dotted config paths.
 */
function buildLegacyKeyToPathMap(): Record<string, string> {
  const legacyKeyToPath: Record<string, string> = {};
  for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
    if (meta.legacyEnvKey) {
      // If multiple schema paths map to the same legacyEnvKey (e.g., "PORT"),
      // the env key also maps via the `env` field, so use the specific env name as primary.
      // For legacyEnvKey, first match wins.
      if (!(meta.legacyEnvKey in legacyKeyToPath)) {
        legacyKeyToPath[meta.legacyEnvKey] = dottedPath;
      }
    }
    // Also map by the `env` field for broader compatibility
    if (meta.env && !(meta.env in legacyKeyToPath)) {
      legacyKeyToPath[meta.env] = dottedPath;
    }
  }
  return legacyKeyToPath;
}

/**
 * Parses a .env file into key-value pairs with warnings for malformed lines.
 *
 * @returns Array of parsed entries and any warnings emitted.
 */
function parseEnvFile(content: string): {
  entries: Array<{ key: string; value: string }>;
  warnings: string[];
} {
  const lines = content.split(/\r?\n/);
  const entries: Array<{ key: string; value: string }> = [];
  const warnings: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const trimmed = lines[i].trim();

    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Check for '=' separator
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      warnings.push(`Warning: Skipping malformed line ${lineNumber}: no '=' separator found`);
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.push({ key, value });
  }

  return { entries, warnings };
}

/**
 * Migrates configuration from a legacy .env file to the unified config format.
 *
 * - Reads .env file and parses KEY=VALUE lines
 * - Maps known keys to schema paths via schemaMeta reverse lookup
 * - Places unknown keys under `custom` namespace with stderr warning
 * - Skips malformed lines (no `=` separator) with line-number warning
 * - Validates generated config against schema before writing
 * - Exits non-zero if no .env found
 *
 * @param options - Migration options (format, envPath, outputPath)
 */
export function migrateConfig(options?: Partial<MigrateOptions>): void {
  const format = options?.format ?? "yaml";
  const repoRoot = process.cwd();
  const envPath = options?.envPath ?? path.join(repoRoot, ".env");
  const defaultOutputName =
    format === "json" ? "llm-toolkit.config.json" : "llm-toolkit.config.yaml";
  const outputPath = options?.outputPath ?? path.join(repoRoot, defaultOutputName);

  // Check .env file exists
  if (!fs.existsSync(envPath)) {
    process.stderr.write(`Error: No .env file found at: ${envPath}\n`);
    process.exitCode = 1;
    return;
  }

  // Read and parse .env file
  const content = fs.readFileSync(envPath, "utf-8");
  const { entries, warnings } = parseEnvFile(content);

  // Emit parse warnings (malformed lines) to stderr
  for (const warning of warnings) {
    process.stderr.write(warning + "\n");
  }

  // Build reverse lookup map
  const legacyKeyToPath = buildLegacyKeyToPathMap();

  // Map entries to config structure
  const configObj: Record<string, unknown> = {};
  const customEntries: Record<string, string> = {};
  const unknownKeyWarnings: string[] = [];

  for (const { key, value } of entries) {
    const dottedPath = legacyKeyToPath[key];
    if (dottedPath) {
      setNestedValue(configObj, dottedPath, coerceValueForPath(value, dottedPath));
    } else {
      // Unknown key → place in custom namespace
      customEntries[key] = value;
      unknownKeyWarnings.push(`Warning: Unknown .env key '${key}' placed in 'custom' section`);
    }
  }

  // Emit unknown key warnings to stderr
  for (const warning of unknownKeyWarnings) {
    process.stderr.write(warning + "\n");
  }

  // Add custom section if there are unknown keys
  if (Object.keys(customEntries).length > 0) {
    configObj["custom"] = customEntries;
  }

  // Validate generated config against schema
  const parseResult = configSchema.safeParse(configObj);
  if (!parseResult.success) {
    process.stderr.write("Warning: Generated config has validation issues:\n");
    for (const issue of parseResult.error.issues) {
      const issuePath = issue.path.join(".");
      process.stderr.write(`  - ${issuePath}: ${issue.message}\n`);
    }
    // Still write the file per requirements (report errors but continue)
  }

  // Serialize the config (use the parsed data if validation succeeded for clean output,
  // otherwise use the raw config object)
  const outputData = parseResult.success ? parseResult.data : configObj;

  // Remove the custom section from validated data and re-add it
  // (since custom isn't part of the schema, it gets stripped by safeParse)
  let finalOutput: Record<string, unknown>;
  if (parseResult.success) {
    finalOutput = { ...outputData } as Record<string, unknown>;
    if (Object.keys(customEntries).length > 0) {
      finalOutput["custom"] = customEntries;
    }
  } else {
    finalOutput = configObj;
  }

  // Write output file
  let outputContent: string;
  if (format === "json") {
    outputContent = JSON.stringify(finalOutput, null, 2) + "\n";
  } else {
    outputContent = yamlStringify(finalOutput, { indent: 2 });
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, outputContent, "utf-8");

  process.stderr.write(`Config file written to: ${outputPath}\n`);
}
