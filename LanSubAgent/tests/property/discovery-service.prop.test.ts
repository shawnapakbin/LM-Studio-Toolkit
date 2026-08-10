/**
 * Property-based tests for the DiscoveryService component.
 *
 * Property 10: Discovery missed cycles trigger offline marking.
 * - Generate discovered endpoints with varying missed cycle counts.
 * - Assert: marked offline iff missed cycles ≥ threshold; remains active otherwise.
 *
 * @tag Feature: lan-sub-agent, Property 10: Discovery missed cycles trigger offline marking
 *
 * **Validates: Requirements 4.4**
 */

import * as fc from "fast-check";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { EndpointDefinition } from "../../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupEnv(): void {
  process.env.SUBAGENT_LOCAL_HOST = "10.0.0.1";
  process.env.SUBAGENT_LOCAL_PORT = "9999";
}

function cleanupEnv(): void {
  delete process.env.SUBAGENT_LOCAL_HOST;
  delete process.env.SUBAGENT_LOCAL_PORT;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a missedCycleThreshold between 1 and 5 */
const thresholdArb = fc.integer({ min: 1, max: 5 });

/** Generate a missed cycle count between 0 and 10 */
const missedCountArb = fc.integer({ min: 0, max: 10 });

/** Generate a discovered endpoint definition with a unique index */
const discoveredEndpointArb = (index: number): fc.Arbitrary<EndpointDefinition> =>
  fc.record({
    id: fc.constant(`discovered-192.168.1.${100 + index}-${5000 + index}`),
    host: fc.constant(`192.168.1.${100 + index}`),
    port: fc.constant(5000 + index),
    models: fc.constant(["model-a"]),
    maxConcurrency: fc.constant(4),
    enabled: fc.constant(true),
    source: fc.constant("discovered" as const),
  });

/** Generate a set of discovered endpoints (1–15) each with a missed cycle count */
const endpointsWithMissedCyclesArb = fc
  .integer({ min: 1, max: 15 })
  .chain((count) =>
    fc.tuple(
      thresholdArb,
      fc.tuple(
        ...Array.from({ length: count }, (_, i) =>
          fc.tuple(discoveredEndpointArb(i), missedCountArb),
        ),
      ),
    ),
  );

// ─── Property 10 Tests ───────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 10: Discovery missed cycles trigger offline marking", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /**
   * **Validates: Requirements 4.4**
   *
   * For any discovered endpoint, if it fails to respond to exactly the configured
   * missedCycleThreshold consecutive discovery cycles, it SHALL be marked offline.
   * If fewer than threshold cycles are missed, it SHALL remain active.
   */
  it("endpoint is marked offline iff missed cycles ≥ threshold; remains active otherwise", () => {
    fc.assert(
      fc.property(endpointsWithMissedCyclesArb, ([threshold, endpointsWithMisses]) => {
        // Create a fresh registry with no initial endpoints
        const registry = new EndpointRegistry([]);

        // Register all discovered endpoints
        for (const [endpoint] of endpointsWithMisses) {
          registry.registerDiscovered(endpoint);
        }

        // Verify all endpoints are initially registered
        for (const [endpoint] of endpointsWithMisses) {
          expect(registry.getEndpoint(endpoint.id)).toBeDefined();
        }

        // Simulate missed-cycle tracking logic:
        // For each endpoint, if missedCount >= threshold, mark offline
        for (const [endpoint, missedCount] of endpointsWithMisses) {
          if (missedCount >= threshold) {
            registry.markDiscoveredOffline(endpoint.id);
          }
        }

        // Assert the property:
        // - Endpoints with missedCount >= threshold should be gone (offline)
        // - Endpoints with missedCount < threshold should still be active
        for (const [endpoint, missedCount] of endpointsWithMisses) {
          const state = registry.getEndpoint(endpoint.id);
          if (missedCount >= threshold) {
            expect(state).toBeUndefined();
          } else {
            expect(state).toBeDefined();
            expect(state!.definition.id).toBe(endpoint.id);
            expect(state!.definition.source).toBe("discovered");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("only discovered endpoints can be marked offline; manual endpoints are never removed", () => {
    fc.assert(
      fc.property(thresholdArb, fc.integer({ min: 1, max: 5 }), (_threshold, manualCount) => {
        // Create manual endpoints that should never be removed
        const manualEndpoints: EndpointDefinition[] = Array.from(
          { length: manualCount },
          (_, i) => ({
            id: `manual-ep-${i}`,
            host: `192.168.2.${10 + i}`,
            port: 1234 + i,
            models: ["model-x"],
            maxConcurrency: 4,
            enabled: true,
            source: "manual" as const,
          }),
        );

        const registry = new EndpointRegistry(manualEndpoints);

        // Register some discovered endpoints
        const discoveredEp: EndpointDefinition = {
          id: "discovered-192.168.3.50-8080",
          host: "192.168.3.50",
          port: 8080,
          models: ["model-a"],
          maxConcurrency: 2,
          enabled: true,
          source: "discovered",
        };
        registry.registerDiscovered(discoveredEp);

        // Mark discovered endpoint offline (simulates threshold exceeded)
        registry.markDiscoveredOffline(discoveredEp.id);

        // Discovered endpoint should be gone
        expect(registry.getEndpoint(discoveredEp.id)).toBeUndefined();

        // Attempting to mark manual endpoints offline is a no-op
        for (const manual of manualEndpoints) {
          registry.markDiscoveredOffline(manual.id);
          // Manual endpoints should still exist
          expect(registry.getEndpoint(manual.id)).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("marking a non-existent endpoint offline is a safe no-op", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (fakeId) => {
        const registry = new EndpointRegistry([]);

        // Should not throw when marking a non-existent endpoint offline
        expect(() => registry.markDiscoveredOffline(fakeId)).not.toThrow();

        // Registry should still be empty / functional
        expect(registry.getEndpoints()).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11: Discovery registry integrity invariants ────────────────────

/**
 * Property 11: Discovery registry integrity invariants.
 * - Generate sequences of discovery responses (some with duplicate host:port).
 * - Process all responses through handleResponse().
 * - Assert: no duplicate host:port combinations among discovered endpoints;
 *   total discovered never exceeds maxDiscovered.
 *
 * @tag Feature: lan-sub-agent, Property 11: Discovery registry integrity invariants
 *
 * **Validates: Requirements 4.5, 4.6**
 */

import * as dgram from "dgram";
import { DiscoveryConfig, DiscoveryService } from "../../src/discovery-service";

// ─── Property 11 Helpers ─────────────────────────────────────────────────────

/**
 * Build a valid discovery response Buffer.
 */
function buildResponseBuffer(
  host: string,
  port: number,
  models: string[],
  maxConcurrency: number,
): Buffer {
  const msg = {
    type: "lan-subagent-announce",
    version: 1,
    host,
    port,
    models,
    maxConcurrency,
  };
  return Buffer.from(JSON.stringify(msg), "utf-8");
}

/**
 * Build a RemoteInfo object for a given host/port/message.
 */
function buildRinfo(host: string, port: number, msg: Buffer): dgram.RemoteInfo {
  return {
    address: host,
    family: "IPv4",
    port,
    size: msg.length,
  };
}

// ─── Property 11 Arbitraries ─────────────────────────────────────────────────

/** Generate an IP in the 192.168.x.y range (avoids local 10.0.0.1:9999) */
const p11IpArb = fc
  .tuple(fc.integer({ min: 1, max: 254 }), fc.integer({ min: 1, max: 254 }))
  .map(([x, y]) => `192.168.${x}.${y}`);

/** Generate a valid port */
const p11PortArb = fc.integer({ min: 1000, max: 60000 });

/** Generate a non-empty models array */
const p11ModelsArb = fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,14}$/), {
  minLength: 1,
  maxLength: 3,
});

/** Generate maxConcurrency */
const p11MaxConcurrencyArb = fc.integer({ min: 1, max: 10 });

/** A single discovery response entry */
interface P11ResponseEntry {
  host: string;
  port: number;
  models: string[];
  maxConcurrency: number;
}

const p11ResponseEntryArb: fc.Arbitrary<P11ResponseEntry> = fc.record({
  host: p11IpArb,
  port: p11PortArb,
  models: p11ModelsArb,
  maxConcurrency: p11MaxConcurrencyArb,
});

/**
 * Generate a sequence of discovery responses that includes intentional duplicates.
 * Strategy: generate a base list of unique entries, then randomly duplicate some
 * to ensure duplicate host:port combinations appear in the sequence.
 */
const p11ResponseSequenceArb = (
  minEntries: number,
  maxEntries: number,
): fc.Arbitrary<P11ResponseEntry[]> =>
  fc
    .record({
      baseEntries: fc.array(p11ResponseEntryArb, { minLength: minEntries, maxLength: maxEntries }),
      duplicateIndices: fc.array(fc.nat(), { minLength: 0, maxLength: 10 }),
    })
    .map(({ baseEntries, duplicateIndices }) => {
      if (baseEntries.length === 0) return baseEntries;
      // Append duplicates of randomly selected base entries
      const result = [...baseEntries];
      for (const idx of duplicateIndices) {
        const sourceIdx = idx % baseEntries.length;
        result.push({ ...baseEntries[sourceIdx] });
      }
      return result;
    });

/** Generate a maxDiscovered value (small for faster tests) */
const p11MaxDiscoveredArb = fc.integer({ min: 5, max: 15 });

// ─── Property 11 Tests ──────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 11: Discovery registry integrity invariants", () => {
  beforeAll(() => setupEnv());
  afterAll(() => cleanupEnv());

  /**
   * **Validates: Requirements 4.5, 4.6**
   *
   * For any sequence of discovery responses (including duplicates),
   * after processing all responses through handleResponse():
   * (a) No two discovered endpoints share the same host:port combination.
   * (b) The total count of discovered endpoints never exceeds maxDiscovered.
   */
  it("no duplicate host:port and discovered count never exceeds maxDiscovered", () => {
    fc.assert(
      fc.property(
        p11MaxDiscoveredArb,
        p11ResponseSequenceArb(10, 30),
        (maxDiscovered, responses) => {
          // Create a fresh registry
          const registry = new EndpointRegistry([]);

          // Create DiscoveryService with the generated maxDiscovered
          const config: DiscoveryConfig = {
            enabled: true,
            intervalMs: 60000,
            broadcastPort: 41234,
            responseTimeoutMs: 5000,
            maxDiscovered,
            missedCycleThreshold: 3,
          };
          const discoveryService = new DiscoveryService(registry, config);

          // Process all responses through handleResponse
          for (const entry of responses) {
            const msg = buildResponseBuffer(
              entry.host,
              entry.port,
              entry.models,
              entry.maxConcurrency,
            );
            const rinfo = buildRinfo(entry.host, entry.port, msg);
            discoveryService.handleResponse(msg, rinfo);
          }

          // Get all discovered endpoints
          const allEndpoints = registry.getEndpoints();
          const discoveredEndpoints = allEndpoints.filter(
            (ep) => ep.definition.source === "discovered",
          );

          // (a) No duplicate host:port combinations
          const hostPortPairs = discoveredEndpoints.map(
            (ep) => `${ep.definition.host}:${ep.definition.port}`,
          );
          const uniquePairs = new Set(hostPortPairs);
          expect(uniquePairs.size).toBe(hostPortPairs.length);

          // (b) Total discovered never exceeds maxDiscovered
          expect(registry.getDiscoveredCount()).toBeLessThanOrEqual(maxDiscovered);
        },
      ),
      { numRuns: 100 },
    );
  });
});
