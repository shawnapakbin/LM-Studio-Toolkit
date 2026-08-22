/**
 * Config Schema - Single source of truth for all configuration structure,
 * types, defaults, and constraints.
 *
 * Defines typed entries for every Tool_Server environment variable including
 * timeouts, paths, ports, API keys, and feature flags.
 *
 * @module @shared/config/schema
 */
import { z } from "zod";

// ─── Shared constraint helpers ───────────────────────────────────────────────

/** Port constraint: integer 1–65535 */
const portSchema = z.number().int().min(1).max(65535);

/** Timeout constraint: integer 0–86400000 ms (0 to 24h) */
const timeoutSchema = z.number().int().min(0).max(86400000);

// ─── Global settings namespace ───────────────────────────────────────────────

export const globalSchema = z.object({
  logLevel: z.enum(["info", "debug", "warn", "error"]).default("info").describe("Global log level"),
  workspaceRoot: z.string().default(".").describe("Relative or absolute path to workspace root"),
});

// ─── Terminal ────────────────────────────────────────────────────────────────

export const terminalSchema = z.object({
  port: portSchema.default(3333).describe("HTTP server port for Terminal tool"),
  defaultTimeoutMs: timeoutSchema
    .default(60000)
    .describe("Default command timeout in milliseconds"),
  maxTimeoutMs: timeoutSchema.default(120000).describe("Maximum allowed timeout in milliseconds"),
  maxOutputChars: z
    .number()
    .int()
    .min(0)
    .default(50000)
    .describe("Max output characters before truncation"),
  workspaceRoot: z.string().default(".").describe("Working directory for terminal commands"),
});

// ─── WebBrowser ──────────────────────────────────────────────────────────────

export const webbrowserSchema = z.object({
  port: portSchema.default(3334).describe("HTTP server port for WebBrowser tool"),
  defaultTimeoutMs: timeoutSchema
    .default(20000)
    .describe("Default page load timeout in milliseconds"),
  maxTimeoutMs: timeoutSchema.default(60000).describe("Maximum allowed timeout in milliseconds"),
  maxContentChars: z
    .number()
    .int()
    .min(0)
    .default(12000)
    .describe("Max content characters returned per page"),
  headless: z.boolean().default(true).describe("Run browser in headless mode"),
  executablePath: z
    .string()
    .default("")
    .describe("Custom browser executable path (empty uses bundled)"),
});

// ─── Calculator ──────────────────────────────────────────────────────────────

export const calculatorSchema = z.object({
  port: portSchema.default(3335).describe("HTTP server port for Calculator tool"),
  defaultPrecision: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(12)
    .describe("Default decimal precision for calculations"),
  maxPrecision: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum allowed decimal precision"),
});

// ─── DocumentScraper ─────────────────────────────────────────────────────────

export const documentscraperSchema = z.object({
  port: portSchema.default(3336).describe("HTTP server port for DocumentScraper tool"),
  defaultTimeoutMs: timeoutSchema
    .default(20000)
    .describe("Default document fetch timeout in milliseconds"),
  maxTimeoutMs: timeoutSchema.default(60000).describe("Maximum allowed timeout in milliseconds"),
  maxContentBytes: z
    .number()
    .int()
    .min(0)
    .default(52428800)
    .describe("Max content size in bytes (default 50 MB)"),
  maxContentChars: z
    .number()
    .int()
    .min(0)
    .default(50000)
    .describe("Max content characters returned"),
  workspaceRoot: z.string().default(".").describe("Working directory for document operations"),
});

// ─── Clock ───────────────────────────────────────────────────────────────────

export const clockSchema = z.object({
  port: portSchema.default(3337).describe("HTTP server port for Clock tool"),
  defaultTimezone: z.string().default("").describe("Default timezone (empty uses system timezone)"),
  defaultLocale: z
    .string()
    .default("")
    .describe("Default locale for date formatting (empty uses system locale)"),
});

// ─── Browserless ─────────────────────────────────────────────────────────────

export const browserlessSchema = z.object({
  port: portSchema.default(3003).describe("HTTP server port for Browserless tool"),
  apiKey: z.string().default("").describe("Browserless API key (sensitive)"),
  apiUrl: z
    .string()
    .default("https://production-sfo.browserless.io")
    .describe("Browserless API base URL"),
  defaultRegion: z.string().default("production-sfo").describe("Default Browserless region"),
  defaultTimeoutMs: timeoutSchema
    .default(30000)
    .describe("Default request timeout in milliseconds"),
  maxTimeoutMs: timeoutSchema.default(120000).describe("Maximum allowed timeout in milliseconds"),
  concurrencyLimit: z
    .number()
    .int()
    .min(1)
    .default(5)
    .describe("Maximum simultaneous browser requests"),
});

// ─── AskUser ─────────────────────────────────────────────────────────────────

