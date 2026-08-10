/**
 * GuiServer — HTTP REST API for the LAN Sub Agent configuration GUI.
 * Serves static files and provides CRUD endpoints for managing
 * LAN endpoints, discovery, and health status.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { LanSubAgentConfig } from "../config-schema";
import { ConfigWatcher } from "../config-watcher";
import { EndpointRegistry } from "../endpoint-registry";
import { HealthChecker } from "../health-checker";
import { Logger, logger as defaultLogger } from "../logger";
import { EndpointDefinition } from "../types";

// ─── Config Interface ────────────────────────────────────────────────────────

export interface GuiServerConfig {
  port: number; // default 9847
  enabled: boolean;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate endpoint input from the GUI (stricter than general endpoint validation).
 * Requirements 7.2, 7.6: non-empty host, port 1-65535, at least 1 model, maxConcurrency 1-32
 */
export function validateEndpointInput(input: unknown): {
  valid: boolean;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "Request body must be an object" }] };
  }

  const data = input as Record<string, unknown>;

  // host: non-empty string
  if (typeof data.host !== "string" || data.host.trim().length === 0) {
    errors.push({ field: "host", message: "host must be a non-empty string" });
  }

  // port: integer 1-65535
  if (
    typeof data.port !== "number" ||
    !Number.isInteger(data.port) ||
    data.port < 1 ||
    data.port > 65535
  ) {
    errors.push({ field: "port", message: "port must be an integer between 1 and 65535" });
  }

  // models: at least 1 model
  if (!Array.isArray(data.models) || data.models.length < 1) {
    errors.push({ field: "models", message: "at least one model is required" });
  } else {
    for (let i = 0; i < data.models.length; i++) {
      const m = data.models[i];
      if (typeof m !== "string" || m.trim().length === 0 || m.length > 200) {
        errors.push({
          field: `models[${i}]`,
          message: "each model must be a non-empty string (max 200 chars)",
        });
        break;
      }
    }
  }

  // maxConcurrency: integer 1-32
  if (
    typeof data.maxConcurrency !== "number" ||
    !Number.isInteger(data.maxConcurrency) ||
    data.maxConcurrency < 1 ||
    data.maxConcurrency > 32
  ) {
    errors.push({
      field: "maxConcurrency",
      message: "maxConcurrency must be an integer between 1 and 32",
    });
  }

  return { valid: errors.length === 0, errors };
}

// ─── GuiServer ───────────────────────────────────────────────────────────────

export class GuiServer {
  private server: http.Server | null = null;
  private config: GuiServerConfig;
  private configWatcher: ConfigWatcher;
  private _healthChecker: HealthChecker;
  private registry: EndpointRegistry;
  private logger: Logger;

  constructor(deps: {
    config: GuiServerConfig;
    configWatcher: ConfigWatcher;
    healthChecker: HealthChecker;
    registry: EndpointRegistry;
    logger?: Logger;
  }) {
    this.config = deps.config;
    this.configWatcher = deps.configWatcher;
    this._healthChecker = deps.healthChecker;
    this.registry = deps.registry;
    this.logger = deps.logger ?? defaultLogger;
  }

  /**
   * Start the HTTP server if enabled.
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info("GUI server disabled via config");
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err) => {
        this.logger.error(`GUI server error: ${err.message}`);
        reject(err);
      });

      this.server.listen(this.config.port, () => {
        this.logger.info(`GUI server listening on http://localhost:${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.logger.info("GUI server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ─── Request Router ──────────────────────────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // CORS headers for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Route API requests
    if (url.startsWith("/api/")) {
      this.routeApi(method, url, req, res);
      return;
    }

    // Serve static files
    this.serveStatic(url, res);
  }

  private routeApi(
    method: string,
    url: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // GET /api/endpoints
    if (method === "GET" && url === "/api/endpoints") {
      this.handleGetEndpoints(res);
      return;
    }

    // POST /api/endpoints
    if (method === "POST" && url === "/api/endpoints") {
      this.readBody(req, (body) => this.handleAddEndpoint(body, res));
      return;
    }

    // PUT /api/endpoints/:id
    const putMatch = url.match(/^\/api\/endpoints\/([^/]+)$/);
    if (method === "PUT" && putMatch) {
      this.readBody(req, (body) => this.handleUpdateEndpoint(putMatch[1], body, res));
      return;
    }

    // DELETE /api/endpoints/:id
    const deleteMatch = url.match(/^\/api\/endpoints\/([^/]+)$/);
    if (method === "DELETE" && deleteMatch) {
      this.handleDeleteEndpoint(deleteMatch[1], res);
      return;
    }

    // POST /api/endpoints/:id/test
    const testMatch = url.match(/^\/api\/endpoints\/([^/]+)\/test$/);
    if (method === "POST" && testMatch) {
      this.handleTestEndpoint(testMatch[1], res);
      return;
    }

    // GET /api/discovery/status
    if (method === "GET" && url === "/api/discovery/status") {
      this.handleGetDiscoveryStatus(res);
      return;
    }

    // POST /api/discovery/toggle
    if (method === "POST" && url === "/api/discovery/toggle") {
      this.readBody(req, (body) => this.handleToggleDiscovery(body, res));
      return;
    }

    // GET /api/health
    if (method === "GET" && url === "/api/health") {
      this.handleGetHealth(res);
      return;
    }

    // 404 for unknown API routes
    this.sendJson(res, 404, { error: "Not found" });
  }

  // ─── API Handlers ────────────────────────────────────────────────────────────

  /**
   * GET /api/endpoints — list all endpoints with health (Req 7.1)
   */
  private handleGetEndpoints(res: http.ServerResponse): void {
    const endpoints = this.registry.getEndpoints();
    const result = endpoints.map((ep) => ({
      ...ep.definition,
      health: ep.health,
      activeTaskCount: ep.activeTaskCount,
      lastProbeSuccess: ep.lastProbeSuccess,
      lastProbeFailure: ep.lastProbeFailure,
    }));
    this.sendJson(res, 200, result);
  }

