/**
 * LAN Telemetry Tracker — per-endpoint metrics aggregation.
 * Tracks request counts, failures, tokens, response times, and p95 latency
 * for each LAN endpoint independently.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of response times to retain per endpoint for p95 calculation */
const MAX_RESPONSE_TIMES = 1000;

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface EndpointTelemetry {
  endpointId: string;
  host: string;
  port: number;
  totalRequests: number;
  totalFailures: number;
  totalTokens: number;
  averageResponseMs: number;
  p95ResponseMs: number;
  lastRequestAt: string | null;
}

export interface LanTelemetrySummary {
  endpointBreakdown: EndpointTelemetry[];
  totalTasks: number;
  totalFailures: number;
  totalDurationMs: number;
}

// ─── Internal State ──────────────────────────────────────────────────────────

interface EndpointMetricsState {
  endpointId: string;
  host: string;
  port: number;
  totalRequests: number;
  totalFailures: number;
  totalTokens: number;
  averageResponseMs: number;
  lastRequestAt: string | null;
  /** Bounded sorted list of recent response times for p95 calculation */
  responseTimes: number[];
}

// ─── LanTelemetryTracker ─────────────────────────────────────────────────────

export class LanTelemetryTracker {
  private endpointMetrics: Map<string, EndpointMetricsState>;

  constructor() {
    this.endpointMetrics = new Map();
  }

  /**
   * Record a task completion with endpoint attribution.
   * Updates running average, token count, and response time history.
   */
  recordLanTask(
    _taskId: string,
    endpointId: string,
    durationMs: number,
    tokens: number,
    host: string,
    port: number,
  ): void {
    const state = this.getOrCreateState(endpointId, host, port);

    state.totalRequests++;
    state.totalTokens += tokens;
    state.lastRequestAt = new Date().toISOString();

    // Incremental running average
    state.averageResponseMs =
      state.averageResponseMs + (durationMs - state.averageResponseMs) / state.totalRequests;

    // Insert into bounded sorted response times array
    this.insertResponseTime(state, durationMs);
  }

  /**
   * Record a task failure with endpoint attribution.
   * Failures count towards total requests and response time tracking.
   */
  recordLanFailure(endpointId: string, durationMs: number, host: string, port: number): void {
    const state = this.getOrCreateState(endpointId, host, port);

    state.totalRequests++;
    state.totalFailures++;
    state.lastRequestAt = new Date().toISOString();

    // Incremental running average (failures still affect response time)
    state.averageResponseMs =
      state.averageResponseMs + (durationMs - state.averageResponseMs) / state.totalRequests;

    // Insert into bounded sorted response times array
    this.insertResponseTime(state, durationMs);
  }

  /**
   * Compute summary with per-endpoint breakdown.
   * Aggregates across all tracked endpoints.
   */
  computeLanSummary(): LanTelemetrySummary {
    const breakdown = this.getEndpointMetrics();

    let totalTasks = 0;
    let totalFailures = 0;
    let totalDurationMs = 0;

    for (const ep of breakdown) {
      totalTasks += ep.totalRequests;
      totalFailures += ep.totalFailures;
      // Total duration approximated from average * count
      totalDurationMs += ep.averageResponseMs * ep.totalRequests;
    }

    return {
      endpointBreakdown: breakdown,
      totalTasks,
      totalFailures,
      totalDurationMs,
    };
  }

  /**
   * Get aggregated per-endpoint metrics as immutable snapshots.
   */
  getEndpointMetrics(): EndpointTelemetry[] {
    const results: EndpointTelemetry[] = [];

    for (const state of this.endpointMetrics.values()) {
      results.push({
        endpointId: state.endpointId,
        host: state.host,
        port: state.port,
        totalRequests: state.totalRequests,
        totalFailures: state.totalFailures,
        totalTokens: state.totalTokens,
        averageResponseMs: state.averageResponseMs,
        p95ResponseMs: this.computeP95(state.responseTimes),
        lastRequestAt: state.lastRequestAt,
      });
    }

    return results;
  }

  /**
   * Reset all metrics.
   */
  clear(): void {
    this.endpointMetrics.clear();
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Get or create internal metrics state for an endpoint.
   */
  private getOrCreateState(endpointId: string, host: string, port: number): EndpointMetricsState {
    let state = this.endpointMetrics.get(endpointId);
    if (!state) {
      state = {
        endpointId,
        host,
        port,
        totalRequests: 0,
        totalFailures: 0,
        totalTokens: 0,
        averageResponseMs: 0,
        lastRequestAt: null,
        responseTimes: [],
      };
      this.endpointMetrics.set(endpointId, state);
    }
    return state;
  }

  /**
   * Insert a response time into the bounded sorted array.
   * Uses binary search for O(log n) insertion position, maintains sorted order.
   * When the array exceeds MAX_RESPONSE_TIMES, the oldest entry is removed.
   */
  private insertResponseTime(state: EndpointMetricsState, durationMs: number): void {
    const arr = state.responseTimes;

    // Binary search for insertion position
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid] < durationMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    arr.splice(lo, 0, durationMs);

    // Evict oldest entries if we exceed the bound
    // Remove from a random position to approximate reservoir sampling behavior
    if (arr.length > MAX_RESPONSE_TIMES) {
      // Remove the middle element to avoid bias towards extremes
      const removeIdx = Math.floor(arr.length / 2);
      arr.splice(removeIdx, 1);
    }
  }

  /**
   * Compute p95 from a sorted array of response times.
   * Returns 0 if no data is available.
   */
  private computeP95(sortedTimes: number[]): number {
    if (sortedTimes.length === 0) {
      return 0;
    }

    // p95 index: ceiling of 95th percentile position
    const index = Math.ceil(sortedTimes.length * 0.95) - 1;
    return sortedTimes[Math.min(index, sortedTimes.length - 1)];
  }
}
