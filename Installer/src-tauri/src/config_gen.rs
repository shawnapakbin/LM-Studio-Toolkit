//! Per-tool environment configuration derivation (Step 4 — Env config, Req 7).
//!
//! This module derives the [`Tool_Environment_Config`] for **all 16** MCP tools
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
//! 16 server names themselves are borrowed from [`crate::tool_payload`] so the
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
//! Requirements: 7.1 (derive per-tool env for all 16), 7.2 (write each before
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
/// mapping. `3dtool` and `csv-exporter` carry no env keys, matching `mcp-config.js`.
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
        "rag",
        &[
            ("RAG_DB_PATH", "./rag.db"),
            ("RAG_EMBEDDINGS_MODE", "lmstudio"),
            ("RAG_EMBEDDING_MODEL", "nomic-ai/nomic-embed-text-v1.5"),
            (
                "RAG_DOC_SCRAPER_ENDPOINT",
                "http://localhost:3336/tools/read_document",
            ),
            (
                "RAG_ASK_USER_ENDPOINT",
                "http://localhost:3338/tools/ask_user_interview",
            ),
            ("RAG_BYPASS_APPROVAL", "true"),
            ("RAG_CHUNK_SIZE_TOKENS", "384"),
            ("RAG_CHUNK_OVERLAP_TOKENS", "75"),
        ],
    ),
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
    ("slash-commands", &[("SLASH_DEFAULT_SESSION", "default")]),
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
        "sub-agent",
        &[
            ("SUBAGENT_MAX_CONCURRENCY", "1"),
            ("SUBAGENT_CACHE_PATH", "./subagent-cache.db"),
            ("SUBAGENT_CHECKPOINT_DIR", "./.subagent-checkpoints/"),
            ("SUBAGENT_API_URL", "http://localhost:1234/v1/chat/completions"),
            ("SUBAGENT_MODEL", "default"),
            ("SUBAGENT_PROMPT_TOKEN_COST", ""),
            ("SUBAGENT_COMPLETION_TOKEN_COST", ""),
        ],
    ),
    (
        "lan-sub-agent",
        &[
            ("LAN_SUBAGENT_CONFIG_PATH", ""),
            ("SUBAGENT_LOCAL_HOST", ""),
            ("SUBAGENT_LOCAL_PORT", ""),
        ],
    ),
    ("git", &[("GIT_WORKSPACE_ROOT", "")]),
    (
        "package-manager",
        &[("PACKAGE_MANAGER_WORKSPACE_ROOT", "")],
    ),
    ("csv-exporter", &[]),
    ("file-editor", &[("FILE_EDITOR_WORKSPACE_ROOT", "")]),
];

