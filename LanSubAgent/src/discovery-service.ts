/**
 * DiscoveryService — periodically broadcasts UDP probes to discover
 * LM Studio instances on the local network. Registers discovered endpoints
 * in the EndpointRegistry, handles missed-cycle tracking, capacity limits,
 * self-exclusion, and duplicate avoidance.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import * as dgram from "dgram";

import {
  type DiscoveryResponse,
  createDiscoveryProbe,
  isValidResponse,
  serializeMessage,
} from "./discovery-protocol";
import { EndpointRegistry } from "./endpoint-registry";
import { type Logger, logger as defaultLogger } from "./logger";
import type { EndpointDefinition } from "./types";

// ─── Configuration ───────────────────────────────────────────────────────────

export interface DiscoveryConfig {
  enabled: boolean;
  intervalMs: number; // default 60000, min 10000, max 300000
  broadcastPort: number; // UDP port for discovery, default 41234
  responseTimeoutMs: number; // 5000
  maxDiscovered: number; // 50
  missedCycleThreshold: number; // 3
}

/**
 * Create a DiscoveryConfig from the config-schema discovery section.
 */
export function createDiscoveryConfig(
  configSection: {
    enabled: boolean;
    intervalSeconds: number;
    broadcastPort: number;
    maxDiscovered: number;
  },
  overrides?: Partial<DiscoveryConfig>,
): DiscoveryConfig {
  return {
    enabled: configSection.enabled,
    intervalMs: Math.max(10000, Math.min(300000, configSection.intervalSeconds * 1000)),
    broadcastPort: configSection.broadcastPort,
    responseTimeoutMs: 5000,
    maxDiscovered: configSection.maxDiscovered,
    missedCycleThreshold: 3,
    ...overrides,
  };
}

// ─── DiscoveryService ────────────────────────────────────────────────────────

export class DiscoveryService {
  private registry: EndpointRegistry;
  private config: DiscoveryConfig;
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private missedCycles: Map<string, number> = new Map(); // endpointId -> missed count
  private logger: Logger;
  private knownDiscoveredIds: Set<string> = new Set(); // track all discovered endpoint IDs

  constructor(registry: EndpointRegistry, config: DiscoveryConfig, logger?: Logger) {
    this.registry = registry;
    this.config = config;
    this.logger = logger ?? defaultLogger;
  }

  /**
   * Start periodic UDP broadcast discovery.
   * No-op if discovery is disabled (Requirement 4.7).
   */
  start(): void {
    if (!this.config.enabled) {
      this.logger.info("Discovery service disabled — relying on manual endpoints only");
      return;
    }

    this.logger.info(
      `Starting discovery service: interval=${this.config.intervalMs}ms, port=${this.config.broadcastPort}`,
    );

    this.timer = setInterval(() => {
      this.broadcastProbe();
    }, this.config.intervalMs);

    // Run immediately on start
    this.broadcastProbe();
  }

