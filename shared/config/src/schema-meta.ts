/**
 * Schema Metadata Map - Parallel structure for environment variable overrides
 * and sensitivity annotations.
 *
 * Maps dotted config paths to their env var names and whether
 * they contain sensitive data (for log redaction).
 *
 * @module @shared/config/schema-meta
 */

/** Metadata for a single configuration entry */
export interface SchemaMetaEntry {
  /** Environment variable name that overrides this entry */
  env?: string;
  /** Whether this entry contains sensitive data (redacted in logs) */
  sensitive?: boolean;
  /** Legacy .env key name for migration mapping */
  legacyEnvKey?: string;
}

/**
 * Maps dotted config paths to env var names and sensitivity flags.
 * Used by the loader for environment variable overrides and
 * by the migrate CLI for .env-to-config mapping.
 */
export const schemaMeta: Record<string, SchemaMetaEntry> = {
  // ─── Global ──────────────────────────────────────────────────────────────────
  "global.logLevel": {
    env: "LLM_TOOLKIT_LOG_LEVEL",
    legacyEnvKey: "LOG_LEVEL",
  },
  "global.workspaceRoot": {
    env: "LLM_TOOLKIT_WORKSPACE_ROOT",
    legacyEnvKey: "WORKSPACE_ROOT",
  },

  // ─── Terminal ────────────────────────────────────────────────────────────────
  "terminal.defaultTimeoutMs": {
    env: "TERMINAL_DEFAULT_TIMEOUT_MS",
    legacyEnvKey: "TERMINAL_DEFAULT_TIMEOUT_MS",
  },
  "terminal.maxTimeoutMs": {
    env: "TERMINAL_MAX_TIMEOUT_MS",
    legacyEnvKey: "TERMINAL_MAX_TIMEOUT_MS",
  },
  "terminal.maxOutputChars": {
    env: "TERMINAL_MAX_OUTPUT_CHARS",
    legacyEnvKey: "TERMINAL_MAX_OUTPUT_CHARS",
  },
  "terminal.workspaceRoot": {
    env: "TERMINAL_WORKSPACE_ROOT",
    legacyEnvKey: "TERMINAL_WORKSPACE_ROOT",
  },
  "terminal.port": {
    env: "TERMINAL_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── WebBrowser ──────────────────────────────────────────────────────────────
  "webbrowser.defaultTimeoutMs": {
    env: "BROWSER_DEFAULT_TIMEOUT_MS",
    legacyEnvKey: "BROWSER_DEFAULT_TIMEOUT_MS",
  },
  "webbrowser.maxTimeoutMs": {
    env: "BROWSER_MAX_TIMEOUT_MS",
    legacyEnvKey: "BROWSER_MAX_TIMEOUT_MS",
  },
  "webbrowser.maxContentChars": {
    env: "BROWSER_MAX_CONTENT_CHARS",
    legacyEnvKey: "BROWSER_MAX_CONTENT_CHARS",
  },
  "webbrowser.headless": {
    env: "BROWSER_HEADLESS",
    legacyEnvKey: "BROWSER_HEADLESS",
  },
  "webbrowser.executablePath": {
    env: "BROWSER_EXECUTABLE_PATH",
    legacyEnvKey: "BROWSER_EXECUTABLE_PATH",
  },
  "webbrowser.port": {
    env: "WEBBROWSER_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── Calculator ──────────────────────────────────────────────────────────────
  "calculator.defaultPrecision": {
    env: "CALCULATOR_DEFAULT_PRECISION",
    legacyEnvKey: "CALCULATOR_DEFAULT_PRECISION",
  },
  "calculator.maxPrecision": {
    env: "CALCULATOR_MAX_PRECISION",
    legacyEnvKey: "CALCULATOR_MAX_PRECISION",
  },
  "calculator.port": {
    env: "CALCULATOR_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── DocumentScraper ─────────────────────────────────────────────────────────
  "documentscraper.workspaceRoot": {
    env: "DOC_SCRAPER_WORKSPACE_ROOT",
    legacyEnvKey: "DOC_SCRAPER_WORKSPACE_ROOT",
  },
  "documentscraper.defaultTimeoutMs": {
    env: "DOC_SCRAPER_DEFAULT_TIMEOUT_MS",
    legacyEnvKey: "DOC_SCRAPER_DEFAULT_TIMEOUT_MS",
  },
  "documentscraper.maxTimeoutMs": {
    env: "DOC_SCRAPER_MAX_TIMEOUT_MS",
    legacyEnvKey: "DOC_SCRAPER_MAX_TIMEOUT_MS",
  },
  "documentscraper.maxContentChars": {
    env: "DOC_SCRAPER_MAX_CONTENT_CHARS",
    legacyEnvKey: "DOC_SCRAPER_MAX_CONTENT_CHARS",
  },
  "documentscraper.maxContentBytes": {
    env: "DOC_SCRAPER_MAX_CONTENT_BYTES",
    legacyEnvKey: "DOC_SCRAPER_MAX_CONTENT_BYTES",
  },
  "documentscraper.port": {
    env: "DOCUMENTSCRAPER_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── Clock ───────────────────────────────────────────────────────────────────
  "clock.defaultTimezone": {
    env: "CLOCK_DEFAULT_TIMEZONE",
    legacyEnvKey: "CLOCK_DEFAULT_TIMEZONE",
  },
  "clock.defaultLocale": {
    env: "CLOCK_DEFAULT_LOCALE",
    legacyEnvKey: "CLOCK_DEFAULT_LOCALE",
  },
  "clock.port": {
    env: "CLOCK_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── Browserless ─────────────────────────────────────────────────────────────
  "browserless.apiKey": {
    env: "BROWSERLESS_API_KEY",
    legacyEnvKey: "BROWSERLESS_API_KEY",
    sensitive: true,
  },
  "browserless.apiUrl": {
    env: "BROWSERLESS_API_URL",
    legacyEnvKey: "BROWSERLESS_API_URL",
  },
  "browserless.defaultRegion": {
    env: "BROWSERLESS_DEFAULT_REGION",
    legacyEnvKey: "BROWSERLESS_DEFAULT_REGION",
  },
  "browserless.defaultTimeoutMs": {
    env: "BROWSERLESS_DEFAULT_TIMEOUT_MS",
    legacyEnvKey: "BROWSERLESS_DEFAULT_TIMEOUT_MS",
  },
  "browserless.maxTimeoutMs": {
    env: "BROWSERLESS_MAX_TIMEOUT_MS",
    legacyEnvKey: "BROWSERLESS_MAX_TIMEOUT_MS",
  },
  "browserless.concurrencyLimit": {
    env: "BROWSERLESS_CONCURRENCY_LIMIT",
    legacyEnvKey: "BROWSERLESS_CONCURRENCY_LIMIT",
  },
  "browserless.port": {
    env: "BROWSERLESS_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── AskUser ─────────────────────────────────────────────────────────────────
  "askuser.dbPath": {
    env: "ASK_USER_DB_PATH",
    legacyEnvKey: "ASK_USER_DB_PATH",
  },
  "askuser.maxQuestions": {
    env: "ASK_USER_MAX_QUESTIONS",
    legacyEnvKey: "ASK_USER_MAX_QUESTIONS",
  },
  "askuser.maxPromptLength": {
    env: "ASK_USER_MAX_PROMPT_LENGTH",
    legacyEnvKey: "ASK_USER_MAX_PROMPT_LENGTH",
  },
  "askuser.maxOptions": {
    env: "ASK_USER_MAX_OPTIONS",
    legacyEnvKey: "ASK_USER_MAX_OPTIONS",
  },
  "askuser.maxTextResponseLength": {
    env: "ASK_USER_MAX_TEXT_RESPONSE_LENGTH",
    legacyEnvKey: "ASK_USER_MAX_TEXT_RESPONSE_LENGTH",
  },
  "askuser.defaultExpiresSeconds": {
    env: "ASK_USER_DEFAULT_EXPIRES_SECONDS",
    legacyEnvKey: "ASK_USER_DEFAULT_EXPIRES_SECONDS",
  },
  "askuser.maxExpiresSeconds": {
    env: "ASK_USER_MAX_EXPIRES_SECONDS",
    legacyEnvKey: "ASK_USER_MAX_EXPIRES_SECONDS",
  },
  "askuser.port": {
    env: "ASKUSER_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── RAG ─────────────────────────────────────────────────────────────────────
  "rag.dbPath": {
    env: "RAG_DB_PATH",
    legacyEnvKey: "RAG_DB_PATH",
  },
  "rag.docScraperEndpoint": {
    env: "RAG_DOC_SCRAPER_ENDPOINT",
    legacyEnvKey: "RAG_DOC_SCRAPER_ENDPOINT",
  },
  "rag.askUserEndpoint": {
    env: "RAG_ASK_USER_ENDPOINT",
    legacyEnvKey: "RAG_ASK_USER_ENDPOINT",
  },
  "rag.bypassApproval": {
    env: "RAG_BYPASS_APPROVAL",
    legacyEnvKey: "RAG_BYPASS_APPROVAL",
  },
  "rag.maxDocumentsPerIngest": {
    env: "RAG_MAX_DOCUMENTS_PER_INGEST",
    legacyEnvKey: "RAG_MAX_DOCUMENTS_PER_INGEST",
  },
  "rag.maxTextLength": {
    env: "RAG_MAX_TEXT_LENGTH",
    legacyEnvKey: "RAG_MAX_TEXT_LENGTH",
  },
  "rag.chunkSizeTokens": {
    env: "RAG_CHUNK_SIZE_TOKENS",
    legacyEnvKey: "RAG_CHUNK_SIZE_TOKENS",
  },
  "rag.chunkOverlapTokens": {
    env: "RAG_CHUNK_OVERLAP_TOKENS",
    legacyEnvKey: "RAG_CHUNK_OVERLAP_TOKENS",
  },
  "rag.maxChunkSizeTokens": {
    env: "RAG_MAX_CHUNK_SIZE_TOKENS",
    legacyEnvKey: "RAG_MAX_CHUNK_SIZE_TOKENS",
  },
  "rag.maxOverlapTokens": {
    env: "RAG_MAX_OVERLAP_TOKENS",
    legacyEnvKey: "RAG_MAX_OVERLAP_TOKENS",
  },
  "rag.queryTopK": {
    env: "RAG_QUERY_TOP_K",
    legacyEnvKey: "RAG_QUERY_TOP_K",
  },
  "rag.maxTopK": {
    env: "RAG_MAX_TOP_K",
    legacyEnvKey: "RAG_MAX_TOP_K",
  },
  "rag.embeddingModel": {
    env: "RAG_EMBEDDING_MODEL",
    legacyEnvKey: "RAG_EMBEDDING_MODEL",
  },
  "rag.embeddingsMode": {
    env: "RAG_EMBEDDINGS_MODE",
    legacyEnvKey: "RAG_EMBEDDINGS_MODE",
  },
  "rag.port": {
    env: "RAG_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── PythonShell ─────────────────────────────────────────────────────────────
  "pythonshell.workspaceRoot": {
    env: "PYTHON_SHELL_WORKSPACE_ROOT",
    legacyEnvKey: "PYTHON_SHELL_WORKSPACE_ROOT",
  },
  "pythonshell.defaultTimeoutMs": {
    env: "PYTHON_SHELL_DEFAULT_TIMEOUT_MS",
    legacyEnvKey: "PYTHON_SHELL_DEFAULT_TIMEOUT_MS",
  },
  "pythonshell.maxTimeoutMs": {
    env: "PYTHON_SHELL_MAX_TIMEOUT_MS",
    legacyEnvKey: "PYTHON_SHELL_MAX_TIMEOUT_MS",
  },
  "pythonshell.maxOutputChars": {
    env: "PYTHON_SHELL_MAX_OUTPUT_CHARS",
    legacyEnvKey: "PYTHON_SHELL_MAX_OUTPUT_CHARS",
  },
  "pythonshell.port": {
    env: "PYTHONSHELL_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── Memory ──────────────────────────────────────────────────────────────────
  "memory.dbPath": {
    env: "MEMORY_DB_PATH",
    legacyEnvKey: "MEMORY_DB_PATH",
  },
  "memory.port": {
    env: "MEMORY_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── Skills ──────────────────────────────────────────────────────────────────
  "skills.dbPath": {
    env: "SKILLS_DB_PATH",
    legacyEnvKey: "SKILLS_DB_PATH",
  },
  "skills.dir": {
    env: "SKILLS_DIR",
    legacyEnvKey: "SKILLS_DIR",
  },
  "skills.port": {
    env: "SKILLS_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── SlashCommands ───────────────────────────────────────────────────────────
  "slashcommands.defaultSession": {
    env: "SLASH_DEFAULT_SESSION",
    legacyEnvKey: "SLASH_DEFAULT_SESSION",
  },
  "slashcommands.calculatorEndpoint": {
    env: "CALCULATOR_ENDPOINT",
    legacyEnvKey: "CALCULATOR_ENDPOINT",
  },
  "slashcommands.webbrowserEndpoint": {
    env: "WEBBROWSER_ENDPOINT",
    legacyEnvKey: "WEBBROWSER_ENDPOINT",
  },
  "slashcommands.clockEndpoint": {
    env: "CLOCK_ENDPOINT",
    legacyEnvKey: "CLOCK_ENDPOINT",
  },
  "slashcommands.terminalEndpoint": {
    env: "TERMINAL_ENDPOINT",
    legacyEnvKey: "TERMINAL_ENDPOINT",
  },
  "slashcommands.askuserEndpoint": {
    env: "ASKUSER_ENDPOINT",
    legacyEnvKey: "ASKUSER_ENDPOINT",
  },
  "slashcommands.ragEndpoint": {
    env: "RAG_ENDPOINT",
    legacyEnvKey: "RAG_ENDPOINT",
  },
  "slashcommands.pythonshellEndpoint": {
    env: "PYTHONSHELL_ENDPOINT",
    legacyEnvKey: "PYTHONSHELL_ENDPOINT",
  },
  "slashcommands.skillsEndpoint": {
    env: "SKILLS_ENDPOINT",
    legacyEnvKey: "SKILLS_ENDPOINT",
  },
  "slashcommands.ecmEndpoint": {
    env: "ECM_ENDPOINT",
    legacyEnvKey: "ECM_ENDPOINT",
  },

  // ─── CLI ─────────────────────────────────────────────────────────────────────
  "cli.port": {
    env: "CLI_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── CsvExporter ─────────────────────────────────────────────────────────────
  "csvexporter.port": {
    env: "CSVEXPORTER_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── FileEditor ──────────────────────────────────────────────────────────────
  "fileeditor.workspaceRoot": {
    env: "FILE_EDITOR_WORKSPACE_ROOT",
    legacyEnvKey: "FILE_EDITOR_WORKSPACE_ROOT",
  },
  "fileeditor.port": {
    env: "FILEEDITOR_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── Git ─────────────────────────────────────────────────────────────────────
  "git.workspaceRoot": {
    env: "GIT_WORKSPACE_ROOT",
    legacyEnvKey: "GIT_WORKSPACE_ROOT",
  },
  "git.port": {
    env: "GIT_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── PackageManager ──────────────────────────────────────────────────────────
  "packagemanager.workspaceRoot": {
    env: "PACKAGE_MANAGER_WORKSPACE_ROOT",
    legacyEnvKey: "PACKAGE_MANAGER_WORKSPACE_ROOT",
  },
  "packagemanager.port": {
    env: "PACKAGEMANAGER_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── Observability ───────────────────────────────────────────────────────────
  "observability.port": {
    env: "OBSERVABILITY_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── AgentRunner ─────────────────────────────────────────────────────────────
  "agentrunner.basePort": {
    env: "BASE_PORT",
    legacyEnvKey: "BASE_PORT",
  },
  "agentrunner.browserlessApiToken": {
    env: "BROWSERLESS_API_TOKEN",
    legacyEnvKey: "BROWSERLESS_API_TOKEN",
    sensitive: true,
  },

  // ─── BlenderBridge ───────────────────────────────────────────────────────────
  "blenderbridge.host": {
    env: "BLENDER_MCP_HOST",
    legacyEnvKey: "BLENDER_MCP_HOST",
  },
  "blenderbridge.port": {
    env: "BLENDER_MCP_PORT",
    legacyEnvKey: "BLENDER_MCP_PORT",
  },
  "blenderbridge.command": {
    env: "BLENDER_MCP_COMMAND",
    legacyEnvKey: "BLENDER_MCP_COMMAND",
  },
  "blenderbridge.args": {
    env: "BLENDER_MCP_ARGS",
    legacyEnvKey: "BLENDER_MCP_ARGS",
  },

  // ─── 3DTool (threedtool) ─────────────────────────────────────────────────────
  "threedtool.port": {
    env: "THREEDTOOL_PORT",
    legacyEnvKey: "PORT",
  },

  // ─── SubAgent ────────────────────────────────────────────────────────────────
  "subagent.maxConcurrency": {
    env: "SUBAGENT_MAX_CONCURRENCY",
    legacyEnvKey: "SUBAGENT_MAX_CONCURRENCY",
  },
  "subagent.cachePath": {
    env: "SUBAGENT_CACHE_PATH",
    legacyEnvKey: "SUBAGENT_CACHE_PATH",
  },
  "subagent.checkpointDir": {
    env: "SUBAGENT_CHECKPOINT_DIR",
    legacyEnvKey: "SUBAGENT_CHECKPOINT_DIR",
  },
  "subagent.apiUrl": {
    env: "SUBAGENT_API_URL",
    legacyEnvKey: "SUBAGENT_API_URL",
  },
  "subagent.model": {
    env: "SUBAGENT_MODEL",
    legacyEnvKey: "SUBAGENT_MODEL",
  },
  "subagent.promptTokenCost": {
    env: "SUBAGENT_PROMPT_TOKEN_COST",
    legacyEnvKey: "SUBAGENT_PROMPT_TOKEN_COST",
  },
  "subagent.completionTokenCost": {
    env: "SUBAGENT_COMPLETION_TOKEN_COST",
    legacyEnvKey: "SUBAGENT_COMPLETION_TOKEN_COST",
  },

  // ─── LanSubAgent ────────────────────────────────────────────────────────────
  "lansubagent.configPath": {
    env: "LAN_SUBAGENT_CONFIG_PATH",
    legacyEnvKey: "LAN_SUBAGENT_CONFIG_PATH",
  },
  "lansubagent.localHost": {
    env: "SUBAGENT_LOCAL_HOST",
    legacyEnvKey: "SUBAGENT_LOCAL_HOST",
  },
  "lansubagent.localPort": {
    env: "SUBAGENT_LOCAL_PORT",
    legacyEnvKey: "SUBAGENT_LOCAL_PORT",
  },
};