export const askuserSchema = z.object({
  port: portSchema.default(3338).describe("HTTP server port for AskUser tool"),
  uiPort: portSchema.default(3338).describe("Port for the AskUser web UI"),
  dbPath: z.string().default("./memory.db").describe("Path to AskUser SQLite database"),
  maxQuestions: z
    .number()
    .int()
    .min(1)
    .default(20)
    .describe("Maximum questions per interview session"),
  maxPromptLength: z
    .number()
    .int()
    .min(1)
    .default(500)
    .describe("Maximum prompt length in characters"),
  maxOptions: z.number().int().min(1).default(30).describe("Maximum options per question"),
  maxTextResponseLength: z
    .number()
    .int()
    .min(1)
    .default(4000)
    .describe("Maximum text response length in characters"),
  defaultExpiresSeconds: z
    .number()
    .int()
    .min(30)
    .max(86400)
    .default(1800)
    .describe("Default question expiration time in seconds"),
  maxExpiresSeconds: z
    .number()
    .int()
    .min(30)
    .max(86400)
    .default(86400)
    .describe("Maximum allowed expiration time in seconds"),
});

// ─── RAG ─────────────────────────────────────────────────────────────────────

export const ragSchema = z.object({
  port: portSchema.default(3339).describe("HTTP server port for RAG tool"),
  dbPath: z.string().default("../rag.db").describe("Path to RAG SQLite database"),
  docScraperEndpoint: z
    .string()
    .default("http://localhost:3336/tools/read_document")
    .describe("DocumentScraper endpoint URL"),
  askUserEndpoint: z
    .string()
    .default("http://localhost:3338/tools/ask_user_interview")
    .describe("AskUser endpoint URL"),
  bypassApproval: z.boolean().default(false).describe("Bypass approval checks (for development)"),
  maxDocumentsPerIngest: z
    .number()
    .int()
    .min(1)
    .default(20)
    .describe("Maximum documents per ingest operation"),
  maxTextLength: z
    .number()
    .int()
    .min(0)
    .default(2000000)
    .describe("Maximum text length for processing"),
  chunkSizeTokens: z.number().int().min(1).default(350).describe("Default chunk size in tokens"),
  chunkOverlapTokens: z
    .number()
    .int()
    .min(0)
    .default(40)
    .describe("Default chunk overlap in tokens"),
  maxChunkSizeTokens: z
    .number()
    .int()
    .min(1)
    .default(1200)
    .describe("Maximum chunk size in tokens"),
  maxOverlapTokens: z.number().int().min(0).default(300).describe("Maximum overlap in tokens"),
  queryTopK: z.number().int().min(1).default(6).describe("Default number of results to return"),
  maxTopK: z.number().int().min(1).default(25).describe("Maximum allowed top-K results"),
  embeddingModel: z
    .string()
    .default("nomic-ai/nomic-embed-text-v1.5")
    .describe("Embedding model identifier"),
  embeddingsMode: z
    .enum(["lmstudio", "mock"])
    .default("lmstudio")
    .describe("Embeddings provider mode"),
});

// ─── PythonShell ─────────────────────────────────────────────────────────────

export const pythonshellSchema = z.object({
  port: portSchema.default(3343).describe("HTTP server port for PythonShell tool"),
  defaultTimeoutMs: timeoutSchema
    .default(60000)
    .describe("Default script execution timeout in milliseconds"),
  maxTimeoutMs: timeoutSchema.default(120000).describe("Maximum allowed timeout in milliseconds"),
  maxOutputChars: z
    .number()
    .int()
    .min(0)
    .default(50000)
    .describe("Max output characters before truncation"),
  workspaceRoot: z.string().default(".").describe("Working directory for Python scripts"),
});

// ─── Memory ──────────────────────────────────────────────────────────────────

export const memorySchema = z.object({
  dbPath: z.string().default("./data/agent-memory.db").describe("Path to memory SQLite database"),
});

// ─── Skills ──────────────────────────────────────────────────────────────────

export const skillsSchema = z.object({
  port: portSchema.default(3341).describe("HTTP server port for Skills tool"),
  dbPath: z.string().default("./skills.db").describe("Path to Skills SQLite database"),
  dir: z.string().default("").describe("Custom skills directory (empty uses platform default)"),
});

// ─── CLI ─────────────────────────────────────────────────────────────────────

export const cliSchema = z.object({
  defaultSession: z.string().default("default").describe("Default CLI session name"),
});

// ─── SlashCommands ───────────────────────────────────────────────────────────

export const slashcommandsSchema = z.object({
  defaultSession: z.string().default("default").describe("Default session identifier"),
  calculatorEndpoint: z
    .string()
    .default("http://localhost:3335")
    .describe("Calculator tool endpoint URL"),
  webbrowserEndpoint: z
    .string()
    .default("http://localhost:3334")
    .describe("WebBrowser tool endpoint URL"),
  clockEndpoint: z.string().default("http://localhost:3337").describe("Clock tool endpoint URL"),
  terminalEndpoint: z
    .string()
    .default("http://localhost:3330")
    .describe("Terminal tool endpoint URL"),
  askuserEndpoint: z
    .string()
    .default("http://localhost:3338")
    .describe("AskUser tool endpoint URL"),
  ragEndpoint: z.string().default("http://localhost:3339").describe("RAG tool endpoint URL"),
  pythonshellEndpoint: z
    .string()
    .default("http://localhost:3343")
    .describe("PythonShell tool endpoint URL"),
  skillsEndpoint: z.string().default("http://localhost:3341").describe("Skills tool endpoint URL"),
  ecmEndpoint: z.string().default("http://localhost:3342").describe("ECM tool endpoint URL"),
});

