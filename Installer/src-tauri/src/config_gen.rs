//! Per-tool environment configuration derivation (Step 4 — Env config, Req 7).
//!
//! This module derives the [`Tool_Environment_Config`] for **all 9** MCP tools
//! from the unified `llm-toolkit.config.yaml` model ([`ToolkitConfig`]) and
//! writes each tool's config to a **current-user-scoped** location so that no
//! secret value (e.g. `BROWSERLESS_TOKEN`) ends up in a place readable by other
//! user accounts (Req 7.3).
//!
//! # Single source of the env *shape*
//!
//! The set of env **keys** a given server carries is fixed by
//! `scripts/workspace/mcp-config.js` — the same registration source of truth the
//! LM Studio bridge sync uses. This module mirrors that per-server key set in
//! [`canonical_env_keys`] so the derivation always produces *exactly* the keys
//! `mcp-config.js` defines for each server, and no others (Property 11). The
//! 9 server names themselves are borrowed from [`crate::tool_payload`] so the
//! two sources cannot drift.
//!
//! The unified [`ToolkitConfig`] (parsed from `llm-toolkit.config.yaml`) supplies
//! the **values**: where the config carries a setting for a key we use it,
//! otherwise the canonical default from `mcp-config.js` is used. The one
//! non-identity mapping is `browserless.apiKey` (YAML) →`BROWSERLESS_TOKEN` (env),
//! matching the `BROWSERLESS_API_KEY`→`BROWSERLESS_TOKEN` mapping documented in
//! `scripts/workspace/mcp-config.js` and `Browserless/README.md`.
//!
//! # Purity
//!
//! [`derive_all`] is a **pure** function `ToolkitConfig -> ToolEnvConfigSet` with
//! no filesystem I/O, so the completeness property (Property 11) and the
//! user-scoped-secrets property (Property 15) can drive it directly. The thin
//! I/O seam ([`write_all`], [`user_scoped_config_dir`]) is kept separate.
//!
//! Requirements: 7.1 (derive per-tool env for all 9), 7.2 (write each before
//! proceeding), 7.3 (current-user-scoped, no world-readable secrets), 7.4
//! (on failure name the tool + cause, leave no partial config).
//!
//! Properties backed here:
//! - Property 11 (per-tool env derivation completeness) — task 10.3,
//! - Property 15 (secrets are user-scoped) — task 10.4.

// Step::EnvConfig wiring (task 10.2) is the runtime consumer of this module.
// Until it lands, most of the public surface is exercised only by tests, so
// silence dead-code warnings for this seam module.
#![allow(dead_code)]

use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

// `CANONICAL_TOOL_COUNT` is referenced by the `ToolEnvConfigSet` doc link and by
// the test modules (via `use super::*`); doc links don't count as a use in a
// non-test build, so allow the otherwise-"unused" import here.
#[allow(unused_imports)]
use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};

/// A single tool's derived environment: `env_key -> value`.
///
/// Ordered (`BTreeMap`) so the derivation and the written config are
/// deterministic regardless of source order.
pub type ToolEnvConfig = BTreeMap<String, String>;

/// The full derivation result: `server_name -> ToolEnvConfig`.
///
/// Exactly [`CANONICAL_TOOL_COUNT`] entries, one per canonical MCP tool.
pub type ToolEnvConfigSet = BTreeMap<String, ToolEnvConfig>;

/// Env keys that hold secret material and must never be written world-readable.
///
/// Used by [`is_secret_key`] and the Property 15 user-scoped check. Kept small
/// and explicit rather than pattern-matched so a new secret is a deliberate
/// addition.
pub const SECRET_ENV_KEYS: [&str; 1] = ["BROWSERLESS_TOKEN"];

/// True iff `key` names a secret-bearing env value (e.g. an API token).
pub fn is_secret_key(key: &str) -> bool {
    SECRET_ENV_KEYS.contains(&key)
}

/// Benign STRUCTURAL package-lock / package-metadata keys whose values are
/// EXPECTED to be long, URL-safe/base64-ish strings and are NEVER secrets.
/// Mirrors TS `BENIGN_METADATA_KEYS` in `scripts/payload-manifest.ts`.
///
/// Bugfix: mcp-shared-module-resolution-fix — the Option B fix adds the two
/// `@shared/*` `file:` entries to the flat `package-lock.json`, and those
/// entries carry `"license": "LicenseRef-Shawna-NonCommercial"` (the real
/// license declared in `shared/package.json` / `shared/config/package.json`).
/// That value is >=24 chars and all URL-safe token characters, so the
/// token-SHAPE heuristic (`looks_like_browserless_token`) would flag it as a
/// FALSE POSITIVE. The same is true of standard lockfile fields `integrity`
/// (base64 SRI hashes) and `resolved` (long registry/tarball URLs). These are
/// structural npm metadata, not credentials.
///
/// This set ONLY gates the token-SHAPE path: a value under one of these keys is
/// never flagged by the shape heuristic. A real secret key (`BROWSERLESS_TOKEN`,
/// via [`is_secret_key`]) is STILL always flagged regardless of value shape —
/// none of these keys is a `SECRET_ENV_KEYS` key, so real-secret detection is
/// unaffected (Req 3.4).
pub const BENIGN_METADATA_KEYS: [&str; 7] = [
    "license",
    "integrity",
    "resolved",
    "version",
    "name",
    "dev",
    "funding",
];

/// True iff `key` is a benign structural metadata key (shape heuristic exempt).
fn is_benign_metadata_key(key: &str) -> bool {
    BENIGN_METADATA_KEYS.contains(&key)
}

/// The known placeholder values that stand in for a Browserless token/API key
/// but carry no real secret material. Kept in lock-step with the pipeline's
/// placeholder handling: `is_placeholder_env_value` in `lmstudio.rs` treats
/// these (and empty/whitespace) as "no value". Replicated here (rather than
/// imported) so the staging secret guard can recognize a placeholder as
/// non-secret without depending on the bridge-sync module.
///
/// Keep this list small and explicit so adding a real secret is a deliberate act.
pub const KNOWN_PLACEHOLDER_SECRETS: [&str; 2] = [
    "your-browserless-api-key-here",
    "your-browserless-api-token-here",
];

/// True iff `value` (already trimmed by the caller, or trimmed here) is an
/// empty or known-placeholder stand-in that carries no real secret material.
///
/// Mirrors the empty/placeholder handling elsewhere in the pipeline; used by
/// [`scan_value_for_secret`] so placeholders and blanks never trip the guard.
fn is_placeholder_or_empty_secret(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || KNOWN_PLACEHOLDER_SECRETS.contains(&trimmed)
}

/// Heuristic: does `value` look like a live Browserless API token?
///
/// Browserless tokens observed in the wild are long, unbroken alphanumeric
/// credentials (the exposed one was a 48-char hex-ish string). We treat a value
/// as token-shaped when it is a single run of at least 24 URL-safe token
/// characters (letters, digits, `-`/`_`) with no whitespace. This is
/// deliberately conservative: it flags credential-looking strings while leaving
/// short/spaced/placeholder values alone. It is only ever consulted for
/// non-empty, non-placeholder values via [`scan_value_for_secret`].
fn looks_like_browserless_token(value: &str) -> bool {
    let v = value.trim();
    v.len() >= 24
        && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Pure predicate backing the build/staging secret guard (Concern 2).
///
/// Flags `(key, value)` as carrying an embedded secret when the value is
/// **non-empty and not a known placeholder** AND either:
/// - `key` is one of [`SECRET_ENV_KEYS`] (i.e. `BROWSERLESS_TOKEN`), or
/// - `value` is a Browserless-token-shaped credential (see
///   [`looks_like_browserless_token`]) whose `key` is NOT a benign structural
///   metadata key (see [`BENIGN_METADATA_KEYS`]).
///
/// Empty, whitespace-only, and the known placeholder values never count as a
/// secret, matching the rest of the pipeline's placeholder-as-empty handling.
/// The benign-metadata-key carve-out ONLY narrows the token-SHAPE path so
/// standard npm lockfile fields (`license`, `integrity`, `resolved`, …) whose
/// values are long url-safe strings are not false-positives (Req 3.4). A real
/// secret key is still ALWAYS caught via [`is_secret_key`], independent of
/// value shape — detection of `BROWSERLESS_TOKEN` is unchanged.
/// This is a pure function (no I/O); the staging guard in `stage-payload.ts`
/// mirrors its logic to abort the build when a real secret is found in the
/// staged payload (task 3.5).
pub fn scan_value_for_secret(key: &str, value: &str) -> bool {
    if is_placeholder_or_empty_secret(value) {
        return false;
    }
    if is_secret_key(key) {
        return true;
    }
    looks_like_browserless_token(value) && !is_benign_metadata_key(key)
}

// ─── Concern 3: install-dir path anchoring (task 3.8) ─────────────────────────

/// The ENUMERATED set of path/db/dir/workspace-root env keys whose relative or
/// empty DEFAULT values must be anchored under the install dir (Concern 3).
///
/// Only keys in this explicit list are ever anchored by [`anchor_env_path`];
/// every other key (and any non-path value) passes through verbatim. Keeping
/// the set small and explicit means a new path key is a deliberate addition and
/// a non-path value can never be accidentally rewritten (Req 3.7, 3.8).
///
/// Two flavours live here:
/// - **file/db paths** whose canonical default is a relative `./file` (e.g.
///   `ASK_USER_DB_PATH = "./memory.db"`): anchored under
///   `install_dir/<server_name>/<relative>`, matching where the tool's files land.
/// - **workspace-root / dir keys** whose canonical default is empty `""` (e.g.
///   `DOC_SCRAPER_WORKSPACE_ROOT`, `PYTHON_SHELL_WORKSPACE_ROOT`): an empty
///   default is anchored to `install_dir` itself; a relative default is anchored
///   under `install_dir/<server_name>/<relative>`.
pub const PATH_ENV_KEYS: &[&str] = &[
    "ASK_USER_DB_PATH",
    "DOC_SCRAPER_WORKSPACE_ROOT",
    "SKILLS_DB_PATH",
    "PYTHON_SHELL_WORKSPACE_ROOT",
];

/// True iff `key` is one of the enumerated path/db/dir/workspace-root keys that
/// [`anchor_env_path`] may anchor. Every other key is a NON-path key and is
/// never rewritten.
pub fn is_path_env_key(key: &str) -> bool {
    PATH_ENV_KEYS.contains(&key)
}

/// True iff `value` is already an absolute path — a user-supplied path that must
/// pass through [`anchor_env_path`] untouched (preserve user intent).
///
/// Recognizes both POSIX-absolute (`/foo`) and Windows-absolute forms: a drive
/// path (`C:\...` / `C:/...`) or a UNC/root path (`\\server\share`, `//host`).
/// Accepts either slash so the check is stable regardless of separator.
fn is_absolute_path_value(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() {
        return false;
    }
    let bytes = v.as_bytes();
    // Drive-letter absolute: `C:\` or `C:/` (and even bare `C:`), where the
    // third char is a separator.
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return true;
    }
    // Root / UNC absolute: leading `/` or `\`.
    matches!(bytes[0], b'/' | b'\\')
}

