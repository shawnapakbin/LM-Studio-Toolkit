/**
 * skills — manage and execute Skills playbooks
 */

import fs from "fs";
import type { Command } from "commander";
import { TOOL_ENDPOINTS } from "../config";
import { handleError, printResult, toolPost } from "../http";

async function skillsPost(body: unknown): Promise<unknown> {
  return toolPost(`${TOOL_ENDPOINTS.skills}/tools/skills`, body);
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command("skills").description("Manage and execute Skills playbooks");

  skills
    .command("list")
    .description("List all defined skills")
    .action(async () => {
      try {
        printResult(await skillsPost({ action: "list_skills" }));
      } catch (err) {
        handleError(err);
      }
    });

  skills
    .command("get <name>")
    .description("Get details of a skill by name")
    .action(async (name: string) => {
      try {
        printResult(await skillsPost({ action: "get_skill", name }));
      } catch (err) {
        handleError(err);
      }
    });

  skills
    .command("run <name>")
    .description("Execute a skill by name")
    .option("-p, --params <json>", 'JSON params for the skill  e.g. \'{"key":"value"}\'')
    .action(async (name: string, opts: { params?: string }) => {
      let params: Record<string, unknown> = {};
      if (opts.params) {
        try {
          params = JSON.parse(opts.params);
        } catch {
          console.error("Invalid JSON for --params");
          process.exit(1);
        }
      }
      try {
        printResult(await skillsPost({ action: "execute_skill", name, params }));
      } catch (err) {
        handleError(err);
      }
    });

  skills
    .command("define <file>")
    .description("Define a skill from a JSON file")
    .action(async (file: string) => {
      let payload: unknown;
      try {
        payload = JSON.parse(fs.readFileSync(file, "utf-8"));
      } catch {
        console.error(`Could not read or parse file: ${file}`);
        process.exit(1);
      }
      try {
        printResult(await skillsPost({ action: "define_skill", ...(payload as object) }));
      } catch (err) {
        handleError(err);
      }
    });

  skills
    .command("delete <name>")
    .description("Delete a skill by name")
    .action(async (name: string) => {
      try {
        printResult(await skillsPost({ action: "delete_skill", name }));
      } catch (err) {
        handleError(err);
      }
    });
}