// ─── CSVExporter ─────────────────────────────────────────────────────────────

export const csvexporterSchema = z.object({
  port: portSchema.default(3339).describe("HTTP server port for CSVExporter tool"),
  exportRoot: z.string().default("").describe("Custom export directory (empty uses ~/Documents)"),
});

// ─── FileEditor ──────────────────────────────────────────────────────────────

export const fileeditorSchema = z.object({
  port: portSchema.default(3010).describe("HTTP server port for FileEditor tool"),
  workspaceRoot: z.string().default(".").describe("Working directory for file operations"),
});

// ─── Git ─────────────────────────────────────────────────────────────────────

export const gitSchema = z.object({
  port: portSchema.default(3011).describe("HTTP server port for Git tool"),
  workspaceRoot: z.string().default(".").describe("Working directory for git operations"),
});

// ─── PackageManager ──────────────────────────────────────────────────────────

export const packagemanagerSchema = z.object({
  port: portSchema.default(3012).describe("HTTP server port for PackageManager tool"),
  workspaceRoot: z
    .string()
    .default(".")
    .describe("Working directory for package manager operations"),
});

// ─── Observability ───────────────────────────────────────────────────────────

export const observabilitySchema = z.object({
  enabled: z.boolean().default(true).describe("Enable observability data collection"),
  logLevel: z
    .enum(["info", "debug", "warn", "error"])
    .default("info")
    .describe("Observability log level"),
});

// ─── AgentRunner ─────────────────────────────────────────────────────────────

export const agentrunnerSchema = z.object({
  basePort: portSchema.default(3330).describe("Base port for tool server discovery"),
});

// ─── BlenderBridge ───────────────────────────────────────────────────────────

export const blenderbridgeSchema = z.object({
  host: z.string().default("127.0.0.1").describe("Blender add-on TCP host"),
  port: portSchema.default(9876).describe("Blender add-on TCP port"),
  command: z.string().default("blender-mcp").describe("MCP server binary command"),
  args: z.string().max(1024).default("").describe("MCP server arguments, whitespace-separated"),
});

// ─── 3DTool (threedtool) ─────────────────────────────────────────────────────

export const threedtoolSchema = z.object({
  port: portSchema.default(3013).describe("HTTP server port for 3DTool"),
  workspaceRoot: z.string().default(".").describe("Working directory for 3D file operations"),
});

// ─── SubAgent ────────────────────────────────────────────────────────────────

export const subagentSchema = z.object({
  model: z.string().default("default").describe("LLM model identifier for sub-agent sessions"),
});

// ─── LanSubAgent ─────────────────────────────────────────────────────────────

export const lansubagentSchema = z.object({
  configPath: z
    .string()
    .default("./lan-subagent-config.json")
    .describe("Path to LAN sub-agent configuration file"),
  localHost: z.string().default("localhost").describe("Local host address for sub-agent"),
  localPort: portSchema.default(1234).describe("Local port for sub-agent"),
});

// ─── Top-level config schema ─────────────────────────────────────────────────

/**
 * Top-level config schema - one namespace per tool, plus global settings.
 * Namespace keys match tool directory names in lowercase.
 */
export const configSchema = z.object({
  global: globalSchema.default({}),
  terminal: terminalSchema.default({}),
  webbrowser: webbrowserSchema.default({}),
  calculator: calculatorSchema.default({}),
  documentscraper: documentscraperSchema.default({}),
  clock: clockSchema.default({}),
  browserless: browserlessSchema.default({}),
  askuser: askuserSchema.default({}),
  rag: ragSchema.default({}),
  pythonshell: pythonshellSchema.default({}),
  memory: memorySchema.default({}),
  skills: skillsSchema.default({}),
  cli: cliSchema.default({}),
  slashcommands: slashcommandsSchema.default({}),
  csvexporter: csvexporterSchema.default({}),
  fileeditor: fileeditorSchema.default({}),
  git: gitSchema.default({}),
  packagemanager: packagemanagerSchema.default({}),
  observability: observabilitySchema.default({}),
  agentrunner: agentrunnerSchema.default({}),
  blenderbridge: blenderbridgeSchema.default({}),
  threedtool: threedtoolSchema.default({}),
  subagent: subagentSchema.default({}),
  lansubagent: lansubagentSchema.default({}),
});

/** Inferred TypeScript type from the config schema */
export type Config = z.infer<typeof configSchema>;
