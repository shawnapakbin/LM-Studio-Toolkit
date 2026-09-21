#!/usr/bin/env node
/**
 * verify-mcp-sync.js — Plugin-registration correctness gate
 *
 * Validates that the MCP plugin registration in `mcp-config.js` is correct and
 * consistent with the plugin-only configuration model. This script performs
 * READ-ONLY checks and preserves the exit-code contract expected by
 * `startup-check.js` (exit 0 on pass, non-zero on failure with per-offense
 * diagnostics).
 *
 * Checks:
 *   1. Registration source is authoritative — the registered server set from
 *      buildMcpServers() equals the intended runtime-server set.
 *   2. Artifact resolution — each non-external server's relativeScript resolves
 *      to its built-artifact path (via missingBuilds); each unresolved
 *      workspace is reported by name.
 *   3. Count assertion — the registered plugin-entry count equals 16.
 *   4. No top-level mcp.json toolkit entries — zero `_owner: "llm-toolkit"`
 *      entries remain in the top-level mcp.json; each offender is named.
 *   5. README hygiene — README contains no `mcp.json` example block and no
 *      instruction to create/open/edit `mcp.json` by hand.
 *
 * The pure detection helpers (README hygiene, registration/count/path checks)
 * are exported so they can be exercised directly by the self-tests without
 * depending on the live README or executing the CLI gate. The CLI gate only
 * runs when this file is executed directly (`require.main === module`).
 *
 * Developed by: revDigit.link | Shawna Pakbin
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildMcpServers } = require("./mcp-config");
const { OWNER_ID, LEGACY_PLUGIN_NAMES, readJsonSafe } = require("./plugin-ownership");

const repoRoot = path.resolve(__dirname, "..", "..");

// ─── Authoritative intended runtime-server set (Component 4, count = 16) ──────
const INTENDED_RUNTIME_SERVERS = [
  "terminal",
  "web-browser",
  "common",
  "browserless",
  "rag",
  "python-shell",
  "skills",
  "slash-commands",
  "blender-bridge",
  "3dtool",
  "sub-agent",
  "lan-sub-agent",
  "git",
  "package-manager",
  "csv-exporter",
  "file-editor",
];

const EXPECTED_COUNT = 16;

// ─── Pure detection helpers (exported for self-tests) ─────────────────────────

/**
 * Compare the registered server set against the intended runtime-server set.
 *
 * @param {string[]} registeredNames - keys of the built mcpServers map
 * @param {string[]} [intended] - intended runtime-server names
 * @returns {{ missing: string[], unexpected: string[], ok: boolean }}
 */
function checkRegistrationSet(registeredNames, intended = INTENDED_RUNTIME_SERVERS) {
  const registeredSet = new Set(registeredNames);
  const intendedSet = new Set(intended);
  const missing = intended.filter((name) => !registeredSet.has(name));
  const unexpected = registeredNames.filter((name) => !intendedSet.has(name));
  return { missing, unexpected, ok: missing.length === 0 && unexpected.length === 0 };
}

/**
 * Assert the registered plugin-entry count equals the expected count.
 *
 * @param {number} count - number of registered entries
 * @param {number} [expected] - expected count (default 16)
 * @returns {{ ok: boolean, count: number, expected: number }}
 */
function checkCount(count, expected = EXPECTED_COUNT) {
  return { ok: count === expected, count, expected };
}

/**
 * Identify toolkit-owned entries in a top-level mcp.json structure. An entry is
 * toolkit-owned when its key matches a registered runtime-server name, a legacy
 * plugin name, or the entry carries the `_owner: "llm-toolkit"` marker.
 *
 * @param {object|null} topLevel - parsed top-level mcp.json (or null if absent)
 * @param {Set<string>} toolkitOwnedNames - registered + legacy names
 * @returns {string[]} offending entry names
 */
function findTopLevelOffenders(topLevel, toolkitOwnedNames) {
  if (!topLevel || typeof topLevel !== "object" || !topLevel.mcpServers) {
    return [];
  }
  const offenders = [];
  for (const [name, entry] of Object.entries(topLevel.mcpServers)) {
    const isNamedToolkit = toolkitOwnedNames.has(name);
    const isMarkedToolkit = entry && typeof entry === "object" && entry._owner === OWNER_ID;
    if (isNamedToolkit || isMarkedToolkit) {
      offenders.push(name);
    }
  }
  return offenders;
}

/**
 * Detect README hygiene offenses in arbitrary README content. Pure over the
 * provided string so it can be exercised against clean/dirty fixtures without
 * depending on the live README.
 *
 * Flags:
 *   - an `mcp.json` example section heading
 *   - a fenced JSON block embedding an `mcpServers` object (the example block)
 *   - an instruction to create/open/edit/update/add-to `mcp.json` by hand
 *
 * @param {string} readme - README content to scan
 * @returns {string[]} list of offense descriptions (empty ⇒ clean)
 */
