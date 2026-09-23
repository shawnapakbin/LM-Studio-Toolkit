/**
 * Pure payload-staging planner for the LLM Toolkit installer.
 *
 * Feature: windows-installer-setup-exe (Requirements 3.2, 3.3)
 *
 * This module contains ONLY pure functions and the checked-in canonical list of
 * the 16 MCP tools (server name -> relative `dist` root). It mirrors the Rust
 * source of truth in `Installer/src-tauri/src/tool_payload.rs`, which in turn
 * mirrors `scripts/workspace/mcp-config.js`. Keeping the "which tools exist and
 * where their dist trees live" decision in one pure place lets the staging
 * script (`stage-payload.ts`) and its test drive the exact same logic that
 * decides completeness and the missing set.
 *
 * Design contract (Requirement 3.3):
 *   If any of the 16 tools' `dist` root is absent or EMPTY at build time, the
 *   build must abort before `tauri build` and name every missing/empty tool.
 *   `planPayloadStaging` computes exactly that `missing` set; the I/O wrapper
 *   turns a non-empty `missing` set into a non-zero exit.
 */

/** A single MCP tool's contribution to the bundled payload. */
export interface ToolPayload {
  /**
   * The MCP server name, e.g. `"terminal"`, `"3dtool"`, `"file-editor"`.
   * Matches the server key in `scripts/workspace/mcp-config.js` and the
   * per-server LM Studio plugin directory name.
   */
  serverName: string;
  /**
   * The tool's prebuilt output directory, relative to the repository root,
   * e.g. `"Terminal/dist"`, `"FileEditor/dist/FileEditor/src"`.
   */
  distRoot: string;
}

/** The number of canonical MCP tools bundled into the installer. */
export const CANONICAL_TOOL_COUNT = 16;

/**
 * The canonical 16 MCP tools: server name -> relative `dist` root.
 *
 * Mirrors `CANONICAL_TOOL_PAYLOADS` in `tool_payload.rs` exactly. Each
 * `distRoot` is the parent directory of that server's emitted entry script in
 * `scripts/workspace/mcp-config.js` (the trailing `mcp-server.js` /
 * `schema-proxy.js` removed).
 */
export const CANONICAL_TOOL_PAYLOADS: readonly ToolPayload[] = [
  { serverName: "terminal", distRoot: "Terminal/dist" },
  { serverName: "web-browser", distRoot: "WebBrowser/dist" },
  { serverName: "common", distRoot: "mcp/common/dist" },
  { serverName: "browserless", distRoot: "Browserless/scripts" },
  { serverName: "rag", distRoot: "RAG/dist" },
  { serverName: "python-shell", distRoot: "PythonShell/dist" },
  { serverName: "skills", distRoot: "Skills/dist" },
  { serverName: "slash-commands", distRoot: "SlashCommands/dist" },
  { serverName: "blender-bridge", distRoot: "BlenderBridge/dist" },
  { serverName: "3dtool", distRoot: "3DTool/dist" },
  { serverName: "sub-agent", distRoot: "SubAgent/dist" },
  { serverName: "lan-sub-agent", distRoot: "LanSubAgent/dist/LanSubAgent/src" },
  { serverName: "git", distRoot: "Git/dist/Git/src" },
  { serverName: "package-manager", distRoot: "PackageManager/dist/PackageManager/src" },
  { serverName: "csv-exporter", distRoot: "CSVExporter/dist" },
  { serverName: "file-editor", distRoot: "FileEditor/dist/FileEditor/src" },
] as const;

/** A tool's staging descriptor: what to copy, from where, to where. */
export interface StagingEntry {
  /** The MCP server name; also the per-tool subdirectory under the staging root. */
  serverName: string;
  /** Repo-root-relative source `dist` root, e.g. `"Terminal/dist"`. */
  distRoot: string;
}

/**
 * Presence facts for a single tool's `dist` root, as observed on disk by the
 * I/O layer. Kept separate from the pure planner so the planner stays testable.
 */
export interface DistPresence {
  serverName: string;
  /** True iff the `dist` root exists as a directory. */
  exists: boolean;
  /** True iff the `dist` root contains at least one file/entry (non-empty). */
  nonEmpty: boolean;
}

/** The pure result of planning the payload staging. */
export interface PayloadStagingPlan {
  /** Every canonical tool that must be staged (the full 16). */
  required: StagingEntry[];
  /** Server names found present AND non-empty, sorted. */
  present: string[];
  /**
   * Server names whose `dist` root is absent OR empty, sorted. Req 3.3: the
   * build aborts and names exactly these when this list is non-empty.
   */
  missing: string[];
}

/** Returns the canonical list of the 16 MCP tool payloads. */
export function canonicalPayloads(): readonly ToolPayload[] {
  return CANONICAL_TOOL_PAYLOADS;
}

/**
 * Compute the payload-staging plan from observed presence facts.
 *
 * Pure: no filesystem access. A tool is `present` iff its presence entry says
 * the `dist` root both exists and is non-empty; otherwise it is `missing`
 * (absent OR empty — Req 3.3). Any canonical tool without a presence entry is
 * treated as missing. The `missing` set is exactly `required - present`, so no
 * present tool is reported missing and no missing tool is omitted.
 *
 * @param presence observed presence facts, keyed implicitly by serverName
 * @returns the plan with sorted `present` / `missing` server-name lists
 */
export function planPayloadStaging(presence: readonly DistPresence[]): PayloadStagingPlan {
  const presenceByServer = new Map<string, DistPresence>();
  for (const p of presence) {
    presenceByServer.set(p.serverName, p);
  }

  const required: StagingEntry[] = CANONICAL_TOOL_PAYLOADS.map((t) => ({
    serverName: t.serverName,
    distRoot: t.distRoot,
  }));

  const present: string[] = [];
  const missing: string[] = [];

  for (const tool of CANONICAL_TOOL_PAYLOADS) {
    const p = presenceByServer.get(tool.serverName);
    const ok = p !== undefined && p.exists && p.nonEmpty;
    if (ok) {
      present.push(tool.serverName);
    } else {
      missing.push(tool.serverName);
    }
  }

  present.sort();
  missing.sort();

  return { required, present, missing };
}

/** True iff every canonical tool is present and non-empty (Req 3.3 satisfied). */
export function isComplete(plan: PayloadStagingPlan): boolean {
  return plan.missing.length === 0;
}
