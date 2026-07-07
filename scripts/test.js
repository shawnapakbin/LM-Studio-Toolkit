#!/usr/bin/env node

/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */


/**
 * Basic integration test suite for MCP Toolkit
 * 
 * Tests:
 * - Build compilation
 * - RAG vector store initialization
 * - Dependencies installation
 * - Configuration validity
 * 
 * Run: node scripts/test.js
 */

import { promises as fs } from "fs";
import { execSync } from "child_process";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then((success) => {
          if (success) {
            console.log(`${GREEN}✓${RESET} ${name}`);
            passCount++;
          } else {
            console.log(`${RED}✗${RESET} ${name}`);
            failCount++;
          }
        })
        .catch((error) => {
          console.log(`${RED}✗${RESET} ${name}: ${error.message}`);
          failCount++;
        });
    } else {
      if (result) {
        console.log(`${GREEN}✓${RESET} ${name}`);
        passCount++;
      } else {
        console.log(`${RED}✗${RESET} ${name}`);
        failCount++;
      }
    }
  } catch (error) {
    console.log(`${RED}✗${RESET} ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failCount++;
  }
}

async function runTests() {
  console.log(`\n${YELLOW}Running MCP Toolkit Integration Tests${RESET}\n`);

  // Test 1: Build succeeds
  test("Build TypeScript", () => {
    try {
      execSync("npm run build", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  });

  // Test 2: Dist files exist
  test("Dist files generated", async () => {
    const files = [
      "dist/servers/browser.js",
      "dist/servers/terminal.js",
      "dist/servers/filesystem.js",
      "dist/servers/calculator.js",
      "dist/servers/calendar.js",
      "dist/servers/proxy-gateway.js",
      "dist/servers/rag.js"
    ];

    for (const file of files) {
      try {
        await fs.access(file);
      } catch {
        return false;
      }
    }
    return true;
  });

  // Test 3: .vscode/mcp.json is valid
  test("MCP config valid JSON", async () => {
    try {
      const content = await fs.readFile(".vscode/mcp.json", "utf-8");
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  });

  // Test 4: .vscode/mcp.json has all servers
  test("MCP config has 6 servers", async () => {
    try {
      const content = await fs.readFile(".vscode/mcp.json", "utf-8");
      const config = JSON.parse(content);
      const expectedServers = [
        "browser-tools",
        "terminal-tools",
        "filesystem-tools",
        "calculator-tools",
        "calendar-tools",
        "rag-tools"
      ];

      return expectedServers.every((server) => server in config.servers);
    } catch {
      return false;
    }
  });

  // Test 5: rag-data directory can be created
  test("RAG data directory access", async () => {
    try {
      await fs.mkdir("rag-data", { recursive: true });
      return true;
    } catch {
      return false;
    }
  });

  // Test 6: README documents new features
  test("README documents browser tools", async () => {
    try {
      const content = await fs.readFile("README.md", "utf-8");
      return (
        content.includes("fetch_page_rendered") &&
        content.includes("RAG Server") &&
        content.includes("ingest_webpage")
      );
    } catch {
      return false;
    }
  });

  // Test 7: QUICKSTART-RAG.md exists
  test("RAG quickstart guide exists", async () => {
    try {
      await fs.access("QUICKSTART-RAG.md");
      return true;
    } catch {
      return false;
    }
  });

  // Test 8: package.json has all scripts
  test("Package.json has all npm scripts", async () => {
    try {
      const content = await fs.readFile("package.json", "utf-8");
      const pkg = JSON.parse(content);
      const expectedScripts = [
        "build",
        "proxy",
        "start:browser",
        "start:terminal",
        "start:filesystem",
        "start:calculator",
        "start:calendar",
        "start:rag"
      ];

      return expectedScripts.every((script) => script in pkg.scripts);
    } catch {
      return false;
    }
  });

  // Test 9: Dependencies installed
  test("Dependencies installed", async () => {
    try {
      await fs.access("node_modules");
      return true;
    } catch {
      return false;
    }
  });

  // Test 10: Key dependencies present
  test("Key packages installed", async () => {
    const packages = [
      "@modelcontextprotocol/sdk",
      "playwright",
      "cheerio",
      "zod",
      "pdf-parse",
      "mammoth"
    ];

    for (const pkg of packages) {
      try {
        await fs.access(`node_modules/${pkg}`);
      } catch {
        return false;
      }
    }
    return true;
  });

  // Summary
  setTimeout(() => {
    console.log(`\n${YELLOW}Test Summary${RESET}`);
    console.log(`  Total:  ${testCount}`);
    console.log(`  ${GREEN}Passed: ${passCount}${RESET}`);
    if (failCount > 0) {
      console.log(`  ${RED}Failed: ${failCount}${RESET}`);
    }

    if (failCount === 0) {
      console.log(`\n${GREEN}All tests passed! ✓${RESET}\n`);
      process.exit(0);
    } else {
      console.log(`\n${RED}Some tests failed${RESET}\n`);
      process.exit(1);
    }
  }, 1000);
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
