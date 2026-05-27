/**
 * Tool Registry - Central registry of available tools and their capabilities
 *
 * Provides tool discovery, health checking, and metadata management.
 */

import { toolEndpoint } from "@shared/ports";

/** Milliseconds before a health-check HTTP request is aborted. */
const HEALTH_CHECK_TIMEOUT_MS = 5000;

/** Milliseconds between automatic health-check cycles. */
const HEALTH_CHECK_INTERVAL_MS = 60000;

/**
 * Tool capability categories
 */
export enum ToolCapability {
  /** Read-only operations (browse, fetch, query) */
  READ = "read",
  /** Execute operations (run commands, calculations) */
  EXECUTE = "execute",
  /** Compute/transform operations (calculate, convert) */
  COMPUTE = "compute",
  /** Write operations (create files, modify data) */
  WRITE = "write",
}

/**
 * Tool status from health check
 */
export enum ToolStatus {
  HEALTHY = "healthy",
  UNHEALTHY = "unhealthy",
  UNKNOWN = "unknown",
}

/**
 * Tool metadata
 */
export interface ToolMetadata {
  /** Unique tool identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Tool description */
  description: string;
  /** Tool version (semantic versioning) */
  version: string;
  /** Tool capabilities */
  capabilities: ToolCapability[];
  /** HTTP endpoint base URL */
  httpEndpoint: string;
  /** MCP server path (if available) */
  mcpServer?: string;
  /** Health check endpoint */
  healthEndpoint: string;
  /** Tool schema endpoint */
  schemaEndpoint: string;
  /** Last health check status */
  status: ToolStatus;
  /** Last health check timestamp */
  lastHealthCheck?: Date;
  /** Health check error message (if unhealthy) */
  healthError?: string;
}

/**
 * Tool schema response
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Tool Registry
 */