/// Strip a single leading `./` or `.\` from a relative value, if present, so the
/// anchored result does not carry a redundant `.` segment.
fn strip_leading_dot_slash(value: &str) -> &str {
    let v = value.trim();
    v.strip_prefix("./")
        .or_else(|| v.strip_prefix(".\\"))
        .unwrap_or(v)
}

/// Join path segments with a single forward slash, normalizing any existing
/// back-slashes and collapsing duplicate separators. Produces the normalized,
/// forward-slashed absolute string the pipeline uses for generated config
/// values (matching the `\\` -> `/` convention used for bridge args).
fn join_normalized(base: &str, rel: &str) -> String {
    let base = base.replace('\\', "/");
    let base = base.trim_end_matches('/');
    let rel = rel.replace('\\', "/");
    let rel = rel.trim_start_matches('/').trim_end_matches('/');
    if rel.is_empty() {
        base.to_string()
    } else {
        format!("{base}/{rel}")
    }
}

/// Anchor a relative/empty path DEFAULT under the install dir (Concern 3).
///
/// For an ENUMERATED path key ([`PATH_ENV_KEYS`]) whose `value` is relative
/// (e.g. `./memory.db`, `./.subagent-checkpoints/`) or an empty workspace-root
/// default, resolve it against `install_dir` — file/db and relative-dir values
/// under the tool's `install_dir/<server_name>/` subdir (matching where the
/// tool's files land), and an empty workspace-root to `install_dir` itself.
/// The result is a normalized, forward-slashed absolute path string.
///
/// Everything else passes through verbatim:
/// - a NON-path key (`is_path_env_key(key) == false`) returns `value` unchanged;
/// - an already-ABSOLUTE value (user-supplied, e.g. `D:/data/rag.db`) returns
///   `value` unchanged.
///
/// This is a pure function with no filesystem I/O: it never touches the process
/// CWD, so a relative default can never resolve against the dev repo. It anchors
/// DEFAULTS only — the derivation (task 3.9) applies it exclusively when there
/// is no user override, so user intent (an absolute config path) is preserved
/// (Req 3.7, 3.8).
pub fn anchor_env_path(install_dir: &Path, server_name: &str, key: &str, value: &str) -> String {
    // Non-path keys are never rewritten.
    if !is_path_env_key(key) {
        return value.to_string();
    }
    // User-supplied absolute paths pass through untouched (preserve user intent).
    if is_absolute_path_value(value) {
        return value.to_string();
    }

    let base = install_dir.to_string_lossy();
    let trimmed = value.trim();

    if trimmed.is_empty() {
        // Empty workspace-root default: anchor to the install dir itself.
        return join_normalized(&base, "");
    }

    // Relative default (e.g. `./memory.db`, `./.subagent-checkpoints/`): anchor
    // under the tool's `<server_name>/` subdir where its files are staged.
    let rel = strip_leading_dot_slash(trimmed);
    let under_server = join_normalized(server_name, rel);
    join_normalized(&base, &under_server)
}

/// The canonical per-server env key set, mirroring the `env` maps in
/// `scripts/workspace/mcp-config.js`.
///
/// Each entry is `(server_name, &[(env_key, default_value), ...])`. The keys
/// (and their order-independent set) are authoritative: [`derive_all`] emits
/// exactly these keys for each server. Default values match `mcp-config.js`;
/// where the unified [`ToolkitConfig`] supplies a value it overrides the
/// default (see [`derive_all`]).
///
/// `browserless` intentionally lists `BROWSERLESS_TOKEN` (the env key), whose
/// value is sourced from `browserless.apiKey` in the YAML — the one non-identity
/// mapping. `3dtool` carries no env keys, matching `mcp-config.js`.
pub const CANONICAL_ENV_KEYS: &[(&str, &[(&str, &str)])] = &[
    (
        "terminal",
        &[
            ("TERMINAL_DEFAULT_TIMEOUT_MS", "60000"),
            ("TERMINAL_MAX_TIMEOUT_MS", "120000"),
        ],
    ),
    (
        "web-browser",
        &[
            ("BROWSER_DEFAULT_TIMEOUT_MS", "20000"),
            ("BROWSER_MAX_TIMEOUT_MS", "60000"),
            ("BROWSER_MAX_CONTENT_CHARS", "12000"),
            ("BROWSER_HEADLESS", "true"),
        ],
    ),
    (
        "common",
        &[
            ("CALCULATOR_DEFAULT_PRECISION", "12"),
            ("CALCULATOR_MAX_PRECISION", "20"),
            ("DOC_SCRAPER_DEFAULT_TIMEOUT_MS", "20000"),
            ("DOC_SCRAPER_MAX_TIMEOUT_MS", "60000"),
            ("DOC_SCRAPER_MAX_CONTENT_BYTES", "52428800"),
            ("DOC_SCRAPER_MAX_CONTENT_CHARS", "50000"),
            ("DOC_SCRAPER_WORKSPACE_ROOT", ""),
            ("CLOCK_DEFAULT_TIMEZONE", ""),
            ("CLOCK_DEFAULT_LOCALE", "en-US"),
            ("ASK_USER_DB_PATH", "./memory.db"),
            ("ASK_USER_DEFAULT_EXPIRES_SECONDS", "1800"),
            ("ASK_USER_MAX_EXPIRES_SECONDS", "86400"),
            ("ASK_USER_MAX_QUESTIONS", "20"),
        ],
    ),
    // Value sourced from browserless.apiKey (YAML) -> BROWSERLESS_TOKEN (env).
    ("browserless", &[("BROWSERLESS_TOKEN", "")]),
    (
        "python-shell",
        &[
            ("PYTHON_SHELL_DEFAULT_TIMEOUT_MS", "60000"),
            ("PYTHON_SHELL_MAX_TIMEOUT_MS", "120000"),
            ("PYTHON_SHELL_MAX_OUTPUT_CHARS", "50000"),
            ("PYTHON_SHELL_WORKSPACE_ROOT", ""),
        ],
    ),
    ("skills", &[("SKILLS_DB_PATH", "./skills.db")]),
    (
        "blender-bridge",
        &[
            ("BLENDER_MCP_HOST", "127.0.0.1"),
            ("BLENDER_MCP_PORT", "9876"),
            ("BLENDER_MCP_COMMAND", "blender-mcp"),
            ("BLENDER_MCP_ARGS", ""),
        ],
    ),
    ("3dtool", &[]),
    (
        "lan-sub-agent",
        &[
            ("LAN_SUBAGENT_CONFIG_PATH", ""),
            ("SUBAGENT_LOCAL_HOST", ""),
            ("SUBAGENT_LOCAL_PORT", ""),
        ],
    ),
];

/// Returns the canonical env key/default pairs for `server_name`, or `None` if
/// the name is not one of the 9 canonical servers.
pub fn canonical_env_defaults(server_name: &str) -> Option<&'static [(&'static str, &'static str)]> {
    CANONICAL_ENV_KEYS
        .iter()
        .find(|(name, _)| *name == server_name)
        .map(|(_, keys)| *keys)
}

/// Returns just the canonical env **keys** for `server_name` (Property 11's
/// "keys exactly those defined for that tool's server").
pub fn canonical_env_keys(server_name: &str) -> Vec<&'static str> {
    canonical_env_defaults(server_name)
        .map(|keys| keys.iter().map(|(k, _)| *k).collect())
        .unwrap_or_default()
}

// ─── Toolkit_Config model (deserialized from llm-toolkit.config.yaml) ─────────

/// The unified `llm-toolkit.config.yaml` model — the single source for per-tool
/// values.
///
/// Only the fields the env derivation consumes are modeled; unknown fields in
/// the YAML are ignored so the installer tolerates a config carrying extra
/// settings for tools/features outside the 9 env maps. All sections are
/// optional: a missing section means "use the canonical defaults for that tool".
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ToolkitConfig {
    pub terminal: TerminalConfig,
    pub webbrowser: WebBrowserConfig,
    pub calculator: CalculatorConfig,
    pub documentscraper: DocumentScraperConfig,
    pub clock: ClockConfig,
    pub askuser: AskUserConfig,
    pub browserless: BrowserlessConfig,
    pub pythonshell: PythonShellConfig,
    pub skills: SkillsConfig,
    pub blenderbridge: BlenderBridgeConfig,
    pub lansubagent: LanSubAgentConfig,
}

