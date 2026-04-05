/**
 * tools — list registered tools and check health
 */

import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, toolGet } from "../http";

export function registerToolsCommands(program: Command): void {
  const tools = program.command("tools").description("Manage and inspect registered tools");

  tools
    .command("list")
    .description("List all registered tools and their endpoints")
    .action(() => {
      console.log("\nRegistered tools:\n");
      for (const [name, endpoint] of Object.entries(TOOL_ENDPOINTS)) {
        console.log(`  ${name.padEnd(16)} ${endpoint}`);
      }
      console.log();
    });

  tools
    .command("health")
    .description("Run health checks across all tools")
    .option("-t, --tool <name>", "Check a specific tool only")
    .action(async (opts: { tool?: string }) => {
      const targets = opts.tool ? { [opts.tool]: TOOL_ENDPOINTS[opts.tool] } : TOOL_ENDPOINTS;

      if (opts.tool && !TOOL_ENDPOINTS[opts.tool]) {
        console.error(`Unknown tool: ${opts.tool}`);
        process.exit(1);
      }

      console.log("\nHealth checks:\n");
      for (const [name, endpoint] of Object.entries(targets)) {
        try {
          const res = (await toolGet(`${endpoint}/health`)) as Record<string, unknown>;
          const ok = res.ok ? "✓ healthy" : "✗ unhealthy";
          console.log(`  ${name.padEnd(16)} ${ok}`);
        } catch {
          console.log(`  ${name.padEnd(16)} ✗ unreachable`);
        }
      }
      console.log();
    });

  tools
    .command("schema <tool>")
    .description("Print the input schema for a tool")
    .action(async (toolName: string) => {
      const endpoint = TOOL_ENDPOINTS[toolName];
      if (!endpoint) {
        console.error(`Unknown tool: ${toolName}`);
        process.exit(1);
      }
      try {
        const schema = await toolGet(`${endpoint}/tool-schema`);
        console.log(JSON.stringify(schema, null, 2));
      } catch (err) {
        handleError(err);
      }
    });
}
