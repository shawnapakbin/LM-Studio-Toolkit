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
 * The workspace-internal packages the (generalized) Option B fix provisions via
 * local `file:` tarballs (bugfix: mcp-shared-module-resolution-fix). Each entry
 * pairs the `npm pack` SOURCE directory (repo-root-relative) with the stable
 * stem used in the staged tarball filename.
 *
 * The 5.4.3 fix started with the two `@shared/*` packages; the 5.4.4 follow-up
 * generalizes the SAME seam to the five `llm-toolkit-*` workspace-internal
 * packages the generator still drops (`AskUser`, `Calculator`, `Clock`,
 * `DocumentScraper`, `Observability`). Every downstream derivation
 * ({@link sharedTarballFileNames}, {@link SANCTIONED_PAYLOAD_ROOT_FILES}, and
 * `stageSharedTarballs` in `stage-payload.ts`) iterates THIS list, so adding a
 * spec entry automatically extends the version-derived staged filename, the
 * sanctioned flat-file set, and the pack/stage step with zero other edits.
 *
 * For the `@shared/*` pair the stem is deliberately NOT a 1:1 slug of the
 * directory (`shared/config` → `shared-config`, `shared` → `shared-types`) so
 * the tarballs read clearly at the payload root and match the `file:`
 * specifiers the generator emits. For the `llm-toolkit-*` packages the stem is
 * the package's own name (e.g. `AskUser` → `llm-toolkit-ask-user`), which is
 * also how `npm pack` names the produced tarball, so the staged name matches
 * the package name directly.
 */
export const SHARED_TARBALL_SPECS: readonly { packageDir: string; stem: string }[] = [
  { packageDir: "shared", stem: "shared-types" },
  { packageDir: "shared/config", stem: "shared-config" },
  { packageDir: "AskUser", stem: "llm-toolkit-ask-user" },
  { packageDir: "Calculator", stem: "llm-toolkit-calculator" },
  { packageDir: "Clock", stem: "llm-toolkit-clock" },
  { packageDir: "DocumentScraper", stem: "llm-toolkit-document-scraper" },
  { packageDir: "Observability", stem: "llm-toolkit-observability" },
] as const;

/**
 * The published-style package NAMES of every workspace-internal package the
 * (generalized) Option B fix provisions via local `file:` tarballs — the full
 * closure (`@shared/types`, `@shared/config`, and the five `llm-toolkit-*`).
 *
 * Bugfix: mcp-shared-module-resolution-fix — task 8.3 (option b). This set
 * drives the NESTED-specifier normalization the pack step applies
 * ({@link normalizeSharedTarball}): any dependency inside a packed tarball whose
 * NAME is in this set (or whose specifier is otherwise workspace-internal) is
 * rewritten to `"*"` so npm binds it to the sibling TOP-LEVEL `file:` tarball at
 * install time. Kept in lockstep with {@link SHARED_TARBALL_SPECS} (same seven
 * packages, same order) and mirrored by `SHARED_FILE_TARBALL_PACKAGES` in
 * `generate-production-manifest.ts`, so the closure can never drift.
 */
export const CLOSURE_PACKAGE_NAMES: ReadonlySet<string> = new Set<string>([
  "@shared/types",
  "@shared/config",
  "llm-toolkit-ask-user",
  "llm-toolkit-calculator",
  "llm-toolkit-clock",
  "llm-toolkit-document-scraper",
  "llm-toolkit-observability",
]);

/**
 * Derive a `@shared/*` tarball filename from its stem and the resolved root
 * version — e.g. `("shared-types", "5.4.3") -> "shared-types-5.4.3.tgz"`.
 *
 * Pure (no I/O): the version is ALWAYS supplied by the caller (read from the
 * root `package.json`), never hardcoded, so the staged filename follows the
 * repo-wide version bump (5.4.2 → 5.4.3) with zero drift.
 */
export function sharedTarballFileName(stem: string, version: string): string {
  return `${stem}-${version}.tgz`;
}

/**
 * The version-derived tarball filenames for EVERY workspace-internal package in
 * `SHARED_TARBALL_SPECS`, in that stable order (`shared-types-*.tgz`,
 * `shared-config-*.tgz`, then the five `llm-toolkit-*-*.tgz`). Derived from the
 * supplied root version — never hardcoded — so the set tracks both the
 * repo-wide version bump and any future spec addition automatically.
 */
export function sharedTarballFileNames(version: string): string[] {
  return SHARED_TARBALL_SPECS.map((s) => sharedTarballFileName(s.stem, version));
}

/**
 * Lazily read the repo root `package.json` `version` so the sanctioned tarball
 * filenames below are version-derived at module load (never hardcoded). Walks
 * UP from a set of mode-robust anchors — the ts-jest CommonJS transform exposes
 * `__dirname`; the `tsx`/Node-ESM CLI does not, so `process.cwd()` is the
 * fallback — until it finds the monorepo root `package.json` (identified by its
 * `workspaces` array). `node:fs`/`node:path` are loaded via `createRequire`
 * (not a top-level import) to keep this otherwise-pure module's filesystem
 * dependency out of the graph until first use, mirroring the secret-guard seam.
 *
 * Falls back to `"0.0.0"` only if no root manifest is discoverable, which keeps
 * the module importable in degenerate environments; in every real build/test
 * the root `package.json` is found and its concrete version is used.
 */
