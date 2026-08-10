/**
 * MCP Server entry point for the LAN Sub Agent.
 * Registers four MCP tools: dispatch_lan_tasks, get_lan_status,
 * discover_endpoints, and get_lan_telemetry.
 * Wires all components and handles graceful shutdown.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 9.3
 *
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 1.0.0
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { LanSubAgentConfig } from "./config-schema";
import { ConfigWatcher } from "./config-watcher";
import { DiscoveryService, createDiscoveryConfig } from "./discovery-service";
import { EndpointRegistry } from "./endpoint-registry";
import { GuiServer } from "./gui/gui-server";
import { HealthChecker, HealthCheckerConfig } from "./health-checker";
import { LanDispatcher } from "./lan-dispatcher";
import { LanTelemetryTracker } from "./lan-telemetry";
import { LoadBalancer, LoadBalancerConfig } from "./load-balancer";
import { logger } from "./logger";

// ─── Tool Schemas ────────────────────────────────────────────────────────────

export const DispatchLanTasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        taskId: z.string().describe("Unique identifier for the task"),
        prompt: z.string().describe("The prompt to send to the LLM"),
        systemPrompt: z.string().optional().describe("Optional system prompt"),
      }),
    )
    .min(1)
    .describe("Array of tasks to dispatch"),
  model: z
    .string()
    .optional()
    .describe("Model requirement — only dispatch to endpoints advertising this model"),
  systemPrompt: z.string().optional().describe("Default system prompt applied to all tasks"),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max concurrent tasks (default 5)"),
});

export const GetLanStatusSchema = z.object({});

export const DiscoverEndpointsSchema = z.object({});

export const GetLanTelemetrySchema = z.object({
  endpointId: z.string().optional().describe("Filter by specific endpoint"),
  since: z.string().optional().describe("ISO timestamp to filter metrics from"),
});

// ─── Default Config Path ─────────────────────────────────────────────────────

const CONFIG_PATH = process.env.LAN_SUBAGENT_CONFIG_PATH || "./lan-subagent-config.json";

// ─── MCP Server Factory ──────────────────────────────────────────────────────

export interface McpServerComponents {
  server: McpServer;
  configWatcher: ConfigWatcher;
  registry: EndpointRegistry;
  healthChecker: HealthChecker;
  loadBalancer: LoadBalancer;
  discoveryService: DiscoveryService;
  dispatcher: LanDispatcher;
  telemetry: LanTelemetryTracker;
  guiServer: GuiServer;
}

/**
 * Create and wire all components, returning the MCP server and
 * references for lifecycle management.
 */
