/**
 * Property 1: Schema Structural Correctness
 *
 * For any entry in the Config_Schema, it must have a valid type
 * (string, integer, boolean, or array) with valid constraints,
 * AND it must satisfy the invariant: the entry either has a default
 * value OR is marked as required (never both, never neither).
 *
 * Validates: Requirements 1.1, 1.3
 */
import fc from "fast-check";
import { z } from "zod";
import { type Config, configSchema } from "../../src/schema";

// ─── Helpers to introspect Zod schemas ────────────────────────────────────────

/** Allowed leaf Zod type names for config entries */
const VALID_LEAF_TYPES = new Set(["ZodString", "ZodNumber", "ZodBoolean", "ZodEnum", "ZodArray"]);

/** Unwrap ZodDefault / ZodOptional to get the inner type */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodDefault) {
    return unwrapSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodOptional) {
    return unwrapSchema(schema._def.innerType);
  }
  return schema;
}

/** Check if a schema has a default value (wrapped in ZodDefault) */
function hasDefault(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodDefault) {
    return true;
  }
  return false;
}

/** Check if a schema is optional (wrapped in ZodOptional without default) */
function isOptional(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional) {
    return true;
  }
  return false;
}

/** Get all leaf entries from the schema as {path, schema} tuples */
function getSchemaEntries(
  schema: z.ZodTypeAny,
  prefix: string = "",
): { path: string; schema: z.ZodTypeAny }[] {
  const entries: { path: string; schema: z.ZodTypeAny }[] = [];

  const inner = unwrapSchema(schema);

  if (inner instanceof z.ZodObject) {
    const shape = inner.shape;
    for (const [key, value] of Object.entries(shape)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      const childSchema = value as z.ZodTypeAny;
      const unwrapped = unwrapSchema(childSchema);

      if (unwrapped instanceof z.ZodObject) {
        // Recurse into nested object (namespace)
        entries.push(...getSchemaEntries(childSchema, childPath));
      } else {
        // Leaf entry
        entries.push({ path: childPath, schema: childSchema });
      }
    }
  }

  return entries;
}

/** Get the Zod type name of the inner (unwrapped) type */
function getLeafTypeName(schema: z.ZodTypeAny): string {
  const inner = unwrapSchema(schema);
  return inner.constructor.name;
}

// ─── Collect all schema entries ──────────────────────────────────────────────

const allEntries = getSchemaEntries(configSchema);

// Port entries: entries whose key ends with "port" or "Port" and whose inner
// type is ZodNumber
const portEntries = allEntries.filter((e) => {
  const key = e.path.split(".").pop() || "";
  return (
    (key.toLowerCase() === "port" ||
      key.toLowerCase() === "baseport" ||
      key.toLowerCase() === "uiport" ||
      key.toLowerCase() === "localport") &&
    unwrapSchema(e.schema) instanceof z.ZodNumber
  );
});