export class ToolRegistry {
  private tools: Map<string, ToolMetadata> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  /**
   * Register a tool in the registry
   */
  register(tool: ToolMetadata): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Get tool by ID
   */
  getTool(id: string): ToolMetadata | undefined {
    return this.tools.get(id);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): ToolMetadata[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by capability
   */
  getToolsByCapability(capability: ToolCapability): ToolMetadata[] {
    return this.getAllTools().filter((tool) => tool.capabilities.includes(capability));
  }

  /**
   * Get healthy tools only
   */
  getHealthyTools(): ToolMetadata[] {
    return this.getAllTools().filter((tool) => tool.status === ToolStatus.HEALTHY);
  }

  /**
   * Check health of a single tool
   */
  async checkToolHealth(toolId: string): Promise<{
    success: boolean;
    status: ToolStatus;
    error?: string;
    responseTime?: number;
  }> {
    const tool = this.getTool(toolId);
    if (!tool) {
      return {
        success: false,
        status: ToolStatus.UNKNOWN,
        error: `Tool ${toolId} not found in registry`,
      };
    }

    const startTime = Date.now();
    try {
      const response = await fetch(tool.healthEndpoint, {
        method: "GET",
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS), // 5s timeout
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          status: ToolStatus.UNHEALTHY,
          error: `Health check failed with status ${response.status}`,
          responseTime,
        };
      }

      const data = (await response.json()) as { ok?: boolean; status?: string };
      const isHealthy = data.ok === true || data.status === "ok";

      return {
        success: isHealthy,
        status: isHealthy ? ToolStatus.HEALTHY : ToolStatus.UNHEALTHY,
        responseTime,
      };
    } catch (error) {
      return {
        success: false,
        status: ToolStatus.UNHEALTHY,
        error: error instanceof Error ? error.message : String(error),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Update tool health status
   */
  private updateToolHealth(toolId: string, status: ToolStatus, error?: string): void {
    const tool = this.getTool(toolId);
    if (tool) {
      tool.status = status;
      tool.lastHealthCheck = new Date();
      tool.healthError = error;
      this.tools.set(toolId, tool);
    }
  }

  /**
   * Check health of all registered tools
   */
  async checkAllToolsHealth(): Promise<Map<string, ToolStatus>> {
    const results = new Map<string, ToolStatus>();
    const healthChecks = Array.from(this.tools.keys()).map(async (toolId) => {
      const result = await this.checkToolHealth(toolId);
      results.set(toolId, result.status);
      this.updateToolHealth(toolId, result.status, result.error);
      return { toolId, result };
    });

    await Promise.all(healthChecks);
    return results;
  }

  /**
   * Fetch tool schema from tool endpoint
   */
  async fetchToolSchema(toolId: string): Promise<ToolSchema | null> {
    const tool = this.getTool(toolId);
    if (!tool) {
      return null;
    }

    try {
      const response = await fetch(tool.schemaEndpoint, {
        method: "GET",
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as ToolSchema | null;
    } catch {
      return null;
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthCheckMonitor(intervalMs = HEALTH_CHECK_INTERVAL_MS): void {
    if (this.healthCheckInterval) {
      this.stopHealthCheckMonitor();
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.checkAllToolsHealth();
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopHealthCheckMonitor(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTools: number;
    healthyTools: number;
    unhealthyTools: number;
    unknownTools: number;
    toolsByCapability: Record<ToolCapability, number>;
  } {
    const allTools = this.getAllTools();
    const stats = {
      totalTools: allTools.length,
      healthyTools: allTools.filter((t) => t.status === ToolStatus.HEALTHY).length,
      unhealthyTools: allTools.filter((t) => t.status === ToolStatus.UNHEALTHY).length,
      unknownTools: allTools.filter((t) => t.status === ToolStatus.UNKNOWN).length,
      toolsByCapability: {
        [ToolCapability.READ]: 0,
        [ToolCapability.EXECUTE]: 0,
        [ToolCapability.COMPUTE]: 0,
        [ToolCapability.WRITE]: 0,
      },
    };

    allTools.forEach((tool) => {
      tool.capabilities.forEach((cap) => {
        stats.toolsByCapability[cap]++;
      });
    });

    return stats;
  }
}

/**
 * Default tool registry instance
 */
export const defaultRegistry = new ToolRegistry();

/**
 * Register default tools from the workspace
 */
export function registerDefaultTools(registry: ToolRegistry = defaultRegistry): void {
  // Terminal Tool
  registry.register({
    id: "terminal",
    name: "Terminal",
    description: "Execute shell commands with safety policies",
    version: "1.0.0",
    capabilities: [ToolCapability.EXECUTE, ToolCapability.READ, ToolCapability.WRITE],
    httpEndpoint: toolEndpoint("terminal"),
    healthEndpoint: `${toolEndpoint("terminal")}/health`,
    schemaEndpoint: `${toolEndpoint("terminal")}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // WebBrowser Tool
  registry.register({
    id: "webbrowser",
    name: "WebBrowser",
    description: "Browse web pages with SSRF protection",
    version: "1.0.0",
    capabilities: [ToolCapability.READ],
    httpEndpoint: toolEndpoint("webbrowser"),
    healthEndpoint: `${toolEndpoint("webbrowser")}/health`,
    schemaEndpoint: `${toolEndpoint("webbrowser")}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // Calculator Tool
  registry.register({
    id: "calculator",
    name: "Calculator",
    description: "Evaluate engineering and mathematical expressions",
    version: "1.0.0",
    capabilities: [ToolCapability.COMPUTE],
    httpEndpoint: toolEndpoint("calculator"),
    healthEndpoint: `${toolEndpoint("calculator")}/health`,
    schemaEndpoint: `${toolEndpoint("calculator")}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // DocumentScraper Tool
  registry.register({
    id: "document-scraper",
    name: "DocumentScraper",
    description: "Read and scrape local or remote documents with PDF encryption detection",
    version: "1.0.0",
    capabilities: [ToolCapability.READ],
    httpEndpoint: toolEndpoint("documentscraper"),
    healthEndpoint: `${toolEndpoint("documentscraper")}/health`,
    schemaEndpoint: `${toolEndpoint("documentscraper")}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // Clock Tool
  registry.register({
    id: "clock",
    name: "Clock",
    description: "Get current date and time with timezone support",
    version: "1.0.0",
    capabilities: [ToolCapability.READ],
    httpEndpoint: toolEndpoint("clock"),
    healthEndpoint: `${toolEndpoint("clock")}/health`,
    schemaEndpoint: `${toolEndpoint("clock")}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // Browserless Tool (MCP Cloud)
  const browserlessToken =
    process.env.BROWSERLESS_API_TOKEN || process.env.BROWSERLESS_API_KEY || "";
  const browserlessBaseUrl =
    process.env.BROWSERLESS_MCP_ENDPOINT ?? "https://mcp.browserless.io/mcp";
  const browserlessEndpoint = browserlessToken
    ? `${browserlessBaseUrl}?token=${browserlessToken}`
    : browserlessBaseUrl;
  registry.register({
    id: "browserless",
    name: "Browserless",
    description: "Browser automation with Browserless MCP Cloud API",
    version: "1.0.0",
    capabilities: [ToolCapability.READ, ToolCapability.EXECUTE],
    httpEndpoint: browserlessEndpoint,
    healthEndpoint: browserlessEndpoint, // MCP endpoint health
    schemaEndpoint: browserlessEndpoint, // MCP endpoint schema
    status: ToolStatus.UNKNOWN,
  });

  // AskUser Tool (interview_user)
  registry.register({
    id: "interview_user",
    name: "InterviewUser",
    description:
      "Interactive interview workflow for clarification and user feedback. Purpose: clarification_only. Not for tool-use approval.",
    version: "1.0.0",
    capabilities: [ToolCapability.READ, ToolCapability.EXECUTE],
    httpEndpoint: toolEndpoint("askuser"),
    healthEndpoint: `${toolEndpoint("askuser")}/health`,
    schemaEndpoint: `${toolEndpoint("askuser")}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // RAG Tool
  registry.register({
    id: "rag",
    name: "RAG",
    description: "Persistent knowledge ingestion and retrieval with approval-gated writes",
    version: "1.0.0",
    capabilities: [ToolCapability.READ, ToolCapability.WRITE, ToolCapability.EXECUTE],
    httpEndpoint: toolEndpoint("rag"),
    healthEndpoint: `${toolEndpoint("rag")}/health`,
    schemaEndpoint: `${toolEndpoint("rag")}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });
}
