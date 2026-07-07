/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Tool Registry - Central registry of available tools and their capabilities
 *
 * Provides tool discovery, health checking, and metadata management.
 */

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
        signal: AbortSignal.timeout(5000), // 5s timeout
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
        signal: AbortSignal.timeout(5000),
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
  startHealthCheckMonitor(intervalMs = 60000): void {
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
  const basePort = Number(process.env.BASE_PORT) || 3330;

  // Terminal Tool
  registry.register({
    id: "terminal",
    name: "Terminal",
    description: "Execute shell commands with safety policies",
    version: "1.0.0",
    capabilities: [ToolCapability.EXECUTE, ToolCapability.READ, ToolCapability.WRITE],
    httpEndpoint: `http://localhost:${basePort}`,
    healthEndpoint: `http://localhost:${basePort}/health`,
    schemaEndpoint: `http://localhost:${basePort}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // WebBrowser Tool
  registry.register({
    id: "webbrowser",
    name: "WebBrowser",
    description: "Browse web pages with SSRF protection",
    version: "1.0.0",
    capabilities: [ToolCapability.READ],
    httpEndpoint: `http://localhost:${basePort + 4}`,
    healthEndpoint: `http://localhost:${basePort + 4}/health`,
    schemaEndpoint: `http://localhost:${basePort + 4}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // Calculator Tool
  registry.register({
    id: "calculator",
    name: "Calculator",
    description: "Evaluate engineering and mathematical expressions",
    version: "1.0.0",
    capabilities: [ToolCapability.COMPUTE],
    httpEndpoint: `http://localhost:${basePort + 5}`,
    healthEndpoint: `http://localhost:${basePort + 5}/health`,
    schemaEndpoint: `http://localhost:${basePort + 5}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // DocumentScraper Tool
  registry.register({
    id: "document-scraper",
    name: "DocumentScraper",
    description: "Read and scrape local or remote documents with PDF encryption detection",
    version: "1.0.0",
    capabilities: [ToolCapability.READ],
    httpEndpoint: `http://localhost:${basePort + 6}`,
    healthEndpoint: `http://localhost:${basePort + 6}/health`,
    schemaEndpoint: `http://localhost:${basePort + 6}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // Clock Tool
  registry.register({
    id: "clock",
    name: "Clock",
    description: "Get current date and time with timezone support",
    version: "1.0.0",
    capabilities: [ToolCapability.READ],
    httpEndpoint: `http://localhost:${basePort + 7}`,
    healthEndpoint: `http://localhost:${basePort + 7}/health`,
    schemaEndpoint: `http://localhost:${basePort + 7}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // Browserless Tool (MCP Cloud)
  const browserlessToken =
    process.env.BROWSERLESS_API_TOKEN || process.env.BROWSERLESS_API_KEY || "";
  const browserlessBaseUrl = "https://mcp.browserless.io/mcp";
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

  // AskUser Tool
  registry.register({
    id: "ask-user",
    name: "AskUser",
    description: "Interactive user interview workflow for planning and clarification",
    version: "1.0.0",
    capabilities: [ToolCapability.READ, ToolCapability.EXECUTE],
    httpEndpoint: `http://localhost:${basePort + 8}`,
    healthEndpoint: `http://localhost:${basePort + 8}/health`,
    schemaEndpoint: `http://localhost:${basePort + 8}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });

  // RAG Tool
  registry.register({
    id: "rag",
    name: "RAG",
    description: "Persistent knowledge ingestion and retrieval with approval-gated writes",
    version: "1.0.0",
    capabilities: [ToolCapability.READ, ToolCapability.WRITE, ToolCapability.EXECUTE],
    httpEndpoint: `http://localhost:${basePort + 9}`,
    healthEndpoint: `http://localhost:${basePort + 9}/health`,
    schemaEndpoint: `http://localhost:${basePort + 9}/tool-schema`,
    status: ToolStatus.UNKNOWN,
  });
}