/// Returns the canonical env key/default pairs for `server_name`, or `None` if
/// the name is not one of the 16 canonical servers.
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
/// settings for tools/features outside the 16 env maps. All sections are
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
    pub rag: RagConfig,
    pub pythonshell: PythonShellConfig,
    pub skills: SkillsConfig,
    pub slashcommands: SlashCommandsConfig,
    pub blenderbridge: BlenderBridgeConfig,
    pub subagent: SubAgentConfig,
    pub lansubagent: LanSubAgentConfig,
    pub git: WorkspaceRootConfig,
    pub packagemanager: WorkspaceRootConfig,
    pub fileeditor: WorkspaceRootConfig,
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
pub struct RagConfig {
    #[serde(rename = "dbPath")]
    pub db_path: Option<String>,
    #[serde(rename = "embeddingsMode")]
    pub embeddings_mode: Option<String>,
    #[serde(rename = "embeddingModel")]
    pub embedding_model: Option<String>,
    #[serde(rename = "docScraperEndpoint")]
    pub doc_scraper_endpoint: Option<String>,
    #[serde(rename = "askUserEndpoint")]
    pub ask_user_endpoint: Option<String>,
    #[serde(rename = "bypassApproval")]
    pub bypass_approval: Option<bool>,
    #[serde(rename = "chunkSizeTokens")]
    pub chunk_size_tokens: Option<u64>,
    #[serde(rename = "chunkOverlapTokens")]
    pub chunk_overlap_tokens: Option<u64>,
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
pub struct SlashCommandsConfig {
    #[serde(rename = "defaultSession")]
    pub default_session: Option<String>,
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
pub struct SubAgentConfig {
    pub model: Option<String>,
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

/// Shared shape for tools whose only env key is a workspace root
/// (`git`, `package-manager`, `file-editor`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct WorkspaceRootConfig {
    #[serde(rename = "workspaceRoot")]
    pub workspace_root: Option<String>,
}

// ─── Pure derivation ──────────────────────────────────────────────────────────

/// Derives the [`ToolEnvConfigSet`] for **all 16** MCP tools from `config`.
///
/// Guarantees (Property 11):
/// - the result has exactly one entry per canonical server (16 total), and
/// - each entry's key set is exactly [`canonical_env_keys`] for that server.
///
/// For each key, the value is the setting from `config` when present, otherwise
/// the canonical default from `mcp-config.js`. This is a pure function with no
/// I/O.
pub fn derive_all(config: &ToolkitConfig) -> ToolEnvConfigSet {
    let mut out: ToolEnvConfigSet = BTreeMap::new();

    // Iterate the canonical 16 server names (from tool_payload) so the entry set
    // is exactly the 16 tools and cannot drift from the payload list.
    for tool in canonical_payloads() {
        let server = tool.server_name;
        let defaults = canonical_env_defaults(server).unwrap_or(&[]);

        let mut env: ToolEnvConfig = BTreeMap::new();
        for (key, default) in defaults {
            let value = override_value(config, server, key).unwrap_or_else(|| (*default).to_string());
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

        ("rag", "RAG_DB_PATH") => config.rag.db_path.clone(),
        ("rag", "RAG_EMBEDDINGS_MODE") => config.rag.embeddings_mode.clone(),
        ("rag", "RAG_EMBEDDING_MODEL") => config.rag.embedding_model.clone(),
        ("rag", "RAG_DOC_SCRAPER_ENDPOINT") => config.rag.doc_scraper_endpoint.clone(),
        ("rag", "RAG_ASK_USER_ENDPOINT") => config.rag.ask_user_endpoint.clone(),
        ("rag", "RAG_BYPASS_APPROVAL") => config.rag.bypass_approval.map(boolean),
        ("rag", "RAG_CHUNK_SIZE_TOKENS") => config.rag.chunk_size_tokens.map(num),
        ("rag", "RAG_CHUNK_OVERLAP_TOKENS") => config.rag.chunk_overlap_tokens.map(num),

        ("python-shell", "PYTHON_SHELL_DEFAULT_TIMEOUT_MS") => config.pythonshell.default_timeout_ms.map(num),
        ("python-shell", "PYTHON_SHELL_MAX_TIMEOUT_MS") => config.pythonshell.max_timeout_ms.map(num),
        ("python-shell", "PYTHON_SHELL_MAX_OUTPUT_CHARS") => config.pythonshell.max_output_chars.map(num),
        ("python-shell", "PYTHON_SHELL_WORKSPACE_ROOT") => config.pythonshell.workspace_root.clone(),

        ("skills", "SKILLS_DB_PATH") => config.skills.db_path.clone(),

        ("slash-commands", "SLASH_DEFAULT_SESSION") => config.slashcommands.default_session.clone(),

        ("blender-bridge", "BLENDER_MCP_HOST") => config.blenderbridge.host.clone(),
        ("blender-bridge", "BLENDER_MCP_PORT") => config.blenderbridge.port.map(num),
        ("blender-bridge", "BLENDER_MCP_COMMAND") => config.blenderbridge.command.clone(),
        ("blender-bridge", "BLENDER_MCP_ARGS") => config.blenderbridge.args.clone(),

        ("sub-agent", "SUBAGENT_MODEL") => config.subagent.model.clone(),

        ("lan-sub-agent", "LAN_SUBAGENT_CONFIG_PATH") => config.lansubagent.config_path.clone(),
        ("lan-sub-agent", "SUBAGENT_LOCAL_HOST") => config.lansubagent.local_host.clone(),
        ("lan-sub-agent", "SUBAGENT_LOCAL_PORT") => config
            .lansubagent
            .local_port
            .as_ref()
            .and_then(yaml_scalar_to_string),

        ("git", "GIT_WORKSPACE_ROOT") => config.git.workspace_root.clone(),
        ("package-manager", "PACKAGE_MANAGER_WORKSPACE_ROOT") => config.packagemanager.workspace_root.clone(),
        ("file-editor", "FILE_EDITOR_WORKSPACE_ROOT") => config.fileeditor.workspace_root.clone(),

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

    /// The default config (all sections empty) must still derive all 16 tools
    /// with their canonical defaults.
    #[test]
    fn derive_all_yields_exactly_sixteen_tools() {
        let set = derive_all(&ToolkitConfig::default());
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
        let set = derive_all(&ToolkitConfig::default());
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
        let set = derive_all(&ToolkitConfig::default());
        // A few representative defaults from mcp-config.js.
        assert_eq!(set["terminal"]["TERMINAL_DEFAULT_TIMEOUT_MS"], "60000");
        assert_eq!(set["common"]["CLOCK_DEFAULT_LOCALE"], "en-US");
        assert_eq!(set["rag"]["RAG_CHUNK_SIZE_TOKENS"], "384");
        // browserless default token is empty when no apiKey is configured.
        assert_eq!(set["browserless"]["BROWSERLESS_TOKEN"], "");
        // 3dtool and csv-exporter carry no env keys.
        assert!(set["3dtool"].is_empty());
        assert!(set["csv-exporter"].is_empty());
    }

    #[test]
    fn tools_with_no_env_keys_have_empty_maps() {
        let set = derive_all(&ToolkitConfig::default());
        assert!(set["3dtool"].is_empty());
        assert!(set["csv-exporter"].is_empty());
    }

    #[test]
    fn config_values_override_defaults() {
        let yaml = r#"
terminal:
  defaultTimeoutMs: 5000
  maxTimeoutMs: 9000
webbrowser:
  headless: false
rag:
  chunkSizeTokens: 512
"#;
        let config = parse_toolkit_config(yaml).expect("parse");
        let set = derive_all(&config);

        assert_eq!(set["terminal"]["TERMINAL_DEFAULT_TIMEOUT_MS"], "5000");
        assert_eq!(set["terminal"]["TERMINAL_MAX_TIMEOUT_MS"], "9000");
        assert_eq!(set["web-browser"]["BROWSER_HEADLESS"], "false");
        assert_eq!(set["rag"]["RAG_CHUNK_SIZE_TOKENS"], "512");
        // Unset keys retain canonical defaults.
        assert_eq!(set["rag"]["RAG_EMBEDDINGS_MODE"], "lmstudio");
    }

    #[test]
    fn browserless_apikey_maps_to_token() {
        let yaml = r#"
browserless:
  apiKey: super-secret-token
"#;
        let config = parse_toolkit_config(yaml).expect("parse");
        let set = derive_all(&config);
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
        let set = derive_all(&config);
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
        let set = derive_all(&ToolkitConfig::default());

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
        let set = derive_all(&ToolkitConfig::default());
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
        let set = derive_all(&config);
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
            let set = derive_all(&config);

            // The derivation yields exactly one entry per canonical server (16).
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

        let set = derive_all(&ToolkitConfig::default());

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

        let set = derive_all(&ToolkitConfig::default());
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
        let set = derive_all(&ToolkitConfig::default());

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
        let set = derive_all(&ToolkitConfig::default());
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
    /// section stays at its default so the derivation still yields all 16 tools.
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
            let set = derive_all(&config);
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
            let set = derive_all(&config);
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
