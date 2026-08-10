/**
 * Property-based tests for per-endpoint metrics correctness (Property 16).
 *
 * Property 16: Per-endpoint metrics correctness
 * - Generate sequences of task completions (both successes and failures) attributed to various endpoints
 * - Assert: totalRequests equals count of all tasks (successes + failures) sent to that endpoint
 * - Assert: totalFailures equals the count of failed tasks on that endpoint
 * - Assert: averageResponseMs equals the arithmetic mean of all response durations for that endpoint
 *
 * Validates: Requirements 9.1, 9.2
 *
 * @tag Feature: lan-sub-agent, Property 16: Per-endpoint metrics correctness
 */

import * as fc from "fast-check";
import { LanTelemetryTracker } from "../../src/lan-telemetry";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for an endpoint identifier */
const endpointIdArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a host string */
const hostArb = fc
  .stringOf(fc.char(), { minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a port number */
const portArb = fc.integer({ min: 1, max: 65535 });

/** Arbitrary for a duration in milliseconds (positive) */
const durationArb = fc.double({ min: 0.01, max: 60000, noNaN: true });

/** Arbitrary for tokens count */
const tokensArb = fc.integer({ min: 0, max: 100000 });

/** Arbitrary for a task ID */
const taskIdArb = fc.string({ minLength: 1, maxLength: 20 });

/** Represents a single recorded event (success or failure) */
interface TaskEvent {
  type: "success" | "failure";
  endpointId: string;
  host: string;
  port: number;
  durationMs: number;
  taskId: string;
  tokens: number;
}

/** Arbitrary for an endpoint definition (fixed id/host/port) */
const endpointDefArb = fc.record({
  endpointId: endpointIdArb,
  host: hostArb,
  port: portArb,
});

/** Arbitrary for a success event given a fixed endpoint */
const successEventArb = (endpoint: { endpointId: string; host: string; port: number }) =>
  fc.record({
    type: fc.constant("success" as const),
    endpointId: fc.constant(endpoint.endpointId),
    host: fc.constant(endpoint.host),
    port: fc.constant(endpoint.port),
    durationMs: durationArb,
    taskId: taskIdArb,
    tokens: tokensArb,
  });

/** Arbitrary for a failure event given a fixed endpoint */
const failureEventArb = (endpoint: { endpointId: string; host: string; port: number }) =>
  fc.record({
    type: fc.constant("failure" as const),
    endpointId: fc.constant(endpoint.endpointId),
    host: fc.constant(endpoint.host),
    port: fc.constant(endpoint.port),
    durationMs: durationArb,
    taskId: taskIdArb,
    tokens: fc.constant(0),
  });

/** Generate a sequence of task events across 1-5 distinct endpoints */
const taskSequenceArb = fc
  .array(endpointDefArb, { minLength: 1, maxLength: 5 })
  .chain((endpoints) => {
    // Deduplicate by endpointId
    const uniqueEndpoints = Array.from(
      new Map(endpoints.map((ep) => [ep.endpointId, ep])).values(),
    );

    // For each endpoint, generate a mix of success/failure events
    const eventArbs = uniqueEndpoints.map((ep) =>
      fc.array(fc.oneof(successEventArb(ep), failureEventArb(ep)), {
        minLength: 1,
        maxLength: 20,
      }),
    );

    return fc.tuple(...eventArbs).map((eventArrays) => ({
      endpoints: uniqueEndpoints,
      events: eventArrays.flat(),
    }));
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 16: Per-endpoint metrics correctness", () => {
  it("totalRequests equals count of all tasks (successes + failures) per endpoint", () => {
    fc.assert(
      fc.property(taskSequenceArb, ({ endpoints, events }) => {
        const tracker = new LanTelemetryTracker();

        // Record all events
        for (const event of events) {
          if (event.type === "success") {
            tracker.recordLanTask(
              event.taskId,
              event.endpointId,
              event.durationMs,
              event.tokens,
              event.host,
              event.port,
            );
          } else {
            tracker.recordLanFailure(event.endpointId, event.durationMs, event.host, event.port);
          }
        }

        const metrics = tracker.getEndpointMetrics();

        // For each endpoint, totalRequests should equal total events for that endpoint
        for (const ep of endpoints) {
          const epEvents = events.filter((e) => e.endpointId === ep.endpointId);
          const metric = metrics.find((m) => m.endpointId === ep.endpointId);

          expect(metric).toBeDefined();
          expect(metric!.totalRequests).toBe(epEvents.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("totalFailures equals the count of failed tasks per endpoint", () => {
    fc.assert(
      fc.property(taskSequenceArb, ({ endpoints, events }) => {
        const tracker = new LanTelemetryTracker();

        // Record all events
        for (const event of events) {
          if (event.type === "success") {
            tracker.recordLanTask(
              event.taskId,
              event.endpointId,
              event.durationMs,
              event.tokens,
              event.host,
              event.port,
            );
          } else {
            tracker.recordLanFailure(event.endpointId, event.durationMs, event.host, event.port);
          }
        }

        const metrics = tracker.getEndpointMetrics();

        // For each endpoint, totalFailures should equal failure count
        for (const ep of endpoints) {
          const failureCount = events.filter(
            (e) => e.endpointId === ep.endpointId && e.type === "failure",
          ).length;
          const metric = metrics.find((m) => m.endpointId === ep.endpointId);

          expect(metric).toBeDefined();
          expect(metric!.totalFailures).toBe(failureCount);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("averageResponseMs equals the arithmetic mean of all response durations per endpoint", () => {
    fc.assert(
      fc.property(taskSequenceArb, ({ endpoints, events }) => {
        const tracker = new LanTelemetryTracker();

        // Record all events
        for (const event of events) {
          if (event.type === "success") {
            tracker.recordLanTask(
              event.taskId,
              event.endpointId,
              event.durationMs,
              event.tokens,
              event.host,
              event.port,
            );
          } else {
            tracker.recordLanFailure(event.endpointId, event.durationMs, event.host, event.port);
          }
        }

        const metrics = tracker.getEndpointMetrics();

        // For each endpoint, averageResponseMs should equal arithmetic mean
        for (const ep of endpoints) {
          const epEvents = events.filter((e) => e.endpointId === ep.endpointId);
          const metric = metrics.find((m) => m.endpointId === ep.endpointId);

          expect(metric).toBeDefined();

          if (epEvents.length === 0) continue;

          const expectedMean = epEvents.reduce((sum, e) => sum + e.durationMs, 0) / epEvents.length;

          // Allow floating point tolerance due to incremental running average
          expect(metric!.averageResponseMs).toBeCloseTo(expectedMean, 6);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("metrics are correctly tracked across multiple endpoints independently", () => {
    fc.assert(
      fc.property(taskSequenceArb, ({ endpoints, events }) => {
        const tracker = new LanTelemetryTracker();

        // Record all events
        for (const event of events) {
          if (event.type === "success") {
            tracker.recordLanTask(
              event.taskId,
              event.endpointId,
              event.durationMs,
              event.tokens,
              event.host,
              event.port,
            );
          } else {
            tracker.recordLanFailure(event.endpointId, event.durationMs, event.host, event.port);
          }
        }

        const metrics = tracker.getEndpointMetrics();

        // Number of endpoints in metrics should match number of distinct endpoints that received events
        const endpointsWithEvents = new Set(events.map((e) => e.endpointId));
        expect(metrics.length).toBe(endpointsWithEvents.size);

        // Sum of all endpoint totalRequests should equal total events
        const totalRequests = metrics.reduce((sum, m) => sum + m.totalRequests, 0);
        expect(totalRequests).toBe(events.length);

        // Sum of all endpoint totalFailures should equal total failures
        const totalFailures = metrics.reduce((sum, m) => sum + m.totalFailures, 0);
        const expectedFailures = events.filter((e) => e.type === "failure").length;
        expect(totalFailures).toBe(expectedFailures);
      }),
      { numRuns: 100 },
    );
  });

  it("clear() resets all metrics to empty state", () => {
    fc.assert(
      fc.property(taskSequenceArb, ({ events }) => {
        const tracker = new LanTelemetryTracker();

        // Record some events
        for (const event of events) {
          if (event.type === "success") {
            tracker.recordLanTask(
              event.taskId,
              event.endpointId,
              event.durationMs,
              event.tokens,
              event.host,
              event.port,
            );
          } else {
            tracker.recordLanFailure(event.endpointId, event.durationMs, event.host, event.port);
          }
        }

        // Clear and verify empty
        tracker.clear();
        const metrics = tracker.getEndpointMetrics();
        expect(metrics.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
