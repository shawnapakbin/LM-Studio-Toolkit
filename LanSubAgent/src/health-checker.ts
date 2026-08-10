/**
 * HealthChecker — periodic probe of registered endpoints.
 * Uses HTTP GET to /v1/models with configurable timeout and failure threshold
 * to determine endpoint availability.
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import http from "http";
import https from "https";
import { EndpointRegistry } from "./endpoint-registry";
import { Logger, logger as defaultLogger } from "./logger";
import { EndpointState } from "./types";

// ─── Config Interface ────────────────────────────────────────────────────────

export interface HealthCheckerConfig {
  /** Probe interval in milliseconds (min 5000, max 300000, default 30000) */
  intervalMs: number;
  /** Probe timeout in milliseconds (default 5000) */
  timeoutMs: number;
  /** Consecutive failures before marking unhealthy (default 2) */
  failureThreshold: number;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface ProbeResult {
  success: boolean;
  failureReason?: string;
}

// ─── HealthChecker ───────────────────────────────────────────────────────────

export class HealthChecker {
  private registry: EndpointRegistry;
  private config: HealthCheckerConfig;
  private timer: NodeJS.Timeout | null;
  private logger: Logger;

  constructor(registry: EndpointRegistry, config: HealthCheckerConfig, logger?: Logger) {
    this.registry = registry;
    this.config = config;
    this.timer = null;
    this.logger = logger ?? defaultLogger;
  }

  /**
   * Start periodic health checking.
   * Runs an immediate cycle, then repeats at the configured interval.
   */
  start(): void {
    if (this.timer) {
      this.logger.warn("HealthChecker already running — ignoring duplicate start()");
      return;
    }

    this.logger.info(
      `HealthChecker starting (interval=${this.config.intervalMs}ms, timeout=${this.config.timeoutMs}ms, threshold=${this.config.failureThreshold})`,
    );

    // Run the first cycle immediately (fire-and-forget)
    void this.runCycle();

    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.config.intervalMs);

    // Allow the process to exit even if the timer is active
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stop periodic health checking.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("HealthChecker stopped");
    }
  }

  /**
   * Probe a single endpoint via HTTP GET to /v1/models.
   * @returns true if the endpoint responded with HTTP 2xx within the timeout
   */
  async probeEndpoint(endpoint: EndpointState): Promise<boolean> {
    const result = await this.probeEndpointDetailed(endpoint);
    return result.success;
  }

  /**
   * Run a full health check cycle across all enabled endpoints.
   * Probes every enabled endpoint (including unhealthy ones for recovery)
   * and applies failure threshold logic before updating the registry.
   */
  async runCycle(): Promise<void> {
    const endpoints = this.registry.getEndpoints({ enabled: true });

    if (endpoints.length === 0) {
      return;
    }

    const probePromises = endpoints.map((ep) => this.probeAndUpdate(ep));
    await Promise.all(probePromises);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * Probe an endpoint and return detailed result including failure reason.
   */
  private async probeEndpointDetailed(endpoint: EndpointState): Promise<ProbeResult> {
    const { host, port } = endpoint.definition;
    const url = `http://${host}:${port}/v1/models`;

    return new Promise<ProbeResult>((resolve) => {
      const requestModule = port === 443 ? https : http;

      const req = requestModule.get(url, { timeout: this.config.timeoutMs }, (res) => {
        // Consume body to free socket
        res.resume();

        const statusCode = res.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ success: true });
        } else {
          resolve({ success: false, failureReason: `non-2xx status code (${statusCode})` });
        }
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ success: false, failureReason: "timeout" });
      });

      req.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ECONNREFUSED") {
          resolve({ success: false, failureReason: "connection refused" });
        } else {
          resolve({ success: false, failureReason: err.message || "unknown error" });
        }
      });
    });
  }

  /**
   * Probe a single endpoint and apply threshold logic to update registry health.
   */
  private async probeAndUpdate(endpoint: EndpointState): Promise<void> {
    const id = endpoint.definition.id;
    const previousHealth = endpoint.health;

    const result = await this.probeEndpointDetailed(endpoint);

    if (result.success) {
      // Successful probe — mark healthy and reset failures
      this.registry.updateHealth(id, true);

      // Log recovery transition: unhealthy → healthy
      if (previousHealth === "unhealthy") {
        this.logger.info(`Endpoint "${id}" recovered — now healthy`);
      }
    } else {
      // Failed probe — apply threshold logic
      const currentFailures = endpoint.consecutiveFailures + 1;
      const reason = result.failureReason ?? "probe failed";

      if (currentFailures >= this.config.failureThreshold) {
        // Threshold reached — mark unhealthy in registry
        this.registry.updateHealth(id, false, reason);

        // Log transition: healthy/unknown → unhealthy
        if (previousHealth !== "unhealthy") {
          this.logger.warn(
            `Endpoint "${id}" marked unhealthy after ${currentFailures} consecutive failures (reason: ${reason})`,
          );
        }
      } else {
        // Below threshold — increment failure count but don't mark unhealthy
        // Track consecutive failures without triggering the registry's unhealthy marking
        endpoint.consecutiveFailures = currentFailures;
        endpoint.lastProbeFailure = new Date().toISOString();
      }
    }
  }
}
