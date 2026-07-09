/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import "dotenv/config";
import { BlenderBridgeConfig } from "./types";

/**
 * Loads BlenderBridge configuration from environment variables with defaults.
 * Calls validateConfig() internally before returning.
 *
 * Environment variables:
 * - BLENDER_MCP_HOST: default "127.0.0.1"
 * - BLENDER_MCP_PORT: default "9876", integer 1-65535
 * - BLENDER_MCP_COMMAND: default "blender-mcp"
 * - BLENDER_MCP_ARGS: default "", whitespace-separated, max 1024 chars total
 * - BLENDER_RENDER_TIMEOUT_MS: default "90000", timeout for render operations
 * - BLENDER_EXPORT_TIMEOUT_MS: default "90000", timeout for export operations
 */
export function loadConfig(): BlenderBridgeConfig {
  const host = process.env.BLENDER_MCP_HOST || "127.0.0.1";
  const portStr = process.env.BLENDER_MCP_PORT || "9876";
  const command = process.env.BLENDER_MCP_COMMAND || "blender-mcp";
  const argsRaw = process.env.BLENDER_MCP_ARGS || "";
  const renderTimeoutStr = process.env.BLENDER_RENDER_TIMEOUT_MS || "90000";
  const exportTimeoutStr = process.env.BLENDER_EXPORT_TIMEOUT_MS || "90000";

  const port = Number(portStr);
  const renderTimeoutMs = Number(renderTimeoutStr);
  const exportTimeoutMs = Number(exportTimeoutStr);

  const args = argsRaw.split(/\s+/).filter((s) => s.length > 0);

  const config: BlenderBridgeConfig = {
    blenderMcpHost: host,
    blenderMcpPort: port,
    blenderMcpCommand: command,
    blenderMcpArgs: args,
    healthCheckTimeoutMs: 5000,
    operationTimeoutMs: 30000,
    renderTimeoutMs,
    exportTimeoutMs,
  };

  validateConfig(config);

  return config;
}

/**
 * Validates a BlenderBridge configuration.
 * Throws an error when:
 * - port is not an integer in range 1-65535
 * - host is empty string
 * - args exceed 1024 chars combined
 *
 * Error messages are produced unconditionally via direct stderr writes
 * (not logger calls), ensuring they are visible even during early
 * initialization before logging subsystems are available.
 *
 * Error messages include BOTH the variable name AND the invalid value.
 */
export function validateConfig(config: BlenderBridgeConfig): void {
  if (
    !Number.isInteger(config.blenderMcpPort) ||
    config.blenderMcpPort < 1 ||
    config.blenderMcpPort > 65535
  ) {
    const message = `Invalid configuration: BLENDER_MCP_PORT must be an integer between 1 and 65535, got "${config.blenderMcpPort}"`;
    process.stderr.write(message + "\n");
    throw new Error(message);
  }

  if (config.blenderMcpHost.length === 0) {
    const message = `Invalid configuration: BLENDER_MCP_HOST must not be empty, got ""`;
    process.stderr.write(message + "\n");
    throw new Error(message);
  }

  const argsLength = config.blenderMcpArgs.join(" ").length;
  if (argsLength > 1024) {
    const message = `Invalid configuration: BLENDER_MCP_ARGS must not exceed 1024 characters, got length ${argsLength}`;
    process.stderr.write(message + "\n");
    throw new Error(message);
  }
}
