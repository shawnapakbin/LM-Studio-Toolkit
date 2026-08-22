#!/usr/bin/env node
/**
 * migrate-config CLI entry point.
 *
 * Parses command-line arguments and invokes the migrateConfig function.
 *
 * Usage:
 *   migrate-config [--format yaml|json] [--env-path <path>] [--output <path>]
 *
 * @module @shared/config/migrate-cli
 */

import { type MigrateOptions, migrateConfig } from "./migrate";

/**
 * Parses CLI arguments from process.argv.
 */
function parseArgs(argv: string[]): Partial<MigrateOptions> {
  const args = argv.slice(2); // Skip node and script path
  const options: Partial<MigrateOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--format": {
        i++;
        const fmt = args[i];
        if (fmt === "yaml" || fmt === "json") {
          options.format = fmt;
        } else {
          process.stderr.write(`Error: Invalid format '${fmt}'. Must be 'yaml' or 'json'.\n`);
          process.exit(1);
        }
        break;
      }

      case "--env-path":
        i++;
        if (args[i]) {
          options.envPath = args[i];
        } else {
          process.stderr.write("Error: --env-path requires a path argument.\n");
          process.exit(1);
        }
        break;

      case "--output":
        i++;
        if (args[i]) {
          options.outputPath = args[i];
        } else {
          process.stderr.write("Error: --output requires a path argument.\n");
          process.exit(1);
        }
        break;

      case "--help":
      case "-h":
        process.stdout.write(
          `Usage: migrate-config [options]

Options:
  --format <yaml|json>   Output format (default: yaml)
  --env-path <path>      Path to .env file (default: ./.env)
  --output <path>        Output config file path (default: ./llm-toolkit.config.yaml)
  --help, -h             Show this help message
`,
        );
        process.exit(0);
        break;

      default:
        process.stderr.write(`Warning: Unknown argument '${arg}' ignored.\n`);
        break;
    }
  }

  return options;
}

// Main execution
const options = parseArgs(process.argv);
migrateConfig(options);
