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

const { TOOL_REGISTRY } = require(path.join(repoRoot, "shared", "dist", "tools.js"));
const tools = TOOL_REGISTRY;

function smokeTest(tool) {
  return new Promise((resolve) => {
    const fullPath = path.join(repoRoot, tool.distFile);
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
