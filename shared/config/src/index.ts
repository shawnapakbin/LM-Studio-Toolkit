/**
 * @shared/config - Unified Configuration System for LLM Toolkit
 *
 * Provides a single schema-validated configuration source for all 19+ tool servers.
 * Replaces fragmented .env files, hard-coded defaults, and per-tool env blocks.
 *
 * @example
 * ```typescript
 * import { getConfig } from "@shared/config";
 *
 * const config = getConfig();
 * const timeout = config.terminal.defaultTimeoutMs; // fully typed
 * ```
 *
 * @module @shared/config
 */

// Schema and types
export { configSchema, type Config } from "./schema";
export {
  globalSchema,
  terminalSchema,
  webbrowserSchema,
  calculatorSchema,
  documentscraperSchema,
  clockSchema,
  browserlessSchema,
  askuserSchema,
  ragSchema,
  pythonshellSchema,
  memorySchema,
  skillsSchema,
  cliSchema,
  slashcommandsSchema,
  csvexporterSchema,
  fileeditorSchema,
  gitSchema,
  packagemanagerSchema,
  observabilitySchema,
  agentrunnerSchema,
  blenderbridgeSchema,
  threedtoolSchema,
  subagentSchema,
  lansubagentSchema,
} from "./schema";
export { schemaMeta, type SchemaMetaEntry } from "./schema-meta";
export {
  type ConfigValidationIssue,
  type ConfigLoaderOptions,
  type IConfigLoader,
  ConfigParseError,
  ConfigValidationError,
  ConfigFileNotFoundError,
} from "./types";

// Loader
export {
  getConfig,
  reloadConfig,
  getRedactedConfig,
  createConfigLoader,
  resolveConfigFile,
  _resetConfigCache,
} from "./loader";

// Redaction
export { redactConfig, REDACTED_PLACEHOLDER } from "./redact";

// Migration
export { migrateConfig, type MigrateOptions } from "./migrate";

// Generation
export { generateConfigFile, type GenerateOptions } from "./generate";

// .env Fallback
export { readEnvFallback } from "./env-fallback";
