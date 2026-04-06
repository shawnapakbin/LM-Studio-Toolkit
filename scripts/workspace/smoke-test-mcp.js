#!/usr/bin/env node
/**
 * MCP server smoke test — spawns each compiled MCP binary and verifies it
 * starts without crashing within a short window. The process must still be
 * alive after STABLE_MS milliseconds (i.e. it did not exit immediately).
 *
 * All servers communicate over stdio so they stay alive indefinitely when
 * not connected to a client. We simply check that they haven't terminated.
 */
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");

const STABLE_MS = 600;

const tools = [
  { name: "Terminal", dist: "Terminal/dist/mcp-server.js" },
  { name: "WebBrowser", dist: "WebBrowser/dist/mcp-server.js" },
  { name: "Calculator", dist: "Calculator/dist/mcp-server.js" },
  { name: "DocumentScraper", dist: "DocumentScraper/dist/mcp-server.js" },
  { name: "Clock", dist: "Clock/dist/mcp-server.js" },
  { name: "Browserless", dist: "Browserless/dist/mcp-server.js" },
  { name: "AskUser", dist: "AskUser/dist/mcp-server.js" },
  { name: "RAG", dist: "RAG/dist/mcp-server.js" },
  { name: "Skills", dist: "Skills/dist/mcp-server.js" },
  { name: "ECM", dist: "ECM/dist/mcp-server.js" },
  { name: "SlashCommands", dist: "SlashCommands/dist/mcp-server.js" },
];

function smokeTest(tool) {
  return new Promise((resolve) => {
    const fullPath = path.join(repoRoot, tool.dist);
    let exitCode = null;
    let stderr = "";

    const child = spawn(process.execPath, [fullPath], {
      cwd: repoRoot,
      stdio: ["pipe", "ignore", "pipe"],
      env: {
        ...process.env,
        RAG_DB_PATH: ":memory:",
        RAG_EMBEDDINGS_MODE: "mock",
        RAG_BYPASS_APPROVAL: "true",
      },
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      exitCode = code;
    });

    setTimeout(() => {
      if (exitCode !== null) {
        const hint = stderr.trim() ? `\n  stderr: ${stderr.trim().split("\n")[0]}` : "";
        console.error(`✗ ${tool.name}: exited with code ${exitCode} within ${STABLE_MS}ms${hint}`);
        resolve(false);
      } else {
        child.kill();
        console.log(`✓ ${tool.name}: stable after ${STABLE_MS}ms`);
        resolve(true);
      }
    }, STABLE_MS);
  });
}

async function main() {
  let failed = false;
  for (const tool of tools) {
    const ok = await smokeTest(tool);
    if (!ok) failed = true;
  }
  if (failed) {
    process.exit(1);
  }
}

main();