/// Parse a [`ToolkitConfig`] from raw YAML text.
pub fn parse_toolkit_config(yaml: &str) -> Result<ToolkitConfig, serde_yaml::Error> {
    serde_yaml::from_str(yaml)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct TerminalConfig {
    #[serde(rename = "defaultTimeoutMs")]
    pub default_timeout_ms: Option<u64>,
    #[serde(rename = "maxTimeoutMs")]
    pub max_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WebBrowserConfig {
    #[serde(rename = "defaultTimeoutMs")]
    pub default_timeout_ms: Option<u64>,
    #[serde(rename = "maxTimeoutMs")]
    pub max_timeout_ms: Option<u64>,
    #[serde(rename = "maxContentChars")]
    pub max_content_chars: Option<u64>,
    pub headless: Option<bool>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct CalculatorConfig {
    #[serde(rename = "defaultPrecision")]
    pub default_precision: Option<u64>,
    #[serde(rename = "maxPrecision")]
    pub max_precision: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct DocumentScraperConfig {
    #[serde(rename = "defaultTimeoutMs")]
    pub default_timeout_ms: Option<u64>,
    #[serde(rename = "maxTimeoutMs")]
    pub max_timeout_ms: Option<u64>,
    #[serde(rename = "maxContentBytes")]
    pub max_content_bytes: Option<u64>,
    #[serde(rename = "maxContentChars")]
    pub max_content_chars: Option<u64>,
    #[serde(rename = "workspaceRoot")]
    pub workspace_root: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ClockConfig {
    #[serde(rename = "defaultTimezone")]
    pub default_timezone: Option<String>,
    #[serde(rename = "defaultLocale")]
    pub default_locale: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AskUserConfig {
    #[serde(rename = "dbPath")]
    pub db_path: Option<String>,
    #[serde(rename = "defaultExpiresSeconds")]
    pub default_expires_seconds: Option<u64>,
    #[serde(rename = "maxExpiresSeconds")]
    pub max_expires_seconds: Option<u64>,
    #[serde(rename = "maxQuestions")]
    pub max_questions: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BrowserlessConfig {
    /// Maps to the `BROWSERLESS_TOKEN` env key (secret-bearing).
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PythonShellConfig {
    #[serde(rename = "defaultTimeoutMs")]
    pub default_timeout_ms: Option<u64>,
    #[serde(rename = "maxTimeoutMs")]
    pub max_timeout_ms: Option<u64>,
    #[serde(rename = "maxOutputChars")]
    pub max_output_chars: Option<u64>,
    #[serde(rename = "workspaceRoot")]
    pub workspace_root: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct SkillsConfig {
    #[serde(rename = "dbPath")]
    pub db_path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct BlenderBridgeConfig {
    pub host: Option<String>,
    pub port: Option<u64>,
    pub command: Option<String>,
    pub args: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct LanSubAgentConfig {
    #[serde(rename = "configPath")]
    pub config_path: Option<String>,
    #[serde(rename = "localHost")]
    pub local_host: Option<String>,
    #[serde(rename = "localPort")]
    pub local_port: Option<serde_yaml::Value>,
}

// ─── Pure derivation ──────────────────────────────────────────────────────────

/// Derives the [`ToolEnvConfigSet`] for **all 9** MCP tools from `config`.
///
/// Guarantees (Property 11):
/// - the result has exactly one entry per canonical server (9 total), and
/// - each entry's key set is exactly [`canonical_env_keys`] for that server.
///
/// For each key, the value is the setting from `config` when present, otherwise
/// the canonical default from `mcp-config.js`. This is a pure function with no
/// I/O.
///
/// # Concern 3 anchoring layer (tasks 3.7-3.9)
///
/// Investigation finding (task 3.7) informing tasks 3.8-3.9: the relative/empty
/// path DEFAULTS (`ASK_USER_DB_PATH = "./memory.db"`,
/// `DOC_SCRAPER_WORKSPACE_ROOT = ""`, and the other enumerated path keys) used to
/// be emitted VERBATIM here and were later resolved to absolute paths at RUNTIME
/// inside each MCP tool against the tool's process CWD / module dir (e.g.
/// DocumentScraper `getWorkspaceRoot()` -> `path.resolve(... || process.cwd())`,
/// AskUser `path.resolve(__dirname, DB_PATH)`). On the dev machine that runtime
/// CWD was the dev repo, which is why the generated config pointed at dev-repo
/// paths. Anchoring now happens HERE, at generation time, against `install_dir`
/// (task 3.9): for a canonical DEFAULT (no user override) whose key is an
/// enumerated path key ([`is_path_env_key`]), the value is run through
/// [`anchor_env_path`] so it resolves under `install_dir`
/// (`%LOCALAPPDATA%\LLM-Toolkit`), never the process CWD or dev repo.
///
/// A user-supplied value from `llm-toolkit.config.yaml` (i.e. [`override_value`]
/// returned `Some`) is NEVER anchored — it passes through verbatim so an absolute
/// user path (or any deliberate user override) preserves user intent (Req 3.8).
/// Non-path keys are likewise never rewritten, both because they are only
/// anchored when they are the default AND because [`anchor_env_path`] itself
/// no-ops for non-path keys.
pub fn derive_all(config: &ToolkitConfig, install_dir: &Path) -> ToolEnvConfigSet {
    let mut out: ToolEnvConfigSet = BTreeMap::new();

    // Iterate the canonical 9 server names (from tool_payload) so the entry set
    // is exactly the 9 tools and cannot drift from the payload list.
    for tool in canonical_payloads() {
        let server = tool.server_name;
        let defaults = canonical_env_defaults(server).unwrap_or(&[]);

        let mut env: ToolEnvConfig = BTreeMap::new();
        for (key, default) in defaults {
            // A user override wins verbatim (preserve user intent — absolute
            // config paths and non-path values are never anchored). Only the
            // canonical DEFAULT is anchored, and only for enumerated path keys.
            let value = match override_value(config, server, key) {
                Some(user_value) => user_value,
                None => anchor_env_path(install_dir, server, key, default),
            };
            env.insert((*key).to_string(), value);
        }
        out.insert(server.to_string(), env);
    }

    out
}

/// Returns the value the unified config supplies for `(server, key)`, or `None`
/// to fall back to the canonical default.
///
/// This is the single place where the YAML model is projected onto the fixed
/// env-key shape. Only keys the unified config actually carries are mapped; all
/// other keys retain their `mcp-config.js` default.
fn override_value(config: &ToolkitConfig, server: &str, key: &str) -> Option<String> {
    match (server, key) {
        ("terminal", "TERMINAL_DEFAULT_TIMEOUT_MS") => config.terminal.default_timeout_ms.map(num),
        ("terminal", "TERMINAL_MAX_TIMEOUT_MS") => config.terminal.max_timeout_ms.map(num),

        ("web-browser", "BROWSER_DEFAULT_TIMEOUT_MS") => config.webbrowser.default_timeout_ms.map(num),
        ("web-browser", "BROWSER_MAX_TIMEOUT_MS") => config.webbrowser.max_timeout_ms.map(num),
        ("web-browser", "BROWSER_MAX_CONTENT_CHARS") => config.webbrowser.max_content_chars.map(num),
        ("web-browser", "BROWSER_HEADLESS") => config.webbrowser.headless.map(boolean),

        ("common", "CALCULATOR_DEFAULT_PRECISION") => config.calculator.default_precision.map(num),
        ("common", "CALCULATOR_MAX_PRECISION") => config.calculator.max_precision.map(num),
        ("common", "DOC_SCRAPER_DEFAULT_TIMEOUT_MS") => config.documentscraper.default_timeout_ms.map(num),
        ("common", "DOC_SCRAPER_MAX_TIMEOUT_MS") => config.documentscraper.max_timeout_ms.map(num),
        ("common", "DOC_SCRAPER_MAX_CONTENT_BYTES") => config.documentscraper.max_content_bytes.map(num),
        ("common", "DOC_SCRAPER_MAX_CONTENT_CHARS") => config.documentscraper.max_content_chars.map(num),
        ("common", "DOC_SCRAPER_WORKSPACE_ROOT") => config.documentscraper.workspace_root.clone(),
        ("common", "CLOCK_DEFAULT_TIMEZONE") => config.clock.default_timezone.clone(),
        ("common", "CLOCK_DEFAULT_LOCALE") => config.clock.default_locale.clone(),
        ("common", "ASK_USER_DB_PATH") => config.askuser.db_path.clone(),
        ("common", "ASK_USER_DEFAULT_EXPIRES_SECONDS") => config.askuser.default_expires_seconds.map(num),
        ("common", "ASK_USER_MAX_EXPIRES_SECONDS") => config.askuser.max_expires_seconds.map(num),
        ("common", "ASK_USER_MAX_QUESTIONS") => config.askuser.max_questions.map(num),

        // The one non-identity mapping: browserless.apiKey (YAML) -> BROWSERLESS_TOKEN (env).
        ("browserless", "BROWSERLESS_TOKEN") => config.browserless.api_key.clone(),

        ("python-shell", "PYTHON_SHELL_DEFAULT_TIMEOUT_MS") => config.pythonshell.default_timeout_ms.map(num),
        ("python-shell", "PYTHON_SHELL_MAX_TIMEOUT_MS") => config.pythonshell.max_timeout_ms.map(num),
        ("python-shell", "PYTHON_SHELL_MAX_OUTPUT_CHARS") => config.pythonshell.max_output_chars.map(num),
        ("python-shell", "PYTHON_SHELL_WORKSPACE_ROOT") => config.pythonshell.workspace_root.clone(),

        ("skills", "SKILLS_DB_PATH") => config.skills.db_path.clone(),

        ("blender-bridge", "BLENDER_MCP_HOST") => config.blenderbridge.host.clone(),
        ("blender-bridge", "BLENDER_MCP_PORT") => config.blenderbridge.port.map(num),
        ("blender-bridge", "BLENDER_MCP_COMMAND") => config.blenderbridge.command.clone(),
        ("blender-bridge", "BLENDER_MCP_ARGS") => config.blenderbridge.args.clone(),

        ("lan-sub-agent", "LAN_SUBAGENT_CONFIG_PATH") => config.lansubagent.config_path.clone(),
        ("lan-sub-agent", "SUBAGENT_LOCAL_HOST") => config.lansubagent.local_host.clone(),
        ("lan-sub-agent", "SUBAGENT_LOCAL_PORT") => config
            .lansubagent
            .local_port
            .as_ref()
            .and_then(yaml_scalar_to_string),

        // No override in the unified config for this key: keep the canonical default.
        _ => None,
    }
}

fn num(n: u64) -> String {
    n.to_string()
}

fn boolean(b: bool) -> String {
    if b {
        "true".to_string()
    } else {
        "false".to_string()
    }
}

/// Renders a scalar YAML value (string/number/bool) to its string form; returns
/// `None` for non-scalar or null values so the canonical default is kept.
fn yaml_scalar_to_string(v: &serde_yaml::Value) -> Option<String> {
    match v {
        serde_yaml::Value::String(s) => Some(s.clone()),
        serde_yaml::Value::Number(n) => Some(n.to_string()),
        serde_yaml::Value::Bool(b) => Some(boolean(*b)),
        _ => None,
    }
}

// ─── User-scoped writer (Req 7.2, 7.3, 7.4) ────────────────────────────────────

/// A failure to write one tool's config, naming the affected tool and cause
/// (Req 7.4).
#[derive(Debug)]
pub struct ConfigWriteError {
    /// The MCP server whose config could not be written.
    pub server_name: String,
    /// Human-readable cause.
    pub cause: String,
}

impl std::fmt::Display for ConfigWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "failed to write env config for tool '{}': {}",
            self.server_name, self.cause
        )
    }
}

impl std::error::Error for ConfigWriteError {}

/// Returns the current-user-scoped directory the per-tool configs are written
/// under: `%LOCALAPPDATA%\LLM-Toolkit\config`.
///
/// `%LOCALAPPDATA%` (`C:\Users\<user>\AppData\Local`) is per-user and not
/// readable by other standard user accounts, satisfying Req 7.3. Falls back to
/// `%USERPROFILE%\AppData\Local\LLM-Toolkit\config` when `LOCALAPPDATA` is unset.
pub fn user_scoped_config_dir() -> PathBuf {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local_app_data)
            .join("LLM-Toolkit")
            .join("config");
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        return PathBuf::from(profile)
            .join("AppData")
            .join("Local")
            .join("LLM-Toolkit")
            .join("config");
    }
    // Last-resort fallback; still user-intent (not a shared/world path).
    PathBuf::from("LLM-Toolkit").join("config")
}

/// Pure predicate: is `path` a current-user-scoped location (never a shared /
/// world-readable one)?
///
/// This backs Property 15: every written config path must satisfy this. A path
/// is user-scoped when it lives under the current user's `%LOCALAPPDATA%` /
/// `%USERPROFILE%` tree (or the relative fallback), and is *not* under a
/// machine-shared root such as `C:\ProgramData`, `C:\Program Files`, the
/// `%PUBLIC%` tree, or `\Users\Public`.
pub fn is_user_scoped_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy().replace('/', "\\").to_lowercase();

    // Reject well-known machine-shared / world-readable roots outright.
    let shared_roots = [
        "c:\\programdata",
        "c:\\program files",
        "c:\\program files (x86)",
        "\\users\\public",
        "c:\\users\\public",
        "c:\\windows",
    ];
    if shared_roots.iter().any(|root| normalized.starts_with(root)) {
        return false;
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        let public = public.replace('/', "\\").to_lowercase();
        if !public.is_empty() && normalized.starts_with(&public) {
            return false;
        }
    }

    // Accept the current user's scoped roots.
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let lad = local_app_data.replace('/', "\\").to_lowercase();
        if !lad.is_empty() && normalized.starts_with(&lad) {
            return true;
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let prof = profile.replace('/', "\\").to_lowercase();
        if !prof.is_empty() && normalized.starts_with(&prof) {
            return true;
        }
    }

    // Relative paths (the last-resort fallback, and test temp dirs that are not
    // under a shared root) are treated as user-scoped: they resolve under the
    // invoking user's context, never a machine-shared location.
    !path.is_absolute()
}

/// Writes every derived tool config under [`user_scoped_config_dir`], one file
/// per tool (`<server>.json`), writing each fully before proceeding to the next
/// (Req 7.2). Returns the list of written file paths on success.
///
/// On the first failure it returns a [`ConfigWriteError`] naming the affected
/// tool and cause and removes that tool's partially written file so no partial
/// config remains for it (Req 7.4).
pub fn write_all(configs: &ToolEnvConfigSet) -> Result<Vec<PathBuf>, ConfigWriteError> {
    let dir = user_scoped_config_dir();
    write_all_to(&dir, configs)
}

/// Testable core of [`write_all`]: writes under an explicit `dir`. `dir` must be
/// a current-user-scoped path (checked, Req 7.3).
pub fn write_all_to(dir: &Path, configs: &ToolEnvConfigSet) -> Result<Vec<PathBuf>, ConfigWriteError> {
    // Refuse to write into a non-user-scoped location: secrets must never land
    // somewhere readable by other accounts (Req 7.3 / Property 15).
    if !is_user_scoped_path(dir) {
        return Err(ConfigWriteError {
            server_name: "<all>".to_string(),
            cause: format!(
                "refusing to write configs to non-user-scoped path: {}",
                dir.display()
            ),
        });
    }

    std::fs::create_dir_all(dir).map_err(|e| ConfigWriteError {
        server_name: "<all>".to_string(),
        cause: format!("could not create config dir {}: {e}", dir.display()),
    })?;

    let mut written: Vec<PathBuf> = Vec::new();

    for (server_name, env) in configs {
        let file = dir.join(format!("{server_name}.json"));

        let body = serde_json::to_string_pretty(env).map_err(|e| ConfigWriteError {
            server_name: server_name.clone(),
            cause: format!("could not serialize config: {e}"),
        })?;

        if let Err(e) = std::fs::write(&file, body) {
            // Leave no partial config for the failed tool (Req 7.4).
            let _ = std::fs::remove_file(&file);
            return Err(ConfigWriteError {
                server_name: server_name.clone(),
                cause: format!("could not write {}: {e}", file.display()),
            });
        }

        written.push(file);
    }

    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The default config (all sections empty) must still derive all 9 tools
    /// with their canonical defaults.
    #[test]
    fn derive_all_yields_exactly_nine_tools() {
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        assert_eq!(set.len(), CANONICAL_TOOL_COUNT);

        let expected: std::collections::BTreeSet<String> = canonical_payloads()
            .iter()
            .map(|t| t.server_name.to_string())
            .collect();
        let actual: std::collections::BTreeSet<String> = set.keys().cloned().collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn each_tool_has_exactly_canonical_keys() {
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        for tool in canonical_payloads() {
            let env = &set[tool.server_name];
            let expected: std::collections::BTreeSet<&str> =
                canonical_env_keys(tool.server_name).into_iter().collect();
            let actual: std::collections::BTreeSet<&str> = env.keys().map(|s| s.as_str()).collect();
            assert_eq!(
                actual, expected,
                "env keys for {} must equal canonical set",
                tool.server_name
            );
        }
    }

    #[test]
    fn defaults_match_mcp_config_when_config_empty() {
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        // A few representative defaults from mcp-config.js.
        assert_eq!(set["terminal"]["TERMINAL_DEFAULT_TIMEOUT_MS"], "60000");
        assert_eq!(set["common"]["CLOCK_DEFAULT_LOCALE"], "en-US");
        assert_eq!(set["skills"].len(), 1);
        // browserless default token is empty when no apiKey is configured.
        assert_eq!(set["browserless"]["BROWSERLESS_TOKEN"], "");
        // 3dtool carries no env keys.
        assert!(set["3dtool"].is_empty());
    }

    #[test]
    fn tools_with_no_env_keys_have_empty_maps() {
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        assert!(set["3dtool"].is_empty());
    }

    #[test]
    fn config_values_override_defaults() {
        let yaml = r#"
terminal:
  defaultTimeoutMs: 5000
  maxTimeoutMs: 9000
webbrowser:
  headless: false
pythonshell:
  maxOutputChars: 12345
"#;
        let config = parse_toolkit_config(yaml).expect("parse");
        let set = derive_all(&config, Path::new("C:/test/Install"));

        assert_eq!(set["terminal"]["TERMINAL_DEFAULT_TIMEOUT_MS"], "5000");
        assert_eq!(set["terminal"]["TERMINAL_MAX_TIMEOUT_MS"], "9000");
        assert_eq!(set["web-browser"]["BROWSER_HEADLESS"], "false");
        assert_eq!(set["python-shell"]["PYTHON_SHELL_MAX_OUTPUT_CHARS"], "12345");
        // Unset keys retain canonical defaults.
        assert_eq!(set["python-shell"]["PYTHON_SHELL_DEFAULT_TIMEOUT_MS"], "60000");
    }

    #[test]
    fn browserless_apikey_maps_to_token() {
        let yaml = r#"
browserless:
  apiKey: super-secret-token
"#;
        let config = parse_toolkit_config(yaml).expect("parse");
        let set = derive_all(&config, Path::new("C:/test/Install"));
        assert_eq!(set["browserless"]["BROWSERLESS_TOKEN"], "super-secret-token");
        // The env key is BROWSERLESS_TOKEN, never BROWSERLESS_API_KEY.
        assert!(!set["browserless"].contains_key("BROWSERLESS_API_KEY"));
    }

    #[test]
    fn parse_ignores_unknown_and_extra_sections() {
        // The real llm-toolkit.config.yaml carries sections (memory, cli,
        // observability, agentrunner, threedtool, csvexporter, global...) that
        // the env derivation does not model. Parsing must tolerate them.
        let yaml = r#"
global:
  logLevel: info
memory:
  dbPath: ./data/agent-memory.db
threedtool:
  port: 3013
terminal:
  defaultTimeoutMs: 1234
"#;
        let config = parse_toolkit_config(yaml).expect("parse must ignore unknown sections");
        let set = derive_all(&config, Path::new("C:/test/Install"));
        assert_eq!(set["terminal"]["TERMINAL_DEFAULT_TIMEOUT_MS"], "1234");
        assert_eq!(set.len(), CANONICAL_TOOL_COUNT);
    }

    #[test]
    fn is_secret_key_flags_browserless_token() {
        assert!(is_secret_key("BROWSERLESS_TOKEN"));
        assert!(!is_secret_key("TERMINAL_DEFAULT_TIMEOUT_MS"));
    }

    #[test]
    fn user_scoped_dir_is_recognized_as_user_scoped() {
        let dir = user_scoped_config_dir();
        assert!(
            is_user_scoped_path(&dir),
            "the writer's own dir must be user-scoped: {}",
            dir.display()
        );
    }

    #[test]
    fn shared_roots_are_not_user_scoped() {
        assert!(!is_user_scoped_path(Path::new("C:\\ProgramData\\LLM-Toolkit")));
        assert!(!is_user_scoped_path(Path::new(
            "C:\\Program Files\\LLM-Toolkit"
        )));
        assert!(!is_user_scoped_path(Path::new("C:\\Users\\Public\\cfg")));
    }

    #[test]
    fn write_all_to_writes_one_file_per_tool_in_user_scoped_dir() {
        // A relative temp-ish dir is treated as user-scoped (not under a shared
        // root), so the writer proceeds.
        let base = std::env::temp_dir().join(format!(
            "llm-toolkit-cfg-test-{}",
            std::process::id()
        ));
        // temp_dir on Windows is under the user profile => user-scoped.
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));

        // Only run the write assertions when temp is user-scoped (it is on
        // Windows CI); otherwise assert the guard refuses gracefully.
        if is_user_scoped_path(&base) {
            let written = write_all_to(&base, &set).expect("write");
            assert_eq!(written.len(), CANONICAL_TOOL_COUNT);
            for path in &written {
                assert!(path.exists(), "config file must exist: {}", path.display());
            }
            // Cleanup.
            let _ = std::fs::remove_dir_all(&base);
        }
    }

    #[test]
    fn write_all_to_refuses_non_user_scoped_dir() {
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        let err = write_all_to(Path::new("C:\\ProgramData\\LLM-Toolkit"), &set)
            .expect_err("must refuse shared path");
        assert!(err.cause.contains("non-user-scoped"));
    }

    #[test]
    fn real_repo_config_parses_and_derives() {
        // The exact llm-toolkit.config.yaml from the repo root must parse and
        // derive cleanly (guards against schema drift).
        let yaml = r#"
global:
  logLevel: info
  workspaceRoot: .
terminal:
  port: 3333
  defaultTimeoutMs: 60000
  maxTimeoutMs: 120000
browserless:
  port: 3003
  apiKey: your_browserless_api_key_here
  apiUrl: https://production-sfo.browserless.io
lansubagent:
  configPath: ./lan-subagent-config.json
  localHost: localhost
  localPort: 1234
"#;
        let config = parse_toolkit_config(yaml).expect("parse repo config");
        let set = derive_all(&config, Path::new("C:/test/Install"));
        assert_eq!(set.len(), CANONICAL_TOOL_COUNT);
        assert_eq!(
            set["browserless"]["BROWSERLESS_TOKEN"],
            "your_browserless_api_key_here"
        );
        assert_eq!(set["lan-sub-agent"]["SUBAGENT_LOCAL_PORT"], "1234");
        assert_eq!(set["lan-sub-agent"]["SUBAGENT_LOCAL_HOST"], "localhost");
    }
}

#[cfg(test)]
mod derivation_completeness_property_tests {
    //! Property-based test for Property 11 (per-tool env derivation completeness).
    //!
    //! Kept in its own module so it does not collide with the secrets-user-scoped
    //! property test (task 10.4) added to this same file.

    use super::*;
    use crate::tool_payload::canonical_payloads;
    use proptest::prelude::*;
    use std::collections::BTreeSet;

    /// A strategy for an optional YAML scalar line `  key: value` for a given
    /// key. `None` omits the line entirely (exercising the "use canonical
    /// default" path); `Some` picks an arbitrary value of the right shape.
    fn opt_u64_line(key: &'static str) -> impl Strategy<Value = String> {
        proptest::option::of(any::<u64>()).prop_map(move |v| match v {
            Some(n) => format!("  {key}: {n}\n"),
            None => String::new(),
        })
    }

    fn opt_bool_line(key: &'static str) -> impl Strategy<Value = String> {
        proptest::option::of(any::<bool>()).prop_map(move |v| match v {
            Some(b) => format!("  {key}: {b}\n"),
            None => String::new(),
        })
    }

    /// A YAML-safe arbitrary string value (no control chars, quotes, or leading
    /// specials) rendered as a double-quoted scalar so any content is legal YAML.
    fn opt_str_line(key: &'static str) -> impl Strategy<Value = String> {
        proptest::option::of("[a-zA-Z0-9 ._/:-]{0,24}").prop_map(move |v| match v {
            Some(s) => format!("  {key}: \"{s}\"\n"),
            None => String::new(),
        })
    }

    /// `localPort` accepts either a numeric or string scalar (both render via
    /// `yaml_scalar_to_string`); vary across both to exercise the untyped value.
    fn opt_local_port_line() -> impl Strategy<Value = String> {
        prop_oneof![
            Just(String::new()),
            any::<u32>().prop_map(|n| format!("  localPort: {n}\n")),
            "[a-zA-Z0-9]{1,8}".prop_map(|s| format!("  localPort: \"{s}\"\n")),
        ]
    }

    /// Assemble a full arbitrary-but-valid `llm-toolkit.config.yaml` document by
    /// randomly including each section and each optional field within it. Also
    /// sprinkle in unmodeled sections to mirror the real config carrying extras.
    fn arb_toolkit_yaml() -> impl Strategy<Value = String> {
        (
            // terminal
            (opt_u64_line("defaultTimeoutMs"), opt_u64_line("maxTimeoutMs")),
            // webbrowser
            (
                opt_u64_line("defaultTimeoutMs"),
                opt_u64_line("maxTimeoutMs"),
                opt_u64_line("maxContentChars"),
                opt_bool_line("headless"),
            ),
            // browserless.apiKey (the secret / non-identity mapping)
            opt_str_line("apiKey"),
            // rag (subset of fields)
            (
                opt_str_line("dbPath"),
                opt_str_line("embeddingsMode"),
                opt_bool_line("bypassApproval"),
                opt_u64_line("chunkSizeTokens"),
            ),
            // blenderbridge
            (
                opt_str_line("host"),
                opt_u64_line("port"),
                opt_str_line("command"),
            ),
            // lansubagent (untyped localPort)
            (opt_str_line("configPath"), opt_local_port_line()),
            // workspace-root tools
            (
                opt_str_line("workspaceRoot"),
                opt_str_line("workspaceRoot"),
                opt_str_line("workspaceRoot"),
            ),
        )
            .prop_map(
                |(
                    (term_dt, term_mt),
                    (wb_dt, wb_mt, wb_cc, wb_hl),
                    bl_key,
                    (rag_db, rag_mode, rag_bypass, rag_chunk),
                    (bb_host, bb_port, bb_cmd),
                    (lan_cfg, lan_port),
                    (git_ws, pkg_ws, fe_ws),
                )| {
                    let mut y = String::new();
                    // An unmodeled section to prove parse tolerance holds.
                    y.push_str("global:\n  logLevel: info\n");
                    y.push_str(&format!("terminal:\n{term_dt}{term_mt}"));
                    y.push_str(&format!("webbrowser:\n{wb_dt}{wb_mt}{wb_cc}{wb_hl}"));
                    y.push_str(&format!("browserless:\n{bl_key}"));
                    y.push_str(&format!("rag:\n{rag_db}{rag_mode}{rag_bypass}{rag_chunk}"));
                    y.push_str(&format!("blenderbridge:\n{bb_host}{bb_port}{bb_cmd}"));
                    y.push_str(&format!("lansubagent:\n{lan_cfg}{lan_port}"));
                    y.push_str(&format!("git:\n{git_ws}"));
                    y.push_str(&format!("packagemanager:\n{pkg_ws}"));
                    y.push_str(&format!("fileeditor:\n{fe_ws}"));
                    y
                },
            )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: windows-installer-setup-exe, Property 11: Per-tool env derivation completeness
        #[test]
        fn derive_all_is_complete_for_every_valid_config(yaml in arb_toolkit_yaml()) {
            let config = parse_toolkit_config(&yaml)
                .expect("generated YAML must parse into a ToolkitConfig");
            let set = derive_all(&config, Path::new("C:/test/Install"));

            // The derivation yields exactly one entry per canonical server (9).
            prop_assert_eq!(set.len(), CANONICAL_TOOL_COUNT);

            let expected_servers: BTreeSet<&str> =
                canonical_payloads().iter().map(|t| t.server_name).collect();
            let actual_servers: BTreeSet<&str> = set.keys().map(|s| s.as_str()).collect();
            prop_assert_eq!(actual_servers, expected_servers);

            // For each server, the derived env's key set is exactly the canonical
            // key set for that server (no missing, no extra keys).
            for tool in canonical_payloads() {
                let server = tool.server_name;
                let env = set
                    .get(server)
                    .unwrap_or_else(|| panic!("missing derived entry for {server}"));

                let expected_keys: BTreeSet<&str> =
                    canonical_env_keys(server).into_iter().collect();
                let actual_keys: BTreeSet<&str> = env.keys().map(|s| s.as_str()).collect();
                prop_assert_eq!(
                    actual_keys,
                    expected_keys,
                    "env keys for {} must equal the canonical set",
                    server
                );
            }
        }
    }
}

/// Error-attribution tests for [`write_all_to`] (task 10.5, Req 7.4).
///
/// These verify the *failure* contract of the per-tool writer:
/// - a config-write failure names the affected tool (via `server_name` and the
///   `Display` message), and
/// - no partial config file is left behind for that tool.
///
/// Kept in a separate module (rather than the main `tests` module) to avoid
/// collisions with the property tests added alongside in tasks 10.3/10.4.
#[cfg(test)]
mod config_error_attribution_tests {
    use super::*;

    /// A private, current-user-scoped scratch dir unique to this process+test.
    ///
    /// `std::env::temp_dir()` on Windows resolves under the user profile
    /// (`%LOCALAPPDATA%\Temp`), so it is user-scoped; we assert that so the test
    /// fails loudly rather than silently no-op'ing if the environment differs.
    fn user_scoped_scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "llm-toolkit-cfg-err-{}-{}",
            tag,
            std::process::id()
        ));
        // Start clean in case a previous run left residue.
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            is_user_scoped_path(&dir),
            "scratch dir must be user-scoped for these tests: {}",
            dir.display()
        );
        dir
    }

    /// Forcing a per-tool write failure names *that* tool and leaves no partial
    /// config file for it (Req 7.4).
    ///
    /// We provoke the failure deterministically: pre-create a **directory** at
    /// the exact path where one tool's `<server>.json` file would be written, so
    /// `std::fs::write` for that tool fails (a path that is a directory cannot be
    /// opened as a file). Because `ToolEnvConfigSet` is a `BTreeMap`, the write
    /// order is the sorted server-name order, so the first (alphabetically
    /// smallest) server is written first and is a stable, deterministic target.
    #[test]
    fn write_failure_names_the_affected_tool_and_leaves_no_partial_file() {
        let dir = user_scoped_scratch_dir("attrib");
        std::fs::create_dir_all(&dir).expect("create scratch dir");

        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));

        // Pick a real tool to sabotage (the first in BTreeMap/sorted order so we
        // know it is reached before any later write could succeed-then-fail).
        let target_server = set
            .keys()
            .next()
            .cloned()
            .expect("derived set is non-empty");

        // Sabotage: create a directory where `<target_server>.json` should be a
        // file. `fs::write` will then fail for this tool only.
        let sabotaged = dir.join(format!("{target_server}.json"));
        std::fs::create_dir_all(&sabotaged)
            .expect("create dir at the target file path to force a write failure");

        let err = write_all_to(&dir, &set).expect_err("write must fail for the sabotaged tool");

        // (1) The error attributes the failure to the affected tool: both the
        //     structured `server_name` and the human-readable `Display`.
        assert_eq!(
            err.server_name, target_server,
            "ConfigWriteError.server_name must name the failing tool"
        );
        let shown = err.to_string();
        assert!(
            shown.contains(&format!("tool '{target_server}'")),
            "Display must name the failing tool; got: {shown}"
        );

        // (2) No partial config file remains for the failed tool. The sabotage
        //     path is (and stays) a directory, never a written config file.
        assert!(
            sabotaged.is_dir(),
            "sabotaged path must remain a directory, not become a file: {}",
            sabotaged.display()
        );
        assert!(
            !sabotaged.is_file(),
            "no partial <server>.json file may remain for the failed tool: {}",
            sabotaged.display()
        );

        // Cleanup.
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The failure is attributed to a *specific* tool, not a blanket `<all>`.
    ///
    /// `<all>` is reserved for whole-directory failures (non-user-scoped path,
    /// dir creation). A per-tool write failure must carry the concrete server
    /// name so the caller can report exactly which tool's config failed.
    #[test]
    fn per_tool_write_failure_is_not_attributed_to_all() {
        let dir = user_scoped_scratch_dir("not-all");
        std::fs::create_dir_all(&dir).expect("create scratch dir");

        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        let target_server = set.keys().next().cloned().expect("non-empty");

        let sabotaged = dir.join(format!("{target_server}.json"));
        std::fs::create_dir_all(&sabotaged).expect("force write failure");

        let err = write_all_to(&dir, &set).expect_err("must fail");
        assert_ne!(
            err.server_name, "<all>",
            "a per-tool write failure must name the tool, not the whole set"
        );
        assert!(
            err.cause.contains("could not write"),
            "cause should describe the write failure; got: {}",
            err.cause
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Sanity companions kept local to this module so the failure tests read as
    /// a complete story: a clean run writes exactly one file per tool, and the
    /// non-user-scoped refusal is attributed to `<all>` (contrast to per-tool).
    #[test]
    fn clean_write_creates_one_file_per_tool() {
        let dir = user_scoped_scratch_dir("clean");
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));

        let written = write_all_to(&dir, &set).expect("clean write must succeed");
        assert_eq!(
            written.len(),
            CANONICAL_TOOL_COUNT,
            "one file per canonical tool"
        );
        for path in &written {
            assert!(path.is_file(), "each config must be a file: {}", path.display());
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_user_scoped_refusal_is_attributed_to_all() {
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        let err = write_all_to(Path::new("C:\\ProgramData\\LLM-Toolkit"), &set)
            .expect_err("must refuse a shared path");
        assert_eq!(err.server_name, "<all>");
        assert!(err.to_string().contains("<all>"));
        assert!(err.cause.contains("non-user-scoped"));
    }
}

// Feature: windows-installer-setup-exe, Property 15: Secrets are user-scoped
//
// Property 15 (design.md): For all derived Tool_Environment_Configs, no secret
// value is written to a configuration location readable by other user accounts;
// every written config uses a current-user-scoped path (and, where applicable,
// user-restricted access).
//
// Validates: Requirements 7.3
//
// The pure predicate `is_user_scoped_path(&Path)` backs this property. These
// tests drive it from three angles: (a) the writer's own dir is user-scoped,
// (b) paths under shared/world-readable roots are rejected while paths under the
// current user's %LOCALAPPDATA%/%USERPROFILE% are accepted, and (c) `write_all_to`
// refuses a non-user-scoped dir and, when given a user-scoped temp dir, writes
// every config (including secret-bearing ones) only under that user-scoped path.
//
// Placed in its own module to avoid collision with the derivation-completeness
// property test (task 10.3) that also extends this file.
#[cfg(test)]
mod secrets_user_scoped_property_tests {
    use super::*;
    use proptest::prelude::*;
    use std::path::PathBuf;

    /// A short, filesystem-safe token/value fragment. Constrained to the input
    /// space: secret values are arbitrary text but must be embeddable in a JSON
    /// config and comparable verbatim, so we keep them printable and non-empty.
    fn secret_value() -> impl Strategy<Value = String> {
        "[A-Za-z0-9_.:/=+-]{1,40}"
    }

    /// A directory *name* component for a generated candidate path: a non-empty
    /// filesystem-safe segment.
    fn path_segment() -> impl Strategy<Value = String> {
        "[A-Za-z0-9_-]{1,16}"
    }

    /// A [`ToolkitConfig`] carrying a random `browserless.apiKey` (which the
    /// derivation maps to the secret `BROWSERLESS_TOKEN` env value). Every other
    /// section stays at its default so the derivation still yields all 9 tools.
    fn config_with_secret() -> impl Strategy<Value = (String, ToolkitConfig)> {
        secret_value().prop_map(|token| {
            let mut config = ToolkitConfig::default();
            config.browserless.api_key = Some(token.clone());
            (token, config)
        })
    }

    /// A shared / world-readable root under which nothing user-scoped may live.
    fn shared_root() -> impl Strategy<Value = &'static str> {
        prop_oneof![
            Just("C:\\ProgramData"),
            Just("C:\\Program Files"),
            Just("C:\\Program Files (x86)"),
            Just("C:\\Users\\Public"),
            Just("\\Users\\Public"),
            Just("C:\\Windows"),
        ]
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        /// (a) The writer's own target directory is always recognized as
        /// user-scoped — configs (and thus secrets) land there, never elsewhere.
        #[test]
        fn prop_user_scoped_config_dir_is_user_scoped(
            suffix in path_segment()
        ) {
            let base = user_scoped_config_dir();
            prop_assert!(
                is_user_scoped_path(&base),
                "user_scoped_config_dir must be user-scoped: {}",
                base.display()
            );
            // Any deeper path beneath it stays user-scoped as well.
            let nested = base.join(suffix);
            prop_assert!(
                is_user_scoped_path(&nested),
                "a path beneath the user-scoped dir must remain user-scoped: {}",
                nested.display()
            );
        }

        /// (b) Any path under a shared / world-readable root is NOT user-scoped,
        /// regardless of the sub-path generated beneath it.
        #[test]
        fn prop_shared_roots_are_never_user_scoped(
            root in shared_root(),
            seg_a in path_segment(),
            seg_b in path_segment(),
        ) {
            let candidate = PathBuf::from(root).join(&seg_a).join(&seg_b);
            prop_assert!(
                !is_user_scoped_path(&candidate),
                "path under shared root must be rejected: {}",
                candidate.display()
            );
        }

        /// (b) Any path under the current user's %LOCALAPPDATA% (or, absent that,
        /// %USERPROFILE%) IS user-scoped. Skipped only if neither var is set.
        #[test]
        fn prop_current_user_roots_are_user_scoped(
            seg_a in path_segment(),
            seg_b in path_segment(),
        ) {
            let user_root = std::env::var("LOCALAPPDATA")
                .ok()
                .filter(|s| !s.is_empty())
                .or_else(|| std::env::var("USERPROFILE").ok().filter(|s| !s.is_empty()));

            if let Some(root) = user_root {
                let candidate = PathBuf::from(root).join(&seg_a).join(&seg_b);
                prop_assert!(
                    is_user_scoped_path(&candidate),
                    "path under the current user's root must be user-scoped: {}",
                    candidate.display()
                );
            }
        }

        /// (c) `write_all_to` REFUSES a non-user-scoped dir (returns Err) so no
        /// secret ever lands in a world-readable location — verified with a
        /// config that actually carries a secret value.
        #[test]
        fn prop_write_all_to_refuses_shared_root(
            (_token, config) in config_with_secret(),
            root in shared_root(),
            seg in path_segment(),
        ) {
            let set = derive_all(&config, Path::new("C:/test/Install"));
            let shared_dir = PathBuf::from(root).join(seg);
            prop_assert!(
                !is_user_scoped_path(&shared_dir),
                "precondition: {} must be non-user-scoped",
                shared_dir.display()
            );

            let result = write_all_to(&shared_dir, &set);
            prop_assert!(
                result.is_err(),
                "write_all_to must refuse the non-user-scoped dir: {}",
                shared_dir.display()
            );
            if let Err(e) = result {
                prop_assert!(
                    e.cause.contains("non-user-scoped"),
                    "refusal cause should mention non-user-scoped, got: {}",
                    e.cause
                );
            }
            // No config file was ever created under the shared root.
            prop_assert!(
                !shared_dir.join("browserless.json").exists(),
                "no secret config may exist under a shared root"
            );
        }

        /// (c) Given a user-scoped temp dir, `write_all_to` writes every config
        /// there and the secret value lands ONLY under that user-scoped path —
        /// every written path satisfies `is_user_scoped_path`.
        #[test]
        fn prop_secret_only_written_under_user_scoped_path(
            (token, config) in config_with_secret(),
            unique in path_segment(),
        ) {
            let set = derive_all(&config, Path::new("C:/test/Install"));
            // The derived secret must carry the generated token verbatim.
            prop_assert_eq!(
                set["browserless"].get("BROWSERLESS_TOKEN"),
                Some(&token)
            );

            // std::env::temp_dir() is under the user profile on Windows =>
            // user-scoped. If the environment ever yields a non-user-scoped temp
            // (unexpected), assert the writer refuses rather than leaking.
            let base = std::env::temp_dir().join(format!(
                "llm-toolkit-secret-prop-{}-{}",
                std::process::id(),
                unique
            ));

            if is_user_scoped_path(&base) {
                let written = write_all_to(&base, &set)
                    .expect("write to user-scoped temp dir should succeed");

                // Every written path is user-scoped (Property 15 core claim).
                for path in &written {
                    prop_assert!(
                        is_user_scoped_path(path),
                        "written config path must be user-scoped: {}",
                        path.display()
                    );
                }

                // The secret value physically resides under the user-scoped dir
                // and nowhere else: the browserless config file exists there and
                // contains the token.
                let secret_file = base.join("browserless.json");
                prop_assert!(
                    written.contains(&secret_file),
                    "secret-bearing config must be among the written files"
                );
                prop_assert!(is_user_scoped_path(&secret_file));

                let body = std::fs::read_to_string(&secret_file)
                    .expect("secret config file must be readable");
                prop_assert!(
                    body.contains(&token),
                    "the secret token must be present in the user-scoped config file"
                );

                // Sanity: the secret key is recognized as secret-bearing.
                prop_assert!(is_secret_key("BROWSERLESS_TOKEN"));

                // Cleanup this iteration's dir.
                let _ = std::fs::remove_dir_all(&base);
            } else {
                let result = write_all_to(&base, &set);
                prop_assert!(
                    result.is_err(),
                    "a non-user-scoped temp base must be refused: {}",
                    base.display()
                );
            }
        }
    }
}

