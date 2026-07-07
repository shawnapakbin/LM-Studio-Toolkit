/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

const fs = require("fs");
const path = require("path");

const rootDist = path.resolve(__dirname, "..", "dist");
const nestedDist = path.join(rootDist, "SlashCommands", "src");

if (!fs.existsSync(nestedDist)) {
  process.exit(0);
}

for (const fileName of ["mcp-server.js", "parser.js", "router.js", "dispatch.js", "config.js"]) {
  const source = path.join(nestedDist, fileName);
  const target = path.join(rootDist, fileName);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
  }
}
