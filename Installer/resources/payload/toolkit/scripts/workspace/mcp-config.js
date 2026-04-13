const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const servers = {
  terminal: {
    relativeScript: "Terminal/dist/mcp-server.js",
    env: {
      TERMINAL_DEFAULT_TIMEOUT_MS: "60000",
      TERMINAL_MAX_TIMEOUT_MS: "120000",
    },
  },
  "web-browser": {
    relativeScript: "WebBrowser/dist/mcp-server.js",
    env: {
      BROWSER_DEFAULT_TIMEOUT_MS: "20000",
      BROWSER_MAX_TIMEOUT_MS: "60000",
      BROWSER_MAX_CONTENT_CHARS: "12000",
      BROWSER_HEADLESS: "true",
    },
  },
  calculator: {
    relativeScript: "Calculator/dist/mcp-server.js",
    env: {
      CALCULATOR_DEFAULT_PRECISION: "12",
      CALCULATOR_MAX_PRECISION: "20",
    },
  },
  "document-scraper": {
    relativeScript: "DocumentScraper/dist/mcp-server.js",
    env: {
      DOC_SCRAPER_DEFAULT_TIMEOUT_MS: "20000",
      DOC_SCRAPER_MAX_TIMEOUT_MS: "60000",
      DOC_SCRAPER_MAX_CONTENT_BYTES: "52428800",
      DOC_SCRAPER_MAX_CONTENT_CHARS: "50000",
      DOC_SCRAPER_WORKSPACE_ROOT: "",
    },
  },
  clock: {
    relativeScript: "Clock/dist/mcp-server.js",
    env: {
      CLOCK_DEFAULT_TIMEZONE: "",
      CLOCK_DEFAULT_LOCALE: "en-US",
    },
  },
  browserless: {
    relativeScript: "Browserless/dist/mcp-server.js",
    env: {
      BROWSERLESS_API_KEY: "your-browserless-api-token-here",
      BROWSERLESS_DEFAULT_REGION: "production-sfo",
      BROWSERLESS_DEFAULT_TIMEOUT_MS: "30000",
      BROWSERLESS_MAX_TIMEOUT_MS: "120000",
      BROWSERLESS_CONCURRENCY_LIMIT: "5",
    },
  },
  "ask-user": {
    relativeScript: "AskUser/dist/mcp-server.js",
    env: {
      ASK_USER_DB_PATH: "./memory.db",
      ASK_USER_DEFAULT_EXPIRES_SECONDS: "1800",
      ASK_USER_MAX_EXPIRES_SECONDS: "86400",
      ASK_USER_MAX_QUESTIONS: "20",
    },
  },
  rag: {
    relativeScript: "RAG/dist/mcp-server.js",
    env: {
      RAG_DB_PATH: "./rag.db",
      RAG_EMBEDDINGS_MODE: "lmstudio",
      RAG_EMBEDDING_MODEL: "nomic-ai/nomic-embed-text-v1.5",
      RAG_DOC_SCRAPER_ENDPOINT: "http://localhost:3336/tools/read_document",
      RAG_ASK_USER_ENDPOINT: "http://localhost:3338/tools/ask_user_interview",
      RAG_BYPASS_APPROVAL: "true",
      RAG_CHUNK_SIZE_TOKENS: "384",
      RAG_CHUNK_OVERLAP_TOKENS: "75",
    },
  },
  "python-shell": {
    relativeScript: "PythonShell/dist/mcp-server.js",
    env: {
      PYTHON_SHELL_DEFAULT_TIMEOUT_MS: "60000",
      PYTHON_SHELL_MAX_TIMEOUT_MS: "120000",
      PYTHON_SHELL_MAX_OUTPUT_CHARS: "50000",
      PYTHON_SHELL_WORKSPACE_ROOT: "",
    },
  },
  skills: {
    relativeScript: "Skills/dist/mcp-server.js",
    env: {
      SKILLS_DB_PATH: "./skills.db",
    },
  },
  ecm: {
    relativeScript: "ECM/dist/mcp-server.js",
    env: {
      ECM_DB_PATH: "./ecm.db",
      ECM_EMBEDDINGS_MODE: "lmstudio",
      ECM_EMBEDDING_MODEL: "nomic-ai/nomic-embed-text-v1.5",
    },
  },
  "slash-commands": {
    relativeScript: "SlashCommands/dist/mcp-server.js",
    env: {
      SLASH_DEFAULT_SESSION: "default",
    },
  },
};

function normalizeForJson(value) {
  return value.replace(/\\/g, "/");
}

function buildMcpServers() {
  const mcpServers = {};
  const missingBuilds = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    const fullPath = path.join(repoRoot, serverConfig.relativeScript);
    if (!fs.existsSync(fullPath)) {
      missingBuilds.push(serverConfig.relativeScript);
    }

    mcpServers[serverName] = {
      command: "node",
      args: [normalizeForJson(fullPath)],
      env: serverConfig.env,
    };
  }

  return {
    mcpServers,
    missingBuilds,
  };
}

module.exports = {
  repoRoot,
  buildMcpServers,
};