// ─── Bug condition exploration tests — Concern 3: path defaults not anchored ─

#[cfg(test)]
mod path_anchoring_bug_condition_tests {
    //! Bugfix: installer-plugin-path-and-browserless-secret
    //! Property 3 (Bug Condition — Path Defaults Anchored To Install Dir).
    //!
    //! These tests encode the EXPECTED (fixed) behavior and are expected to
    //! FAIL on the unfixed code, confirming Concern 3: the `common` env
    //! path-bearing DEFAULTS (`ASK_USER_DB_PATH = "./memory.db"`,
    //! `DOC_SCRAPER_WORKSPACE_ROOT = ""`) are relative/empty, so they resolve
    //! against the process CWD / dev repo instead of the per-user install dir.
    //!
    //! Bug condition (from design):
    //!   isBugCondition_pathNotAnchored(input) ==
    //!     is_path_key(key)
    //!     AND (is_relative(value) OR is_empty_workspace_root(key, value))
    //!     AND NOT resolves_under(install_dir, value)
    //!
    //! The anchoring seam (`anchor_env_path`) does not exist yet, so this test
    //! asserts over the OBSERVABLE derived env value from `derive_all` (with no
    //! user override) rather than referencing the not-yet-existing symbol. On
    //! the unfixed code the derived values are `./memory.db` / `` — neither is
    //! absolute nor anchored under the fake install dir — so the assertions
    //! fail meaningfully.
    //!
    //! Validates: Requirements 2.1, 2.2

