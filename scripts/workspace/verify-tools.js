#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

const { TOOL_REGISTRY } = require(path.join(repoRoot, "shared", "dist", "tools.js"));
const tools = TOOL_REGISTRY;

let failed = false;

for (const tool of tools) {
  const srcPath = path.join(repoRoot, tool.srcFile);
  const distPath = path.join(repoRoot, tool.distFile);

  if (!fs.existsSync(srcPath)) {
    console.error(`✗ ${tool.name}: missing source MCP server: ${tool.srcFile}`);
    failed = true;
    continue;
  }

  if (!fs.existsSync(distPath)) {
    console.error(`✗ ${tool.name}: missing built MCP binary: ${tool.distFile}`);
    failed = true;
    continue;
  }

  console.log(`✓ ${tool.name}: ${tool.distFile}`);
}

if (failed) {
  console.error("\nTool verification failed. Run `npm run build` and retry.");
  process.exit(1);
}

console.log("\nAll MCP tool binaries are present.");
