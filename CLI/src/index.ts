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
import { registerPythonCommands } from "./commands/python";
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
registerPythonCommands(program);
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
  .option("--used <n>", "Current used tokens (forces compaction trigger)", parseInt)
  .option("--limit <n>", "Model context limit", parseInt)
  .option("--keep-newest <n>", "Newest segments to keep (default: 4)", parseInt)
  .option("--threshold <n>", "Trigger ratio in (0, 1] (default: 0.5)", parseFloat)
  .action(
    async (opts: {
      session?: string;
      used?: number;
      limit?: number;
      keepNewest?: number;
      threshold?: number;
    }) => {
      const { DEFAULT_ECM_SESSION, TOOL_ENDPOINTS } = await import("./config");
      const { toolPost, handleError } = await import("./http");

      const session = opts.session ?? DEFAULT_ECM_SESSION;
      const limit = opts.limit ?? 8192;
      const used = opts.used ?? limit;

      console.log(`Compacting session "${session}"...`);
      try {
        const result = await toolPost(`${TOOL_ENDPOINTS.ecm}/tools/ecm`, {
          action: "on_user_turn",
          sessionId: session,
          currentUsedTokens: used,
          contextLimit: limit,
          ...(opts.keepNewest !== undefined && { keepNewest: opts.keepNewest }),
          ...(opts.threshold !== undefined && { threshold: opts.threshold }),
        });
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        handleError(err);
      }
    },
  );

program.parse(process.argv);