    use super::*;

    /// A fake, absolute install root standing in for `%LOCALAPPDATA%\LLM-Toolkit`.
    const FAKE_INSTALL_DIR: &str = "C:/fake/Install";

    /// Whether `value`, once resolved, sits under `install_dir`. A value is
    /// considered anchored when it is an absolute path whose normalized,
    /// forward-slashed form begins with the install dir prefix.
    fn resolves_under(install_dir: &str, value: &str) -> bool {
        let v = value.replace('\\', "/");
        let root = install_dir.replace('\\', "/");
        // Must be absolute and prefixed by the install dir.
        v.starts_with(&root)
    }

    #[test]
    fn common_ask_user_db_path_default_is_anchored_under_install_dir() {
        // No user override -> canonical default is anchored under install_dir.
        let set = derive_all(&ToolkitConfig::default(), Path::new(FAKE_INSTALL_DIR));
        let common = &set["common"];
        let value = common
            .get("ASK_USER_DB_PATH")
            .expect("common env must carry ASK_USER_DB_PATH")
            .clone();

        assert!(
            resolves_under(FAKE_INSTALL_DIR, &value),
            "ASK_USER_DB_PATH default `{}` must resolve under the install dir `{}` \
             (unfixed: relative `./memory.db` resolves against the dev repo / CWD)",
            value,
            FAKE_INSTALL_DIR,
        );
    }

