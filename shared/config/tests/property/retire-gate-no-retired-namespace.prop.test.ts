// Feature: retire-and-gate-mcp-servers, Property 3: no schema namespace references a Retired server
// **Validates: Requirements 3.4, 1.6, 1.11**

/**
 * Property 3: No schema namespace references a Retired server
 *
 * For all namespaces defined in `configSchema` after the edit, the namespace
 * name is not one of the four Retired server namespaces
 * (`rag`, `csvexporter`, `fileeditor`, `packagemanager`), and no remaining
 * namespace field resolves to a Retired-server endpoint.
 *
 * ── EXPECTED STATE AT TIME OF WRITING ────────────────────────────────────────
 * This test is authored BEFORE the schema is pruned (spec task 2.5). The
 * current `shared/config/src/schema.ts` still contains the four Retired
 * namespaces (`rag`, `csvexporter`, `fileeditor`, `packagemanager`) and the
 * dangling `ragEndpoint` / `ecmEndpoint` fields inside `slashcommandsSchema`.
 *
 * Therefore this test is EXPECTED TO FAIL on current code. That failure is the
 * point: it confirms the Retired namespaces / dangling endpoints still exist.
 * Once task 2.5 removes them (and fixes the terminalEndpoint default), this
 * test turns green. Do NOT "fix" the test to pass against the un-pruned schema.
 */

import fc from "fast-check";
import { z } from "zod";
import { configSchema } from "../../src/schema";

// ─── The four Retired server namespaces (design Decision 3) ──────────────────

const RETIRED_NAMESPACES = ["rag", "csvexporter", "fileeditor", "packagemanager"] as const;

/**
 * Ports and host:port endpoints owned by Retired (or non-existent) servers.
 * A remaining field "resolves to a Retired-server endpoint" if its default
 * string value points at one of these. Per the design:
 *   - `rag`         → port 3339 (RAG tool)
 *   - `csvexporter` → port 3339 (CSVExporter tool)
 *   - `ecm`         → port 3342 (nonexistent server — must not be referenced, R1.11)
 * `fileeditor` (3010) and `packagemanager` (3012) are Retired too, but no
 * cross-namespace field references their endpoints, so ports 3339 and 3342 are
 * the observable "dangling endpoint" ports for remaining-namespace fields.
 */
const RETIRED_ENDPOINT_PORTS = [3339, 3342] as const;

/** Field-name substrings that name a Retired / non-existent server. */
const RETIRED_FIELD_TOKENS = ["rag", "csvexporter", "fileeditor", "packagemanager", "ecm"];

// ─── Introspection helpers (mirror schema.prop.test.ts conventions) ──────────

/** Unwrap ZodDefault / ZodOptional to reach the inner type. */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodDefault) {
    return unwrapSchema(schema._def.innerType);
  }
  if (schema instanceof z.ZodOptional) {
    return unwrapSchema(schema._def.innerType);
  }
  return schema;
}

/** Read the literal default value of a ZodDefault-wrapped schema (or undefined). */
function getDefaultValue(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    const dv = schema._def.defaultValue;
    return typeof dv === "function" ? dv() : dv;
  }
  return undefined;
}

/**
 * Collect every leaf field of the schema as
 * `{ namespace, field, defaultValue }`. `namespace` is the top-level key,
 * `field` is the dotted path below it.
 */
function collectLeafFields(): { namespace: string; field: string; defaultValue: unknown }[] {
  const out: { namespace: string; field: string; defaultValue: unknown }[] = [];

  const topShape = configSchema.shape as Record<string, z.ZodTypeAny>;

  const walk = (namespace: string, schema: z.ZodTypeAny, prefix: string): void => {
    const inner = unwrapSchema(schema);
    if (inner instanceof z.ZodObject) {
      const shape = inner.shape as Record<string, z.ZodTypeAny>;
      for (const [key, child] of Object.entries(shape)) {
        const childPath = prefix ? `${prefix}.${key}` : key;
        const unwrapped = unwrapSchema(child);
        if (unwrapped instanceof z.ZodObject) {
          walk(namespace, child, childPath);
        } else {
          out.push({ namespace, field: childPath, defaultValue: getDefaultValue(child) });
        }
      }
    }
  };

  for (const [nsKey, nsSchema] of Object.entries(topShape)) {
    walk(nsKey, nsSchema, "");
  }

  return out;
}

/** True if a default string value points at a Retired-server endpoint port. */
function referencesRetiredEndpoint(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return RETIRED_ENDPOINT_PORTS.some((port) => value.includes(`:${port}`));
}

/** True if a field name names a Retired / non-existent server. */
function fieldNamesRetiredServer(fieldPath: string): boolean {
  const leaf = (fieldPath.split(".").pop() || "").toLowerCase();
  return RETIRED_FIELD_TOKENS.some((token) => leaf.includes(token));
}

// ─── Collect once ────────────────────────────────────────────────────────────

const namespaceNames = Object.keys(configSchema.shape);
const leafFields = collectLeafFields();

describe("Feature: retire-and-gate-mcp-servers, Property 3: no schema namespace references a Retired server", () => {
  /**
   * Validates: Requirements 3.4, 1.6, 1.11
   *
   * NOTE: EXPECTED TO FAIL until spec task 2.5 prunes the Retired namespaces
   * and dangling endpoints from schema.ts. See file header.
   */

  it("no top-level configSchema namespace is a Retired server namespace", () => {
    const offenders = namespaceNames.filter((n) =>
      (RETIRED_NAMESPACES as readonly string[]).includes(n),
    );
    expect(offenders).toEqual([]);
  });

  it("no remaining field name references a Retired / non-existent server", () => {
    const offenders = leafFields
      .filter((f) => fieldNamesRetiredServer(f.field))
      .map((f) => `${f.namespace}.${f.field}`);
    expect(offenders).toEqual([]);
  });

  it("no remaining field default resolves to a Retired-server endpoint", () => {
    const offenders = leafFields
      .filter((f) => referencesRetiredEndpoint(f.defaultValue))
      .map((f) => `${f.namespace}.${f.field} = ${String(f.defaultValue)}`);
    expect(offenders).toEqual([]);
  });

  it("property: for any namespace sampled from configSchema, it is not a Retired namespace (min 100 iterations)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...namespaceNames), (name: string) => {
        return !(RETIRED_NAMESPACES as readonly string[]).includes(name);
      }),
      { numRuns: 100 },
    );
  });

  it("property: for any remaining leaf field sampled from configSchema, it neither names nor resolves to a Retired server (min 100 iterations)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: leafFields.length - 1 }), (index: number) => {
        const field = leafFields[index];
        const namesRetired = fieldNamesRetiredServer(field.field);
        const resolvesRetired = referencesRetiredEndpoint(field.defaultValue);
        return !namesRetired && !resolvesRetired;
      }),
      { numRuns: 100 },
    );
  });
});
