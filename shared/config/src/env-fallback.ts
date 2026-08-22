/**
 * .env Fallback Reader - Backward compatibility for legacy .env configuration.
 *
 * When no unified config file exists, this module reads a `.env` file and maps
 * its keys to schema paths via the `legacyEnvKey` field in schemaMeta.
 *
 * @module @shared/config/env-fallback
 */

import * as fs from "fs";
import * as path from "path";
import { schemaMeta } from "./schema-meta";

/**
 * Reads a `.env` file and maps its keys to a structured config object
 * using the `legacyEnvKey` field from schemaMeta.
 *
 * Values remain as strings - type coercion happens during schema validation.
 *
 * @param basePath - Directory to look for `.env` in. Defaults to process.cwd().
 * @returns A structured config object, or null if no `.env` file exists.
 */
export function readEnvFallback(basePath?: string): Record<string, unknown> | null {
  const dir = basePath ?? process.cwd();
  const envFilePath = path.join(dir, ".env");

  if (!fs.existsSync(envFilePath)) {
    return null;
  }

  const content = fs.readFileSync(envFilePath, "utf-8");
  const lines = content.split(/\r?\n/);

  // Build a reverse lookup: legacyEnvKey -> dotted config path
  const legacyKeyToPath: Record<string, string> = {};
  for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
    if (meta.legacyEnvKey) {
      legacyKeyToPath[meta.legacyEnvKey] = dottedPath;
    }
  }

  const result: Record<string, unknown> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Split on first '=' to get KEY and VALUE
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
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

    // Look up the config path for this legacy key
    const dottedPath = legacyKeyToPath[key];
    if (!dottedPath) {
      continue;
    }

    // Set the value at the dotted path in the result object
    setNestedValue(result, dottedPath, value);
  }

  return result;
}

/**
 * Sets a value at a dotted path in a nested object.
 * Creates intermediate objects as needed.
 *
 * @example
 * setNestedValue({}, "terminal.port", "3333")
 * // => { terminal: { port: "3333" } }
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
