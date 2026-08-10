/**
 * EndpointRegistry — central store for endpoint state.
 * Holds both manually-configured and discovered endpoints, manages health,
 * concurrency slots, and task metrics.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import { logger } from "./logger";
import { isLocalEndpoint, resolveLocalAddresses } from "./self-exclusion";
import { EndpointDefinition, EndpointMetrics, EndpointState } from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_DISCOVERED_ENDPOINTS = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createInitialMetrics(): EndpointMetrics {
  return {
    totalRequests: 0,
    totalFailures: 0,
    totalTokensProcessed: 0,
    averageResponseMs: 0,
  };
}

function createEndpointState(definition: EndpointDefinition): EndpointState {
  return {
    definition,
    health: "unknown",
    activeTaskCount: 0,
    consecutiveFailures: 0,
    lastProbeSuccess: null,
    lastProbeFailure: null,
    metrics: createInitialMetrics(),
  };
}

// ─── EndpointRegistry ────────────────────────────────────────────────────────

export class EndpointRegistry {
  private endpoints: Map<string, EndpointState>;
  private localAddresses: Set<string>;

  constructor(initialEndpoints: EndpointDefinition[]) {
    this.endpoints = new Map();

    // Resolve local addresses for self-exclusion
    const localHost = process.env.SUBAGENT_LOCAL_HOST || "localhost";
    const localPort = parseInt(process.env.SUBAGENT_LOCAL_PORT || "1234", 10);
    this.localAddresses = resolveLocalAddresses(localHost, localPort);

    // Register initial manual endpoints (filtering out self and duplicates)
    for (const ep of initialEndpoints) {
      if (this.isLocalInstance(ep.host, ep.port)) {
        logger.info(`Skipping local instance endpoint "${ep.id}" (${ep.host}:${ep.port})`);
        continue;
      }
      this.endpoints.set(ep.id, createEndpointState(ep));
    }

    logger.info(`EndpointRegistry initialized with ${this.endpoints.size} endpoint(s)`);
  }

  /**
   * Replace all manual endpoints (called on config reload).
   * Discovered endpoints are preserved. Manual endpoints not in the new list are removed.
   */
  reloadManualEndpoints(endpoints: EndpointDefinition[]): void {
    // Remove all existing manual endpoints
    for (const [id, state] of this.endpoints) {
      if (state.definition.source === "manual") {
        this.endpoints.delete(id);
      }
    }

    // Add new manual endpoints (filtering out self and duplicates)
    for (const ep of endpoints) {
      if (this.isLocalInstance(ep.host, ep.port)) {
        logger.info(
          `Skipping local instance endpoint "${ep.id}" on reload (${ep.host}:${ep.port})`,
        );
        continue;
      }
      if (this.hasDuplicateHostPort(ep.host, ep.port)) {
        logger.warn(`Skipping duplicate endpoint "${ep.id}" (${ep.host}:${ep.port})`);
        continue;
      }
      this.endpoints.set(ep.id, createEndpointState(ep));
    }

    logger.info(
      `Manual endpoints reloaded: ${endpoints.length} provided, ${this.getManualCount()} active`,
    );
  }

  /**
   * Add a discovered endpoint.
   * No-op if duplicate host:port exists, if it matches a manual endpoint,
   * or if the discovered limit is reached.
   *
   * @returns true if the endpoint was added, false otherwise
   */
  registerDiscovered(endpoint: EndpointDefinition): boolean {
    // Reject if at discovered capacity
    if (this.getDiscoveredCount() >= MAX_DISCOVERED_ENDPOINTS) {
      logger.warn(
        `Discovered endpoint limit (${MAX_DISCOVERED_ENDPOINTS}) reached; ignoring "${endpoint.id}"`,
      );
      return false;
    }

    // Reject if it's the local instance
    if (this.isLocalInstance(endpoint.host, endpoint.port)) {
      logger.info(`Ignoring discovered endpoint "${endpoint.id}" — matches local instance`);
      return false;
    }

    // Reject if duplicate host:port already exists
    if (this.hasDuplicateHostPort(endpoint.host, endpoint.port)) {
      logger.info(
        `Ignoring discovered endpoint "${endpoint.id}" — duplicate host:port (${endpoint.host}:${endpoint.port})`,
      );
      return false;
    }

    // Reject if ID already exists
    if (this.endpoints.has(endpoint.id)) {
      logger.info(`Ignoring discovered endpoint "${endpoint.id}" — ID already registered`);
      return false;
    }

    this.endpoints.set(endpoint.id, createEndpointState(endpoint));
    logger.info(
      `Registered discovered endpoint "${endpoint.id}" (${endpoint.host}:${endpoint.port})`,
    );
    return true;
  }

  /**
   * Remove a discovered endpoint that stopped responding.
   * Only discovered endpoints can be removed this way.
   */
  markDiscoveredOffline(id: string): void {
    const state = this.endpoints.get(id);
    if (!state) {
      logger.warn(`Cannot mark endpoint "${id}" offline — not found`);
      return;
    }
    if (state.definition.source !== "discovered") {
      logger.warn(`Cannot mark endpoint "${id}" offline — not a discovered endpoint`);
      return;
    }
    this.endpoints.delete(id);
    logger.info(`Discovered endpoint "${id}" marked offline and removed`);
  }

  /**
   * Get all endpoints matching optional filter criteria.
   */
  getEndpoints(filter?: { healthy?: boolean; enabled?: boolean; model?: string }): EndpointState[] {
    const results: EndpointState[] = [];

    for (const state of this.endpoints.values()) {
      if (filter) {
        if (filter.healthy !== undefined) {
          const isHealthy = state.health === "healthy";
          if (filter.healthy !== isHealthy) continue;
        }
        if (filter.enabled !== undefined) {
          if (filter.enabled !== state.definition.enabled) continue;
        }
        if (filter.model !== undefined) {
          if (!state.definition.models.includes(filter.model)) continue;
        }
      }
      results.push(state);
    }

    return results;
  }

  /**
   * Get a single endpoint by ID.
   */
  getEndpoint(id: string): EndpointState | undefined {
    return this.endpoints.get(id);
  }

  /**
   * Update health status after a probe.
   */
  updateHealth(id: string, healthy: boolean, failureReason?: string): void {
    const state = this.endpoints.get(id);
    if (!state) {
      logger.warn(`Cannot update health for endpoint "${id}" — not found`);
      return;
    }

    const now = new Date().toISOString();

    if (healthy) {
      state.health = "healthy";
      state.consecutiveFailures = 0;
      state.lastProbeSuccess = now;
    } else {
      state.consecutiveFailures++;
      state.lastProbeFailure = now;
      state.health = "unhealthy";
      if (failureReason) {
        logger.warn(`Endpoint "${id}" health probe failed: ${failureReason}`);
      }
    }
  }

  /**
   * Attempt to acquire a concurrency slot on an endpoint.
   * @returns false if the endpoint is at capacity or not found
   */
  acquireSlot(id: string): boolean {
    const state = this.endpoints.get(id);
    if (!state) {
      return false;
    }
    if (state.activeTaskCount >= state.definition.maxConcurrency) {
      return false;
    }
    state.activeTaskCount++;
    return true;
  }

  /**
   * Release a concurrency slot on an endpoint.
   */
  releaseSlot(id: string): void {
    const state = this.endpoints.get(id);
    if (!state) {
      logger.warn(`Cannot release slot for endpoint "${id}" — not found`);
      return;
    }
    if (state.activeTaskCount > 0) {
      state.activeTaskCount--;
    }
  }

  /**
   * Record task completion metrics for an endpoint.
   */
  recordTaskMetrics(id: string, durationMs: number, tokens: number, failed: boolean): void {
    const state = this.endpoints.get(id);
    if (!state) {
      logger.warn(`Cannot record metrics for endpoint "${id}" — not found`);
      return;
    }

    const metrics = state.metrics;
    metrics.totalRequests++;

    if (failed) {
      metrics.totalFailures++;
    }

    metrics.totalTokensProcessed += tokens;

    // Incremental running average for response time
    if (metrics.totalRequests === 1) {
      metrics.averageResponseMs = durationMs;
    } else {
      metrics.averageResponseMs =
        metrics.averageResponseMs +
        (durationMs - metrics.averageResponseMs) / metrics.totalRequests;
    }
  }

  /**
   * Check if a host:port combination matches the local instance.
   */
  isLocalInstance(host: string, port: number): boolean {
    return isLocalEndpoint(host, port, this.localAddresses);
  }

  /**
   * Get the count of discovered endpoints currently registered.
   */
  getDiscoveredCount(): number {
    let count = 0;
    for (const state of this.endpoints.values()) {
      if (state.definition.source === "discovered") {
        count++;
      }
    }
    return count;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Check if any existing endpoint already occupies the given host:port.
   */
  private hasDuplicateHostPort(host: string, port: number): boolean {
    const normalizedHost = host.toLowerCase();
    for (const state of this.endpoints.values()) {
      if (
        state.definition.host.toLowerCase() === normalizedHost &&
        state.definition.port === port
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Count of manually-configured endpoints.
   */
  private getManualCount(): number {
    let count = 0;
    for (const state of this.endpoints.values()) {
      if (state.definition.source === "manual") {
        count++;
      }
    }
    return count;
  }
}
