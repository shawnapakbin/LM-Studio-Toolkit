/**
 * Node-version-compliance check — the Phase B gate for dependency-refresh-node24.
 *
 * Feature: dependency-refresh-node24 (Requirements 1.6, 1.7)
 *
 * Thin I/O wrapper around the pure `check-node-24-core` compliance decision. It
 * scans the repository for every Node version reference the refresh must keep on
 * Node 24, evaluates each with the pure core, prints the result, and exits 0
 * when all references are compliant or non-zero listing each offending
 * `{ filePath, offendingValue }` otherwise (Req 1.7). Wired into CI as a gate.
 *
 * Sources scanned (design.md "Node-version-compliance check (new)"):
 *   - `engines.node` in the root and every workspace `package.json`.
 *   - the `.nvmrc` resolved major (when the file exists).
 *   - `node-version` in every `uses: actions/setup-node` step across both
 *     workflows (`.github/workflows/ci.yml`, `installer-release.yml`).
 *   - any Dockerfile / tool-config that pins a Node version (Req 1.6).
 *
 * The scan deliberately avoids a YAML/TOML dependency (matching the dependency-
 * free style of the other `scripts/workspace` checks): the two shapes it reads
 * — `engines` JSON fields and the `uses:`/`node-version:` step pairing — are
 * extracted with narrow, well-commented parsers.
 *
 * Run with: `tsx scripts/workspace/node-compliance/check-node-24.ts`.
 * Flags:
 *   --json   emit the full `NodeComplianceReport` as JSON instead of text.
 *
 * Exit code: 0 when every reference is compliant; 1 when one or more references
 * are non-compliant (each listed); 2 when the scan itself cannot run.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkNodeCompliance,
  type NodeComplianceReport,
  type NodeRefKind,
} from "./check-node-24-core.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/workspace/node-compliance -> repo root is three levels up.
const repoRoot = resolve(scriptDir, "..", "..", "..");

/** A reference extracted from the filesystem, ready for the pure core. */
interface ExtractedRef {
  filePath: string;
  kind: NodeRefKind;
  rawValue: string;
}

/** Repo-relative, forward-slash path for stable reporting. */
function repoRelative(absPath: string): string {
  return relative(repoRoot, absPath).replaceAll("\\", "/");
}

/**
 * Read a JSON file, returning `null` (and logging) when it is missing or
 * unparseable rather than throwing — a single unreadable workspace manifest
 * should not abort the whole scan.
 */
function readJsonSafe(absPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(absPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    console.error(`[node-24] could not read/parse ${repoRelative(absPath)}: ${String(err)}`);
    return null;
  }
}

/**
 * Extract the `engines.node` value from a parsed `package.json`, if declared.
 */
function enginesNode(pkg: Record<string, unknown> | null): string | null {
  if (!pkg) return null;
  const engines = pkg.engines;
  if (engines && typeof engines === "object" && !Array.isArray(engines)) {
    const node = (engines as Record<string, unknown>).node;
    if (typeof node === "string" && node.trim().length > 0) return node;
  }
  return null;
}

/** Collect `engines.node` refs from the root + every workspace package.json. */
function scanEngines(): ExtractedRef[] {
  const refs: ExtractedRef[] = [];

  const rootPkgPath = resolve(repoRoot, "package.json");
  const rootPkg = readJsonSafe(rootPkgPath);
  const rootEngines = enginesNode(rootPkg);
  if (rootEngines !== null) {
    refs.push({ filePath: repoRelative(rootPkgPath), kind: "engines", rawValue: rootEngines });
  }

  // Discover workspace dirs from the root `workspaces` array (single source of
  // truth) rather than hardcoding the list, so the scan tracks the real set.
  const workspaces = Array.isArray(rootPkg?.workspaces)
    ? (rootPkg?.workspaces as unknown[]).filter((w): w is string => typeof w === "string")
    : [];

  for (const ws of workspaces) {
    const wsPkgPath = resolve(repoRoot, ws, "package.json");
    if (!existsSync(wsPkgPath)) continue;
    const engines = enginesNode(readJsonSafe(wsPkgPath));
    if (engines !== null) {
      refs.push({ filePath: repoRelative(wsPkgPath), kind: "engines", rawValue: engines });
    }
  }

  return refs;
}

/** Collect the `.nvmrc` reference (Req 1.3), when the file exists. */
function scanNvmrc(): ExtractedRef[] {
  const nvmrcPath = resolve(repoRoot, ".nvmrc");
  if (!existsSync(nvmrcPath)) return [];
  const raw = readFileSync(nvmrcPath, "utf8").trim();
  if (raw.length === 0) return [];
  return [{ filePath: ".nvmrc", kind: "nvmrc", rawValue: raw }];
}

