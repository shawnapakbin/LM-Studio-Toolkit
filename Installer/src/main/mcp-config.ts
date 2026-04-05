import { resolveToolScriptPath } from "./script-path";
import type { ToolDescriptor } from "./types";

export const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    id: "terminal",
    displayName: "Terminal",
    relativeScript: "Terminal/dist/mcp-server.js",
    env: {
      TERMINAL_DEFAULT_TIMEOUT_MS: "60000",
      TERMINAL_MAX_TIMEOUT_MS: "120000",
    },
  },
  {
    id: "web-browser",
    displayName: "WebBrowser",
    relativeScript: "WebBrowser/dist/mcp-server.js",
    env: {
      BROWSER_DEFAULT_TIMEOUT_MS: "20000",
      BROWSER_MAX_TIMEOUT_MS: "60000",
      BROWSER_MAX_CONTENT_CHARS: "12000",
      BROWSER_HEADLESS: "true",
    },
  },
  {
    id: "calculator",
    displayName: "Calculator",
    relativeScript: "Calculator/dist/mcp-server.js",
    env: {
      CALCULATOR_DEFAULT_PRECISION: "12",
      CALCULATOR_MAX_PRECISION: "20",
    },
  },
  {
    id: "document-scraper",
    displayName: "DocumentScraper",
    relativeScript: "DocumentScraper/dist/mcp-server.js",
    env: {
      DOC_SCRAPER_DEFAULT_TIMEOUT_MS: "20000",
      DOC_SCRAPER_MAX_TIMEOUT_MS: "60000",
      DOC_SCRAPER_MAX_CONTENT_BYTES: "52428800",
      DOC_SCRAPER_MAX_CONTENT_CHARS: "50000",
      DOC_SCRAPER_WORKSPACE_ROOT: "",
    },
  },
  {
    id: "clock",
    displayName: "Clock",
    relativeScript: "Clock/dist/mcp-server.js",
    env: {
      CLOCK_DEFAULT_TIMEZONE: "",
      CLOCK_DEFAULT_LOCALE: "en-US",
    },
  },
  {
    id: "browserless",
    displayName: "Browserless",
    relativeScript: "Browserless/dist/mcp-server.js",
    env: {
      BROWSERLESS_API_KEY: "",
      BROWSERLESS_DEFAULT_REGION: "production-sfo",
      BROWSERLESS_DEFAULT_TIMEOUT_MS: "30000",
      BROWSERLESS_MAX_TIMEOUT_MS: "120000",
      BROWSERLESS_CONCURRENCY_LIMIT: "5",
    },
  },
  {
    id: "ask-user",
    displayName: "AskUser",
    relativeScript: "AskUser/dist/mcp-server.js",
    env: {
      ASK_USER_DB_PATH: "./memory.db",
      ASK_USER_DEFAULT_EXPIRES_SECONDS: "1800",
      ASK_USER_MAX_EXPIRES_SECONDS: "86400",
      ASK_USER_MAX_QUESTIONS: "20",
    },
  },
  {
    id: "rag",
    displayName: "RAG",
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
  {
    id: "skills",
    displayName: "Skills",
    relativeScript: "Skills/dist/mcp-server.js",
    env: {
      SKILLS_DB_PATH: "./skills.db",
    },
  },
  {
    id: "ecm",
    displayName: "ECM",
    relativeScript: "ECM/dist/mcp-server.js",
    env: {
      ECM_DB_PATH: "./ecm.db",
      ECM_EMBEDDINGS_MODE: "lmstudio",
      ECM_EMBEDDING_MODEL: "nomic-ai/nomic-embed-text-v1.5",
    },
  },
  {
    id: "slash-commands",
    displayName: "SlashCommands",
    relativeScript: "SlashCommands/dist/mcp-server.js",
    env: {
      SLASH_DEFAULT_SESSION: "default",
    },
  },
];

export function buildBridgeConfig(installRoot: string, tool: ToolDescriptor) {
  const { resolvedPath } = resolveToolScriptPath(installRoot, tool);

  return {
    command: "node",
    args: [resolvedPath.replace(/\\/g, "/")],
    cwd: installRoot.replace(/\\/g, "/"),
    env: tool.env,
  };
}