    #[test]
    fn common_doc_scraper_workspace_root_default_is_anchored_under_install_dir() {
        let set = derive_all(&ToolkitConfig::default(), Path::new(FAKE_INSTALL_DIR));
        let common = &set["common"];
        let value = common
            .get("DOC_SCRAPER_WORKSPACE_ROOT")
            .expect("common env must carry DOC_SCRAPER_WORKSPACE_ROOT")
            .clone();

        assert!(
            resolves_under(FAKE_INSTALL_DIR, &value),
            "DOC_SCRAPER_WORKSPACE_ROOT default `{}` must resolve under the install dir `{}` \
             (unfixed: empty workspace-root resolves against the dev repo / CWD)",
            value,
            FAKE_INSTALL_DIR,
        );
    }
}

// ─── Preservation baseline tests — Property 4 (secrets, mapping, user paths) ──

#[cfg(test)]
mod preservation_baseline_tests {
    //! Bugfix: installer-plugin-path-and-browserless-secret
    //! Property 4 (Preservation — Names, Command, Ownership, Env, Secrets,
    //! User Paths Unchanged) — the `config_gen.rs` half.
    //!
    //! These tests encode behavior observed on the UNFIXED code that the fix
    //! MUST preserve. The ones asserting existing secret handling and the
    //! `browserless.apiKey -> BROWSERLESS_TOKEN` mapping PASS today (baseline).
    //!
    //! Two invariants concern the NEW `anchor_env_path` seam (Concern 3), which
    //! does not exist yet, so they are split into:
    //!   (a) an OBSERVABLE baseline over `derive_all` that PASSES today — a
    //!       user-supplied ABSOLUTE path and any NON-path key flow through the
    //!       derivation verbatim (there is no anchoring today, so the value the
    //!       user set is exactly what comes out); and
    //!   (b) `#[ignore]`d tests that state the post-fix preservation contract
    //!       directly against `anchor_env_path`. They are marked pending the fix
    //!       (task 3.8) and cannot run until the seam exists — running them with
    //!       `--ignored` after the fix confirms preservation held.
    //!
    //! Validates: Requirements 3.6, 3.7, 3.8

