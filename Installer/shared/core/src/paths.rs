use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Where the toolkit will be installed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstallScope {
    /// Per-machine, requires admin elevation on Windows / sudo elsewhere.
    System,
    /// Per-user, no elevation required.
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallPaths {
    pub scope: InstallScope,
    /// Root install directory (toolkit sources, node_modules live here).
    pub install_root: PathBuf,
    /// Per-user app data directory (logs, diagnostics, .env).
    pub app_data: PathBuf,
    pub logs_dir: PathBuf,
    pub diagnostics_dir: PathBuf,
}

const PUBLISHER: &str = "expDigit Studio";
const PRODUCT: &str = "LLM Toolkit";

/// Resolve the install paths for the chosen scope. Falls back gracefully if
/// an environment variable is missing.
pub fn resolve(scope: InstallScope) -> InstallPaths {
    let install_root = match scope {
        InstallScope::System => system_install_root(),
        InstallScope::User => user_install_root(),
    };
    let app_data = user_app_data_dir();
    let logs_dir = app_data.join("logs");
    let diagnostics_dir = app_data.join("diagnostics");
    InstallPaths {
        scope,
        install_root,
        app_data,
        logs_dir,
        diagnostics_dir,
    }
}

#[cfg(target_os = "windows")]
fn system_install_root() -> PathBuf {
    let pf = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    pf.join(PUBLISHER).join(PRODUCT)
}

#[cfg(target_os = "windows")]
fn user_install_root() -> PathBuf {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| dirs::data_local_dir())
        .unwrap_or_else(|| PathBuf::from("."));
    local.join("Programs").join(PUBLISHER).join(PRODUCT)
}

#[cfg(target_os = "windows")]
fn user_app_data_dir() -> PathBuf {
    let appdata = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    appdata.join(PUBLISHER).join(PRODUCT)
}

#[cfg(target_os = "macos")]
fn system_install_root() -> PathBuf {
    PathBuf::from("/Applications").join(PUBLISHER).join(PRODUCT)
}

#[cfg(target_os = "macos")]
fn user_install_root() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join("Applications").join(PUBLISHER).join(PRODUCT))
        .unwrap_or_else(|| PathBuf::from("./LLM Toolkit"))
}

#[cfg(target_os = "macos")]
fn user_app_data_dir() -> PathBuf {
    dirs::data_dir()
        .map(|d| d.join("expDigitStudio").join("LLMToolkit"))
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(target_os = "linux")]
fn system_install_root() -> PathBuf {
    PathBuf::from("/opt/expdigit-studio/llm-toolkit")
}

#[cfg(target_os = "linux")]
fn user_install_root() -> PathBuf {
    dirs::data_local_dir()
        .map(|d| d.join("expdigit-studio").join("llm-toolkit"))
        .unwrap_or_else(|| PathBuf::from("./llm-toolkit"))
}

#[cfg(target_os = "linux")]
fn user_app_data_dir() -> PathBuf {
    dirs::config_dir()
        .map(|d| d.join("expdigit-studio").join("llm-toolkit"))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// On Windows, returns true if the current process token has admin privileges.
/// On other platforms, returns true if running as root.
#[cfg(target_os = "windows")]
pub fn is_elevated() -> bool {
    // Cheap heuristic: try to create a file in System32. If forbidden, not elevated.
    // For a robust check we'd call OpenProcessToken + GetTokenInformation; this avoids
    // pulling in the windows-rs crate for the scaffold.
    let probe = std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join(format!(".llm-toolkit-elev-probe-{}", std::process::id()));
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_elevated() -> bool {
    // Best effort: euid 0.
    #[cfg(unix)]
    unsafe {
        libc_geteuid() == 0
    }
    #[cfg(not(unix))]
    false
}

#[cfg(unix)]
extern "C" {
    #[link_name = "geteuid"]
    fn libc_geteuid() -> u32;
}

/// Free-space probe for the disk hosting `target`. Returns bytes available or `None`.
pub fn free_space_bytes(target: &Path) -> Option<u64> {
    // Walk up until we find an existing ancestor; std doesn't expose statfs portably,
    // so use `fs2`-style approach via the `dirs` crate is not enough. Best effort: None.
    // Real implementation can wire `sysinfo` or platform calls later.
    let mut probe = target.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            return None;
        }
    }
    Some(0).filter(|_| probe.exists())
        .and(None) // placeholder until we wire a platform-specific call
}
