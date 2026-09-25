#!/usr/bin/env node
/**
 * LLM Toolkit CLI
 *
 * Usage: llm <command> [options]
 * Run `llm --help` for a full command listing.
 */

import { Command } from "commander";
import { registerAskCommand } from "./commands/ask";
import { registerBrowseCommand } from "./commands/browse";
import { registerCalcCommand } from "./commands/calc";
import { registerClockCommand } from "./commands/clock";
import { registerConfigCommands } from "./commands/config";
import { registerMemoryCommands } from "./commands/memory";
import { registerPythonCommands } from "./commands/python";
import { registerSkillsCommands } from "./commands/skills";
import { registerTerminalCommand } from "./commands/terminal";
import { registerToolsCommands } from "./commands/tools";
import { registerWorkflowCommands } from "./commands/workflow";

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
registerAskCommand(program);
registerWorkflowCommands(program);
registerConfigCommands(program);

program.parse(process.argv);
