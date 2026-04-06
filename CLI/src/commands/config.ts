/**
 * config — manage CLI configuration (tool endpoints, port overrides)
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { Command } from "commander";
import { TOOL_PORTS } from "../config";

export const CONFIG_FILE_PATH = path.join(os.homedir(), ".llm-config.json");

export type CliConfig = Record<string, string | number>;

export function loadConfig(filePath = CONFIG_FILE_PATH): CliConfig {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig, filePath = CONFIG_FILE_PATH): void {
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
}

export function registerConfigCommands(program: Command): void {
  const cfg = program.command("config").description("Manage CLI configuration");

  cfg
    .command("show")
    .description("Display current CLI configuration (defaults + overrides)")
    .option("--config-file <path>", "Path to config file", CONFIG_FILE_PATH)
    .action((opts: { configFile: string }) => {
      const overrides = loadConfig(opts.configFile);

      console.log("\nCLI Configuration:\n");
      console.log(`  Config file: ${opts.configFile}\n`);
      console.log("  Tool endpoints:\n");

      for (const [tool, defaultPort] of Object.entries(TOOL_PORTS)) {
        const portKey = `${tool}.port`;
        const hostKey = `${tool}.host`;
        const host = (overrides[hostKey] as string | undefined) ?? "localhost";
        const port = (overrides[portKey] as number | undefined) ?? defaultPort;
        const effective = `http://${host}:${port}`;
        const isOverridden = portKey in overrides || hostKey in overrides;
        const tag = isOverridden ? " (overridden)" : "";
        console.log(`  ${tool.padEnd(18)} ${effective}${tag}`);
      }

      if (Object.keys(overrides).length > 0) {
        console.log("\n  Overrides stored:\n");
        for (const [key, value] of Object.entries(overrides)) {
          console.log(`  ${key.padEnd(24)} ${value}`);
        }
      }

      console.log();
    });

  cfg
    .command("set <key> <value>")
    .description("Set a config value (e.g. calculator.port 4000, calculator.host 192.168.1.10)")
    .option("--config-file <path>", "Path to config file", CONFIG_FILE_PATH)
    .action((key: string, value: string, opts: { configFile: string }) => {
      const config = loadConfig(opts.configFile);
      // Coerce numeric strings to numbers for port keys
      const coerced: string | number = /\.port$/.test(key) ? parseInt(value, 10) : value;
      config[key] = coerced;
      saveConfig(config, opts.configFile);
      console.log(`Set ${key} = ${coerced}`);
    });
}