/**
 * Extract every `actions/setup-node` `node-version` from a workflow file.
 *
 * We avoid a YAML dependency: a `uses: actions/setup-node@…` step is always
 * followed (within its `with:` block) by a `node-version:` key. We scan lines,
 * and for each `uses: actions/setup-node` line we take the FIRST `node-version:`
 * that appears before the next `uses:` / `- name:` step boundary. This pairs
 * each setup-node step with its own version and ignores unrelated
 * `node-version`-looking text elsewhere.
 */
function extractSetupNodeVersions(filePath: string, content: string): ExtractedRef[] {
  const refs: ExtractedRef[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (!/\buses:\s*actions\/setup-node(@|\s|$)/.test(lines[i])) continue;

    // Walk forward to the version line, stopping at the next step boundary so a
    // setup-node step without a node-version does not borrow a later step's one.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      // Next step boundary: another `uses:` or a list-item `- name:`.
      if (/\buses:\s*\S/.test(line) || /^\s*-\s+name:/.test(line)) break;

      const m = /^\s*node-version:\s*(\S.*)$/.exec(line);
      if (m) {
        // Strip any trailing inline comment (split on the first `#`), then any
        // surrounding quotes.
        let value = m[1].split("#")[0].trim();
        value = value.replace(/^['"]/, "").replace(/['"]$/, "").trim();
        if (value.length > 0) {
          refs.push({ filePath, kind: "setup-node", rawValue: value });
        }
        break;
      }
    }
  }

  return refs;
}

/** Collect setup-node refs across both workflow files (Req 1.4, 1.5). */
function scanWorkflows(): ExtractedRef[] {
  const refs: ExtractedRef[] = [];
  const workflowDir = resolve(repoRoot, ".github", "workflows");
  for (const name of ["ci.yml", "installer-release.yml"]) {
    const absPath = join(workflowDir, name);
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, "utf8");
    refs.push(...extractSetupNodeVersions(repoRelative(absPath), content));
  }
  return refs;
}

/**
 * Collect Node pins from any Dockerfile in the repo (Req 1.6).
 *
 * A `FROM node:<tag>` line pins a Node version; the tag's leading version is the
 * reference. There are no Dockerfiles in the repo today, so this yields an empty
 * set, but the scanner is in place so a future Dockerfile is gated too.
 */
function scanDockerfiles(dockerfilePaths: string[]): ExtractedRef[] {
  const refs: ExtractedRef[] = [];
  for (const absPath of dockerfilePaths) {
    if (!existsSync(absPath)) continue;
    const content = readFileSync(absPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = /^\s*FROM\s+node:(\S+)/i.exec(line);
      if (m) {
        refs.push({ filePath: repoRelative(absPath), kind: "dockerfile", rawValue: m[1] });
      }
    }
  }
  return refs;
}

/** Run the full scan and produce the compliance report via the pure core. */
export function runScan(): NodeComplianceReport {
  const refs: ExtractedRef[] = [
    ...scanEngines(),
    ...scanNvmrc(),
    ...scanWorkflows(),
    // No Dockerfiles exist today; pass the known candidate path so a future
    // repo-root Dockerfile is picked up without further wiring.
    ...scanDockerfiles([resolve(repoRoot, "Dockerfile")]),
  ];
  return checkNodeCompliance(refs);
}

function main(): void {
  const asJson = process.argv.slice(2).includes("--json");
  let report: NodeComplianceReport;
  try {
    report = runScan();
  } catch (err) {
    console.error(`[node-24] scan failed: ${String(err)}`);
    process.exit(2);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[node-24] scanned ${report.refs.length} Node version reference(s):`);
    for (const ref of report.refs) {
      const mark = ref.compliant ? "ok  " : "FAIL";
      const major = ref.resolvedMajor === null ? "unparseable" : `major ${ref.resolvedMajor}`;
      console.log(
        `  [${mark}] ${ref.kind.padEnd(11)} ${ref.filePath} -> "${ref.rawValue}" (${major})`,
      );
    }
  }

  if (report.ok) {
    console.log(
      `[node-24] OK: all ${report.refs.length} Node version reference(s) target Node 24.`,
    );
    process.exit(0);
  }

  console.error(
    `[node-24] FAILED: ${report.offending.length} non-compliant Node version reference(s):`,
  );
  for (const off of report.offending) {
    console.error(
      `  - ${off.filePath}: "${off.offendingValue}" (must resolve to Node major 24 within >=24.0.0 <25.0.0)`,
    );
  }
  process.exit(1);
}

// Only run when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main();
}