function readRepoRootVersion(): string {
  const req = createRequire(process.cwd() + "/");
  const fs = req("node:fs") as typeof import("node:fs");
  const nodePath = req("node:path") as typeof import("node:path");

  /** The monorepo root `version` iff this manifest declares `workspaces`. */
  const rootVersionAt = (manifestPath: string): string | undefined => {
    try {
      if (!fs.existsSync(manifestPath)) {
        return undefined;
      }
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        version?: string;
        workspaces?: unknown;
      };
      return parsed.workspaces !== undefined && typeof parsed.version === "string"
        ? parsed.version
        : undefined;
    } catch {
      // Ignore unreadable/un-parseable manifests; the caller keeps walking up.
      return undefined;
    }
  };

  const starts: string[] = [];
  // Under the ts-jest CommonJS transform `__dirname` is the real module dir;
  // the `tsx`/Node-ESM CLI leaves it undefined, so `process.cwd()` is the
  // fallback anchor.
  if (typeof __dirname === "string" && __dirname.length > 0) {
    starts.push(__dirname);
  }
  starts.push(process.cwd());

  for (const start of starts) {
    let dir = nodePath.resolve(start);
    for (;;) {
      const version = rootVersionAt(nodePath.join(dir, "package.json"));
      if (version !== undefined) {
        return version;
      }
      const parent = nodePath.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return "0.0.0";
}

/**
 * The sanctioned flat NON-TOOL file entries the Lean_Payload may carry at its
 * top level, in addition to the nine canonical tool `<serverName>/` dirs.
 *
 * Bugfix: runtimes-npm-install-nonzero-exit — task 3.4 (Part B / B2).
 * Requirements: 2.1, 3.6.
 *
 * The first two are the build-time-generated flat production `package.json` +
 * `package-lock.json` (produced by `generate-production-manifest.ts`). They are
 * staged at the payload ROOT — the level that maps to `install_dir` — because
 * the Runtimes step runs `npm install --omit=dev …` with `cwd = install_dir`,
 * and npm resolves its manifest in the current directory. A `runtime-manifest/`
 * subdir would land at `install_dir/runtime-manifest/` where npm's `cwd` would
 * never read it.
 *
 * Bugfix: mcp-shared-module-resolution-fix (Option B, task 3.2) adds the two
 * `@shared/*` tarballs (`shared-types-<version>.tgz`,
 * `shared-config-<version>.tgz`) as sanctioned flat files so `assertLeanPayload`
 * accepts them as top-level REGULAR FILES; the 5.4.4 follow-up (task 8.2)
 * generalizes the SAME seam to the five `llm-toolkit-*` tarballs
 * (`llm-toolkit-ask-user-<version>.tgz`, …). Every one of these names is
 * VERSION-DERIVED from the root `package.json` via `sharedTarballFileNames`
 * (never hardcoded), so the sanctioned set tracks both the repo-wide version
 * bump and any `SHARED_TARBALL_SPECS` addition automatically —
 * `stage-payload`'s pack step derives the identical names from the SAME root
 * version and the SAME spec list, so the staged files and this sanction can
 * never drift.
 *
 * This list is the ONLY relaxation of the Lean_Payload top-level contract: the
 * "no `node_modules` at any depth" and size-budget intents are UNCHANGED — no
 * directory tree (and never a `node_modules`) is added here.
 */
export const SANCTIONED_PAYLOAD_ROOT_FILES: readonly string[] = [
  "package.json",
  "package-lock.json",
  ...sharedTarballFileNames(readRepoRootVersion()),
] as const;

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
 * Benign STRUCTURAL package-lock / package-metadata keys whose values are
 * EXPECTED to be long, URL-safe/base64-ish strings and are NEVER secrets.
 * Mirrors Rust `BENIGN_METADATA_KEYS`.
 *
 * Bugfix: mcp-shared-module-resolution-fix — the Option B fix adds the two
 * `@shared/*` `file:` entries to the flat `package-lock.json`, and those
 * entries carry `"license": "LicenseRef-Shawna-NonCommercial"` (the real
 * license declared in `shared/package.json` / `shared/config/package.json`).
 * That value is ≥24 chars and matches `^[A-Za-z0-9_-]+$`, so the token-SHAPE
 * heuristic (`looksLikeBrowserlessToken`) would flag it as a FALSE POSITIVE.
 * The same is true of standard lockfile fields `integrity` (base64 SRI hashes)
 * and `resolved` (long registry/tarball URLs → url-safe runs). These are
 * structural npm metadata, not credentials.
 *
 * This set ONLY gates the token-SHAPE path: a value under one of these keys is
 * never flagged by the shape heuristic. A real secret key
 * (`BROWSERLESS_TOKEN`, via {@link isSecretKey}) is STILL always flagged
 * regardless of value shape — none of these keys is a `SECRET_ENV_KEYS` key, so
 * real-secret detection is unaffected (Req 3.4).
 */
export const BENIGN_METADATA_KEYS: readonly string[] = [
  "license",
  "integrity",
  "resolved",
  "version",
  "name",
  "dev",
  "funding",
];

/** True iff `key` is a benign structural metadata key (shape heuristic exempt). */
export function isBenignMetadataKey(key: string): boolean {
  return BENIGN_METADATA_KEYS.includes(key);
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
 * Browserless-token-shaped credential whose `key` is NOT a benign structural
 * metadata key (see {@link BENIGN_METADATA_KEYS}). Empty, whitespace-only, and
 * the known placeholders never count as a secret.
 *
 * The benign-metadata-key carve-out ONLY narrows the token-SHAPE path so
 * standard npm lockfile fields (`license`, `integrity`, `resolved`, …) whose
 * values are long url-safe strings are not false-positives (Req 3.4). A real
 * secret key is still ALWAYS caught via {@link isSecretKey}, independent of
 * value shape — detection of `BROWSERLESS_TOKEN` is unchanged.
 */
export function scanValueForSecret(key: string, value: string): boolean {
  if (isPlaceholderOrEmptySecret(value)) {
    return false;
  }
  if (isSecretKey(key)) {
    return true;
  }
  return looksLikeBrowserlessToken(value) && !isBenignMetadataKey(key);
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
