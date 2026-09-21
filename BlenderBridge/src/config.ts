import { blenderbridgeSchema, getConfig } from "@shared/config";
import { BlenderBridgeConfig } from "./types";

/**
 * BlenderBridge default values, sourced from the unified `@shared/config`
 * schema. Reading defaults through the schema (rather than `getConfig()`)
 * guarantees they are always available even when the current environment
 * carries a BlenderBridge value that the unified loader would reject — in
 * that case BlenderBridge's own `validateConfig()` remains the authority for
 * producing the contract error message.
 */
function loadDefaults(): { host: string; port: number; command: string; args: string } {
  try {
    // Prefer the fully-resolved unified config (honors a config file, if any).
    return getConfig().blenderbridge;
  } catch {
    // Env carries a value the unified loader rejects; use pure schema defaults.
    return blenderbridgeSchema.parse({});
  }
}

/**
 * Loads BlenderBridge configuration.
 *
 * Defaults are sourced from the unified `@shared/config` system, but the
 * BlenderBridge-specific environment variables (`BLENDER_MCP_HOST`,
 * `BLENDER_MCP_PORT`, `BLENDER_MCP_COMMAND`, `BLENDER_MCP_ARGS`) are read
 * directly from `process.env` on every call. This preserves BlenderBridge's
 * own validation contract: values are read fresh (no caching between calls),
 * an empty-string env var falls back to the default, and invalid values are
 * rejected by `validateConfig()` with a message naming both the variable and
 * the offending value.
 *
 * Calls validateConfig() internally before returning.
 */
export function loadConfig(): BlenderBridgeConfig {
  // Unified-config defaults (used when the corresponding env var is unset/empty).
  const defaults = loadDefaults();

  // Empty string → fall back to default (parity with the historical `||` behavior).
  const host = process.env.BLENDER_MCP_HOST || defaults.host;
  const command = process.env.BLENDER_MCP_COMMAND || defaults.command;
  const argsRaw = process.env.BLENDER_MCP_ARGS ?? defaults.args;

  // Port: empty string → default; otherwise coerce the raw value via Number()
  // so non-integers (floats like "1.1") and non-numerics ("abc" → NaN) survive
  // to validateConfig(), which rejects them with the offending value in the message.
  const portRaw = process.env.BLENDER_MCP_PORT;
  const port = portRaw === undefined || portRaw === "" ? defaults.port : Number(portRaw);

  const args = argsRaw.split(/\s+/).filter((s) => s.length > 0);

  const config: BlenderBridgeConfig = {
    blenderMcpHost: host,
    blenderMcpPort: port,
    blenderMcpCommand: command,
    blenderMcpArgs: args,
    threeDToolHost: "http://localhost:3344", // deprecated — unused, retained for interface compat
    healthCheckTimeoutMs: 5000,
    operationTimeoutMs: 30000,
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
