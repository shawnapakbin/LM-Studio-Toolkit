/**
 * Pure payload-staging planner for the LLM Toolkit installer.
 *
 * Feature: windows-installer-setup-exe (Requirements 3.2, 3.3)
 *
 * This module contains ONLY pure functions and the checked-in canonical list of
 * the nine MCP tools (server name -> relative `dist` root). It mirrors the Rust
 * source of truth in `Installer/src-tauri/src/tool_payload.rs`, which in turn
 * mirrors `scripts/workspace/mcp-config.js`. Keeping the "which tools exist and
 * where their dist trees live" decision in one pure place lets the staging
 * script (`stage-payload.ts`) and its test drive the exact same logic that
 * decides completeness and the missing set.
 *
 * Design contract (Requirement 3.3):
 *   If any of the nine tools' `dist` root is absent or EMPTY at build time, the
 *   build must abort before `tauri build` and name every missing/empty tool.
 *   `planPayloadStaging` computes exactly that `missing` set; the I/O wrapper
 *   turns a non-empty `missing` set into a non-zero exit.
 */

// The one top-level Node import: `createRequire` is used ONLY inside
// `defaultSecretScanDeps` to lazily load `node:fs` / `node:path` for the
// staging secret guard, so the pure planner / seam functions keep their
// filesystem dependency out of the module graph until the guard needs it. A
// bare `require(...)` would be undefined in ES module scope under `tsx`/Node
// ESM; `createRequire` resolves Node core modules in both the ESM CLI and the
// CommonJS test transform.
import { createRequire } from "node:module";

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
export const CANONICAL_TOOL_COUNT = 9;

/**
 * The canonical nine MCP tools: server name -> relative `dist` root.
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
  { serverName: "python-shell", distRoot: "PythonShell/dist" },
  { serverName: "skills", distRoot: "Skills/dist" },
  { serverName: "blender-bridge", distRoot: "BlenderBridge/dist" },
  { serverName: "3dtool", distRoot: "3DTool/dist" },
  { serverName: "lan-sub-agent", distRoot: "LanSubAgent/dist/LanSubAgent/src" },
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
  /** Every canonical tool that must be staged (the full nine). */
  required: StagingEntry[];
  /** Server names found present AND non-empty, sorted. */
  present: string[];
  /**
   * Server names whose `dist` root is absent OR empty, sorted. Req 3.3: the
   * build aborts and names exactly these when this list is non-empty.
   */
  missing: string[];
}

/** Returns the canonical list of the nine MCP tool payloads. */
export function canonicalPayloads(): readonly ToolPayload[] {
  return CANONICAL_TOOL_PAYLOADS;
}

// ─── Shared entry-path seam (TS mirror of Rust lmstudio.rs) ──────────────────
//
// Bugfix: installer-plugin-path-and-browserless-secret (Concern 1).
//
// The Rust side (`Installer/src-tauri/src/lmstudio.rs`) owns the single source
// of truth for where a tool's entry script lands once installed:
//   - `entry(tool)`                   -> "schema-proxy.js" for browserless, else "mcp-server.js"
//   - `installed_entry_relpath(tool)` -> "<server_name>/<entry>"
//   - `entry_script_path(dir, tool)`  -> dir/<server_name>/<entry>
// and `default_bridge_configs` builds each plugin's `args[0]` from that seam.
//
// Staging (`stage-payload.ts`) must land each tool's files at the SAME
// `<serverName>/` leading directory, so the generated bridge-config path
// resolves to a real file. The pure helpers below mirror the Rust seam so a
// parity test can assert the two layouts agree for all nine tools and a future
// rename cannot desync them. They live here (not in `stage-payload.ts`) because
// this module is the pure, ESM-`import.meta`-free source that tests can import.

/**
 * The installed entry filename for a tool, keyed by `serverName`.
 *
 * Mirrors Rust `entry(tool)` in `lmstudio.rs`: browserless ships
 * `schema-proxy.js`; every other tool ships `mcp-server.js`.
 */
export function installedEntryFilename(serverName: string): string {
  return serverName === "browserless" ? "schema-proxy.js" : "mcp-server.js";
}

/**
 * The installed entry-script path RELATIVE to the install dir, `<serverName>/<entry>`.
 *
 * Mirrors Rust `installed_entry_relpath(tool)`. Uses a forward slash to match
 * the normalized `args[0]` the bridge-config generator emits.
 */
export function installedEntryRelpath(tool: ToolPayload): string {
  return `${tool.serverName}/${installedEntryFilename(tool.serverName)}`;
}

/**
 * The leading path segment of a `<serverName>/<entry>` relative path.
 *
 * This is the directory a tool's files must be staged INTO, and — after the
 * fix — the leading dir of the bridge-config `args[0]`. Splits on both `/` and
 * `\` so the assertion holds regardless of separator.
 */
export function leadingDir(relpath: string): string {
  return relpath.split(/[\\/]/, 1)[0];
}