export async function createLanMcpServer(configPath?: string): Promise<McpServerComponents> {
  const resolvedConfigPath = configPath ?? CONFIG_PATH;

  // ─── Step 1: Load Configuration ──────────────────────────────────────────
  const configWatcher = new ConfigWatcher(resolvedConfigPath, logger);
  const config = await configWatcher.loadOrCreate();

  // ─── Step 2: Create Endpoint Registry ────────────────────────────────────
  const registry = new EndpointRegistry(config.endpoints);

  // ─── Step 3: Create Health Checker ───────────────────────────────────────
  const healthCheckerConfig: HealthCheckerConfig = {
    intervalMs: config.healthCheck.intervalSeconds * 1000,
    timeoutMs: config.healthCheck.timeoutMs,
    failureThreshold: config.healthCheck.failureThreshold,
  };
  const healthChecker = new HealthChecker(registry, healthCheckerConfig, logger);

  // ─── Step 4: Create Load Balancer ────────────────────────────────────────
  const localHost = process.env.SUBAGENT_LOCAL_HOST || config.localInstance.host;
  const localPort = parseInt(
    process.env.SUBAGENT_LOCAL_PORT || String(config.localInstance.port),
    10,
  );

  const loadBalancerConfig: LoadBalancerConfig = {
    strategy: config.loadBalancer.strategy,
    retryLimit: config.loadBalancer.retryLimit,
    localHost,
    localPort,
  };
  const loadBalancer = new LoadBalancer(registry, loadBalancerConfig, logger);

  // ─── Step 5: Create Discovery Service ────────────────────────────────────
  const discoveryConfig = createDiscoveryConfig(config.discovery);
  const discoveryService = new DiscoveryService(registry, discoveryConfig, logger);

  // ─── Step 6: Create Telemetry Tracker ────────────────────────────────────
  const telemetry = new LanTelemetryTracker();

  // ─── Step 7: Create LAN Dispatcher ───────────────────────────────────────
  const dispatcher = new LanDispatcher({
    registry,
    loadBalancer,
    healthChecker,
    telemetry,
    logger,
  });

  // ─── Step 8: Create GUI Server ───────────────────────────────────────────
  const guiServer = new GuiServer({
    config: { port: config.gui.port, enabled: config.gui.enabled },
    configWatcher,
    healthChecker,
    registry,
    logger,
  });

  // ─── Step 9: Create MCP Server and Register Tools ────────────────────────
  const server = new McpServer({
    name: "lan-sub-agent",
    version: "1.0.0",
  });

  // --- dispatch_lan_tasks (Req 5.1, 5.5, 5.6, 5.7, 5.8) ---
  server.registerTool(
    "dispatch_lan_tasks",
    {
      description: "Dispatch tasks to LAN LM Studio endpoints for parallel inference",
      inputSchema: {
        tasks: z
          .array(
            z.object({
              taskId: z.string().describe("Unique identifier for the task"),
              prompt: z.string().describe("The prompt to send to the LLM"),
              systemPrompt: z.string().optional().describe("Optional system prompt"),
            }),
          )
          .min(1)
          .describe("Array of tasks to dispatch"),
        model: z
          .string()
          .optional()
          .describe("Model requirement — only dispatch to endpoints advertising this model"),
        systemPrompt: z.string().optional().describe("Default system prompt applied to all tasks"),
        concurrency: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Max concurrent tasks (default 5)"),
      } as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => {
      try {
        const result = await dispatcher.dispatch(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }) as any,
  );

  // --- get_lan_status (Req 5.2) ---
  server.registerTool(
    "get_lan_status",
    {
      description: "Get health status, active tasks, and model list for all LAN endpoints",
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async () => {
      const endpoints = registry.getEndpoints();
      const status = endpoints.map((ep) => ({
        id: ep.definition.id,
        host: ep.definition.host,
        port: ep.definition.port,
        models: ep.definition.models,
        health: ep.health,
        enabled: ep.definition.enabled,
        activeTaskCount: ep.activeTaskCount,
        maxConcurrency: ep.definition.maxConcurrency,
        source: ep.definition.source,
        lastProbeSuccess: ep.lastProbeSuccess,
        lastProbeFailure: ep.lastProbeFailure,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
      };
    }) as any,
  );

  // --- discover_endpoints (Req 5.3, 5.4) ---
  server.registerTool(
    "discover_endpoints",
    {
      description: "Trigger an immediate LAN discovery scan and return newly found endpoints",
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async () => {
      if (!config.discovery.enabled) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "Discovery mode is not enabled. Enable it in the configuration to use this tool.",
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        const discovered = await discoveryService.scanOnce();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ discovered, count: discovered.length }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      }
    }) as any,
  );

  // --- get_lan_telemetry (Req 9.3) ---
  server.registerTool(
    "get_lan_telemetry",
    {
      description: "Get aggregated per-endpoint performance metrics",
      inputSchema: {
        endpointId: z.string().optional().describe("Filter by specific endpoint"),
        since: z.string().optional().describe("ISO timestamp to filter metrics from"),
      } as any,
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK registerTool generic causes deep type instantiation
    (async (args: any) => {
      const metrics = telemetry.getEndpointMetrics();
      let filtered = metrics;

      // Filter by endpointId if specified
      if (args.endpointId) {
        filtered = filtered.filter((m) => m.endpointId === args.endpointId);
      }

      // Filter by since timestamp if specified
      if (args.since) {
        const sinceDate = new Date(args.since).getTime();
        if (!isNaN(sinceDate)) {
          filtered = filtered.filter((m) => {
            if (!m.lastRequestAt) return false;
            return new Date(m.lastRequestAt).getTime() >= sinceDate;
          });
        }
      }

      const summary = telemetry.computeLanSummary();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                endpoints: filtered,
                summary: {
                  totalTasks: summary.totalTasks,
                  totalFailures: summary.totalFailures,
                  totalDurationMs: summary.totalDurationMs,
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }) as any,
  );

  // ─── Step 10: Set Up Hot-Reload ──────────────────────────────────────────
  configWatcher.startWatching((newConfig: LanSubAgentConfig) => {
    logger.info("Configuration changed — applying hot-reload");

    // Update registry with new endpoint list
    registry.reloadManualEndpoints(newConfig.endpoints);

    // Update load balancer strategy
    loadBalancer.setStrategy(newConfig.loadBalancer.strategy);

    // Update health checker if config changed
    const newHcConfig: HealthCheckerConfig = {
      intervalMs: newConfig.healthCheck.intervalSeconds * 1000,
      timeoutMs: newConfig.healthCheck.timeoutMs,
      failureThreshold: newConfig.healthCheck.failureThreshold,
    };
    const currentHcConfig = healthCheckerConfig;
    if (
      newHcConfig.intervalMs !== currentHcConfig.intervalMs ||
      newHcConfig.timeoutMs !== currentHcConfig.timeoutMs ||
      newHcConfig.failureThreshold !== currentHcConfig.failureThreshold
    ) {
      healthChecker.stop();
      Object.assign(healthCheckerConfig, newHcConfig);
      healthChecker.start();
      logger.info("Health checker restarted with new configuration");
    }

    logger.info("Hot-reload complete");
  });

  return {
    server,
    configWatcher,
    registry,
    healthChecker,
    loadBalancer,
    discoveryService,
    dispatcher,
    telemetry,
    guiServer,
  };
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function gracefulShutdown(components: McpServerComponents): Promise<void> {
  logger.info("Graceful shutdown initiated");

  components.configWatcher.stopWatching();
  components.healthChecker.stop();
  components.discoveryService.stop();
  await components.guiServer.stop();

  logger.info("All components shut down cleanly");
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("LAN Sub Agent MCP server starting...");

  const components = await createLanMcpServer();

  // Start background services
  components.healthChecker.start();
  components.discoveryService.start();
  await components.guiServer.start();

  // Connect MCP server via stdio transport
  const transport = new StdioServerTransport();
  await components.server.connect(transport);

  logger.info("LAN Sub Agent MCP server running on stdio");

  // Handle graceful shutdown signals
  const shutdown = async () => {
    await gracefulShutdown(components);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(`LAN Sub Agent MCP server startup failed: ${error}`);
    process.exit(1);
  });
}