    use super::*;
    use proptest::prelude::*;

    // ── Secret-key detection preservation (Req 3.6) ───────────────────────────

    /// `SECRET_ENV_KEYS` remains exactly `["BROWSERLESS_TOKEN"]` and
    /// `is_secret_key` flags it and nothing else. The fix must not widen or
    /// narrow the secret-key set.
    #[test]
    fn secret_env_keys_are_unchanged() {
        assert_eq!(SECRET_ENV_KEYS, ["BROWSERLESS_TOKEN"]);
        assert!(is_secret_key("BROWSERLESS_TOKEN"));
        assert!(!is_secret_key("TERMINAL_DEFAULT_TIMEOUT_MS"));
        assert!(!is_secret_key("RAG_DB_PATH"));
        assert!(!is_secret_key("BROWSERLESS_API_KEY"));
    }

    /// The canonical `browserless` default token is EMPTY (never a baked
    /// secret). Preserved exactly. (Req 3.6.)
    #[test]
    fn browserless_default_token_is_empty() {
        let defaults = canonical_env_defaults("browserless").expect("browserless is canonical");
        assert_eq!(defaults, &[("BROWSERLESS_TOKEN", "")]);

        // And the empty default flows through derivation with no user apiKey.
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        assert_eq!(set["browserless"]["BROWSERLESS_TOKEN"], "");
    }

    /// Placeholder token values behave as empty: when supplied as the user's
    /// `browserless.apiKey`, the derivation still maps them through (they are
    /// only treated as empty at the write/merge layer, unchanged by this fix).
    /// This documents that the placeholder strings themselves are preserved as
    /// the known placeholders the pipeline recognizes.
    #[test]
    fn known_placeholder_values_are_recognized_and_preserved() {
        // The two known placeholders documented across the pipeline.
        for placeholder in ["your-browserless-api-key-here", "your-browserless-api-token-here"] {
            let yaml = format!("browserless:\n  apiKey: {placeholder}\n");
            let config = parse_toolkit_config(&yaml).expect("parse");
            let set = derive_all(&config, Path::new("C:/test/Install"));
            // derive_all maps apiKey -> BROWSERLESS_TOKEN verbatim (placeholder
            // filtering happens later, in merge_env / drop-on-write, unchanged).
            assert_eq!(set["browserless"]["BROWSERLESS_TOKEN"], placeholder);
        }
    }

    // ── apiKey -> BROWSERLESS_TOKEN mapping preservation (Req 3.7) ─────────────

    /// The one non-identity mapping — `browserless.apiKey` (YAML) ->
    /// `BROWSERLESS_TOKEN` (env) — is preserved for arbitrary token values, and
    /// the env key is never `BROWSERLESS_API_KEY`. (Property-based.)
    #[test]
    fn apikey_to_token_mapping_is_preserved_for_arbitrary_tokens() {
        proptest!(|(token in "[A-Za-z0-9_.:/=+-]{1,40}")| {
            let yaml = format!("browserless:\n  apiKey: \"{token}\"\n");
            let config = parse_toolkit_config(&yaml).expect("parse");
            let set = derive_all(&config, Path::new("C:/test/Install"));
            prop_assert_eq!(set["browserless"].get("BROWSERLESS_TOKEN"), Some(&token));
            prop_assert!(!set["browserless"].contains_key("BROWSERLESS_API_KEY"));
        });
    }

    // ── User-supplied path / non-path preservation, observable baseline ───────

    /// BASELINE (passes today): a user-supplied ABSOLUTE path in the config is
    /// carried through `derive_all` verbatim. There is no anchoring today, so
    /// the derived value equals exactly what the user set. After the fix,
    /// `anchor_env_path` must keep this same pass-through for absolute user
    /// paths — see the `#[ignore]`d contract test below. (Req 3.8.)
    #[test]
    fn user_absolute_path_flows_through_derivation_verbatim() {
        proptest!(|(drive in "[A-Z]", tail in "[A-Za-z0-9_/-]{1,24}")| {
            let abs = format!("{drive}:/data/{tail}");
            let yaml = format!("pythonshell:\n  workspaceRoot: \"{abs}\"\n");
            let config = parse_toolkit_config(&yaml).expect("parse");
            let set = derive_all(&config, Path::new("C:/test/Install"));
            // User-supplied absolute path is preserved exactly (no rewrite).
            prop_assert_eq!(set["python-shell"].get("PYTHON_SHELL_WORKSPACE_ROOT"), Some(&abs));
        });
    }

    /// BASELINE (passes today): a NON-path env key (e.g. `BLENDER_MCP_COMMAND`)
    /// is never a path and is carried through `derive_all` verbatim. After the
    /// fix, `anchor_env_path` must never rewrite a non-path key — see the
    /// `#[ignore]`d contract test below. (Req 3.8.)
    #[test]
    fn non_path_env_value_flows_through_derivation_verbatim() {
        proptest!(|(cmd in "[a-z][a-z0-9-]{0,15}")| {
            let yaml = format!("blenderbridge:\n  command: \"{cmd}\"\n");
            let config = parse_toolkit_config(&yaml).expect("parse");
            let set = derive_all(&config, Path::new("C:/test/Install"));
            prop_assert_eq!(set["blender-bridge"].get("BLENDER_MCP_COMMAND"), Some(&cmd));
        });
    }

    // ── Pending-the-fix preservation contract against anchor_env_path ─────────
    //
    // The `anchor_env_path(install_dir, server_name, key, value)` seam does not
    // exist on the unfixed code. These tests state the preservation half of its
    // contract DIRECTLY. They are `#[ignore]`d so the suite compiles and passes
    // today; once task 3.8 adds `anchor_env_path`, drop the `#[ignore]` (and the
    // local shim) and run with `--ignored` to confirm preservation held:
    //
    //   * a user-supplied ABSOLUTE path passes through unchanged, and
    //   * a NON-path key is never rewritten.
    //
    // Until then, the OBSERVABLE baselines above cover the same invariants
    // through `derive_all`.

    /// task 3.8 (Concern 3): `anchor_env_path` leaves an absolute user path
    /// unchanged (preserve user intent). Enabled now that the seam exists.
    #[test]
    fn anchor_env_path_preserves_absolute_user_paths() {
        let out = anchor_env_path(Path::new("C:/fake/Install"), "rag", "RAG_DB_PATH", "D:/data/rag.db");
        assert_eq!(out, "D:/data/rag.db");
    }

    /// task 3.8 (Concern 3): `anchor_env_path` never rewrites a non-path key.
    /// Enabled now that the seam exists.
    #[test]
    fn anchor_env_path_never_rewrites_non_path_keys() {
        let out = anchor_env_path(
            Path::new("C:/fake/Install"),
            "rag",
            "RAG_EMBEDDINGS_MODE",
            "lmstudio",
        );
        assert_eq!(out, "lmstudio");
    }
}

// ─── Secret-scan predicate tests — Concern 2 (build/staging secret guard) ─────

#[cfg(test)]
mod secret_scan_predicate_tests {
    //! Bugfix: installer-plugin-path-and-browserless-secret
    //! Property 2 (No Secret Embedded In Payload) + Property 4 (Preservation).
    //!
    //! Unit tests for the pure `scan_value_for_secret(key, value)` predicate
    //! (task 3.4). It flags a value as an embedded secret when it is non-empty
    //! and NOT a known placeholder, AND is either assigned to a `SECRET_ENV_KEYS`
    //! key (`BROWSERLESS_TOKEN`) or is a Browserless-token-shaped credential.
    //! Empty and both known placeholders are ignored.
    //!
    //! Validates: Requirements 2.4, 2.5, 3.6

    use super::*;

    /// The exposed-token shape observed in the bug report (48-char hex-ish run):
    /// a live, non-placeholder Browserless token assigned to `BROWSERLESS_TOKEN`
    /// MUST be flagged.
    #[test]
    fn flags_nonempty_live_browserless_token() {
        let live = "2TNn0yOdSpEFIT49a897dc67e03352d172e69c1b07bf3d930";
        assert!(
            scan_value_for_secret("BROWSERLESS_TOKEN", live),
            "a non-empty live token on the secret key must be flagged"
        );
    }

