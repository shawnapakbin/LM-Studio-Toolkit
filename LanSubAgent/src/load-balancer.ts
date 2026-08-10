/**
 * LoadBalancer — selects target endpoint for each task based on configurable strategy.
 * Supports round-robin, least-connections, and weighted distribution.
 * Enforces self-exclusion, health filtering, capacity checks, and model matching.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import { EndpointRegistry } from "./endpoint-registry";
import { Logger, logger as defaultLogger } from "./logger";
import { EndpointState } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LoadBalancerStrategy = "round-robin" | "least-connections" | "weighted";

export interface LoadBalancerConfig {
  strategy: LoadBalancerStrategy;
  retryLimit: number; // 0–5, default 2
  localHost: string;
  localPort: number;
}

export interface EndpointSelection {
  endpoint: EndpointState;
  reason: string;
}

export interface EndpointSelectionError {
  error: "no_endpoints_available" | "no_remote_endpoints";
  reason: string;
}

export type SelectionResult = EndpointSelection | EndpointSelectionError;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSelectionError(result: SelectionResult): result is EndpointSelectionError {
  return "error" in result;
}

// ─── LoadBalancer ────────────────────────────────────────────────────────────

export class LoadBalancer {
  private registry: EndpointRegistry;
  private config: LoadBalancerConfig;
  private roundRobinIndex: number;
  private logger: Logger;

  constructor(registry: EndpointRegistry, config: LoadBalancerConfig, logger?: Logger) {
    this.registry = registry;
    this.config = config;
    this.roundRobinIndex = 0;
    this.logger = logger || defaultLogger;
  }

  /**
   * Select best endpoint for a task.
   * Applies health + enabled filtering, self-exclusion, model matching, and capacity check.
   *
   * Returns an EndpointSelection on success or an EndpointSelectionError if no candidates exist.
   */
  selectEndpoint(modelRequirement?: string): SelectionResult {
    // Step 1: Get all healthy + enabled endpoints
    const allHealthy = this.registry.getEndpoints({ healthy: true, enabled: true });

    // If zero healthy endpoints exist at all, return no_endpoints_available
    if (allHealthy.length === 0) {
      this.logger.warn("No healthy endpoints available for task dispatch");
      return {
        error: "no_endpoints_available",
        reason: "No endpoints are currently healthy and enabled",
      };
    }

    // Step 2: Self-exclusion — filter out local instance
    const remote = allHealthy.filter(
      (ep) => !this.registry.isLocalInstance(ep.definition.host, ep.definition.port),
    );

    // If all healthy endpoints resolve to local, return no_remote_endpoints
    if (remote.length === 0) {
      this.logger.warn("All healthy endpoints resolve to the local instance");
      return {
        error: "no_remote_endpoints",
        reason: "All available endpoints are local — cannot dispatch to self",
      };
    }

    // Step 3: Model filtering (if a model requirement is specified)
    let candidates = remote;
    if (modelRequirement) {
      candidates = remote.filter((ep) => ep.definition.models.includes(modelRequirement));

      if (candidates.length === 0) {
        this.logger.warn(`No healthy remote endpoints advertise model "${modelRequirement}"`);
        return {
          error: "no_endpoints_available",
          reason: `No healthy endpoints advertise model "${modelRequirement}"`,
        };
      }
    }

    // Step 4: Capacity filtering — skip endpoints at max concurrency
    const available = candidates.filter((ep) => ep.activeTaskCount < ep.definition.maxConcurrency);

    if (available.length === 0) {
      this.logger.warn("All candidate endpoints are at maximum concurrency");
      return {
        error: "no_endpoints_available",
        reason: "All candidate endpoints have reached maximum concurrency",
      };
    }

    // Step 5: Apply strategy
    const selected = this.applyStrategy(available);

    this.logger.info(
      `Selected endpoint "${selected.definition.id}" via ${this.config.strategy} strategy`,
    );

    return {
      endpoint: selected,
      reason: `Selected via ${this.config.strategy} strategy`,
    };
  }

  /**
   * Get ordered list of candidates for retry fallback.
   * Excludes endpoints matching the given IDs (typically the failed endpoint).
   */
  getCandidates(modelRequirement?: string, excludeIds?: string[]): EndpointState[] {
    // Get healthy + enabled endpoints
    const allHealthy = this.registry.getEndpoints({ healthy: true, enabled: true });

    // Self-exclusion
    const remote = allHealthy.filter(
      (ep) => !this.registry.isLocalInstance(ep.definition.host, ep.definition.port),
    );

    // Model filtering
    let candidates = remote;
    if (modelRequirement) {
      candidates = remote.filter((ep) => ep.definition.models.includes(modelRequirement));
    }

    // Exclude failed endpoint IDs
    if (excludeIds && excludeIds.length > 0) {
      const excludeSet = new Set(excludeIds);
      candidates = candidates.filter((ep) => !excludeSet.has(ep.definition.id));
    }

    // Capacity filtering
    candidates = candidates.filter((ep) => ep.activeTaskCount < ep.definition.maxConcurrency);

    // Sort by strategy preference for retry ordering
    return this.sortByStrategy(candidates);
  }

  /**
   * Update the load balancing strategy at runtime (e.g., on config reload).
   */
  setStrategy(strategy: LoadBalancerStrategy): void {
    const previous = this.config.strategy;
    this.config.strategy = strategy;

    if (previous !== strategy) {
      this.roundRobinIndex = 0; // Reset round-robin index on strategy change
      this.logger.info(`Load balancer strategy changed from "${previous}" to "${strategy}"`);
    }
  }

  /**
   * Get the current retry limit from config.
   */
  getRetryLimit(): number {
    return this.config.retryLimit;
  }

  // ─── Private Strategy Implementation ─────────────────────────────────────────

  /**
   * Apply the configured strategy to select one endpoint from available candidates.
   */
  private applyStrategy(candidates: EndpointState[]): EndpointState {
    switch (this.config.strategy) {
      case "round-robin":
        return this.selectRoundRobin(candidates);
      case "least-connections":
        return this.selectLeastConnections(candidates);
      case "weighted":
        return this.selectWeighted(candidates);
      default:
        // Fallback to round-robin for any unknown strategy
        return this.selectRoundRobin(candidates);
    }
  }

  /**
   * Round-robin strategy: cycle through candidates in order.
   * Maintains a persistent index that wraps around.
   */
  private selectRoundRobin(candidates: EndpointState[]): EndpointState {
    const index = this.roundRobinIndex % candidates.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length;
    return candidates[index];
  }

  /**
   * Least-connections strategy: select the endpoint with the fewest active tasks.
   * Breaks ties by picking the first one found (stable ordering).
   */
  private selectLeastConnections(candidates: EndpointState[]): EndpointState {
    let selected = candidates[0];

    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].activeTaskCount < selected.activeTaskCount) {
        selected = candidates[i];
      }
    }

    return selected;
  }

  /**
   * Weighted strategy: distribute proportional to maxConcurrency.
   * Endpoints with higher maxConcurrency get proportionally more tasks.
   * Uses weighted random selection based on remaining capacity.
   */
  private selectWeighted(candidates: EndpointState[]): EndpointState {
    // Weight is remaining capacity (maxConcurrency - activeTaskCount)
    // This naturally distributes load proportional to capacity
    const weights = candidates.map((ep) => ep.definition.maxConcurrency - ep.activeTaskCount);

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    if (totalWeight === 0) {
      // All endpoints have equal remaining capacity — fall back to first
      return candidates[0];
    }

    // Deterministic weighted selection: pick the endpoint with the highest weight
    // (most remaining capacity proportional to its total capacity)
    let maxWeightIndex = 0;
    let maxWeight = weights[0];

    for (let i = 1; i < weights.length; i++) {
      if (weights[i] > maxWeight) {
        maxWeight = weights[i];
        maxWeightIndex = i;
      }
    }

    return candidates[maxWeightIndex];
  }

  /**
   * Sort candidates by strategy preference for retry ordering.
   */
  private sortByStrategy(candidates: EndpointState[]): EndpointState[] {
    switch (this.config.strategy) {
      case "least-connections":
        return [...candidates].sort((a, b) => a.activeTaskCount - b.activeTaskCount);
      case "weighted":
        return [...candidates].sort((a, b) => {
          const remainingA = a.definition.maxConcurrency - a.activeTaskCount;
          const remainingB = b.definition.maxConcurrency - b.activeTaskCount;
          return remainingB - remainingA; // Higher remaining capacity first
        });
      case "round-robin":
      default:
        return [...candidates]; // Preserve insertion order
    }
  }
}

export { isSelectionError };