/**
 * The staging destination directory name for a tool: its `serverName`.
 *
 * `stagePayload` copies each tool's `distRoot` tree into
 * `payload/<stagingDestDirName(tool)>/`. This is the single value the parity
 * test checks against `leadingDir(installedEntryRelpath(tool))`.
 */
export function stagingDestDirName(tool: ToolPayload): string {
  return tool.serverName;
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

/**
 * True iff every canonical tool is present and non-empty (Req 3.3).
 *
 * This is the nine-tool dist completeness verdict: it reflects only the
 * per-tool `dist` trees.
 */
export function isComplete(plan: PayloadStagingPlan): boolean {
  return plan.missing.length === 0;
}

/**
 * True iff the FULL payload is stageable: every canonical tool `dist` tree is
 * present and non-empty (Req 3.3).
 *
 * This is the gate the build step (`stage-payload.ts`) checks. The Lean_Payload
 * ships only the nine plugin `dist` trees — no bundled `node_modules` — so this
 * is exactly the nine-tool completeness verdict {@link isComplete}.
 */
export function isStagingComplete(plan: PayloadStagingPlan): boolean {
  return isComplete(plan);
}

/**
 * The names of every REQUIRED staging entry that is absent or empty, sorted —
 * the exact set the build must name when it aborts. This is exactly the
 * nine-tool `missing` set.
 */
export function stagingBlockers(plan: PayloadStagingPlan): string[] {
  return [...plan.missing].sort();
}

// ─── Staging secret guard (Concern 2, TS mirror of Rust config_gen.rs) ───────
//
// Bugfix: installer-plugin-path-and-browserless-secret (Concern 2, task 3.5).
//
// The build must never embed a real secret into the staged `payload/`. The Rust
// side (`Installer/src-tauri/src/config_gen.rs`) owns the canonical pure
// predicate `scan_value_for_secret(key, value)`; the helpers below MIRROR that
// logic exactly so the staging guard in `stage-payload.ts` can scan the staged
// tree and abort the build (naming the offending file) when a non-empty,
// non-placeholder secret-bearing value is found. Keeping the scanner here (the
// pure, `import.meta`-free module) lets tests import it directly.

/** Env keys that carry secret material. Mirrors Rust `SECRET_ENV_KEYS`. */
export const SECRET_ENV_KEYS: readonly string[] = ["BROWSERLESS_TOKEN"];

/**
 * Known placeholder token/API-key values that carry NO real secret material.
 * Mirrors Rust `KNOWN_PLACEHOLDER_SECRETS`; treated as empty by the guard.
 */
export const KNOWN_PLACEHOLDER_SECRETS: readonly string[] = [
  "your-browserless-api-key-here",
  "your-browserless-api-token-here",
];

/** True iff `key` names a secret-bearing env value. Mirrors Rust `is_secret_key`. */
export function isSecretKey(key: string): boolean {
  return SECRET_ENV_KEYS.includes(key);
}

/**
 * True iff `value` is empty/whitespace or a known placeholder (no real secret).
 * Mirrors Rust `is_placeholder_or_empty_secret`.
 */
function isPlaceholderOrEmptySecret(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length === 0 || KNOWN_PLACEHOLDER_SECRETS.includes(trimmed);
}

/**
 * Heuristic: does `value` look like a live Browserless API token?
 *
 * Mirrors Rust `looks_like_browserless_token`: a single run of at least 24
 * URL-safe token characters (letters, digits, `-`/`_`) with no whitespace.
 */
function looksLikeBrowserlessToken(value: string): boolean {
  const v = value.trim();
  return v.length >= 24 && /^[A-Za-z0-9_-]+$/.test(v);
}

/**
 * Pure predicate backing the build/staging secret guard (Concern 2).
 *
 * Mirrors Rust `scan_value_for_secret`: flags `(key, value)` as an embedded
 * secret when the value is non-empty and not a known placeholder, AND either
 * `key` is a `SECRET_ENV_KEYS` key (`BROWSERLESS_TOKEN`) or `value` is a
 * Browserless-token-shaped credential. Empty, whitespace-only, and the known
 * placeholders never count as a secret.
 */
export function scanValueForSecret(key: string, value: string): boolean {
  if (isPlaceholderOrEmptySecret(value)) {
    return false;
  }
  return isSecretKey(key) || looksLikeBrowserlessToken(value);
}

/** A single secret finding: the offending file plus the key/value that tripped the guard. */
export interface SecretFinding {
  /** Absolute path to the staged file that carries the secret. */
  file: string;
  /** The env key (or a synthetic marker) the secret value was assigned to. */
  key: string;
  /** The secret-bearing value (redacted-safe callers should not log this). */
  value: string;
}

/**
 * Recursively collect the absolute paths of every regular file under `dir`.
 * Injected `readDir`/`isDir` keep the walker pure/testable, but the default
 * uses the real filesystem so the staging guard can scan `payload/`.
 */
function walkFiles(dir: string, deps: SecretScanDeps): string[] {
  const out: string[] = [];
  for (const name of deps.readDir(dir)) {
    const full = deps.join(dir, name);
    if (deps.isDir(full)) {
      out.push(...walkFiles(full, deps));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Filesystem seam for {@link scanPayloadForSecrets}, injectable for tests. */
export interface SecretScanDeps {
  exists(p: string): boolean;
  isDir(p: string): boolean;
  readDir(p: string): string[];
  readText(p: string): string;
  join(a: string, b: string): string;
}

/**
 * Scan a value's contribution for secrets. Handles JSON objects (env maps like
 * `{ "env": { "BROWSERLESS_TOKEN": "…" } }`), nested objects/arrays, and bare
 * strings. Every `(key, value)` pair is checked with {@link scanValueForSecret}.
 */
function collectSecretsFromJson(
  node: unknown,
  key: string,
  file: string,
  findings: SecretFinding[],
): void {
  if (typeof node === "string") {
    if (scanValueForSecret(key, node)) {
      findings.push({ file, key, value: node });
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectSecretsFromJson(item, key, file, findings);
    }
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [childKey, childVal] of Object.entries(node as Record<string, unknown>)) {
      collectSecretsFromJson(childVal, childKey, file, findings);
    }
  }
}

/**
 * Scan a single staged file's text for embedded secrets.
 *
 * JSON files are parsed and every `(key, value)` pair is checked so a secret in
 * an `env` map is caught with its real key. For non-JSON (or unparseable) text
 * we fall back to scanning ONLY the values assigned to a secret key (e.g.
 * `BROWSERLESS_TOKEN=<value>` or `"BROWSERLESS_TOKEN": "<value>"`), so a stray
 * credential assigned to a secret env key in any file still trips the guard
 * WITHOUT flagging the countless token-shaped runs (long identifiers, hashes,
 * base64) that appear in ordinary compiled JS — those are not secrets and must
 * not abort the build.
 */
function scanFileForSecrets(file: string, text: string, findings: SecretFinding[]): void {
  let parsed: unknown;
  let isJson = false;
  try {
    parsed = JSON.parse(text);
    isJson = true;
  } catch {
    isJson = false;
  }

  if (isJson) {
    collectSecretsFromJson(parsed, "", file, findings);
    return;
  }

  // Non-JSON fallback: only inspect values that are explicitly assigned to a
  // SECRET_ENV_KEYS key. This keys the scan off the same secret-key set the
  // JSON path uses (via `scanValueForSecret(key, value)`), so a leaked
  // `BROWSERLESS_TOKEN=<live>` in a `.env`/`.js`/text file is still caught,
  // while arbitrary token-shaped substrings in compiled JS are ignored.
  for (const key of SECRET_ENV_KEYS) {
    // Match `KEY = "value"` / `KEY: value` / `KEY=value` with optional quotes,
    // across common env/JS/text assignment shapes.
    const assignment = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']?([A-Za-z0-9_-]+)["']?`, "g");
    for (const match of text.matchAll(assignment)) {
      const value = match[1];
      if (value && scanValueForSecret(key, value)) {
        findings.push({ file, key, value });
      }
    }
  }
}

/**
 * Scan the staged `payload/` tree for any non-empty, non-placeholder
 * secret-bearing value, returning one {@link SecretFinding} per offending
 * occurrence (empty list == clean payload).
 *
 * This is the pure core the staging guard wires an abort around (task 3.5): a
 * non-empty result means the build must fail, naming each offending file. The
 * filesystem seam defaults to the real fs but is injectable for tests.
 */
export function scanPayloadForSecrets(
  stagingRoot: string,
  deps: SecretScanDeps = defaultSecretScanDeps(),
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  if (!deps.exists(stagingRoot)) {
    return findings;
  }
  for (const file of walkFiles(stagingRoot, deps)) {
    let text: string;
    try {
      text = deps.readText(file);
    } catch {
      continue;
    }
    scanFileForSecrets(file, text, findings);
  }
  return findings;
}

/**
 * Build the default real-filesystem seam for {@link scanPayloadForSecrets}.
 *
 * The `fs`/`path` builtins are loaded lazily via `createRequire` rather than a
 * top-level `import` so this otherwise-pure module keeps its filesystem
 * dependency out of the module graph until the staging guard actually needs it,
 * and via `createRequire` rather than a bare `require(...)` (which is undefined
 * in ES module scope under `tsx`/Node ESM) so the guard works both as an ESM
 * CLI and under the CommonJS test transform. `createRequire` needs only an
 * anchor from which to resolve; `process.cwd()` (a real absolute dir) resolves
 * Node core modules identically in either mode. The guard only ever runs in
 * Node.
 */
function defaultSecretScanDeps(): SecretScanDeps {
  const req = createRequire(process.cwd() + "/");
  const fs = req("node:fs") as typeof import("node:fs");
  const nodePath = req("node:path") as typeof import("node:path");
  return {
    exists: (p) => fs.existsSync(p),
    isDir: (p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    readDir: (p) => fs.readdirSync(p),
    readText: (p) => fs.readFileSync(p, "utf8"),
    join: (a, b) => nodePath.join(a, b),
  };
}