  /**
   * Stop periodic discovery and close the UDP socket.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Socket may already be closed
      }
      this.socket = null;
    }
    this.logger.info("Discovery service stopped");
  }

  /**
   * Perform a single on-demand discovery scan.
   * Returns newly discovered endpoints within the response timeout window.
   * Used by the `discover_endpoints` MCP tool (Requirement 4.2).
   */
  async scanOnce(): Promise<EndpointDefinition[]> {
    if (!this.config.enabled) {
      this.logger.info("Discovery disabled — scanOnce returning empty");
      return [];
    }

    return new Promise<EndpointDefinition[]>((resolve) => {
      const discovered: EndpointDefinition[] = [];
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      socket.on("error", (err) => {
        this.logger.warn(`scanOnce socket error: ${err.message}`);
        socket.close();
        resolve(discovered);
      });

      socket.on("message", (msg, rinfo) => {
        const endpoint = this.processResponse(msg, rinfo);
        if (endpoint) {
          discovered.push(endpoint);
        }
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        const probe = serializeMessage(createDiscoveryProbe());
        socket.send(probe, 0, probe.length, this.config.broadcastPort, "255.255.255.255", (err) => {
          if (err) {
            this.logger.warn(`scanOnce broadcast error: ${err.message}`);
          }
        });
      });

      // Wait for responses up to timeout, then close and return results
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Socket may already be closed
        }
        resolve(discovered);
      }, this.config.responseTimeoutMs);
    });
  }

  /**
   * Handle a received UDP response message.
   * Validates the response, applies self-exclusion and duplicate checks,
   * enforces capacity limit, and registers in the endpoint registry.
   *
   * Requirements: 4.2, 4.3, 4.5, 4.6
   */
  handleResponse(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    this.processResponse(msg, rinfo);
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * Process a response message, returning the endpoint definition if registered.
   */
  private processResponse(msg: Buffer, rinfo: dgram.RemoteInfo): EndpointDefinition | null {
    // Parse the message
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.toString("utf-8"));
    } catch {
      this.logger.warn(`Discovery: invalid JSON from ${rinfo.address}:${rinfo.port}`);
      return null;
    }

    // Validate as a proper discovery response (Requirement 4.3)
    if (!isValidResponse(parsed)) {
      this.logger.warn(
        `Discovery: invalid response from ${rinfo.address}:${rinfo.port} — missing host, port, or models`,
      );
      return null;
    }

    const response = parsed as DiscoveryResponse;

    // Self-exclusion: discard if matches local instance
    if (this.registry.isLocalInstance(response.host, response.port)) {
      this.logger.info(
        `Discovery: discarding response from self (${response.host}:${response.port})`,
      );
      return null;
    }

    // Capacity limit (Requirement 4.6)
    if (this.registry.getDiscoveredCount() >= this.config.maxDiscovered) {
      this.logger.warn(
        `Discovery: max discovered endpoints (${this.config.maxDiscovered}) reached — ignoring ${response.host}:${response.port}`,
      );
      return null;
    }

    // Build EndpointDefinition
    const endpointId = `discovered-${response.host}-${response.port}`;
    const endpoint: EndpointDefinition = {
      id: endpointId,
      host: response.host,
      port: response.port,
      models: response.models,
      maxConcurrency: response.maxConcurrency ?? 1,
      enabled: true,
      source: "discovered",
    };

    // Register in registry (handles duplicate host:port, manual overlap — Requirement 4.5)
    const registered = this.registry.registerDiscovered(endpoint);

    if (registered) {
      this.knownDiscoveredIds.add(endpointId);
      // Reset missed cycles on successful registration
      this.missedCycles.set(endpointId, 0);
      this.logger.info(`Discovery: registered endpoint ${endpointId}`);
      return endpoint;
    }

    // Even if not newly registered (duplicate), reset missed cycles if it's a known endpoint
    if (this.knownDiscoveredIds.has(endpointId)) {
      this.missedCycles.set(endpointId, 0);
    }

    return null;
  }

  /**
   * Broadcast a UDP discovery probe and track missed cycles.
   * Requirement 4.1: Broadcast at configurable interval.
   * Requirement 4.4: Mark offline after missedCycleThreshold consecutive misses.
   */
  private broadcastProbe(): void {
    // Track which known endpoints respond in this cycle
    const respondedInCycle = new Set<string>();

    // Create or reuse socket
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
    }

    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    this.socket.on("error", (err) => {
      this.logger.warn(`Discovery socket error: ${err.message}`);
      this.closeSocket();
    });

    this.socket.on("message", (msg, rinfo) => {
      const endpoint = this.processResponse(msg, rinfo);
      if (endpoint) {
        respondedInCycle.add(endpoint.id);
      } else {
        // Check if it was a valid response for an already-known endpoint
        try {
          const parsed = JSON.parse(msg.toString("utf-8"));
          if (isValidResponse(parsed)) {
            const id = `discovered-${parsed.host}-${parsed.port}`;
            if (this.knownDiscoveredIds.has(id)) {
              respondedInCycle.add(id);
              this.missedCycles.set(id, 0);
            }
          }
        } catch {
          // Ignore parse errors here — already handled in processResponse
        }
      }
    });

    this.socket.bind(() => {
      this.socket!.setBroadcast(true);
      const probe = serializeMessage(createDiscoveryProbe());
      this.socket!.send(
        probe,
        0,
        probe.length,
        this.config.broadcastPort,
        "255.255.255.255",
        (err) => {
          if (err) {
            this.logger.warn(`Discovery broadcast error: ${err.message}`);
          }
        },
      );
    });

    // After timeout, process missed cycles
    setTimeout(() => {
      this.processMissedCycles(respondedInCycle);
      this.closeSocket();
    }, this.config.responseTimeoutMs);
  }

  /**
   * Increment missed cycle count for non-responding endpoints.
   * Mark offline after threshold consecutive misses (Requirement 4.4).
   */
  private processMissedCycles(respondedInCycle: Set<string>): void {
    for (const endpointId of this.knownDiscoveredIds) {
      if (!respondedInCycle.has(endpointId)) {
        const currentMisses = (this.missedCycles.get(endpointId) ?? 0) + 1;
        this.missedCycles.set(endpointId, currentMisses);

        if (currentMisses >= this.config.missedCycleThreshold) {
          this.logger.info(
            `Discovery: endpoint "${endpointId}" missed ${currentMisses} cycles — marking offline`,
          );
          this.registry.markDiscoveredOffline(endpointId);
          this.knownDiscoveredIds.delete(endpointId);
          this.missedCycles.delete(endpointId);
        }
      }
    }
  }

  /**
   * Safely close the current socket.
   */
  private closeSocket(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // Socket may already be closed
      }
      this.socket = null;
    }
  }
}