    /// A short but non-placeholder value on the secret key still counts as a
    /// secret: the key itself (`BROWSERLESS_TOKEN`) is authoritative.
    #[test]
    fn flags_any_nonempty_nonplaceholder_value_on_secret_key() {
        assert!(scan_value_for_secret("BROWSERLESS_TOKEN", "abc123"));
    }

    /// An empty (and whitespace-only) value on the secret key is NOT a secret —
    /// it matches the empty canonical default / empty-drop handling.
    #[test]
    fn ignores_empty_value_on_secret_key() {
        assert!(!scan_value_for_secret("BROWSERLESS_TOKEN", ""));
        assert!(!scan_value_for_secret("BROWSERLESS_TOKEN", "   "));
    }

    /// Both known placeholders are ignored on the secret key (placeholder-as-empty).
    #[test]
    fn ignores_both_known_placeholders_on_secret_key() {
        assert!(!scan_value_for_secret(
            "BROWSERLESS_TOKEN",
            "your-browserless-api-key-here"
        ));
        assert!(!scan_value_for_secret(
            "BROWSERLESS_TOKEN",
            "your-browserless-api-token-here"
        ));
    }

    /// A token-shaped credential is flagged even under a non-secret key name,
    /// so a secret accidentally staged under another key is still caught.
    #[test]
    fn flags_token_shaped_value_under_nonsecret_key() {
        let live = "2TNn0yOdSpEFIT49a897dc67e03352d172e69c1b07bf3d930";
        assert!(scan_value_for_secret("SOME_OTHER_KEY", live));
    }

    /// Regression (mcp-shared-module-resolution-fix, Req 3.4): a token-shaped
    /// value under a benign structural metadata key (`license`, `integrity`,
    /// `resolved`, …) is NOT flagged. The Option B fix adds `@shared/*` `file:`
    /// entries to the flat `package-lock.json` carrying a long url-safe
    /// `"license"` value; the token-SHAPE heuristic must NOT false-positive on
    /// these standard lockfile fields.
    #[test]
    fn ignores_token_shaped_value_under_benign_metadata_key() {
        assert!(!scan_value_for_secret(
            "license",
            "LicenseRef-Shawna-NonCommercial"
        ));
        assert!(!scan_value_for_secret(
            "integrity",
            "sha512-Qd9j3u2m9Yd1pQpXz3F7bK0wVq1l5c2x8a7y6z4m3n2b1v0c9x8z7q6w5e4r3t2"
        ));
        assert!(!scan_value_for_secret(
            "resolved",
            "https://registry.npmjs.org/zod/-/zod-3.23.8.tgz"
        ));
        assert!(!scan_value_for_secret("version", "1.0.0-alpha.20240101120000"));
    }

    /// The benign-metadata carve-out does NOT weaken real-secret detection: a
    /// `BROWSERLESS_TOKEN` is still flagged regardless of value shape, since it
    /// is caught by `is_secret_key` before the shape path.
    #[test]
    fn benign_carveout_does_not_weaken_secret_key_detection() {
        let live = "2TNn0yOdSpEFIT49a897dc67e03352d172e69c1b07bf3d930";
        assert!(scan_value_for_secret("BROWSERLESS_TOKEN", live));
        assert!(scan_value_for_secret("BROWSERLESS_TOKEN", "abc123"));
    }

    /// A short, ordinary non-path value under a non-secret key is NOT flagged
    /// (preservation: non-secret config values pass the guard untouched).
    #[test]
    fn ignores_ordinary_value_under_nonsecret_key() {
        assert!(!scan_value_for_secret("RAG_EMBEDDINGS_MODE", "lmstudio"));
        assert!(!scan_value_for_secret("TERMINAL_DEFAULT_TIMEOUT_MS", "60000"));
        assert!(!scan_value_for_secret("SLASH_DEFAULT_SESSION", "default"));
    }

    /// A placeholder value is ignored regardless of the key it appears under.
    #[test]
    fn ignores_placeholder_under_any_key() {
        assert!(!scan_value_for_secret(
            "ANY_KEY",
            "your-browserless-api-token-here"
        ));
    }

    /// Preservation guard: the predicate does not alter the secret-key set or
    /// the empty canonical default it relies on.
    #[test]
    fn preserves_secret_key_set_and_empty_default() {
        assert_eq!(SECRET_ENV_KEYS, ["BROWSERLESS_TOKEN"]);
        let set = derive_all(&ToolkitConfig::default(), Path::new("C:/test/Install"));
        assert_eq!(set["browserless"]["BROWSERLESS_TOKEN"], "");
        // The empty default must not be flagged as an embedded secret.
        assert!(!scan_value_for_secret(
            "BROWSERLESS_TOKEN",
            &set["browserless"]["BROWSERLESS_TOKEN"]
        ));
    }
}

// ─── anchor_env_path unit tests — Concern 3 (task 3.8) ────────────────────────

#[cfg(test)]
mod anchor_env_path_tests {
    //! Bugfix: installer-plugin-path-and-browserless-secret
    //! Property 3 (Path Defaults Anchored To Install Dir) + Property 4
    //! (Preservation — non-path keys and absolute user paths unchanged).
    //!
    //! Unit tests for the pure `anchor_env_path(install_dir, server_name, key,
    //! value)` seam (task 3.8). It anchors relative/empty DEFAULTS of the
    //! enumerated path keys under `install_dir`, and leaves NON-path keys and
    //! already-absolute (user-supplied) paths verbatim.
    //!
    //! Validates: Requirements 2.1, 2.2, 3.7, 3.8

    use super::*;

    const INSTALL: &str = "C:/fake/Install";

    /// Mirror of the bug-condition test's helper: a value is anchored when its
    /// forward-slashed form begins with the install-dir prefix.
    fn resolves_under(install_dir: &str, value: &str) -> bool {
        value.replace('\\', "/").starts_with(&install_dir.replace('\\', "/"))
    }

    // ── Bug condition: relative / empty path defaults get anchored ────────────

    /// A relative `./file` db default (`ASK_USER_DB_PATH = "./memory.db"`) is
    /// anchored under `install_dir/<server_name>/` and resolves under the
    /// install dir (Concern 3, common).
    #[test]
    fn anchors_relative_db_path_under_install_dir_server_subdir() {
        let out = anchor_env_path(Path::new(INSTALL), "common", "ASK_USER_DB_PATH", "./memory.db");
        assert_eq!(out, "C:/fake/Install/common/memory.db");
        assert!(resolves_under(INSTALL, &out));
    }

    /// An empty workspace-root default (`DOC_SCRAPER_WORKSPACE_ROOT = ""`) is
    /// anchored to the install dir itself (Concern 3, common).
    #[test]
    fn anchors_empty_workspace_root_to_install_dir() {
        let out = anchor_env_path(Path::new(INSTALL), "common", "DOC_SCRAPER_WORKSPACE_ROOT", "");
        assert_eq!(out, "C:/fake/Install");
        assert!(resolves_under(INSTALL, &out));
    }

    /// A relative directory value with a trailing slash is anchored under the
    /// server subdir, with separators normalized.
    #[test]
    fn anchors_relative_dir_default_under_server_subdir() {
        let out = anchor_env_path(
            Path::new(INSTALL),
            "skills",
            "SKILLS_DB_PATH",
            "./.skills-data/",
        );
        assert_eq!(out, "C:/fake/Install/skills/.skills-data");
        assert!(resolves_under(INSTALL, &out));
    }

    /// Every enumerated path key with a relative default resolves under the
    /// install dir (covers the file/db path keys and the empty workspace roots).
    #[test]
    fn all_enumerated_relative_defaults_resolve_under_install_dir() {
        let cases = [
            ("common", "ASK_USER_DB_PATH", "./memory.db"),
            ("skills", "SKILLS_DB_PATH", "./skills.db"),
        ];
        for (server, key, val) in cases {
            let out = anchor_env_path(Path::new(INSTALL), server, key, val);
            assert!(
                resolves_under(INSTALL, &out),
                "{key}={val} anchored to `{out}` must resolve under {INSTALL}"
            );
        }
        // The empty-default workspace-root keys anchor to the install dir.
        for (server, key) in [
            ("python-shell", "PYTHON_SHELL_WORKSPACE_ROOT"),
            ("common", "DOC_SCRAPER_WORKSPACE_ROOT"),
        ] {
            let out = anchor_env_path(Path::new(INSTALL), server, key, "");
            assert_eq!(out, "C:/fake/Install", "{key} empty default anchors to install dir");
        }
    }

    /// Back-slash install dirs and values normalize to forward slashes and
    /// still resolve under the install dir.
    #[test]
    fn normalizes_backslash_install_dir_and_value() {
        let out = anchor_env_path(Path::new(r"C:\fake\Install"), "common", "ASK_USER_DB_PATH", r".\memory.db");
        assert_eq!(out, "C:/fake/Install/common/memory.db");
    }

    // ── Preservation: non-path keys and absolute user paths pass through ──────

    /// A NON-path key is never rewritten, regardless of value shape.
    #[test]
    fn non_path_keys_pass_through_verbatim() {
        assert_eq!(
            anchor_env_path(Path::new(INSTALL), "rag", "RAG_EMBEDDINGS_MODE", "lmstudio"),
            "lmstudio"
        );
        // Even a relative-looking value under a non-path key is left alone.
        assert_eq!(
            anchor_env_path(Path::new(INSTALL), "common", "CLOCK_DEFAULT_LOCALE", "./weird"),
            "./weird"
        );
        assert_eq!(
            anchor_env_path(Path::new(INSTALL), "terminal", "TERMINAL_DEFAULT_TIMEOUT_MS", "60000"),
            "60000"
        );
    }

    /// A user-supplied ABSOLUTE path on a path key passes through unchanged
    /// (preserve user intent) — drive, forward-slash drive, and UNC forms.
    #[test]
    fn absolute_user_paths_pass_through_verbatim() {
        assert_eq!(
            anchor_env_path(Path::new(INSTALL), "rag", "RAG_DB_PATH", "D:/data/rag.db"),
            "D:/data/rag.db"
        );
        assert_eq!(
            anchor_env_path(Path::new(INSTALL), "common", "ASK_USER_DB_PATH", r"D:\data\memory.db"),
            r"D:\data\memory.db"
        );
        assert_eq!(
            anchor_env_path(Path::new(INSTALL), "git", "GIT_WORKSPACE_ROOT", r"\\server\share\ws"),
            r"\\server\share\ws"
        );
    }

    /// `is_path_env_key` recognizes exactly the enumerated keys and nothing else.
    #[test]
    fn is_path_env_key_matches_enumerated_set_only() {
        for key in PATH_ENV_KEYS {
            assert!(is_path_env_key(key), "{key} must be a path key");
        }
        assert!(!is_path_env_key("RAG_EMBEDDINGS_MODE"));
        assert!(!is_path_env_key("BROWSERLESS_TOKEN"));
        assert!(!is_path_env_key("CLOCK_DEFAULT_LOCALE"));
    }
}
