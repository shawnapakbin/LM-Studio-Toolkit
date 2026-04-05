#!/usr/bin/env node
/**
 * LLM Toolkit CLI
 *
 * Usage: llm <command> [options]
 * Run `llm --help` for a full command listing.
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { registerAskCommand } from "./commands/ask";
import { registerBrowseCommand } from "./commands/browse";
import { registerCalcCommand } from "./commands/calc";
import { registerClockCommand } from "./commands/clock";
import { registerConfigCommands } from "./commands/config";
import { registerEcmCommands } from "./commands/ecm";
import { registerMemoryCommands } from "./commands/memory";
import { registerRagCommands } from "./commands/rag";
import { registerSkillsCommands } from "./commands/skills";
import { registerTerminalCommand } from "./commands/terminal";
import { registerToolsCommands } from "./commands/tools";
import { registerWorkflowCommands } from "./commands/workflow";

dotenv.config();

const program = new Command();

program
  .name("llm")
  .description("LLM Toolkit CLI — invoke tools, manage memory, and run workflows")
  .version("1.0.0");

// Register all command groups
registerToolsCommands(program);
registerCalcCommand(program);
registerBrowseCommand(program);
registerClockCommand(program);
registerTerminalCommand(program);
registerSkillsCommands(program);
registerMemoryCommands(program);
registerEcmCommands(program);
registerRagCommands(program);
registerAskCommand(program);
registerWorkflowCommands(program);
registerConfigCommands(program);

// /compact shortcut — alias for `ecm compact`
program
  .command("compact")
  .description("/compact — compact ECM context memory for the current session")
  .option("-s, --session <id>", "Session ID (default: cli-session)")
  .option("--keep-newest <n>", "Newest segments to keep (default: 5)", parseInt)
  .action(async (opts: { session?: string; keepNewest?: number }) => {
    // Delegate to the ecm compact sub-command logic directly
    const { DEFAULT_ECM_SESSION, TOOL_ENDPOINTS } = await import("./config");
    const { toolPost, handleError } = await import("./http");

    const session = opts.session ?? DEFAULT_ECM_SESSION;
    const keepNewest = opts.keepNewest ?? 5;

    console.log(`Compacting session "${session}" (keeping ${keepNewest} newest segments)...`);
    try {
      const summary = await toolPost(`${TOOL_ENDPOINTS.ecm}/tools/ecm`, {
        action: "summarize_session",
        sessionId: session,
        keepNewest,
      });
      console.log("\nSummary written:");
      console.log(JSON.stringify(summary, null, 2));

      const list = (await toolPost(`${TOOL_ENDPOINTS.ecm}/tools/ecm`, {
        action: "list_segments",
        sessionId: session,
        limit: 1,
      })) as Record<string, unknown>;

      const data = list.data as Record<string, unknown> | undefined;
      const total = data?.total ?? "unknown";
      console.log(`\nContext compacted. Segments remaining: ${total}`);
    } catch (err) {
      handleError(err);
    }
  });

program.parse(process.argv);
