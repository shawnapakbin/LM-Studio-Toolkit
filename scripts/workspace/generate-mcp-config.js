#!/usr/bin/env node

/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

const { buildMcpServers } = require("./mcp-config");

const { mcpServers, missingBuilds } = buildMcpServers();

if (missingBuilds.length > 0) {
  console.error("Warning: some MCP binaries are missing. Run `npm run build` first.");
  for (const missing of missingBuilds) {
    console.error(` - ${missing}`);
  }
  console.error("");
}

process.stdout.write(`${JSON.stringify({ mcpServers }, null, "\t")}\n`);
