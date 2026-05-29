use crate::error::{InstallError, InstallErrorKind, Phase};
use crate::tools::{build_bridge_config, BridgeConfig, ToolDescriptor};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LmStudioInstallationStatus {
    pub app_installed: bool,
    pub app_path: Option<PathBuf>,
    pub plugin_root: PathBuf,
    pub plugin_root_exists: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LmStudioSyncResult {
    pub plugin_root: PathBuf,
    pub mode: String,
    pub updated: usize,
    pub skipped: usize,
    pub message: String,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_plugin_root(override_path: Option<&str>) -> PathBuf {
    if let Some(p) = override_path.map(str::trim).filter(|s| !s.is_empty()) {
        return PathBuf::from(p);
    }
    home().join(".lmstudio").join("extensions").join("plugins").join("mcp")
}

#[cfg(target_os = "windows")]
fn detect_app_path() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("LOCALAPPDATA").map(|v| {
            PathBuf::from(v)
                .join("Programs")
                .join("LM Studio")
                .join("LM Studio.exe")
        }),
        std::env::var_os("ProgramFiles").map(|v| {
            PathBuf::from(v).join("LM Studio").join("LM Studio.exe")
        }),
        std::env::var_os("ProgramFiles(x86)").map(|v| {
            PathBuf::from(v).join("LM Studio").join("LM Studio.exe")
        }),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
}

#[cfg(target_os = "macos")]
fn detect_app_path() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("/Applications/LM Studio.app"),
        home().join("Applications").join("LM Studio.app"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

#[cfg(target_os = "linux")]
fn detect_app_path() -> Option<PathBuf> {
    let candidates = [
        home().join("Applications").join("LM-Studio.AppImage"),
        home().join("Applications").join("LM Studio.AppImage"),
        PathBuf::from("/opt/LM Studio/lmstudio"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

pub fn installation_status(override_path: Option<&str>) -> LmStudioInstallationStatus {
    let plugin_root = resolve_plugin_root(override_path);
    let plugin_root_exists = plugin_root.exists();
    let app_path = detect_app_path();
    let app_installed = app_path.is_some();
    let message = if app_installed {
        if plugin_root_exists {
            "LM Studio app and plugin directory detected.".into()
        } else {
            "LM Studio app detected. Plugin directory will be created during sync.".into()
        }
    } else {
        "LM Studio app was not detected on this machine.".into()
    };
    LmStudioInstallationStatus {
        app_installed,
        app_path,
        plugin_root,
        plugin_root_exists,
        message,
    }
}

/// Write `mcp.json` + per-plugin bridge configs.
pub fn sync(
    install_root: &Path,
    tools: &[ToolDescriptor],
    node_path: &str,
    override_path: Option<&str>,
) -> Result<LmStudioSyncResult, InstallError> {
    let status = installation_status(override_path);
    let plugin_root = status.plugin_root.clone();

    if !status.app_installed {
        return Ok(LmStudioSyncResult {
            plugin_root,
            mode: "skipped".into(),
            updated: 0,
            skipped: tools.len(),
            message: "LM Studio installation not found. Sync can be retried later.".into(),
        });
    }

    std::fs::create_dir_all(&plugin_root).map_err(|e| InstallError {
        phase: Phase::LmStudioSync,
        kind: InstallErrorKind::Filesystem,
        message: format!("Could not create LM Studio plugin root: {e}"),
        recoverable: true,
        cause_chain: vec![],
    })?;

    let mut mcp_servers: Map<String, Value> = Map::new();
    let mut updated = 0usize;
    for tool in tools {
        let cfg = build_bridge_config(install_root, tool, node_path);
        mcp_servers.insert(tool.id.clone(), serde_json::to_value(&cfg).unwrap());
        let plugin_dir = plugin_root.join(&tool.id);
        std::fs::create_dir_all(&plugin_dir).map_err(io_err)?;
        let body = format!("{}\n", serde_json::to_string_pretty(&cfg).unwrap());
        std::fs::write(plugin_dir.join("mcp-bridge-config.json"), body).map_err(io_err)?;
        updated += 1;
    }

    let lm_dir = home().join(".lmstudio");
    std::fs::create_dir_all(&lm_dir).map_err(io_err)?;
    let mcp_json_path = lm_dir.join("mcp.json");

    let mut existing: Map<String, Value> = if mcp_json_path.is_file() {
        std::fs::read_to_string(&mcp_json_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Map<String, Value>>(&s).ok())
            .unwrap_or_default()
    } else {
        Map::new()
    };
    existing.insert("mcpServers".into(), Value::Object(mcp_servers));
    let body = format!("{}\n", serde_json::to_string_pretty(&existing).unwrap());
    std::fs::write(&mcp_json_path, body).map_err(io_err)?;

    Ok(LmStudioSyncResult {
        plugin_root,
        mode: "ready".into(),
        updated,
        skipped: 0,
        message: format!("LM Studio sync complete: {updated} updated."),
    })
}

fn io_err(e: std::io::Error) -> InstallError {
    InstallError {
        phase: Phase::LmStudioSync,
        kind: InstallErrorKind::Filesystem,
        message: e.to_string(),
        recoverable: true,
        cause_chain: vec![],
    }
}

#[allow(dead_code)]
fn _ensure_bridge_serializes() -> BridgeConfig {
    BridgeConfig {
        command: "node".into(),
        args: vec![],
        cwd: ".".into(),
        env: Default::default(),
    }
}
