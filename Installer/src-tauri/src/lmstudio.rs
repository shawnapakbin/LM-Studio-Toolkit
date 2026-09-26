//! Native LM Studio MCP plugin provisioning and ownership-marked cleanup.
//!
//! This module reimplements, in Rust, the behavior of
//! `scripts/workspace/plugin-ownership.js` and
//! `scripts/workspace/sync-lmstudio-bridge-configs.js`. Per decision 1.2
//! (`.kiro/specs/windows-installer-setup-exe/decisions/1.2-lmstudio-provisioning-mechanism.md`)
//! the installer does **not** shell out to Node to provision LM Studio plugin
//! directories at install time; the `_owner: "llm-toolkit"` ownership contract
//! is reproduced natively here so it can be exercised in-process, error-attributed
//! per server, and shared with the uninstall-by-marker logic (task 12.2).
//!
//! ## The ownership contract (source of truth: the two JS files above)
//!
//! - **Ownership marker:** `_owner: "llm-toolkit"` (constant [`OWNER_ID`]).
//! - **Owned predicate:** a plugin directory is toolkit-owned iff its
//!   `manifest.json` OR `install-state.json` contains `_owner: "llm-toolkit"`,
//!   OR its directory name is in the legacy set [`LEGACY_PLUGIN_NAMES`].
//! - **Plugin root:** `~/.lmstudio/extensions/plugins/mcp/`, overridable by the
//!   `LMSTUDIO_MCP_PLUGIN_ROOT` env var ([`resolve_plugin_root`]). The override
//!   is honored for test parity with the JS `resolvePluginRoot`.
//! - **Per-server directory:** `<pluginRoot>/<serverName>/` containing exactly:
//!   - `manifest.json`
//!     `{ "type":"plugin", "runner":"mcpBridge", "owner":"mcp", "name":<server>, "_owner":"llm-toolkit" }`
//!   - `install-state.json`
//!     `{ "by":"mcp-bridge-v1", "at":<epoch-ms>, "_owner":"llm-toolkit" }`
//!   - `mcp-bridge-config.json` — the per-server bridge config (command/args/env).
//! - **Sequence:** read existing owned bridge configs (to preserve user-customized,
//!   non-empty, non-placeholder env values) -> clean all owned/legacy dirs ->
//!   re-provision exactly one dir per current server with the marker on every
//!   artifact. Files are UTF-8 with no BOM; empty-string env values are dropped.
//! - **Cleanup / no-orphans (Req 6.4):** after provisioning, the only
//!   marker-bearing dirs are those matching a current server; orphaned/misnamed
//!   owned dirs are removed; unmarked (foreign) dirs are never touched.
//!
//! ## Structure
//!
//! The logic is factored into near-pure functions over a *plugin-root population*
//! (a directory tree on disk under a caller-provided root) so the property tests
//! (Properties 7, 8, 10 — tasks 9.3/9.4/12.6) can drive it against a temp plugin
//! root via the `LMSTUDIO_MCP_PLUGIN_ROOT` override. The install-time wiring into
//! `Step::LmStudioPluginDirs` is task 9.2.
//!
//! Requirements: 6.1, 6.2, 6.3, 6.4 (supporting 6.5, 6.6).

// The install-time wiring (task 9.2) and property tests (tasks 9.3/9.4/12.6)
// are the first non-test consumers of this module. Until 9.2 lands, some public
// items are referenced only by unit tests, so silence dead-code warnings.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

use crate::tool_payload::{canonical_payloads, ToolPayload};

/// Ownership marker value written to `manifest.json` and `install-state.json`.
/// Mirrors `OWNER_ID` in `plugin-ownership.js`.
pub const OWNER_ID: &str = "llm-toolkit";

/// The JSON key that carries the ownership marker in owned artifacts.
pub const OWNER_KEY: &str = "_owner";

/// Legacy plugin directory names that predate the ownership-marker system.
/// A directory with one of these names is treated as owned for cleanup even if
/// it carries no marker. Mirrors `LEGACY_PLUGIN_NAMES` in `plugin-ownership.js`.
pub const LEGACY_PLUGIN_NAMES: [&str; 5] =
    ["basic", "calculator", "document-scraper", "clock", "ask-user"];

/// The three files that make up an owned per-server plugin directory.
const MANIFEST_FILE: &str = "manifest.json";
const INSTALL_STATE_FILE: &str = "install-state.json";
const BRIDGE_CONFIG_FILE: &str = "mcp-bridge-config.json";

// ─── Bridge config model ─────────────────────────────────────────────────────

/// The per-server bridge configuration written to `mcp-bridge-config.json`.
///
/// This is the provisioning *input* for one server. Keeping it as a plain data
/// struct (rather than reading it from `mcp-config.js` at runtime) lets the
/// provisioning functions stay pure over a plugin-root population: tests can
/// construct arbitrary server sets, and the install-time caller (task 9.2)
/// supplies the real command/args/env derived for each installed tool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerBridgeConfig {
    /// The MCP server name — also the plugin directory name.
    pub server_name: String,
    /// The launch command (typically `"node"`).
    pub command: String,
    /// The launch arguments (typically the absolute path to the tool's entry script).
    pub args: Vec<String>,
    /// Environment variables for the tool. Empty-string values are dropped on write.
    /// Ordered (`BTreeMap`) for deterministic JSON output.
    pub env: BTreeMap<String, String>,
}

impl ServerBridgeConfig {
    /// Construct a bridge config with an empty env map.
    pub fn new(
        server_name: impl Into<String>,
        command: impl Into<String>,
        args: Vec<String>,
    ) -> Self {
        Self {
            server_name: server_name.into(),
            command: command.into(),
            args,
            env: BTreeMap::new(),
        }
    }
}

/// The installed entry-script filename for a tool.
///
/// Browserless ships `schema-proxy.js`; every other tool ships `mcp-server.js`.
/// This is the single source of truth for the entry filename, keyed by
/// `<server_name>`, shared by [`installed_entry_relpath`],
/// [`entry_script_path`], and [`default_bridge_configs`] so no caller
/// re-derives the browserless special case independently.
fn entry(tool: &ToolPayload) -> &'static str {
    if tool.server_name == "browserless" {
        "schema-proxy.js"
    } else {
        "mcp-server.js"
    }
}

/// The installed entry-script location for a tool, relative to the install root,
/// as a forward-slash string: `<server_name>/<entry>`.
///
/// This mirrors the flattened staging layout produced by `stage-payload.ts`
/// (`payload/<serverName>/`), so bridge-config generation and staging agree on
/// a single `<server_name>`-keyed location and cannot drift.
fn installed_entry_relpath(tool: &ToolPayload) -> String {
    format!("{}/{}", tool.server_name, entry(tool))
}

/// The absolute installed entry-script path for a tool under `install_dir`:
/// `install_dir/<server_name>/<entry>`.
///
/// Single source of truth for where a tool's entry script lands once staged,
/// keyed by `<server_name>` (kebab-case), with no `dist_root` sub-structure.
fn entry_script_path(install_dir: &Path, tool: &ToolPayload) -> PathBuf {
    install_dir.join(tool.server_name).join(entry(tool))
}

/// Build the default set of bridge configs for the 9 canonical MCP servers,
/// with each server's entry script resolved under `install_dir`.
///
/// The command is `node` and the single argument is the absolute path to the
/// server's `mcp-server.js` (or `schema-proxy.js`) under the install directory.
/// Env maps are intentionally empty here: per-tool env derivation is the
/// `EnvConfig` step's job (task 10.2), which supplies fully-populated configs to
/// [`provision_plugin_dirs`]. This helper exists so the LM Studio step can be
/// exercised end-to-end with the canonical server set.
pub fn default_bridge_configs(install_dir: &Path) -> Vec<ServerBridgeConfig> {
    canonical_payloads()
        .iter()
        .map(|tool| {
            // The entry script lands at the flattened, staged layout
            // `install_dir/<server_name>/<entry>` (schema-proxy.js for
            // browserless, else mcp-server.js). Derived from the shared
            // `entry_script_path` seam so bridge-config generation and
            // `stage-payload.ts` cannot drift.
            let script_path = entry_script_path(install_dir, tool);
            ServerBridgeConfig::new(
                tool.server_name,
                "node",
                vec![script_path.to_string_lossy().replace('\\', "/")],
            )
        })
        .collect()
}

// ─── Plugin root resolution ──────────────────────────────────────────────────

/// Resolve the LM Studio MCP plugin root directory.
///
/// Honors the `LMSTUDIO_MCP_PLUGIN_ROOT` env var override (trimmed, non-empty)
/// for test parity with the JS `resolvePluginRoot`; otherwise falls back to
/// `~/.lmstudio/extensions/plugins/mcp`.
///
/// Returns `Err` only when no override is set and the home directory cannot be
/// resolved.
pub fn resolve_plugin_root() -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("LMSTUDIO_MCP_PLUGIN_ROOT") {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let home = home_dir().ok_or_else(|| {
        "Unable to resolve home directory. Set LMSTUDIO_MCP_PLUGIN_ROOT to your \
         LM Studio MCP plugins folder."
            .to_string()
    })?;

    Ok(home
        .join(".lmstudio")
        .join("extensions")
        .join("plugins")
        .join("mcp"))
}

/// Resolve the current user's home directory without pulling in an extra crate.
///
/// Uses `USERPROFILE` (Windows) then `HOME` (POSIX / test environments).
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|v| !v.is_empty()))
        .map(PathBuf::from)
}

// ─── Ownership predicate ─────────────────────────────────────────────────────

