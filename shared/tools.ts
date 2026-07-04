/**
 * Central tool registry — single source of truth for all LLM Toolkit MCP tools.
 *
 * This file is consumed by:
 *  - scripts/setup/setup.js         (LM Studio bridge config sync)
 *  - scripts/workspace/verify-tools.js  (post-build binary checks)
 *  - scripts/workspace/smoke-test-mcp.js (MCP startup smoke tests)
 *  - AgentRunner (tool discovery)
 *
 * Adding a new tool only requires updating this file.
 */

export interface ToolEntry {
  /** Package/folder name used as the registry key: "Terminal", "3DTool", etc. */
  name: string;
  /** LM Studio plugin directory name: "terminal", "3d-tool", etc. */
  serverName: string;
  /** Repo-relative path to the compiled MCP server entry point. */
  distFile: string;
  /** Repo-relative path to the TypeScript MCP server source (for verify-tools). */
  srcFile: string;
}

export const TOOL_REGISTRY: ToolEntry[] = [
  {
    name: "Terminal",
    serverName: "terminal",
    distFile: "Terminal/dist/mcp-server.js",
    srcFile: "Terminal/src/mcp-server.ts",
  },
  {
    name: "WebBrowser",
    serverName: "web-browser",
    distFile: "WebBrowser/dist/mcp-server.js",
    srcFile: "WebBrowser/src/mcp-server.ts",
  },
  {
    name: "Basic",
    serverName: "basic",
    distFile: "Basic/dist/mcp-server.js",
    srcFile: "Basic/src/mcp-server.ts",
  },
  {
    name: "DocumentScraper",
    serverName: "document-scraper",
    distFile: "DocumentScraper/dist/mcp-server.js",
    srcFile: "DocumentScraper/src/mcp-server.ts",
  },
  {
    name: "Browserless",
    serverName: "browserless",
    distFile: "Browserless/dist/mcp-server.js",
    srcFile: "Browserless/src/mcp-server.ts",
  },
  {
    name: "RAG",
    serverName: "rag",
    distFile: "RAG/dist/mcp-server.js",
    srcFile: "RAG/src/mcp-server.ts",
  },
  {
    name: "3DTool",
    serverName: "3d-tool",
    distFile: "3DTool/dist/mcp-server.js",
    srcFile: "3DTool/src/mcp-server.ts",
  },
  {
    name: "PythonShell",
    serverName: "python-shell",
    distFile: "PythonShell/dist/mcp-server.js",
    srcFile: "PythonShell/src/mcp-server.ts",
  },
  {
    name: "Skills",
    serverName: "skills",
    distFile: "Skills/dist/mcp-server.js",
    srcFile: "Skills/src/mcp-server.ts",
  },
  {
    name: "SlashCommands",
    serverName: "slash-commands",
    distFile: "SlashCommands/dist/mcp-server.js",
    srcFile: "SlashCommands/src/mcp-server.ts",
  },
];