// Timeout entries: entries whose key contains "timeout" (case insensitive)
// and whose inner type is ZodNumber
const timeoutEntries = allEntries.filter((e) => {
  const key = e.path.split(".").pop() || "";
  return key.toLowerCase().includes("timeout") && unwrapSchema(e.schema) instanceof z.ZodNumber;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Feature: v2-4-0-unified-config-installer, Property 1: Schema Structural Correctness", () => {
  /**
   * Validates: Requirements 1.1, 1.3
   */

  it("every schema entry has a valid Zod type (string, number, boolean, enum, array)", () => {
    // This is a deterministic check over the actual schema - we iterate all entries
    for (const entry of allEntries) {
      const typeName = getLeafTypeName(entry.schema);
      expect(VALID_LEAF_TYPES).toContain(typeName);
    }
    // Sanity: we found a meaningful number of entries
    expect(allEntries.length).toBeGreaterThan(50);
  });

  it("schema has at least one entry for each expected type", () => {
    const typeNames = new Set(allEntries.map((e) => getLeafTypeName(e.schema)));
    // The schema uses string, number, boolean, and enum types
    expect(typeNames.has("ZodString")).toBe(true);
    expect(typeNames.has("ZodNumber")).toBe(true);
    expect(typeNames.has("ZodBoolean")).toBe(true);
    expect(typeNames.has("ZodEnum")).toBe(true);
  });

  it("port entries have integer constraints within 1-65535", () => {
    expect(portEntries.length).toBeGreaterThan(0);
    for (const entry of portEntries) {
      const inner = unwrapSchema(entry.schema) as z.ZodNumber;
      const checks = inner._def.checks;

      const intCheck = checks.find((c: { kind: string }) => c.kind === "int");
      const minCheck = checks.find((c: { kind: string }) => c.kind === "min") as
        | { kind: string; value: number }
        | undefined;
      const maxCheck = checks.find((c: { kind: string }) => c.kind === "max") as
        | { kind: string; value: number }
        | undefined;

      expect(intCheck).toBeDefined();
      expect(minCheck).toBeDefined();
      expect(minCheck!.value).toBe(1);
      expect(maxCheck).toBeDefined();
      expect(maxCheck!.value).toBe(65535);
    }
  });

  it("timeout entries have integer constraints within 0-86400000", () => {
    expect(timeoutEntries.length).toBeGreaterThan(0);
    for (const entry of timeoutEntries) {
      const inner = unwrapSchema(entry.schema) as z.ZodNumber;
      const checks = inner._def.checks;

      const intCheck = checks.find((c: { kind: string }) => c.kind === "int");
      const minCheck = checks.find((c: { kind: string }) => c.kind === "min") as
        | { kind: string; value: number }
        | undefined;
      const maxCheck = checks.find((c: { kind: string }) => c.kind === "max") as
        | { kind: string; value: number }
        | undefined;

      expect(intCheck).toBeDefined();
      expect(minCheck).toBeDefined();
      expect(minCheck!.value).toBe(0);
      expect(maxCheck).toBeDefined();
      expect(maxCheck!.value).toBe(86400000);
    }
  });

  it("every entry either has a default (never both default AND required without default)", () => {
    for (const entry of allEntries) {
      const entryHasDefault = hasDefault(entry.schema);
      const entryIsOptional = isOptional(entry.schema);

      // Per the design: every entry either has a default value OR is marked required.
      // In this schema, ALL entries currently have defaults (design choice).
      // The invariant: an entry must have a default OR be required (= no default, not optional).
      // It must never be: optional without a default (that would mean it can be undefined
      // without the user knowing it's missing).
      // So: hasDefault(entry) || (!isOptional(entry) && !hasDefault(entry)) must be true.
      // Simplified: if it doesn't have a default, it must not be optional either (it's required).
      if (!entryHasDefault) {
        expect(entryIsOptional).toBe(false);
      }
    }
  });

  it("schema parses empty object {} and produces a fully-typed config with all defaults populated", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      const config: Config = result.data;
      // Verify all top-level namespaces are present
      expect(config.global).toBeDefined();
      expect(config.terminal).toBeDefined();
      expect(config.webbrowser).toBeDefined();
      expect(config.calculator).toBeDefined();
      expect(config.browserless).toBeDefined();
      expect(config.blenderbridge).toBeDefined();
      expect(config.rag).toBeDefined();
      expect(config.pythonshell).toBeDefined();
      expect(config.memory).toBeDefined();
      expect(config.skills).toBeDefined();
      expect(config.cli).toBeDefined();
      expect(config.slashcommands).toBeDefined();
      expect(config.csvexporter).toBeDefined();
      expect(config.fileeditor).toBeDefined();
      expect(config.git).toBeDefined();
      expect(config.packagemanager).toBeDefined();
      expect(config.observability).toBeDefined();
      expect(config.agentrunner).toBeDefined();
      expect(config.threedtool).toBeDefined();
      expect(config.subagent).toBeDefined();
      expect(config.lansubagent).toBeDefined();

      // Spot-check some specific defaults
      expect(config.terminal.port).toBe(3333);
      expect(config.terminal.defaultTimeoutMs).toBe(60000);
      expect(config.webbrowser.headless).toBe(true);
      expect(config.global.logLevel).toBe("info");
      expect(config.blenderbridge.host).toBe("127.0.0.1");
    }
  });

  it("property: random valid overrides for any namespace still pass schema validation", () => {
    // Generate random partial config objects that override specific namespace values
    // within valid constraints. The schema should still validate.
    const namespaceKeys = Object.keys(configSchema.shape) as Array<keyof typeof configSchema.shape>;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: namespaceKeys.length - 1 }),
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 0, max: 86400000 }),
        fc.boolean(),
        (nsIndex, portVal, timeoutVal, boolVal) => {
          // Build a partial config with random valid values
          const partial: Record<string, unknown> = {};
          const nsKey = namespaceKeys[nsIndex];

          // Get the shape of this namespace
          const nsSchema = unwrapSchema(configSchema.shape[nsKey]);
          if (nsSchema instanceof z.ZodObject) {
            const shape = nsSchema.shape;
            const nsPartial: Record<string, unknown> = {};

            for (const [key, fieldSchema] of Object.entries(shape)) {
              const innerType = unwrapSchema(fieldSchema as z.ZodTypeAny);
              if (innerType instanceof z.ZodNumber) {
                // Check if it's a port or timeout
                const checks = (innerType as z.ZodNumber)._def.checks;
                const maxCheck = checks.find((c: { kind: string }) => c.kind === "max") as
                  | { kind: string; value: number }
                  | undefined;
                if (maxCheck && maxCheck.value === 65535) {
                  nsPartial[key] = portVal;
                } else if (maxCheck && maxCheck.value === 86400000) {
                  nsPartial[key] = timeoutVal;
                }
                // For other numbers, let default handle it
              } else if (innerType instanceof z.ZodBoolean) {
                nsPartial[key] = boolVal;
              }
              // For strings and enums, let defaults handle it
            }

            if (Object.keys(nsPartial).length > 0) {
              partial[nsKey] = nsPartial;
            }
          }

          const result = configSchema.safeParse(partial);
          return result.success === true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: invalid port values (outside 1-65535) are rejected by schema", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -1000, max: 0 }), fc.integer({ min: 65536, max: 100000 })),
        (invalidPort) => {
          // Try to parse with an invalid port in the terminal namespace
          const result = configSchema.safeParse({
            terminal: { port: invalidPort },
          });
          return result.success === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: invalid timeout values (outside 0-86400000) are rejected by schema", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10000, max: -1 }),
          fc.integer({ min: 86400001, max: 100000000 }),
        ),
        (invalidTimeout) => {
          // Try to parse with an invalid timeout in the terminal namespace
          const result = configSchema.safeParse({
            terminal: { defaultTimeoutMs: invalidTimeout },
          });
          return result.success === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: valid port values (1-65535) are accepted by schema for any port entry", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 0, max: portEntries.length - 1 }),
        (validPort, entryIndex) => {
          const entry = portEntries[entryIndex];
          const parts = entry.path.split(".");
          const namespace = parts[0];
          const key = parts[1];

          const result = configSchema.safeParse({
            [namespace]: { [key]: validPort },
          });
          return result.success === true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: valid timeout values (0-86400000) are accepted by schema for any timeout entry", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86400000 }),
        fc.integer({ min: 0, max: timeoutEntries.length - 1 }),
        (validTimeout, entryIndex) => {
          const entry = timeoutEntries[entryIndex];
          const parts = entry.path.split(".");
          const namespace = parts[0];
          const key = parts[1];

          const result = configSchema.safeParse({
            [namespace]: { [key]: validTimeout },
          });
          return result.success === true;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 2: Sensitive Entry Redaction ───────────────────────────────────

import { REDACTED_PLACEHOLDER, redactConfig } from "../../src/redact";
import { schemaMeta } from "../../src/schema-meta";

/**
 * Property 2: Sensitive Entry Redaction
 *
 * For any configuration entry marked with `sensitive: true` in the schema metadata,
 * when the configuration is serialized for logging or diagnostic output via
 * `redactConfig()`, that entry's value must be replaced with a redaction placeholder
 * (never the actual value).
 *
 * Validates: Requirements 1.6
 */
describe("Feature: v2-4-0-unified-config-installer, Property 2: Sensitive Entry Redaction", () => {
  // Collect all sensitive paths from schemaMeta
  const sensitivePaths = Object.entries(schemaMeta)
    .filter(([, meta]) => meta.sensitive === true)
    .map(([path]) => path);

  // Collect some non-sensitive paths for verification
  const _nonSensitivePaths = Object.entries(schemaMeta)
    .filter(([, meta]) => !meta.sensitive)
    .slice(0, 5)
    .map(([path]) => path);

  // Sanity check: there are sensitive entries to test
  it("schemaMeta contains at least 2 sensitive entries (browserless.apiKey, agentrunner.browserlessApiToken)", () => {
    expect(sensitivePaths).toContain("browserless.apiKey");
    expect(sensitivePaths).toContain("agentrunner.browserlessApiToken");
    expect(sensitivePaths.length).toBeGreaterThanOrEqual(2);
  });

  it("property: sensitive fields are always replaced with [REDACTED] regardless of value", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 200 }),
        (apiKeyValue, tokenValue) => {
          const config: Record<string, unknown> = {
            browserless: { apiKey: apiKeyValue, apiUrl: "https://example.com" },
            agentrunner: { browserlessApiToken: tokenValue, basePort: 8080 },
            terminal: { port: 3333, defaultTimeoutMs: 60000 },
          };

          const redacted = redactConfig(config);

          // Sensitive fields must be redacted
          expect((redacted.browserless as Record<string, unknown>).apiKey).toBe(
            REDACTED_PLACEHOLDER,
          );
          expect((redacted.agentrunner as Record<string, unknown>).browserlessApiToken).toBe(
            REDACTED_PLACEHOLDER,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: non-sensitive fields remain unchanged after redaction", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 0, max: 86400000 }),
        (apiUrl, workspaceRoot, port, timeout) => {
          const config: Record<string, unknown> = {
            browserless: { apiKey: "secret-key", apiUrl: apiUrl },
            terminal: { port: port, defaultTimeoutMs: timeout, workspaceRoot: workspaceRoot },
            agentrunner: { browserlessApiToken: "secret-token", basePort: 8080 },
          };

          const redacted = redactConfig(config);

          // Non-sensitive fields must remain unchanged
          expect((redacted.browserless as Record<string, unknown>).apiUrl).toBe(apiUrl);
          expect((redacted.terminal as Record<string, unknown>).port).toBe(port);
          expect((redacted.terminal as Record<string, unknown>).defaultTimeoutMs).toBe(timeout);
          expect((redacted.terminal as Record<string, unknown>).workspaceRoot).toBe(workspaceRoot);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: original config object is never mutated by redaction", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (apiKeyValue, tokenValue) => {
          const config: Record<string, unknown> = {
            browserless: { apiKey: apiKeyValue, apiUrl: "https://example.com" },
            agentrunner: { browserlessApiToken: tokenValue, basePort: 9000 },
          };

          // Snapshot original values
          const originalApiKey = apiKeyValue;
          const originalToken = tokenValue;

          // Perform redaction
          redactConfig(config);

          // Original object must remain unchanged
          expect((config.browserless as Record<string, unknown>).apiKey).toBe(originalApiKey);
          expect((config.agentrunner as Record<string, unknown>).browserlessApiToken).toBe(
            originalToken,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("property: redacted value is always exactly REDACTED_PLACEHOLDER (never actual value)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 500 }), (secretValue) => {
        const config: Record<string, unknown> = {
          browserless: { apiKey: secretValue },
          agentrunner: { browserlessApiToken: secretValue },
        };

        const redacted = redactConfig(config);

        // The redacted value must never equal the secret (unless secret happens to be "[REDACTED]")
        const redactedApiKey = (redacted.browserless as Record<string, unknown>).apiKey;
        const redactedToken = (redacted.agentrunner as Record<string, unknown>).browserlessApiToken;

        // Must always be the placeholder
        expect(redactedApiKey).toBe(REDACTED_PLACEHOLDER);
        expect(redactedToken).toBe(REDACTED_PLACEHOLDER);

        // If original value wasn't "[REDACTED]", it must differ from redacted
        if (secretValue !== REDACTED_PLACEHOLDER) {
          expect(redactedApiKey).not.toBe(secretValue);
          expect(redactedToken).not.toBe(secretValue);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("property: sensitive entries missing from config are not added by redaction", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (port, workspace) => {
          // Config that has NO sensitive fields at all
          const config: Record<string, unknown> = {
            terminal: { port: port, workspaceRoot: workspace },
          };

          const redacted = redactConfig(config);

          // Should not inject browserless or agentrunner keys
          expect(redacted.browserless).toBeUndefined();
          expect(redacted.agentrunner).toBeUndefined();
          // Non-sensitive fields remain
          expect((redacted.terminal as Record<string, unknown>).port).toBe(port);
          expect((redacted.terminal as Record<string, unknown>).workspaceRoot).toBe(workspace);
        },
      ),
      { numRuns: 100 },
    );
  });
});