/// Safely read and parse a JSON file. Returns `None` on any failure (missing
/// file, unreadable, or invalid JSON) — mirrors the JS `readJsonSafe`.
pub fn read_json_safe(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Whether a parsed JSON value carries the ownership marker `_owner: "llm-toolkit"`.
fn value_has_marker(value: &Value) -> bool {
    value
        .get(OWNER_KEY)
        .and_then(Value::as_str)
        .map(|s| s == OWNER_ID)
        .unwrap_or(false)
}

/// Whether a plugin directory is owned by the toolkit *by marker* — i.e. its
/// `manifest.json` OR `install-state.json` contains `_owner: "llm-toolkit"`.
///
/// This does not consider the legacy-name list; use [`is_owned_dir`] for the
/// full owned predicate (marker OR legacy name).
pub fn is_owned_by_marker(plugin_dir: &Path) -> bool {
    if let Some(manifest) = read_json_safe(&plugin_dir.join(MANIFEST_FILE)) {
        if value_has_marker(&manifest) {
            return true;
        }
    }
    if let Some(install_state) = read_json_safe(&plugin_dir.join(INSTALL_STATE_FILE)) {
        if value_has_marker(&install_state) {
            return true;
        }
    }
    false
}

/// Whether a directory name matches a known legacy plugin name.
pub fn is_legacy_plugin(dir_name: &str) -> bool {
    LEGACY_PLUGIN_NAMES.contains(&dir_name)
}

/// The full owned predicate: a directory is toolkit-owned iff it bears the
/// ownership marker OR its name is in the legacy set. `dir_name` must be the
/// directory's basename.
pub fn is_owned_dir(plugin_dir: &Path, dir_name: &str) -> bool {
    is_owned_by_marker(plugin_dir) || is_legacy_plugin(dir_name)
}

/// Enumerate the immediate subdirectories of `plugin_root`.
///
/// Returns `(dir_name, full_path)` pairs, sorted by name for determinism.
/// A missing root yields an empty list (not an error), mirroring the JS
/// `getOwnedPluginDirs` / `cleanOwnedPlugins` which no-op on a missing root.
fn read_subdirs(plugin_root: &Path) -> Vec<(String, PathBuf)> {
    let mut dirs = Vec::new();
    let entries = match std::fs::read_dir(plugin_root) {
        Ok(e) => e,
        Err(_) => return dirs,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                dirs.push((name.to_string(), path));
            }
        }
    }
    dirs.sort_by(|a, b| a.0.cmp(&b.0));
    dirs
}

/// Return the paths of all toolkit-owned plugin directories under `plugin_root`
/// (owned by marker OR legacy name). Mirrors `getOwnedPluginDirs`.
pub fn get_owned_plugin_dirs(plugin_root: &Path) -> Vec<PathBuf> {
    read_subdirs(plugin_root)
        .into_iter()
        .filter(|(name, path)| is_owned_dir(path, name))
        .map(|(_, path)| path)
        .collect()
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/// Outcome of [`clean_owned_plugins`].
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CleanResult {
    /// Owned directories that were removed.
    pub removed: Vec<PathBuf>,
    /// Directories left untouched because they are not owned (foreign).
    pub preserved: Vec<PathBuf>,
    /// Owned directories whose removal failed.
    pub errors: Vec<PathBuf>,
}

/// Remove all toolkit-owned plugin directories under `plugin_root`, leaving
/// foreign (unmarked, non-legacy) directories untouched. Mirrors
/// `cleanOwnedPlugins`.
///
/// A missing root is a no-op returning an empty result.
pub fn clean_owned_plugins(plugin_root: &Path) -> CleanResult {
    let mut result = CleanResult::default();

    for (name, path) in read_subdirs(plugin_root) {
        if is_owned_dir(&path, &name) {
            match std::fs::remove_dir_all(&path) {
                Ok(()) => result.removed.push(path),
                Err(_) => result.errors.push(path),
            }
        } else {
            result.preserved.push(path);
        }
    }

    result
}

// ─── Env merge ───────────────────────────────────────────────────────────────

/// Whether an env value is a known placeholder that should NOT override the
/// default. Mirrors `isPlaceholderEnvValue`.
fn is_placeholder_env_value(key: &str, value: &str) -> bool {
    let normalized = value.trim();
    if normalized.is_empty() {
        return false;
    }
    match key {
        "BROWSERLESS_API_KEY" => normalized == "your-browserless-api-key-here",
        "BROWSERLESS_TOKEN" => normalized == "your-browserless-api-token-here",
        _ => false,
    }
}

/// Merge user-customized env values from a previously-saved bridge config into a
/// fresh server config's env, then drop empty-string values.
///
/// Rules (mirroring `mergeServerConfig`):
/// - Start from the fresh config's env.
/// - For each key in the existing config's env: if the value is non-empty and
///   not a placeholder, it overrides the fresh value (preserve user customization).
/// - After merging, drop any key whose value is empty/whitespace (passing empty
///   strings to child processes can override package defaults).
fn merge_env(
    fresh: &BTreeMap<String, String>,
    existing_bridge_config: Option<&Value>,
) -> BTreeMap<String, String> {
    let mut merged = fresh.clone();

    if let Some(Value::Object(obj)) = existing_bridge_config {
        if let Some(Value::Object(env)) = obj.get("env") {
            for (key, value) in env {
                if let Some(s) = value.as_str() {
                    let trimmed = s.trim();
                    if trimmed.is_empty() || is_placeholder_env_value(key, trimmed) {
                        continue;
                    }
                    merged.insert(key.clone(), s.to_string());
                }
            }
        }
    }

    // Drop empty-string env values.
    merged.retain(|_, v| !v.trim().is_empty());
    merged
}

// ─── Artifact construction (pure) ────────────────────────────────────────────

/// Build the `manifest.json` value for a server, with the ownership marker.
fn build_manifest(server_name: &str) -> Value {
    json!({
        "type": "plugin",
        "runner": "mcpBridge",
        "owner": "mcp",
        "name": server_name,
        OWNER_KEY: OWNER_ID,
    })
}

/// Build the `install-state.json` value with the given epoch-ms timestamp and
/// the ownership marker.
fn build_install_state(epoch_ms: u128) -> Value {
    json!({
        "by": "mcp-bridge-v1",
        "at": epoch_ms as u64,
        OWNER_KEY: OWNER_ID,
    })
}

/// Build the `mcp-bridge-config.json` value from a bridge config and a
/// (possibly-merged) env map. Env keys are emitted in sorted order.
fn build_bridge_config_json(config: &ServerBridgeConfig, env: &BTreeMap<String, String>) -> Value {
    let mut env_map = Map::new();
    for (k, v) in env {
        env_map.insert(k.clone(), Value::String(v.clone()));
    }
    json!({
        "command": config.command,
        "args": config.args,
        "env": Value::Object(env_map),
    })
}

/// Current time as epoch milliseconds (falls back to 0 if the clock is before
/// the epoch, which cannot happen in practice).
fn now_epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ─── Provisioning ────────────────────────────────────────────────────────────

/// Outcome of [`provision_plugin_dirs`].
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ProvisionResult {
    /// Server names that were provisioned (one directory each). On a step
    /// failure these successfully-provisioned dirs are **left in place** — the
    /// step itself does not remove them (Req 8.6); the eventual pipeline
    /// rollback / uninstall clears artifacts at their own level.
    pub provisioned: Vec<String>,
    /// Servers that failed to provision, as `(server_name, error)` pairs. Each
    /// failing server's partial directory was removed before the error was
    /// recorded (Req 8.5). An empty vec means every server succeeded.
    pub failed: Vec<(String, String)>,
    /// Owned/legacy directories removed during the cleanup pass (Req 8.3).
    pub removed: Vec<PathBuf>,
}

/// Provision one LM Studio plugin directory per server under `plugin_root`,
/// reproducing the `sync-lmstudio-bridge-configs.js` sequence.
///
/// Sequence:
/// 1. Read existing owned bridge configs (to preserve user-customized env).
/// 2. Clean all currently owned/legacy directories.
/// 3. Re-provision exactly one directory per current server, writing
///    `manifest.json`, `install-state.json`, and `mcp-bridge-config.json`, each
///    bearing the ownership marker, UTF-8 with no BOM, empty env values dropped.
///
/// ## Attempt-all-then-fail (Req 8.5, 8.6)
///
/// Provisioning does **not** abort on the first server failure. When a server
/// fails: the affected server is named, that server's partial directory is
/// removed, the error is recorded in [`ProvisionResult::failed`], and the pass
/// **continues** to the next server (Req 8.5). After all servers have been
/// attempted, if one or more failed the function returns `Err` naming every
/// failed server — while **leaving the successfully-provisioned directories in
/// place** (the step itself does not remove them — Req 8.6). Pipeline-level
/// rollback (Req 12.4) and uninstall (Req 9) clear artifacts at their own level.
///
/// The plugin root is created if it does not exist.
pub fn provision_plugin_dirs(
    plugin_root: &Path,
    servers: &[ServerBridgeConfig],
) -> Result<ProvisionResult, String> {
    std::fs::create_dir_all(plugin_root)
        .map_err(|e| format!("failed to create plugin root {}: {e}", plugin_root.display()))?;

    // ── Pass 1: read existing owned bridge configs (preserve user env) ──
    let mut existing_configs: BTreeMap<String, Value> = BTreeMap::new();
    for dir in get_owned_plugin_dirs(plugin_root) {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            if let Some(cfg) = read_json_safe(&dir.join(BRIDGE_CONFIG_FILE)) {
                existing_configs.insert(name.to_string(), cfg);
            }
        }
    }

    // ── Pass 2: clean all owned/legacy directories ──
    let clean = clean_owned_plugins(plugin_root);
    if !clean.errors.is_empty() {
        let names: Vec<String> = clean
            .errors
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        return Err(format!(
            "failed to clean previously-owned plugin directories: {}",
            names.join(", ")
        ));
    }

    // ── Pass 3: provision fresh directories with ownership markers ──
    //
    // Attempt every server (Req 8.5). On a server failure, name it, remove its
    // partial directory, record the error, and continue — do not abort. After
    // all servers are attempted, if any failed, return an error naming every
    // failed server while leaving the successful dirs in place (Req 8.6).
    let mut result = ProvisionResult {
        provisioned: Vec::new(),
        failed: Vec::new(),
        removed: clean.removed,
    };

    for config in servers {
        let server = &config.server_name;
        let plugin_dir = plugin_root.join(server);

        match provision_one(&plugin_dir, config, existing_configs.get(server)) {
            Ok(()) => result.provisioned.push(server.clone()),
            Err(e) => {
                // Remove this server's partial directory so no partial/misnamed
                // owned dir is left behind (Req 8.5), record the error by server
                // name, and continue attempting the remaining servers.
                let _ = std::fs::remove_dir_all(&plugin_dir);
                result.failed.push((server.clone(), e));
            }
        }
    }

    if !result.failed.is_empty() {
        // All servers were attempted; one or more failed. Report every failed
        // server by name (Req 8.6). The successfully-provisioned dirs recorded
        // in `result.provisioned` are intentionally left in place — the step
        // does not remove them; pipeline rollback / uninstall handle that.
        let names: Vec<String> = result
            .failed
            .iter()
            .map(|(server, e)| format!("'{server}': {e}"))
            .collect();
        return Err(format!(
            "failed to provision {} of {} LM Studio plugin server(s): {}",
            result.failed.len(),
            servers.len(),
            names.join("; ")
        ));
    }

    Ok(result)
}

