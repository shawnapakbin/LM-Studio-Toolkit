/**
 * Feature: retire-and-gate-mcp-servers, Property 2: remaining schema ports are unique
 *
 * For all pairs of distinct port-bearing schema entries remaining in
 * `configSchema` after the edit, their `port` defaults differ — i.e. the
 * multiset of assigned ports contains no duplicate.
 *
 * **Validates: Requirements 1.7**
 *
 * ── EXPECTED STATE ──────────────────────────────────────────────────────────
 * This property test is authored BEFORE the schema is pruned (task 2.5).
 * On the CURRENT (unpruned) schema there is a known port `3339` COLLISION
 * between `ragSchema` (rag) and `csvexporterSchema` (csvexporter). A strict
 * "no duplicate ports" assertion therefore FAILS on current code — that
 * failure is the intended signal confirming the collision exists (R1.7).
 *
 * Once task 2.5 removes `ragSchema`/`csvexporterSchema` (and the other Retired
 * namespaces) from `configSchema`, the collision disappears and this test turns
 * green. No change to this test is required for it to pass after the prune —
 * the property is simply "all remaining ports are unique".
 * ────────────────────────────────────────────────────────────────────────────
 */
import fc from "fast-check";
import { z } from "zod";
import { configSchema } from "../../src/schema";

// ─── Zod introspection helpers ────────────────────────────────────────────────

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

/** Read the literal default value from a ZodDefault-wrapped schema, if any. */
function getDefaultValue(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    return schema._def.defaultValue();
  }
  return undefined;
}

/** True when the leaf field name denotes a network port assignment. */
function isPortFieldName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "port" || lower === "uiport" || lower === "baseport" || lower === "localport";
}

/**
 * Collect every port-bearing entry from the top-level config schema.
 *
 * An entry is port-bearing when its leaf field name is a port name
 * (port/uiPort/basePort/localPort) and its inner Zod type is a number with a
 * concrete default. Returns one record per assignment so shared ports (e.g. the
 * AskUser `port`/`uiPort` pair) are represented as distinct entries.
 */
interface PortEntry {
  /** `<namespace>.<field>` path, e.g. `terminal.port`. */
  path: string;
  /** Top-level namespace key, e.g. `terminal`. */
  namespace: string;
  /** The default port value declared in the schema. */
  port: number;
}

function collectPortEntries(): PortEntry[] {
  const entries: PortEntry[] = [];
  const shape = configSchema.shape as Record<string, z.ZodTypeAny>;

  for (const [namespace, nsSchema] of Object.entries(shape)) {
    const nsInner = unwrapSchema(nsSchema);
    if (!(nsInner instanceof z.ZodObject)) {
      continue;
    }
    const nsShape = nsInner.shape as Record<string, z.ZodTypeAny>;
    for (const [field, fieldSchema] of Object.entries(nsShape)) {
      if (!isPortFieldName(field)) {
        continue;
      }
      const fieldInner = unwrapSchema(fieldSchema);
      if (!(fieldInner instanceof z.ZodNumber)) {
        continue;
      }
      const def = getDefaultValue(fieldSchema);
      if (typeof def === "number") {
        entries.push({ path: `${namespace}.${field}`, namespace, port: def });
      }
    }
  }

  return entries;
}

/**
 * A namespace-level view of assigned ports.
 *
 * The AskUser namespace intentionally reuses one port for both its API and UI
 * (`port` === `uiPort` === 3338); that intra-namespace reuse is by design and
 * is not a collision. Property 2 is about ports assigned across DISTINCT
 * servers, so we reduce each namespace to the set of ports it owns and compare
 * ownership across namespaces.
 */
interface NamespacePort {
  namespace: string;
  port: number;
}

function collectNamespacePorts(entries: PortEntry[]): NamespacePort[] {
  const seen = new Set<string>();
  const result: NamespacePort[] = [];
  for (const e of entries) {
    const key = `${e.namespace}:${e.port}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ namespace: e.namespace, port: e.port });
  }
  return result;
}

// ─── Collected fixtures ────────────────────────────────────────────────────────

const portEntries = collectPortEntries();
const namespacePorts = collectNamespacePorts(portEntries);

describe("Feature: retire-and-gate-mcp-servers, Property 2: remaining schema ports are unique", () => {
  /**
   * **Validates: Requirements 1.7**
   */

  it("discovers a meaningful set of port-bearing schema entries", () => {
    // Guard against a broken introspection helper silently passing the property.
    expect(portEntries.length).toBeGreaterThan(5);
    expect(namespacePorts.length).toBeGreaterThan(5);
  });

  it("property: for all distinct port-bearing schema entries, no port is assigned to two different servers", () => {
    // The property: for every unordered pair of namespace/port ownerships, if
    // two entries share the same port they must belong to the same namespace.
    //
    // The assignment space is the fixed set of per-server port ownerships, so
    // the exhaustive input is the set of unordered index pairs. We enumerate
    // those pairs up front and let fast-check drive selection across them —
    // this guarantees the single colliding pair is always reachable rather than
    // relying on a random sampler happening to draw it. numRuns is capped at the
    // pair count (min 100) so every pair is exercised.
    if (namespacePorts.length < 2) {
      // Degenerate space — nothing to compare; property holds vacuously.
      return;
    }

    const pairs: [number, number][] = [];
    for (let i = 0; i < namespacePorts.length; i++) {
      for (let j = i + 1; j < namespacePorts.length; j++) {
        pairs.push([i, j]);
      }
    }

    fc.assert(
      fc.property(fc.constantFrom(...pairs), ([i, j]) => {
        const a = namespacePorts[i];
        const b = namespacePorts[j];
        // Two DIFFERENT namespaces must never share a port default.
        if (a.namespace !== b.namespace && a.port === b.port) {
          return false;
        }
        return true;
      }),
      { numRuns: Math.max(100, pairs.length) },
    );
  });

  it("the multiset of per-server assigned ports contains no duplicate", () => {
    // Deterministic, exhaustive companion to the property above: build the
    // multiset of ports owned by distinct servers and assert it is a set.
    const ports = namespacePorts.map((n) => n.port);
    const unique = new Set(ports);

    if (ports.length !== unique.size) {
      // Produce an actionable diagnostic listing each duplicated port and its
      // owning namespaces so a failure names the offending servers directly.
      const byPort = new Map<number, string[]>();
      for (const n of namespacePorts) {
        const owners = byPort.get(n.port) ?? [];
        owners.push(n.namespace);
        byPort.set(n.port, owners);
      }
      const collisions = [...byPort.entries()]
        .filter(([, owners]) => owners.length > 1)
        .map(([port, owners]) => `port ${port} shared by { ${owners.join(", ")} }`);
      // eslint-disable-next-line no-console
      throw new Error(`Duplicate port assignments detected: ${collisions.join("; ")}`);
    }

    expect(ports.length).toBe(unique.size);
  });
});
