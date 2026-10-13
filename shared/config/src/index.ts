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

// .env Fallback
export { readEnvFallback } from "./env-fallback";
// Generation
export { type GenerateOptions, generateConfigFile } from "./generate";
// Loader
export {
  _resetConfigCache,
  createConfigLoader,
  getConfig,
  getRedactedConfig,
  reloadConfig,
  resolveConfigFile,
} from "./loader";
// Migration
export { type MigrateOptions, migrateConfig } from "./migrate";
// Redaction
export { REDACTED_PLACEHOLDER, redactConfig } from "./redact";
// Schema and types
export {
  agentrunnerSchema,
  askuserSchema,
  blenderbridgeSchema,
  browserlessSchema,
  type Config,
  calculatorSchema,
  cliSchema,
  clockSchema,
  configSchema,
  documentscraperSchema,
  gitSchema,
  globalSchema,
  lansubagentSchema,
  memorySchema,
  observabilitySchema,
  pythonshellSchema,
  skillsSchema,
  slashcommandsSchema,
  subagentSchema,
  terminalSchema,
  threedtoolSchema,
  webbrowserSchema,
} from "./schema";
export { type SchemaMetaEntry, schemaMeta } from "./schema-meta";
export {
  ConfigFileNotFoundError,
  type ConfigLoaderOptions,
  ConfigParseError,
  ConfigValidationError,
  type ConfigValidationIssue,
  type IConfigLoader,
} from "./types";
