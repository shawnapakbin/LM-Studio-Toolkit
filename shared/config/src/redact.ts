/**
 * Redaction utility for sensitive configuration values.
 *
 * Walks through the schema metadata to identify entries marked as
 * `sensitive: true` and replaces their values with a redaction placeholder.
 *
 * @module @shared/config/redact
 */

import { schemaMeta } from "./schema-meta";

/** Placeholder used to replace sensitive values */
export const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Returns a deep copy of the config object with all sensitive values replaced
 * by "[REDACTED]". Uses `schemaMeta` to determine which entries are sensitive.
 *
 * Never mutates the original config object.
 *
 * @param config - The configuration object (as a plain object / Record)
 * @returns A new object with sensitive values redacted
 */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  // Deep clone to avoid mutating the original
  const redacted = structuredClone(config);

  // Walk schemaMeta for sensitive entries
  for (const [dottedPath, meta] of Object.entries(schemaMeta)) {
    if (!meta.sensitive) continue;

    // Split dotted path (e.g., "browserless.apiKey" → ["browserless", "apiKey"])
    const segments = dottedPath.split(".");
    setNestedValue(redacted, segments, REDACTED_PLACEHOLDER);
  }

  return redacted;
}

/**
 * Sets a value at a nested path within an object.
 * Only sets if the intermediate objects exist (does not create missing paths).
 */
function setNestedValue(obj: Record<string, unknown>, segments: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    const next = current[segment];
    if (next === null || next === undefined || typeof next !== "object") {
      // Path doesn't exist in the config — nothing to redact
      return;
    }
    current = next as Record<string, unknown>;
  }

  const lastSegment = segments[segments.length - 1];
  // Only redact if the key actually exists in the config
  if (lastSegment in current) {
    current[lastSegment] = value;
  }
}
