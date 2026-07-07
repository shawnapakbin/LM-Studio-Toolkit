/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
      BROWSERLESS_API_KEY: "",
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
  "slash-commands": {
    relativeScript: "SlashCommands/dist/mcp-server.js",
    env: {
      SLASH_DEFAULT_SESSION: "default",
    },
  },
  "blender-bridge": {
    relativeScript: "BlenderBridge/dist/mcp-server.js",
    env: {
      BLENDER_MCP_HOST: "127.0.0.1",
      BLENDER_MCP_PORT: "9876",
      BLENDER_MCP_COMMAND: "blender-mcp",
      BLENDER_MCP_ARGS: "",
    },
  },
};

function normalizeForJson(value) {
  return value.replace(/\\/g, "/");
}

function isBinaryOnPath(command) {
  try {
    const cmd = process.platform === "win32" ? `where ${command}` : `which ${command}`;
    const result = execSync(cmd, { stdio: "pipe", encoding: "utf-8" }).trim();
    if (process.platform !== "win32") {
      // On Unix, `which` confirms existence on PATH but we must also verify executability
      const resolvedPath = result.split("\n")[0].trim();
      fs.accessSync(resolvedPath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function buildMcpServers() {
  const mcpServers = {};
  const missingBuilds = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (serverConfig.external) {
      if (!isBinaryOnPath(serverConfig.command)) {
        console.warn(
          `[mcp-config] Warning: "${serverConfig.command}" missing or non-executable — skipping "${serverName}" entry`
        );
        continue;
      }

      mcpServers[serverName] = {
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      };
      continue;
    }

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