  /**
   * POST /api/endpoints — add a new endpoint (Req 7.2, 7.6, 7.7, 7.8)
   */
  private handleAddEndpoint(body: unknown, res: http.ServerResponse): void {
    const validation = validateEndpointInput(body);
    if (!validation.valid) {
      this.sendJson(res, 400, { error: "Validation failed", details: validation.errors });
      return;
    }

    const data = body as Record<string, unknown>;
    const id =
      (data.id as string) || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const endpoint: EndpointDefinition = {
      id,
      host: (data.host as string).trim(),
      port: data.port as number,
      models: data.models as string[],
      maxConcurrency: data.maxConcurrency as number,
      enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
      source: "manual",
    };

    // Persist to config (Req 7.7)
    this.persistEndpointChange((config) => {
      config.endpoints.push(endpoint);
      return config;
    })
      .then(() => {
        // Reload registry after config write
        const config = this.configWatcher.getLastConfig();
        this.registry.reloadManualEndpoints(config.endpoints);
        this.sendJson(res, 201, endpoint);
      })
      .catch((err) => {
        // Req 7.8: return error to client, retain in-memory state
        this.logger.error(`Failed to persist new endpoint: ${err.message}`);
        this.sendJson(res, 500, { error: "Failed to persist configuration", detail: err.message });
      });
  }

  /**
   * PUT /api/endpoints/:id — update an endpoint (Req 7.3, 7.6, 7.7, 7.8)
   */
  private handleUpdateEndpoint(id: string, body: unknown, res: http.ServerResponse): void {
    const existing = this.registry.getEndpoint(id);
    if (!existing) {
      this.sendJson(res, 404, { error: `Endpoint "${id}" not found` });
      return;
    }

    const validation = validateEndpointInput(body);
    if (!validation.valid) {
      this.sendJson(res, 400, { error: "Validation failed", details: validation.errors });
      return;
    }

    const data = body as Record<string, unknown>;
    const updated: EndpointDefinition = {
      id,
      host: (data.host as string).trim(),
      port: data.port as number,
      models: data.models as string[],
      maxConcurrency: data.maxConcurrency as number,
      enabled: data.enabled !== undefined ? Boolean(data.enabled) : existing.definition.enabled,
      source: existing.definition.source,
    };

    // Persist (Req 7.7)
    this.persistEndpointChange((config) => {
      const idx = config.endpoints.findIndex((ep) => ep.id === id);
      if (idx >= 0) {
        config.endpoints[idx] = updated;
      } else {
        config.endpoints.push(updated);
      }
      return config;
    })
      .then(() => {
        const config = this.configWatcher.getLastConfig();
        this.registry.reloadManualEndpoints(config.endpoints);
        this.sendJson(res, 200, updated);
      })
      .catch((err) => {
        this.logger.error(`Failed to persist endpoint update: ${err.message}`);
        this.sendJson(res, 500, { error: "Failed to persist configuration", detail: err.message });
      });
  }

  /**
   * DELETE /api/endpoints/:id — delete an endpoint (Req 7.4, 7.7, 7.8)
   */
  private handleDeleteEndpoint(id: string, res: http.ServerResponse): void {
    const existing = this.registry.getEndpoint(id);
    if (!existing) {
      this.sendJson(res, 404, { error: `Endpoint "${id}" not found` });
      return;
    }

    this.persistEndpointChange((config) => {
      config.endpoints = config.endpoints.filter((ep) => ep.id !== id);
      return config;
    })
      .then(() => {
        const config = this.configWatcher.getLastConfig();
        this.registry.reloadManualEndpoints(config.endpoints);
        this.sendJson(res, 200, { deleted: id });
      })
      .catch((err) => {
        this.logger.error(`Failed to persist endpoint deletion: ${err.message}`);
        this.sendJson(res, 500, { error: "Failed to persist configuration", detail: err.message });
      });
  }

