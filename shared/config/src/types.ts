/**
 * Shared types for the unified configuration system.
 *
 * @module @shared/config/types
 */

import type { Config } from "./schema";

/** Error details for a single validation failure */
export interface ConfigValidationIssue {
  /** Full dotted path to the invalid entry (e.g., "terminal.defaultTimeoutMs") */
  path: string;
  /** Expected type or constraint description */
  expected: string;
  /** Actual value received */
  received: unknown;
}

/** Error thrown when the config file cannot be parsed (syntax errors) */
export class ConfigParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly location: string,
    message: string,
  ) {
    super(`Failed to parse ${filePath}: ${message} at ${location}`);
    this.name = "ConfigParseError";
  }
}

/** Error thrown when config validation fails */
export class ConfigValidationError extends Error {
  constructor(public readonly issues: ConfigValidationIssue[]) {
    const details = issues
      .map((i) => `  - ${i.path}: expected ${i.expected}, got ${JSON.stringify(i.received)}`)
      .join("\n");
    super(`Config validation failed:\n${details}`);
    this.name = "ConfigValidationError";
  }
}

/** Error thrown when the specified config file is not found */
export class ConfigFileNotFoundError extends Error {
  constructor(public readonly filePath: string) {
    super(`Config file not found at: ${filePath}`);
    this.name = "ConfigFileNotFoundError";
  }
}

/** Options for the config loader */
export interface ConfigLoaderOptions {
  /** Override the config file path (bypasses LLM_TOOLKIT_CONFIG and default detection) */
  configPath?: string;
  /** Override the repository root for default file detection */
  repoRoot?: string;
  /** Override environment variables (useful for testing). If provided, used instead of process.env. */
  envOverrides?: Record<string, string | undefined>;
}

/** Public interface for the config loader */
export interface IConfigLoader {
  /** Returns cached config, performing lazy load on first call */
  getConfig(): Config;
  /** Invalidates cache, re-reads all sources, re-validates */
  reloadConfig(): Config;
  /** Returns config with sensitive values redacted (for logging) */
  getRedactedConfig(): Record<string, unknown>;
}