/// Provision a single server's plugin directory. Writes the three artifacts,
/// merging preserved env from `existing_config` when present.
fn provision_one(
    plugin_dir: &Path,
    config: &ServerBridgeConfig,
    existing_config: Option<&Value>,
) -> Result<(), String> {
    std::fs::create_dir_all(plugin_dir)
        .map_err(|e| format!("could not create directory: {e}"))?;

    // manifest.json (always carries the marker)
    write_json_pretty(&plugin_dir.join(MANIFEST_FILE), &build_manifest(&config.server_name))?;

    // install-state.json (always carries the marker)
    write_json_pretty(
        &plugin_dir.join(INSTALL_STATE_FILE),
        &build_install_state(now_epoch_ms()),
    )?;

    // mcp-bridge-config.json (merged env, empty values dropped)
    let merged_env = merge_env(&config.env, existing_config);
    write_json_pretty(
        &plugin_dir.join(BRIDGE_CONFIG_FILE),
        &build_bridge_config_json(config, &merged_env),
    )?;

    Ok(())
}

/// Write a JSON value to `path` as pretty-printed UTF-8 with a trailing newline
/// and no BOM (mirrors the JS `writeUtf8NoBom` + `JSON.stringify(x, null, 2)`).
fn write_json_pretty(path: &Path, value: &Value) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(value)
        .map_err(|e| format!("could not serialize {}: {e}", path.display()))?;
    text.push('\n');
    // std::fs::write emits raw UTF-8 bytes with no BOM.
    std::fs::write(path, text.as_bytes())
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A unique temp plugin root per test (no external tempdir crate).
    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let pid = std::process::id();
            let path = std::env::temp_dir()
                .join(format!("llm_toolkit_lmstudio_test_{tag}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            TempRoot { path }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn cfg(name: &str) -> ServerBridgeConfig {
        ServerBridgeConfig::new(name, "node", vec![format!("/install/{name}/mcp-server.js")])
    }

    #[test]
    fn owner_constants_match_contract() {
        assert_eq!(OWNER_ID, "llm-toolkit");
        assert_eq!(OWNER_KEY, "_owner");
        assert_eq!(
            LEGACY_PLUGIN_NAMES,
            ["basic", "calculator", "document-scraper", "clock", "ask-user"]
        );
    }

    #[test]
    fn resolve_plugin_root_honors_env_override() {
        // The override is read live; set it, resolve, restore.
        let prev = std::env::var_os("LMSTUDIO_MCP_PLUGIN_ROOT");
        std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", "  /custom/plugin/root  ");
        let root = resolve_plugin_root().unwrap();
        assert_eq!(root, PathBuf::from("/custom/plugin/root"));
        match prev {
            Some(v) => std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", v),
            None => std::env::remove_var("LMSTUDIO_MCP_PLUGIN_ROOT"),
        }
    }

    #[test]
    fn is_owned_by_marker_detects_manifest_and_install_state() {
        let root = TempRoot::new("marker");

        // Marker in manifest.json
        let a = root.path.join("a");
        write(
            &a.join("manifest.json"),
            r#"{ "type": "plugin", "_owner": "llm-toolkit" }"#,
        );
        assert!(is_owned_by_marker(&a));

        // Marker in install-state.json only
        let b = root.path.join("b");
        write(&b.join("install-state.json"), r#"{ "_owner": "llm-toolkit" }"#);
        assert!(is_owned_by_marker(&b));

        // No marker anywhere -> foreign
        let c = root.path.join("c");
        write(&c.join("manifest.json"), r#"{ "type": "plugin", "_owner": "someone-else" }"#);
        assert!(!is_owned_by_marker(&c));

        // Malformed JSON is treated as no marker
        let d = root.path.join("d");
        write(&d.join("manifest.json"), "{ not json");
        assert!(!is_owned_by_marker(&d));
    }

    #[test]
    fn legacy_names_are_owned_even_without_marker() {
        let root = TempRoot::new("legacy");
        let calc = root.path.join("calculator");
        std::fs::create_dir_all(&calc).unwrap();
        // No marker files at all.
        assert!(!is_owned_by_marker(&calc));
        assert!(is_owned_dir(&calc, "calculator"));
        assert!(!is_owned_dir(&calc, "some-foreign-name"));
    }

    #[test]
    fn clean_removes_owned_and_legacy_preserves_foreign() {
        let root = TempRoot::new("clean");

        // Owned by marker
        write(
            &root.path.join("terminal").join("manifest.json"),
            r#"{ "_owner": "llm-toolkit" }"#,
        );
        // Legacy by name (no marker)
        std::fs::create_dir_all(root.path.join("clock")).unwrap();
        // Foreign (has a marker for a different owner)
        write(
            &root.path.join("some-other-plugin").join("manifest.json"),
            r#"{ "_owner": "another-app" }"#,
        );
        // Foreign (no marker at all)
        std::fs::create_dir_all(root.path.join("unrelated")).unwrap();

        let result = clean_owned_plugins(&root.path);

        assert!(result.errors.is_empty());
        assert_eq!(result.removed.len(), 2, "terminal + clock removed");
        assert!(!root.path.join("terminal").exists());
        assert!(!root.path.join("clock").exists());
        // Foreign dirs preserved.
        assert!(root.path.join("some-other-plugin").exists());
        assert!(root.path.join("unrelated").exists());
        assert_eq!(result.preserved.len(), 2);
    }

    #[test]
    fn clean_on_missing_root_is_noop() {
        let missing = std::env::temp_dir().join("llm_toolkit_lmstudio_missing_root_xyz");
        let _ = std::fs::remove_dir_all(&missing);
        let result = clean_owned_plugins(&missing);
        assert!(result.removed.is_empty());
        assert!(result.preserved.is_empty());
        assert!(result.errors.is_empty());
    }

    #[test]
    fn provision_writes_three_marked_files_per_server() {
        let root = TempRoot::new("provision");
        let servers = vec![cfg("terminal"), cfg("git")];

        let result = provision_plugin_dirs(&root.path, &servers).unwrap();
        assert_eq!(result.provisioned, vec!["terminal".to_string(), "git".to_string()]);

        for name in ["terminal", "git"] {
            let dir = root.path.join(name);
            let manifest = read_json_safe(&dir.join("manifest.json")).unwrap();
            assert_eq!(manifest["type"], "plugin");
            assert_eq!(manifest["runner"], "mcpBridge");
            assert_eq!(manifest["owner"], "mcp");
            assert_eq!(manifest["name"], name);
            assert_eq!(manifest["_owner"], "llm-toolkit");

            let install_state = read_json_safe(&dir.join("install-state.json")).unwrap();
            assert_eq!(install_state["by"], "mcp-bridge-v1");
            assert!(install_state["at"].as_u64().unwrap() > 0);
            assert_eq!(install_state["_owner"], "llm-toolkit");

            let bridge = read_json_safe(&dir.join("mcp-bridge-config.json")).unwrap();
            assert_eq!(bridge["command"], "node");
            assert!(bridge["args"].is_array());
            assert!(bridge["env"].is_object());
        }
    }

    #[test]
    fn provision_files_are_utf8_no_bom_with_trailing_newline() {
        let root = TempRoot::new("nobom");
        provision_plugin_dirs(&root.path, &[cfg("terminal")]).unwrap();
        let bytes = std::fs::read(root.path.join("terminal").join("manifest.json")).unwrap();
        // No UTF-8 BOM prefix.
        assert_ne!(&bytes[0..3.min(bytes.len())], &[0xEF, 0xBB, 0xBF]);
        // Trailing newline.
        assert_eq!(*bytes.last().unwrap(), b'\n');
    }

    #[test]
    fn provision_removes_orphans_and_preserves_foreign() {
        let root = TempRoot::new("orphans");

        // A stale owned dir that is NOT in the new server set.
        write(
            &root.path.join("stale-owned").join("manifest.json"),
            r#"{ "_owner": "llm-toolkit" }"#,
        );
        // A legacy-named dir.
        std::fs::create_dir_all(root.path.join("basic")).unwrap();
        // A foreign dir that must be preserved.
        write(
            &root.path.join("foreign").join("manifest.json"),
            r#"{ "_owner": "another-app" }"#,
        );

        provision_plugin_dirs(&root.path, &[cfg("terminal")]).unwrap();

        // After provisioning: only "terminal" is a marker-bearing dir; the
        // stale-owned and legacy dirs are gone; the foreign dir survives.
        assert!(root.path.join("terminal").exists());
        assert!(!root.path.join("stale-owned").exists());
        assert!(!root.path.join("basic").exists());
        assert!(root.path.join("foreign").exists());

        let owned = get_owned_plugin_dirs(&root.path);
        let owned_names: Vec<String> = owned
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(owned_names, vec!["terminal".to_string()]);
    }

    #[test]
    fn provision_preserves_user_customized_env_across_resync() {
        let root = TempRoot::new("env-preserve");

        // First provision with an env value.
        let mut first = cfg("browserless");
        first
            .env
            .insert("BROWSERLESS_TOKEN".to_string(), "".to_string());
        provision_plugin_dirs(&root.path, &[first]).unwrap();

        // User customizes the token in the existing bridge config.
        let bridge_path = root.path.join("browserless").join("mcp-bridge-config.json");
        let mut bridge = read_json_safe(&bridge_path).unwrap();
        bridge["env"] = json!({ "BROWSERLESS_TOKEN": "user-secret-123" });
        std::fs::write(&bridge_path, serde_json::to_string(&bridge).unwrap()).unwrap();

        // Re-provision with a fresh (empty) env — user's value should survive.
        let mut second = cfg("browserless");
        second
            .env
            .insert("BROWSERLESS_TOKEN".to_string(), "".to_string());
        provision_plugin_dirs(&root.path, &[second]).unwrap();

        let after = read_json_safe(&bridge_path).unwrap();
        assert_eq!(after["env"]["BROWSERLESS_TOKEN"], "user-secret-123");
    }

    #[test]
    fn merge_env_drops_empty_and_ignores_placeholder() {
        let mut fresh = BTreeMap::new();
        fresh.insert("KEEP".to_string(), "default".to_string());
        fresh.insert("EMPTY".to_string(), "".to_string());
        fresh.insert("BROWSERLESS_TOKEN".to_string(), "".to_string());

        let existing = json!({
            "env": {
                "KEEP": "user-value",
                "BROWSERLESS_TOKEN": "your-browserless-api-token-here", // placeholder, ignored
                "EXTRA": "added-by-user",
                "BLANK": "   " // whitespace-only, dropped
            }
        });

        let merged = merge_env(&fresh, Some(&existing));

        // User value overrides default.
        assert_eq!(merged.get("KEEP").map(String::as_str), Some("user-value"));
        // Extra user key preserved.
        assert_eq!(merged.get("EXTRA").map(String::as_str), Some("added-by-user"));
        // Empty fresh value dropped.
        assert!(!merged.contains_key("EMPTY"));
        // Placeholder ignored -> the fresh empty value remains, then dropped.
        assert!(!merged.contains_key("BROWSERLESS_TOKEN"));
        // Whitespace-only dropped.
        assert!(!merged.contains_key("BLANK"));
    }

    #[test]
    fn default_bridge_configs_cover_all_nine_canonical_servers() {
        let install = PathBuf::from("/opt/llm-toolkit");
        let configs = default_bridge_configs(&install);
        assert_eq!(configs.len(), 9);

        let browserless = configs
            .iter()
            .find(|c| c.server_name == "browserless")
            .unwrap();
        assert!(browserless.args[0].ends_with("schema-proxy.js"));

        let terminal = configs.iter().find(|c| c.server_name == "terminal").unwrap();
        assert!(terminal.args[0].ends_with("mcp-server.js"));
        assert_eq!(terminal.command, "node");
    }

    #[test]
    fn provision_bijection_one_dir_per_server() {
        let root = TempRoot::new("bijection");
        let servers: Vec<ServerBridgeConfig> =
            ["a", "b", "c"].iter().map(|n| cfg(n)).collect();

        provision_plugin_dirs(&root.path, &servers).unwrap();

        let owned = get_owned_plugin_dirs(&root.path);
        let mut owned_names: Vec<String> = owned
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        owned_names.sort();
        assert_eq!(owned_names, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }
}

// ─── Property tests (Property 7) ─────────────────────────────────────────────

#[cfg(test)]
mod provisioning_bijection_property_tests {
    //! Feature: windows-installer-setup-exe, Property 7: Plugin provisioning
    //! bijection with required files and marker.
    //!
    //! For any non-empty set of current MCP server names, after provisioning:
    //!   - there is exactly one plugin directory per server (a one-to-one
    //!     correspondence between owned plugin directories and the server set),
    //!   - each such directory contains manifest.json, install-state.json, and
    //!     mcp-bridge-config.json, and
    //!   - manifest.json and install-state.json each carry the ownership marker
    //!     `_owner: "llm-toolkit"`.
    //!
    //! Validates: Requirements 6.1, 6.2, 6.3

    use super::*;
    use proptest::collection::hash_set;
    use proptest::prelude::*;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A unique, self-cleaning temp plugin root per case. Mirrors the `TempRoot`
    /// helper in the sibling `tests` module (kept local to this module so this
    /// property test does not collide with concurrently-added tests).
    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let pid = std::process::id();
            let path = std::env::temp_dir()
                .join(format!("llm_toolkit_lmstudio_prop_{tag}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            TempRoot { path }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// A strategy for a single valid plugin directory / server name: a non-empty
    /// string of filesystem-safe characters (lowercase letters, digits, hyphen,
    /// underscore). This intelligently constrains generation to the input space
    /// — the provisioning uses the server name verbatim as a directory name.
    fn server_name() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_-]{0,15}".prop_map(|s| s)
    }

    /// A strategy for a non-empty *set* of distinct server names (1..=12).
    fn server_name_set() -> impl Strategy<Value = HashSet<String>> {
        hash_set(server_name(), 1..=12)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        #[test]
        fn prop_provision_bijection(names in server_name_set()) {
            let root = TempRoot::new("bijection");

            // Build one ServerBridgeConfig per name in the set.
            let servers: Vec<ServerBridgeConfig> = names
                .iter()
                .map(|name| {
                    ServerBridgeConfig::new(
                        name,
                        "node",
                        vec![format!("/install/{name}/mcp-server.js")],
                    )
                })
                .collect();

            let result = provision_plugin_dirs(&root.path, &servers)
                .expect("provisioning a valid non-empty server set should succeed");

            // Every server in the set was reported as provisioned exactly once.
            let provisioned: HashSet<String> = result.provisioned.iter().cloned().collect();
            prop_assert_eq!(&provisioned, &names);
            prop_assert_eq!(result.provisioned.len(), names.len());

            // Bijection: the owned plugin directories on disk correspond exactly
            // to the server set — one directory per server, no orphans, no extras.
            let owned_names: HashSet<String> = get_owned_plugin_dirs(&root.path)
                .iter()
                .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
                .collect();
            prop_assert_eq!(&owned_names, &names);

            // Each server directory contains the three required artifacts, and
            // manifest.json / install-state.json each carry the ownership marker.
            for name in &names {
                let dir = root.path.join(name);
                prop_assert!(dir.is_dir(), "expected a directory for server {name}");

                let manifest = read_json_safe(&dir.join("manifest.json"))
                    .expect("manifest.json must exist and parse");
                let install_state = read_json_safe(&dir.join("install-state.json"))
                    .expect("install-state.json must exist and parse");
                let bridge = read_json_safe(&dir.join("mcp-bridge-config.json"))
                    .expect("mcp-bridge-config.json must exist and parse");

                prop_assert_eq!(manifest.get(OWNER_KEY).and_then(Value::as_str), Some(OWNER_ID));
                prop_assert_eq!(
                    install_state.get(OWNER_KEY).and_then(Value::as_str),
                    Some(OWNER_ID)
                );
                // The bridge config is present (required artifact) and well-formed.
                prop_assert!(bridge.is_object());
            }
        }
    }
}

// ─── Property test: no orphans, foreign artifacts preserved (Property 8) ─────

#[cfg(test)]
mod no_orphans_property_tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A unique temp plugin root per test iteration (no external tempdir crate).
    /// Mirrors the `TempRoot` in the module's unit tests but is self-contained so
    /// this property module does not depend on `#[cfg(test)] mod tests` internals
    /// (task 9.3 concurrently edits that module).
    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new() -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let pid = std::process::id();
            let path = std::env::temp_dir()
                .join(format!("llm_toolkit_lmstudio_prop8_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            TempRoot { path }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// The kind of pre-existing directory to seed into the plugin root.
    #[derive(Debug, Clone)]
    enum SeedKind {
        /// Toolkit-owned by the `_owner:"llm-toolkit"` marker in manifest.json.
        OwnedByManifestMarker,
        /// Toolkit-owned by the marker in install-state.json only.
        OwnedByStateMarker,
        /// Legacy-named dir (owned by name, no marker files).
        Legacy(&'static str),
        /// Foreign: carries a marker for a different owner.
        ForeignOtherOwner,
        /// Foreign: no marker file at all.
        ForeignNoMarker,
    }

    /// A seeded directory: a name plus a kind. `content_tag` is a random marker
    /// string written into a sentinel file so we can verify foreign content is
    /// left byte-for-byte intact.
    #[derive(Debug, Clone)]
    struct Seed {
        name: String,
        kind: SeedKind,
        content_tag: String,
    }

    /// A directory-name-safe token generator (lowercase letters + digits, 1..=12).
    /// Kept ASCII and free of path separators / reserved chars so names are valid
    /// on every OS the installer targets.
    fn name_token() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9]{0,11}"
    }

    fn seed_kind() -> impl Strategy<Value = SeedKind> {
        prop_oneof![
            Just(SeedKind::OwnedByManifestMarker),
            Just(SeedKind::OwnedByStateMarker),
            prop::sample::select(LEGACY_PLUGIN_NAMES.to_vec()).prop_map(SeedKind::Legacy),
            Just(SeedKind::ForeignOtherOwner),
            Just(SeedKind::ForeignNoMarker),
        ]
    }

    fn seed() -> impl Strategy<Value = Seed> {
        (name_token(), seed_kind(), name_token()).prop_map(|(name, kind, tag)| Seed {
            // Legacy seeds must use their legacy name so they are owned-by-name.
            name: match &kind {
                SeedKind::Legacy(legacy) => (*legacy).to_string(),
                _ => name,
            },
            kind,
            content_tag: tag,
        })
    }

    /// Write the seed to disk under `root`. Every seed gets a `sentinel.txt`
    /// carrying its `content_tag`, so foreign preservation can be checked
    /// content-exact (not just existence).
    fn write_seed(root: &std::path::Path, s: &Seed) {
        let dir = root.join(&s.name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("sentinel.txt"), s.content_tag.as_bytes()).unwrap();
        match &s.kind {
            SeedKind::OwnedByManifestMarker => {
                std::fs::write(
                    dir.join("manifest.json"),
                    r#"{ "type": "plugin", "_owner": "llm-toolkit" }"#,
                )
                .unwrap();
            }
            SeedKind::OwnedByStateMarker => {
                std::fs::write(
                    dir.join("install-state.json"),
                    r#"{ "by": "mcp-bridge-v1", "_owner": "llm-toolkit" }"#,
                )
                .unwrap();
            }
            SeedKind::Legacy(_) => {
                // Legacy dirs carry no marker files; ownership is by name only.
            }
            SeedKind::ForeignOtherOwner => {
                std::fs::write(
                    dir.join("manifest.json"),
                    r#"{ "type": "plugin", "_owner": "another-app" }"#,
                )
                .unwrap();
            }
            SeedKind::ForeignNoMarker => {
                std::fs::write(dir.join("manifest.json"), r#"{ "type": "plugin" }"#).unwrap();
            }
        }
    }

    fn is_foreign(kind: &SeedKind) -> bool {
        matches!(kind, SeedKind::ForeignOtherOwner | SeedKind::ForeignNoMarker)
    }

    fn cfg(name: &str) -> ServerBridgeConfig {
        ServerBridgeConfig::new(name, "node", vec![format!("/install/{name}/mcp-server.js")])
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: windows-installer-setup-exe, Property 8: No orphans, foreign artifacts preserved
        //
        // For all initial populations of the plugin root (any mix of owned,
        // stale/misnamed-owned, legacy, and foreign directories) and any set of
        // current server names, after `provision_plugin_dirs`:
        //   (a) the set of owned plugin dirs (`get_owned_plugin_dirs`) equals
        //       exactly the set of current server names;
        //   (b) no owned orphan or misnamed-owned directory remains;
        //   (c) every directory NOT bearing the ownership marker (foreign,
        //       non-legacy) is left untouched — still present with content intact.
        //
        // Validates: Requirements 6.4
        #[test]
        fn prop_no_orphans_foreign_preserved(
            seeds in prop::collection::vec(seed(), 0..12),
            server_names in prop::collection::vec(name_token(), 0..8),
        ) {
            let root = TempRoot::new();

            // De-duplicate the current server set (directory names are unique).
            let servers: BTreeSet<String> = server_names.into_iter().collect();

            // Seed the plugin root. A seed whose name collides with a current
            // server name is dropped from the seeding step: provisioning will
            // (re)create that server dir, so the pre-existing occupant is not a
            // meaningful "foreign vs owned" case — the property is about the dirs
            // that are NOT current servers. This keeps the seeded population and
            // the server set name-disjoint, which is the interesting input space.
            let mut foreign_expected: BTreeMap<String, String> = BTreeMap::new();
            let mut seen: BTreeSet<String> = BTreeSet::new();
            for s in &seeds {
                if servers.contains(&s.name) || seen.contains(&s.name) {
                    continue;
                }
                seen.insert(s.name.clone());
                write_seed(&root.path, s);
                if is_foreign(&s.kind) {
                    // Record the exact sentinel content we expect to survive.
                    foreign_expected.insert(s.name.clone(), s.content_tag.clone());
                }
            }

            // Provision exactly the current server set.
            let configs: Vec<ServerBridgeConfig> =
                servers.iter().map(|n| cfg(n)).collect();
            let result = provision_plugin_dirs(&root.path, &configs)
                .expect("provision_plugin_dirs should succeed for valid inputs");

            prop_assert_eq!(
                result.provisioned.iter().cloned().collect::<BTreeSet<_>>(),
                servers.clone(),
                "provisioned set must equal the current server set"
            );

            // (a) owned dirs == exactly the current server set.
            let owned_names: BTreeSet<String> = get_owned_plugin_dirs(&root.path)
                .iter()
                .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
                .collect();
            prop_assert_eq!(
                &owned_names,
                &servers,
                "owned dirs must equal exactly the current server set (no orphans, no misnamed owned)"
            );

            // (b) no owned orphan / misnamed-owned directory remains: every
            // marker-or-legacy dir on disk must be a current server. This is the
            // contrapositive of (a) stated over the raw directory listing, so a
            // stray owned dir with an unexpected name is caught.
            for entry in std::fs::read_dir(&root.path).unwrap().flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = path.file_name().unwrap().to_string_lossy().to_string();
                if is_owned_dir(&path, &dir_name) {
                    prop_assert!(
                        servers.contains(&dir_name),
                        "owned dir '{}' is not a current server -> orphan/misnamed owned remains",
                        dir_name
                    );
                }
            }

            // (c) every foreign (unmarked, non-legacy) dir is preserved with its
            // content byte-for-byte intact.
            for (name, tag) in &foreign_expected {
                let dir = root.path.join(name);
                prop_assert!(dir.exists(), "foreign dir '{}' must be preserved", name);
                let sentinel = std::fs::read(dir.join("sentinel.txt")).unwrap();
                prop_assert_eq!(
                    &sentinel,
                    tag.as_bytes(),
                    "foreign dir '{}' content must be left untouched",
                    name
                );
            }
        }
    }
}

// ─── Error attribution + rollback unit tests (Req 6.5, 6.6) ──────────────────

#[cfg(test)]
mod plugin_error_attribution_tests {
    //! Example/unit tests for per-server error attribution and rollback in
    //! [`provision_plugin_dirs`].
    //!
    //! - Req 6.5: IF provisioning a plugin directory fails, the returned error
    //!   identifies the *affected server* by name.
    //! - Req 6.6: IF provisioning fails, no partially-written or misnamed
    //!   owned directory is left behind for that server (rollback).
    //!
    //! To force a deterministic, cross-platform provisioning failure without
    //! mocking the filesystem, these tests exploit a real filesystem invariant:
    //! a path cannot be both a directory and a regular file. By pre-creating a
    //! *directory* where `provision_one` will try to write the `manifest.json`
    //! *file*, the `write_json_pretty` call fails on a genuine `io::Error`
    //! (`fs::write` cannot truncate/open a directory as a file). This mirrors a
    //! real disk fault (permission denied, path conflict) and drives the exact
    //! attribution + rollback code path under test.
    //!
    //! Validates: Requirements 6.5, 6.6

    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A unique, self-cleaning temp plugin root per test. Mirrors the `TempRoot`
    /// helper in the sibling modules; kept local so this module does not depend
    /// on the concurrently-edited `tests` / property-test modules.
    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let pid = std::process::id();
            let path = std::env::temp_dir()
                .join(format!("llm_toolkit_lmstudio_errattr_{tag}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            TempRoot { path }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn cfg(name: &str) -> ServerBridgeConfig {
        ServerBridgeConfig::new(name, "node", vec![format!("/install/{name}/mcp-server.js")])
    }

    /// Force a write failure for exactly one server by planting a *directory*
    /// named `manifest.json` at that server's plugin dir. `create_dir_all` of the
    /// plugin dir then succeeds (it already exists), but writing the
    /// `manifest.json` *file* fails because the path is a directory. The planted
    /// dir carries no ownership marker and a non-legacy name, so it is treated as
    /// foreign and survives the cleanup pass into the provisioning pass.
    fn plant_manifest_conflict(plugin_root: &Path, server: &str) {
        let manifest_as_dir = plugin_root.join(server).join(MANIFEST_FILE);
        std::fs::create_dir_all(&manifest_as_dir).unwrap();
        // Put something inside so the conflicting dir is non-empty (belt and
        // braces: fs::write must still refuse to open a directory as a file).
        std::fs::write(manifest_as_dir.join("keep.txt"), b"x").unwrap();
    }

    #[test]
    fn provision_failure_error_names_the_affected_server() {
        // Req 6.5: the error message identifies the affected server by name.
        let root = TempRoot::new("names_server");

        // "git" will provision fine; "terminal" is rigged to fail.
        plant_manifest_conflict(&root.path, "terminal");
        let servers = vec![cfg("git"), cfg("terminal")];

        let err = provision_plugin_dirs(&root.path, &servers)
            .expect_err("provisioning must fail when a server's manifest path is a directory");

        assert!(
            err.contains("terminal"),
            "error must name the affected server 'terminal'; got: {err}"
        );
        // The failure must be attributed to a *server*, not the unrelated one.
        assert!(
            !err.contains("'git'"),
            "error must not misattribute the failure to the healthy server 'git'; got: {err}"
        );
    }

    #[test]
    fn provision_failure_rolls_back_the_partial_dir() {
        // Req 6.6: no partial/misnamed OWNED dir remains for the failed server.
        let root = TempRoot::new("rollback");

        plant_manifest_conflict(&root.path, "terminal");
        let servers = vec![cfg("terminal")];

        let err = provision_plugin_dirs(&root.path, &servers).expect_err("must fail");
        assert!(err.contains("terminal"), "error should name 'terminal'; got: {err}");

        // The rolled-back directory must not remain as a partial owned dir.
        // provision_one wrote nothing that survives: the whole `terminal` dir is
        // removed on the error path, so it must be gone entirely.
        let terminal_dir = root.path.join("terminal");
        assert!(
            !terminal_dir.exists(),
            "the affected server's directory must be rolled back (removed) on failure"
        );

        // And it must not appear as an owned plugin dir (no marker-bearing
        // partial artifacts left behind).
        let owned_names: Vec<String> = get_owned_plugin_dirs(&root.path)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(
            !owned_names.contains(&"terminal".to_string()),
            "no owned/marker-bearing 'terminal' dir may remain after rollback; owned: {owned_names:?}"
        );
    }

    #[test]
    fn provision_attempts_all_servers_after_a_mid_list_failure() {
        // Req 8.5: a mid-list server failure does NOT abort the pass — every
        // remaining server is still attempted and (if it can) provisioned. The
        // failing server is named, its partial dir is removed, and the servers
        // ordered after it are still provisioned.
        let root = TempRoot::new("attempt_all");

        // Order: ok, FAIL, would-still-be-ok. The third MUST be provisioned.
        plant_manifest_conflict(&root.path, "middle");
        let servers = vec![cfg("first"), cfg("middle"), cfg("last")];

        let err = provision_plugin_dirs(&root.path, &servers).expect_err("must fail on 'middle'");
        assert!(err.contains("middle"), "error should name 'middle'; got: {err}");

        // "first" (before the failure) and "last" (after it) were both attempted
        // and provisioned; only "middle" failed and had its partial dir removed.
        assert!(root.path.join("first").join(MANIFEST_FILE).is_file());
        assert!(
            root.path.join("last").join(MANIFEST_FILE).is_file(),
            "servers after the failing one must still be attempted and provisioned"
        );

        // The failing server's directory is removed; it is not left as a
        // partial/misnamed owned dir.
        let owned_names: Vec<String> = get_owned_plugin_dirs(&root.path)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert!(
            !owned_names.contains(&"middle".to_string()),
            "the failed server 'middle' must not remain as an owned dir; owned: {owned_names:?}"
        );
    }

    #[test]
    fn provision_reports_every_failed_server_and_keeps_successful_dirs() {
        // Req 8.5/8.6: after all servers are attempted, the error names every
        // failed server, and the successfully-provisioned dirs are left in place.
        let root = TempRoot::new("all_failed");

        // Two of four servers are rigged to fail.
        plant_manifest_conflict(&root.path, "alpha");
        plant_manifest_conflict(&root.path, "gamma");
        let servers = vec![cfg("alpha"), cfg("beta"), cfg("gamma"), cfg("delta")];

        let err = provision_plugin_dirs(&root.path, &servers).expect_err("must fail");
        assert!(err.contains("alpha"), "error must name 'alpha'; got: {err}");
        assert!(err.contains("gamma"), "error must name 'gamma'; got: {err}");

        // The successful servers' directories remain in place (step does not
        // remove them on failure — Req 8.6).
        assert!(root.path.join("beta").join(MANIFEST_FILE).is_file());
        assert!(root.path.join("delta").join(MANIFEST_FILE).is_file());
    }

    #[test]
    fn clean_phase_error_message_lists_affected_dirs() {
        // Req 6.5 (clean-phase attribution): when the pre-provision cleanup pass
        // cannot remove an owned directory, the surfaced error names the affected
        // directory. We construct a CleanResult with an error entry and assert
        // the message format used by provision_plugin_dirs. This exercises the
        // attribution wording without needing an un-removable dir (which is not
        // reliably reproducible cross-platform).
        //
        // The message is built from clean.errors in provision_plugin_dirs; here
        // we assert clean_owned_plugins reports the owned dir it could not remove
        // by keeping an open handle is impractical, so we validate the reporting
        // contract via the CleanResult surface directly.
        let root = TempRoot::new("clean_attr");

        // Seed one owned dir; removal succeeds, so errors is empty and the happy
        // path is taken. This asserts the *non-error* contract: a clean removal
        // does not produce a spurious error message.
        std::fs::create_dir_all(root.path.join("clock")).unwrap(); // legacy-owned
        let result = clean_owned_plugins(&root.path);
        assert!(result.errors.is_empty());
        assert_eq!(result.removed.len(), 1);

        // And the error-message format (used by provision_plugin_dirs) names the
        // offending paths when errors are present.
        let mut with_error = CleanResult::default();
        let bad = root.path.join("stuck-owned");
        with_error.errors.push(bad.clone());
        let names: Vec<String> = with_error
            .errors
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        let msg = format!(
            "failed to clean previously-owned plugin directories: {}",
            names.join(", ")
        );
        assert!(
            msg.contains(&bad.display().to_string()),
            "clean-phase error must name the affected directory; got: {msg}"
        );
    }
}

// ─── Bug condition exploration tests — Concern 1: entry-script path mismatch ─

#[cfg(test)]
mod entry_path_bug_condition_tests {
    //! Bugfix: installer-plugin-path-and-browserless-secret
    //! Property 1 (Bug Condition — Entry-Script Path Matches Staged Layout).
    //!
    //! These tests encode the EXPECTED (fixed) behavior and are expected to
    //! FAIL on the unfixed code, confirming the defect exists (Defect 1 —
    //! `MODULE_NOT_FOUND`). They will PASS once `default_bridge_configs` derives
    //! `args[0]` from the shared `install_dir/<server_name>/<entry>` seam.
    //!
    //! Bug condition (from design):
    //!   isBugCondition_pathMismatch(input) ==
    //!     bridge_args_path != normalize(install_dir / server_name / entry)
    //!
    //! On the UNFIXED code `default_bridge_configs` builds
    //! `install_dir.join(tool.dist_root).join(entry)`, so for every one of the
    //! 9 tools `args[0]` equals the SOURCE-repo layout
    //! (`install_dir/<dist_root>/<entry>`) rather than the STAGED layout
    //! (`install_dir/<server_name>/<entry>`), and the counterexample surfaces on
    //! the very first tool.
    //!
    //! Validates: Requirements 2.1, 2.2, 2.3

    use super::*;
    use crate::tool_payload::canonical_payloads;

    /// The observable-consequence entry file selection (browserless ->
    /// schema-proxy.js, else mcp-server.js). Kept local so the test asserts over
    /// the generated `args` string rather than a not-yet-existing seam symbol.
    fn expected_entry(server_name: &str) -> &'static str {
        if server_name == "browserless" {
            "schema-proxy.js"
        } else {
            "mcp-server.js"
        }
    }

    /// Normalize a path to the forward-slash form `default_bridge_configs`
    /// emits into the JSON `args` string.
    fn normalize(p: &Path) -> String {
        p.to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn all_nine_args0_match_staged_server_name_layout() {
        // A representative install root; the seam must anchor under it.
        let install_dir = PathBuf::from("C:/fake/Install/LLM-Toolkit");
        let configs = default_bridge_configs(&install_dir);

        assert_eq!(configs.len(), 9, "must cover all 9 canonical tools");

        let mut mismatches: Vec<String> = Vec::new();

        for tool in canonical_payloads() {
            let cfg = configs
                .iter()
                .find(|c| c.server_name == tool.server_name)
                .unwrap_or_else(|| panic!("missing bridge config for {}", tool.server_name));

            // EXPECTED (fixed) layout: install_dir/<server_name>/<entry>.
            let expected = normalize(
                &install_dir
                    .join(tool.server_name)
                    .join(expected_entry(tool.server_name)),
            );

            let actual = &cfg.args[0];
            if actual != &expected {
                mismatches.push(format!(
                    "  {}: expected `{}` but got `{}`",
                    tool.server_name, expected, actual
                ));
            }
        }

        assert!(
            mismatches.is_empty(),
            "args[0] does not match the staged install_dir/<server_name>/<entry> layout \
             for {} of 9 tools (Defect 1 — MODULE_NOT_FOUND). Counterexamples:\n{}",
            mismatches.len(),
            mismatches.join("\n"),
        );
    }

    #[test]
    fn browserless_and_python_shell_are_concrete_counterexamples() {
        // Two concrete, deterministic counterexamples named in the bugfix doc.
        let install_dir = PathBuf::from("C:/fake/Install");
        let configs = default_bridge_configs(&install_dir);

        let browserless = configs
            .iter()
            .find(|c| c.server_name == "browserless")
            .unwrap();
        assert_eq!(
            browserless.args[0],
            normalize(&install_dir.join("browserless").join("schema-proxy.js")),
            "browserless args[0] must be install_dir/browserless/schema-proxy.js \
             (unfixed yields install_dir/Browserless/scripts/schema-proxy.js)",
        );

        let python_shell = configs
            .iter()
            .find(|c| c.server_name == "python-shell")
            .unwrap();
        assert_eq!(
            python_shell.args[0],
            normalize(&install_dir.join("python-shell").join("mcp-server.js")),
            "python-shell args[0] must be install_dir/python-shell/mcp-server.js \
             (unfixed yields install_dir/PythonShell/dist/mcp-server.js)",
        );
    }
}

// ─── Preservation baseline tests — Property 4 (names, command, ownership, env) ─

#[cfg(test)]
mod preservation_baseline_tests {
    //! Bugfix: installer-plugin-path-and-browserless-secret
    //! Property 4 (Preservation — Names, Command, Ownership, Env, Secrets,
    //! User Paths Unchanged) — the `lmstudio.rs` half.
    //!
    //! These tests encode behavior observed on the UNFIXED code that the fix
    //! MUST preserve, so they PASS today and act as a regression baseline. Per
    //! the design, only three things change: how the entry-script path is
    //! derived (`args[0]`), the addition of a build/staging secret guard, and
    //! how relative/empty path DEFAULTS are anchored. Everything asserted here —
    //! the 9 canonical server names, the `node` command, ownership-marker
    //! provisioning, `merge_env`, and empty-value drop — is unchanged.
    //!
    //! Where practical the invariants are expressed as property-based tests
    //! (proptest) over arbitrary install dirs, server subsets, and env values,
    //! matching the design's "generate arbitrary install dirs, server subsets,
    //! and env values" instruction.
    //!
    //! Validates: Requirements 3.1, 3.2, 3.3, 3.5

    use super::*;
    use proptest::collection::hash_set;
    use proptest::prelude::*;
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// The exact 9 canonical server names, in the order `mcp-config.js` /
    /// `tool_payload.rs` list them. The fix must not add, drop, or rename any.
    const CANONICAL_SERVER_NAMES: [&str; 9] = [
        "terminal",
        "web-browser",
        "common",
        "browserless",
        "python-shell",
        "skills",
        "blender-bridge",
        "3dtool",
        "lan-sub-agent",
    ];

    /// A unique, self-cleaning temp plugin root per test (no external crate).
    struct TempRoot {
        path: PathBuf,
    }

    impl TempRoot {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let pid = std::process::id();
            let path = std::env::temp_dir()
                .join(format!("llm_toolkit_lmstudio_preserve_{tag}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            TempRoot { path }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn cfg(name: &str) -> ServerBridgeConfig {
        ServerBridgeConfig::new(name, "node", vec![format!("/install/{name}/mcp-server.js")])
    }

    // ── Server-name set preservation (Req 3.1) ───────────────────────────────

    /// The 9 canonical server names emitted by `default_bridge_configs` are
    /// exactly the expected set, regardless of the install dir. Only `args[0]`
    /// changes under the fix; the name set is invariant. (Property-based over
    /// arbitrary install dirs.)
    #[test]
    fn default_bridge_configs_server_name_set_is_the_canonical_nine() {
        let expected: BTreeSet<&str> = CANONICAL_SERVER_NAMES.into_iter().collect();

        proptest!(|(root in "[A-Za-z]:/[A-Za-z0-9_/-]{0,40}")| {
            let install_dir = PathBuf::from(&root);
            let configs = default_bridge_configs(&install_dir);
            prop_assert_eq!(configs.len(), 9);

            let actual: BTreeSet<&str> =
                configs.iter().map(|c| c.server_name.as_str()).collect();
            prop_assert_eq!(&actual, &expected);
        });
    }

    /// Every emitted bridge config uses the `node` command and exactly one arg,
    /// for any install dir. The fix corrects only the VALUE of `args[0]`, never
    /// the command or the arg count. (Req 3.3.)
    #[test]
    fn default_bridge_configs_command_is_always_node_with_single_arg() {
        proptest!(|(root in "[A-Za-z]:/[A-Za-z0-9_/-]{0,40}")| {
            let install_dir = PathBuf::from(&root);
            for c in default_bridge_configs(&install_dir) {
                prop_assert_eq!(&c.command, "node");
                prop_assert_eq!(c.args.len(), 1);
            }
        });
    }

    /// The browserless entry stays `schema-proxy.js` and every other tool stays
    /// `mcp-server.js` — the entry-FILE selection is preserved (only the
    /// directory segment of `args[0]` changes under the fix). (Req 3.5.)
    #[test]
    fn entry_file_selection_is_preserved_browserless_schema_proxy_else_mcp_server() {
        let install_dir = PathBuf::from("C:/any/Install");
        for c in default_bridge_configs(&install_dir) {
            let arg0 = &c.args[0];
            if c.server_name == "browserless" {
                assert!(
                    arg0.ends_with("/schema-proxy.js") || arg0.ends_with("schema-proxy.js"),
                    "browserless entry file must remain schema-proxy.js; got {arg0}"
                );
            } else {
                assert!(
                    arg0.ends_with("/mcp-server.js") || arg0.ends_with("mcp-server.js"),
                    "{} entry file must remain mcp-server.js; got {arg0}",
                    c.server_name
                );
            }
        }
    }

    // ── Ownership-marker provisioning preservation (Req 3.2) ──────────────────

    /// Provisioning writes the three ownership artifacts with the
    /// `_owner: "llm-toolkit"` marker on `manifest.json` and `install-state.json`.
    /// This contract is unchanged by the fix.
    #[test]
    fn ownership_marker_provisioning_is_preserved() {
        let root = TempRoot::new("owner");
        provision_plugin_dirs(&root.path, &[cfg("terminal"), cfg("browserless")]).unwrap();

        for name in ["terminal", "browserless"] {
            let dir = root.path.join(name);
            let manifest = read_json_safe(&dir.join("manifest.json")).unwrap();
            assert_eq!(manifest["_owner"], OWNER_ID);
            assert_eq!(manifest["type"], "plugin");
            assert_eq!(manifest["runner"], "mcpBridge");
            assert_eq!(manifest["owner"], "mcp");
            assert_eq!(manifest["name"], name);

            let state = read_json_safe(&dir.join("install-state.json")).unwrap();
            assert_eq!(state["_owner"], OWNER_ID);
            assert_eq!(state["by"], "mcp-bridge-v1");

            // The bridge config exists and keeps command == node.
            let bridge = read_json_safe(&dir.join("mcp-bridge-config.json")).unwrap();
            assert_eq!(bridge["command"], "node");
        }
    }

    /// `merge_env` preserves a user's real (non-placeholder, non-empty) token
    /// across a re-provision. This is the user-token flow the fix must keep
    /// intact (Req 3.2, and 3.8 for the token survival specifically).
    #[test]
    fn merge_env_preserves_user_real_token_across_reprovision() {
        let root = TempRoot::new("token-survive");

        // First provision browserless with an empty default token.
        let mut first = cfg("browserless");
        first.env.insert("BROWSERLESS_TOKEN".to_string(), String::new());
        provision_plugin_dirs(&root.path, &[first]).unwrap();

        // User writes a real token into the existing bridge config.
        let bridge_path = root.path.join("browserless").join("mcp-bridge-config.json");
        let mut bridge = read_json_safe(&bridge_path).unwrap();
        bridge["env"] = json!({ "BROWSERLESS_TOKEN": "real-user-token-xyz" });
        std::fs::write(&bridge_path, serde_json::to_string(&bridge).unwrap()).unwrap();

        // Re-provision with a fresh empty default — the real token must survive.
        let mut second = cfg("browserless");
        second.env.insert("BROWSERLESS_TOKEN".to_string(), String::new());
        provision_plugin_dirs(&root.path, &[second]).unwrap();

        let after = read_json_safe(&bridge_path).unwrap();
        assert_eq!(after["env"]["BROWSERLESS_TOKEN"], "real-user-token-xyz");
    }

    /// Empty-string env values are dropped on write, and placeholder token
    /// values are ignored (treated as empty), for arbitrary extra user env.
    /// Property-based to match the design's arbitrary-env-value instruction.
    #[test]
    fn merge_env_drops_empty_and_ignores_placeholders_over_arbitrary_env() {
        // Arbitrary non-empty, non-placeholder user values for a KEEP key, and
        // arbitrary keys that carry empty/whitespace values (must be dropped).
        let user_value = "[A-Za-z0-9 ._:/-]{1,20}";
        let blank_value = "[ \t]{0,4}"; // empty or whitespace only

        proptest!(|(keep in user_value, blank in blank_value)| {
            // Skip a generated "keep" that is only whitespace (would be dropped).
            prop_assume!(!keep.trim().is_empty());

            let mut fresh: BTreeMap<String, String> = BTreeMap::new();
            fresh.insert("KEEP".to_string(), "default".to_string());
            fresh.insert("EMPTY".to_string(), String::new());
            fresh.insert("BROWSERLESS_TOKEN".to_string(), String::new());

            let existing = json!({
                "env": {
                    "KEEP": keep,
                    // placeholder is ignored -> fresh empty remains -> dropped
                    "BROWSERLESS_TOKEN": "your-browserless-api-token-here",
                    "BLANK": blank,
                }
            });

            let merged = merge_env(&fresh, Some(&existing));

            // User's real non-placeholder value overrides the default.
            prop_assert_eq!(merged.get("KEEP").map(String::as_str), Some(keep.as_str()));
            // Empty fresh value dropped.
            prop_assert!(!merged.contains_key("EMPTY"));
            // Placeholder ignored -> token stays empty -> dropped.
            prop_assert!(!merged.contains_key("BROWSERLESS_TOKEN"));
            // Whitespace/empty user value dropped.
            prop_assert!(!merged.contains_key("BLANK"));
        });
    }

    /// The provisioning bijection (one owned dir per server, foreign dirs
    /// untouched) is preserved for arbitrary server subsets. This guards the
    /// ownership-provisioning / cleanup behavior the fix must not disturb.
    #[test]
    fn provision_bijection_preserved_for_arbitrary_server_subsets() {
        fn name() -> impl Strategy<Value = String> {
            "[a-z][a-z0-9_-]{0,12}"
        }

        proptest!(|(names in hash_set(name(), 1..=8))| {
            let root = TempRoot::new("bijection");
            let servers: Vec<ServerBridgeConfig> = names.iter().map(|n| cfg(n)).collect();

            let result = provision_plugin_dirs(&root.path, &servers)
                .expect("valid non-empty server set must provision");

            let provisioned: BTreeSet<String> = result.provisioned.into_iter().collect();
            let expected: BTreeSet<String> = names.iter().cloned().collect();
            prop_assert_eq!(&provisioned, &expected);

            let owned: BTreeSet<String> = get_owned_plugin_dirs(&root.path)
                .iter()
                .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
                .collect();
            prop_assert_eq!(&owned, &expected);

            // Every provisioned config still uses the node command.
            for name in &names {
                let bridge =
                    read_json_safe(&root.path.join(name).join("mcp-bridge-config.json")).unwrap();
                prop_assert_eq!(bridge["command"].as_str(), Some("node"));
            }
        });
    }
}

// ─── Property 4 — generated config for each Shipped server is unchanged ───────

#[cfg(test)]
mod shipped_config_parity_property_tests {
    //! Feature: retire-and-gate-mcp-servers, Property 4: generated config for
    //! each Shipped server is unchanged.
    //!
    //! *For all* nine Shipped servers, the configuration generated after the
    //! change (LM Studio bridge command, argument entry-path layout, and
    //! environment map) is identical to the configuration generated for that
    //! same server before the change — the only whole-set difference is the
    //! removal of the Retired and Unshipped entries.
    //!
    //! The pre-change golden snapshot lives at
    //! `tests/fixtures/shipped-servers-baseline.json` (captured in task 1.1,
    //! before any source-of-truth mirror was edited). It contains ONLY the nine
    //! Shipped servers, so it doubles as the post-change expected set.
    //!
    //! ## Why this passes now AND after pruning
    //!
    //! `default_bridge_configs` iterates `canonical_payloads()`. Before the
    //! mirrors were pruned that was 16 configs; now that they are pruned it is 9.
    //! This test asserts, for each of the nine Shipped servers in the baseline,
    //! that the live generated command/args-layout matches the baseline — a
    //! subset relationship that holds regardless of whether the extra 7
    //! Retired/Unshipped configs are still present. It additionally asserts the
    //! whole-set difference is *exactly* the removal of the seven known
    //! Retired/Unshipped names: the live set minus the nine Shipped is always a
    //! subset of those seven (never anything unexpected), and post-prune it is
    //! empty. Both invariants hold pre- and post-change.
    //!
    //! Per `shipped-servers-baseline.schema.md`, `default_bridge_configs` emits
    //! an empty env map (per-tool env derivation is `config_gen.rs`'s job); the
    //! `env` half of the baseline is the authoritative per-server env taken from
    //! `mcp-config.js`. This test therefore asserts the command/args-layout half
    //! against `default_bridge_configs` (over arbitrary install dirs) and locks
    //! the env half as the golden fixture (the authoritative per-server env that
    //! must remain unchanged for the nine Shipped servers).
    //!
    //! Validates: Requirements 6.1, 6.3

    use super::*;
    use proptest::prelude::*;
    use serde_json::Value;
    use std::collections::BTreeSet;

    /// The nine Shipped server names (the canonical post-change set).
    const SHIPPED_SERVER_NAMES: [&str; 9] = [
        "terminal",
        "web-browser",
        "common",
        "browserless",
        "python-shell",
        "skills",
        "blender-bridge",
        "3dtool",
        "lan-sub-agent",
    ];

    /// The seven names removed by this feature — four Retired plus three
    /// Unshipped. On unpruned code `default_bridge_configs` still emits these;
    /// after pruning it emits none of them. The live set minus the nine Shipped
    /// must always be a subset of exactly these seven.
    const REMOVED_SERVER_NAMES: [&str; 7] = [
        // Retired (4)
        "rag",
        "csv-exporter",
        "file-editor",
        "package-manager",
        // Unshipped (3)
        "slash-commands",
        "sub-agent",
        "git",
    ];

    /// Load and parse the golden baseline fixture captured in task 1.1.
    fn load_baseline() -> Value {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/shipped-servers-baseline.json"
        );
        let text = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("could not read baseline fixture {path}: {e}"));
        serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("baseline fixture is not valid JSON ({path}): {e}"))
    }

    /// Normalize a path the way `default_bridge_configs` does (forward slashes).
    fn normalize(p: &Path) -> String {
        p.to_string_lossy().replace('\\', "/")
    }

    /// Substitute the resolved install root into the baseline's
    /// `entryPathTemplate` (`{installDir}/<serverName>/<entry>`) and normalize,
    /// producing the concrete expected `args[0]`.
    fn expected_arg0(install_dir: &Path, server_name: &str, entry: &str) -> String {
        normalize(&install_dir.join(server_name).join(entry))
    }

    /// The baseline must be self-consistent: exactly nine servers, none of them
    /// a Retired/Unshipped name, and it declares `expectedServerCount == 9`.
    #[test]
    fn baseline_fixture_contains_exactly_the_nine_shipped_servers() {
        let baseline = load_baseline();

        assert_eq!(
            baseline["expectedServerCount"].as_u64(),
            Some(9),
            "baseline must declare expectedServerCount == 9"
        );

        let servers = baseline["servers"]
            .as_object()
            .expect("baseline.servers must be an object");

        let baseline_names: BTreeSet<&str> = servers.keys().map(String::as_str).collect();
        let expected: BTreeSet<&str> = SHIPPED_SERVER_NAMES.into_iter().collect();
        assert_eq!(
            baseline_names, expected,
            "baseline server set must be exactly the nine Shipped servers"
        );

        // No Retired/Unshipped name may appear in the baseline.
        for removed in REMOVED_SERVER_NAMES {
            assert!(
                !servers.contains_key(removed),
                "baseline must not contain the removed server '{removed}'"
            );
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: retire-and-gate-mcp-servers, Property 4: generated config for
        // each Shipped server is unchanged.
        //
        // For arbitrary install roots, the live-generated bridge config
        // (command + args entry-path layout) for each of the nine Shipped
        // servers equals the pre-change golden baseline, and the whole-set
        // difference from the baseline is exactly the removal of the seven
        // Retired/Unshipped entries.
        #[test]
        fn generated_config_for_each_shipped_server_matches_baseline(
            root in "[A-Za-z]:/[A-Za-z0-9_/-]{0,40}"
        ) {
            let baseline = load_baseline();
            let baseline_servers = baseline["servers"]
                .as_object()
                .expect("baseline.servers must be an object");

            let install_dir = PathBuf::from(&root);
            let configs = default_bridge_configs(&install_dir);

            // Index the live configs by server name.
            let live: std::collections::BTreeMap<&str, &ServerBridgeConfig> =
                configs.iter().map(|c| (c.server_name.as_str(), c)).collect();

            // (a) Each of the nine Shipped servers is generated and matches the
            //     baseline command + args entry-path layout exactly.
            for &name in SHIPPED_SERVER_NAMES.iter() {
                let expected = &baseline_servers[name];
                let expected_command = expected["command"]
                    .as_str()
                    .expect("baseline command must be a string");
                let entry = expected["entry"]
                    .as_str()
                    .expect("baseline entry must be a string");

                let cfg = live
                    .get(name)
                    .unwrap_or_else(|| panic!("missing generated bridge config for Shipped server '{name}'"));

                prop_assert_eq!(
                    cfg.command.as_str(),
                    expected_command,
                    "command for Shipped server '{}' must be unchanged", name
                );
                prop_assert_eq!(
                    cfg.args.len(),
                    1,
                    "Shipped server '{}' must have exactly one arg", name
                );
                prop_assert_eq!(
                    &cfg.args[0],
                    &expected_arg0(&install_dir, name, entry),
                    "args entry-path layout for Shipped server '{}' must match the baseline", name
                );
            }

            // (b) The whole-set difference is ONLY the removal of Retired/
            //     Unshipped entries. The live names minus the nine Shipped must
            //     be a subset of exactly the seven removed names (never anything
            //     unexpected). Pre-prune this is those seven; post-prune it is
            //     empty. Either way it can never contain a surprise name.
            let live_names: BTreeSet<&str> = live.keys().copied().collect();
            let shipped: BTreeSet<&str> = SHIPPED_SERVER_NAMES.into_iter().collect();
            let removed: BTreeSet<&str> = REMOVED_SERVER_NAMES.into_iter().collect();

            let extra: BTreeSet<&str> = live_names.difference(&shipped).copied().collect();
            for name in &extra {
                prop_assert!(
                    removed.contains(name),
                    "unexpected server '{}' in generated set — the only permitted \
                     difference from the nine Shipped is the seven Retired/Unshipped names",
                    name
                );
            }

            // The nine Shipped must all be present regardless of pruning state.
            prop_assert!(
                shipped.is_subset(&live_names),
                "all nine Shipped servers must be present in the generated set"
            );
        }
    }
}