  /**
   * POST /api/endpoints/:id/test — test connectivity to an endpoint (Req 7.5)
   * Reaches endpoint at /v1/models with 10s timeout.
   */
  private handleTestEndpoint(id: string, res: http.ServerResponse): void {
    const existing = this.registry.getEndpoint(id);
    if (!existing) {
      this.sendJson(res, 404, { error: `Endpoint "${id}" not found` });
      return;
    }

    const { host, port } = existing.definition;
    const url = `http://${host}:${port}/v1/models`;
    const timeoutMs = 10000;
    let responded = false;

    const sendOnce = (statusCode: number, body: unknown) => {
      if (!responded) {
        responded = true;
        this.sendJson(res, statusCode, body);
      }
    };

    const req = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode >= 200 && statusCode < 300) {
          let models: unknown = null;
          try {
            models = JSON.parse(body);
          } catch {
            // Response isn't JSON, that's okay
          }
          sendOnce(200, { success: true, statusCode, models });
        } else {
          sendOnce(200, { success: false, statusCode, reason: `HTTP ${statusCode}` });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      sendOnce(200, { success: false, reason: "Connection timed out (10s)" });
    });

    req.on("error", (err: NodeJS.ErrnoException) => {
      const reason =
        err.code === "ECONNREFUSED" ? "Connection refused" : err.message || "Unknown error";
      sendOnce(200, { success: false, reason });
    });
  }

  /**
   * GET /api/discovery/status — get discovery mode status (Req 7.9)
   */
  private handleGetDiscoveryStatus(res: http.ServerResponse): void {
    const config = this.configWatcher.getLastConfig();
    this.sendJson(res, 200, {
      enabled: config.discovery.enabled,
      intervalSeconds: config.discovery.intervalSeconds,
      broadcastPort: config.discovery.broadcastPort,
      maxDiscovered: config.discovery.maxDiscovered,
      currentDiscovered: this.registry.getDiscoveredCount(),
    });
  }

  /**
   * POST /api/discovery/toggle — enable/disable discovery (Req 7.9)
   */
  private handleToggleDiscovery(body: unknown, res: http.ServerResponse): void {
    const data = body as Record<string, unknown> | null;
    const config = this.configWatcher.getLastConfig();

    // If body has explicit "enabled" field, use it; otherwise toggle
    let newEnabled: boolean;
    if (data && typeof data.enabled === "boolean") {
      newEnabled = data.enabled;
    } else {
      newEnabled = !config.discovery.enabled;
    }

    const updatedConfig: LanSubAgentConfig = {
      ...config,
      discovery: {
        ...config.discovery,
        enabled: newEnabled,
      },
    };

    this.configWatcher
      .writeConfig(updatedConfig)
      .then(() => {
        this.sendJson(res, 200, { enabled: newEnabled });
      })
      .catch((err) => {
        this.logger.error(`Failed to toggle discovery: ${err.message}`);
        this.sendJson(res, 500, { error: "Failed to persist configuration", detail: err.message });
      });
  }

  /**
   * GET /api/health — get all endpoint health statuses (Req 7.1)
   */
  private handleGetHealth(res: http.ServerResponse): void {
    const endpoints = this.registry.getEndpoints();
    const result = endpoints.map((ep) => ({
      id: ep.definition.id,
      host: ep.definition.host,
      port: ep.definition.port,
      health: ep.health,
      lastProbeSuccess: ep.lastProbeSuccess,
      lastProbeFailure: ep.lastProbeFailure,
      consecutiveFailures: ep.consecutiveFailures,
      activeTaskCount: ep.activeTaskCount,
    }));
    this.sendJson(res, 200, result);
  }

  // ─── Utility Methods ─────────────────────────────────────────────────────────

  /**
   * Read JSON body from request.
   */
  private readBody(req: http.IncomingMessage, callback: (body: unknown) => void): void {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        const parsed = data.length > 0 ? JSON.parse(data) : {};
        callback(parsed);
      } catch {
        callback(null);
      }
    });
  }

  /**
   * Send a JSON response.
   */
  private sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  /**
   * Apply an endpoint change to the config and persist via ConfigWatcher.
   * On failure, the error propagates (Req 7.8).
   */
  private async persistEndpointChange(
    mutator: (config: LanSubAgentConfig) => LanSubAgentConfig,
  ): Promise<void> {
    const currentConfig = this.configWatcher.getLastConfig();
    const updatedConfig = mutator({ ...currentConfig, endpoints: [...currentConfig.endpoints] });
    await this.configWatcher.writeConfig(updatedConfig);
  }

  /**
   * Serve static files from the public directory.
   */
  private serveStatic(urlPath: string, res: http.ServerResponse): void {
    const publicDir = path.join(__dirname, "public");
    let filePath = path.join(publicDir, urlPath === "/" ? "index.html" : urlPath);

    // Prevent directory traversal
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
    };

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      res.end(data);
    });
  }
}
