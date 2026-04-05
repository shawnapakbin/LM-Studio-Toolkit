#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const readmePath = path.join(repoRoot, "README.md");
const readme = fs.readFileSync(readmePath, "utf8");

const expectedServers = {
  terminal: "Terminal/dist/mcp-server.js",
  "web-browser": "WebBrowser/dist/mcp-server.js",
  calculator: "Calculator/dist/mcp-server.js",
  "document-scraper": "DocumentScraper/dist/mcp-server.js",
  clock: "Clock/dist/mcp-server.js",
  browserless: "Browserless/dist/mcp-server.js",
  "ask-user": "AskUser/dist/mcp-server.js",
  rag: "RAG/dist/mcp-server.js",
};

const marker = "## Complete `mcp.json` Example";
const markerIndex = readme.indexOf(marker);

if (markerIndex < 0) {
  console.error("✗ README is missing 'Complete mcp.json Example' section.");
  process.exit(1);
}

const fencedJsonRegex = /```json\s*([\s\S]*?)```/g;
let match;
let jsonBlock = null;

while ((match = fencedJsonRegex.exec(readme)) !== null) {
  if (match.index > markerIndex) {
    jsonBlock = match[1];
    break;
  }
}

if (!jsonBlock) {
  console.error("✗ README mcp.json code block not found after the MCP section heading.");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(jsonBlock);
} catch {
  console.error("✗ README mcp.json block is not valid JSON.");
  process.exit(1);
}

if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
  console.error("✗ README mcp.json block is missing `mcpServers`.");
  process.exit(1);
}

let failed = false;

for (const [serverKey, expectedPath] of Object.entries(expectedServers)) {
  const server = parsed.mcpServers[serverKey];

  if (!server) {
    console.error(`✗ README mcp.json missing server '${serverKey}'.`);
    failed = true;
    continue;
  }

  const args = Array.isArray(server.args) ? server.args : [];
  const hasExpectedPath = args.some((arg) =>
    String(arg).replace(/\\\\/g, "/").endsWith(expectedPath),
  );

  if (!hasExpectedPath) {
    console.error(`✗ Server '${serverKey}' args do not include '${expectedPath}'.`);
    failed = true;
    continue;
  }

  console.log(`✓ ${serverKey} path synchronized`);
}

if (failed) {
  console.error("\nMCP sync verification failed. Update README mcp.json block.");
  process.exit(1);
}

console.log("\nREADME mcp.json block is synchronized.");
