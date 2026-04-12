#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const tools = [
  { name: "Terminal", dist: "Terminal/dist/mcp-server.js", src: "Terminal/src/mcp-server.ts" },
  {
    name: "WebBrowser",
    dist: "WebBrowser/dist/mcp-server.js",
    src: "WebBrowser/src/mcp-server.ts",
  },
  {
    name: "Calculator",
    dist: "Calculator/dist/mcp-server.js",
    src: "Calculator/src/mcp-server.ts",
  },
  {
    name: "DocumentScraper",
    dist: "DocumentScraper/dist/mcp-server.js",
    src: "DocumentScraper/src/mcp-server.ts",
  },
  { name: "Clock", dist: "Clock/dist/mcp-server.js", src: "Clock/src/mcp-server.ts" },
  {
    name: "Browserless",
    dist: "Browserless/dist/mcp-server.js",
    src: "Browserless/src/mcp-server.ts",
  },
  { name: "AskUser", dist: "AskUser/dist/mcp-server.js", src: "AskUser/src/mcp-server.ts" },
  { name: "RAG", dist: "RAG/dist/mcp-server.js", src: "RAG/src/mcp-server.ts" },
  {
    name: "PythonShell",
    dist: "PythonShell/dist/mcp-server.js",
    src: "PythonShell/src/mcp-server.ts",
  },
  {
    name: "SlashCommands",
    dist: "SlashCommands/dist/mcp-server.js",
    src: "SlashCommands/src/mcp-server.ts",
  },
];

let failed = false;

for (const tool of tools) {
  const srcPath = path.join(repoRoot, tool.src);
  const distPath = path.join(repoRoot, tool.dist);

  if (!fs.existsSync(srcPath)) {
    console.error(`✗ ${tool.name}: missing source MCP server: ${tool.src}`);
    failed = true;
    continue;
  }

  if (!fs.existsSync(distPath)) {
    console.error(`✗ ${tool.name}: missing built MCP binary: ${tool.dist}`);
    failed = true;
    continue;
  }

  console.log(`✓ ${tool.name}: ${tool.dist}`);
}

if (failed) {
  console.error("\nTool verification failed. Run `npm run build` and retry.");
  process.exit(1);
}

console.log("\nAll MCP tool binaries are present.");
