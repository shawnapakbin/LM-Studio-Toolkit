#!/usr/bin/env node
/**
 * Test SubAgent MCP tool directly using the MCP SDK client transport.
 *
 * Usage: node scripts/test-subagent-mcp.js
 *
 * Prerequisites:
 *   - LM Studio running with a model loaded on localhost:1234
 *   - No active chat sessions using the model
 *   - SubAgent built: npx tsc -p SubAgent/tsconfig.json
 */

const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SERVER_SCRIPT = path.join(REPO_ROOT, "SubAgent", "dist", "mcp-server.js");

async function main() {
  // Dynamically import the MCP SDK (ESM)
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  console.log("Starting SubAgent MCP server...\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_SCRIPT],
    env: {
      ...process.env,
      SUBAGENT_API_URL: process.env.SUBAGENT_API_URL || "http://localhost:1234/v1/chat/completions",
      SUBAGENT_MODEL: process.env.SUBAGENT_MODEL || "default",
      SUBAGENT_MAX_CONCURRENCY: "3",
    },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });

  await client.connect(transport);
  console.log("✓ Connected to SubAgent MCP server\n");

  // List tools
  console.log("--- Listing tools ---");
  const tools = await client.listTools();
  console.log(`Tools available: ${tools.tools.map((t) => t.name).join(", ")}\n`);

  // Dispatch simple test
  console.log("--- Dispatching test sub-tasks ---");
  console.log("    2 simple prompts, no allowedTools, concurrency=2");
  console.log("    Waiting for LM Studio inference...\n");

  const startTime = Date.now();

  try {
    const result = await client.callTool({
      name: "dispatch_sub_tasks",
      arguments: {
        tasks: [
          {
            taskId: "math-test",
            prompt: "What is 2+2? Answer in exactly one sentence.",
          },
          {
            taskId: "greeting-test",
            prompt: "Say hello in 3 different languages. One sentence each.",
          },
        ],
        temperature: 0.3,
        maxTokens: 256,
        concurrency: 2,
        taskTimeout: 60,
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✓ Dispatch completed in ${elapsed}s\n`);

    // Parse the result
    const text = result.content?.[0]?.text;
    if (text) {
      const parsed = JSON.parse(text);
      console.log(`Status: ${parsed.status}`);
      console.log(`Dispatch ID: ${parsed.dispatchId}`);
      console.log(`\nTask Results:`);
      for (const task of parsed.tasks || []) {
        console.log(`  [${task.taskId}] ${task.status}`);
        if (task.response) {
          const snippet = task.response.slice(0, 200);
          const ellipsis = task.response.length > 200 ? "..." : "";
          console.log(`    Response: ${snippet}${ellipsis}`);
        }
        if (task.error) {
          console.log(`    Error: ${task.error.type} — ${task.error.message}`);
        }
        if (task.telemetry) {
          console.log(
            `    Tokens: ${task.telemetry.totalTokens}, Duration: ${task.telemetry.wallClockMs}ms`,
          );
        }
      }
      if (parsed.telemetrySummary) {
        console.log(`\nTelemetry Summary:`);
        const totalTokens =
          parsed.telemetrySummary.totalPromptTokens + parsed.telemetrySummary.totalCompletionTokens;
        console.log(`  Total tokens: ${totalTokens}`);
        console.log(`  Wall clock: ${parsed.telemetrySummary.totalWallClockMs}ms`);
      }
    } else {
      console.log("Raw result:", JSON.stringify(result, null, 2));
    }
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n✗ Dispatch failed after ${elapsed}s:`, err.message);
  }

  await client.close();
  console.log("\n✓ Done");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
