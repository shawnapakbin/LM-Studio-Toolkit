#!/usr/bin/env node
/**
 * Preflight check for the official @browserless.io/mcp package.
 * Validates that Node.js 24+ is available (required by the official package).
 *
 * Exit codes:
 *   0 — All checks passed
 *   1 — Node.js version too low or not found
 */

"use strict";

const MIN_NODE_MAJOR = 24;

function main() {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);

  if (Number.isNaN(major)) {
    process.stderr.write(
      `[browserless-preflight] Unable to parse Node.js version: ${nodeVersion}\n`,
    );
    process.exit(1);
  }

  if (major < MIN_NODE_MAJOR) {
    process.stderr.write(
      `[browserless-preflight] Node.js ${nodeVersion} detected. ` +
        `The official @browserless.io/mcp package requires Node.js ${MIN_NODE_MAJOR}+.\n` +
        `Download the latest version at https://nodejs.org/\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `[browserless-preflight] Node.js ${nodeVersion} — OK (>= ${MIN_NODE_MAJOR})\n`,
  );
}

main();