function findReadmeOffenses(readme) {
  const offenses = [];
  if (!readme) {
    return offenses;
  }

  // No `mcp.json` example section heading.
  if (/^#{1,6}\s.*mcp\.json.*example/im.test(readme)) {
    offenses.push("README contains an 'mcp.json Example' section heading.");
  }

  // No fenced JSON block that embeds an `mcpServers` object (the example block).
  const fencedJsonRegex = /```json\s*([\s\S]*?)```/g;
  let jsonMatch;
  while ((jsonMatch = fencedJsonRegex.exec(readme)) !== null) {
    if (/"mcpServers"\s*:/.test(jsonMatch[1])) {
      offenses.push("README contains an embedded `mcp.json` example block (mcpServers).");
      break;
    }
  }

  // No instruction to create/open/edit/update/add-to `mcp.json` by hand.
  const handEditRegex =
    /\b(create|open|edit|update|modify|add\s+.+\s+to|paste\s+.+\s+into)\b[^\n.`]*`?mcp\.json`?/i;
  if (handEditRegex.test(readme)) {
    offenses.push("README contains a hand-edit instruction referencing `mcp.json`.");
  }

  return offenses;
}

// ─── CLI gate ─────────────────────────────────────────────────────────────────

function runCli() {
  const failures = [];

  const fail = (message) => {
    failures.push(message);
    console.error(`✗ ${message}`);
  };
  const pass = (message) => {
    console.log(`✓ ${message}`);
  };

  // ─── Check 1: Registration set equals intended runtime-server set ───────────
  const { mcpServers, missingBuilds } = buildMcpServers();
  const registeredNames = Object.keys(mcpServers);
  const { missing, unexpected } = checkRegistrationSet(registeredNames);

  for (const name of missing) {
    fail(`Intended runtime server '${name}' is not registered in mcp-config.js.`);
  }
  for (const name of unexpected) {
    fail(`Registered server '${name}' is not part of the intended runtime-server set.`);
  }
  if (missing.length === 0 && unexpected.length === 0) {
    pass("Registered server set equals the intended runtime-server set.");
  }

  // ─── Check 2: Artifact resolution ───────────────────────────────────────────
  if (missingBuilds.length === 0) {
    pass("All non-external server artifacts resolve to their built paths.");
  } else {
    for (const relativeScript of missingBuilds) {
      fail(`Unresolved built artifact: '${relativeScript}' (workspace not built).`);
    }
  }

  // ─── Check 3: Registered plugin-entry count equals 16 ───────────────────────
  const countResult = checkCount(registeredNames.length);
  if (countResult.ok) {
    pass(`Registered plugin-entry count equals ${EXPECTED_COUNT}.`);
  } else {
    fail(`Registered plugin-entry count is ${countResult.count}, expected ${EXPECTED_COUNT}.`);
  }

  // ─── Check 4: No toolkit-owned entries in top-level mcp.json ────────────────
  const toolkitOwnedNames = new Set([...registeredNames, ...LEGACY_PLUGIN_NAMES]);
  const topLevelMcpJsonPath = path.join(os.homedir(), ".lmstudio", "mcp.json");
  const topLevel = readJsonSafe(topLevelMcpJsonPath);

  if (!topLevel || typeof topLevel !== "object" || !topLevel.mcpServers) {
    pass("No toolkit-owned entries in top-level mcp.json (file absent or empty).");
  } else {
    const offenders = findTopLevelOffenders(topLevel, toolkitOwnedNames);
    if (offenders.length === 0) {
      pass("No toolkit-owned entries in top-level mcp.json.");
    } else {
      for (const name of offenders) {
        fail(`Toolkit-owned entry '${name}' found in top-level mcp.json (must be plugin-only).`);
      }
    }
  }

  // ─── Check 5: README hygiene ────────────────────────────────────────────────
  const readmePath = path.join(repoRoot, "README.md");
  let readme = "";
  try {
    readme = fs.readFileSync(readmePath, "utf8");
  } catch (err) {
    fail(`Unable to read README.md: ${err.message}`);
  }

  if (readme) {
    const readmeOffenses = findReadmeOffenses(readme);
    if (readmeOffenses.length === 0) {
      pass("README contains no `mcp.json` example block or hand-edit instruction.");
    } else {
      for (const offense of readmeOffenses) {
        fail(offense);
      }
    }
  }

  // ─── Result ───────────────────────────────────────────────────────────────
  if (failures.length > 0) {
    console.error(
      `\nMCP plugin-registration verification failed with ${failures.length} issue(s).`,
    );
    process.exit(1);
  }

  console.log("\nMCP plugin-registration verification passed.");
}

module.exports = {
  INTENDED_RUNTIME_SERVERS,
  EXPECTED_COUNT,
  checkRegistrationSet,
  checkCount,
  findTopLevelOffenders,
  findReadmeOffenses,
  runCli,
};

if (require.main === module) {
  runCli();
}
