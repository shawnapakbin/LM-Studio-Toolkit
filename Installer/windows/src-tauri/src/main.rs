// LLM Toolkit Installer — Windows entry point
//
// Wires shared/core install orchestration to Tauri commands.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use llmtk_core::{
    diagnostics, github_issue, license,
    license::LicenseAcceptance,
    lmstudio,
    paths::{self, InstallPaths, InstallScope},
    phases::{self, CancelToken, InstallOptions, ProgressEvent},
    tools, INSTALLER_VERSION,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, Mutex};

struct AppState {
    cancel: Mutex<Option<CancelToken>>,
    last_paths: Mutex<Option<InstallPaths>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            cancel: Mutex::new(None),
            last_paths: Mutex::new(None),
        }
    }
}

#[derive(serde::Serialize)]
struct SystemInfo {
    os: String,
    arch: String,
    elevated: bool,
    installer_version: String,
    default_scope: &'static str,
    default_install_root_system: PathBuf,
    default_install_root_user: PathBuf,
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    let elevated = paths::is_elevated();
    SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        elevated,
        installer_version: INSTALLER_VERSION.to_string(),
        default_scope: if elevated { "system" } else { "user" },
        default_install_root_system: paths::resolve(InstallScope::System).install_root,
        default_install_root_user: paths::resolve(InstallScope::User).install_root,
    }
}

#[tauri::command]
fn get_license_text() -> &'static str {
    license::get_license_text()
}

#[tauri::command]
fn validate_license(acceptance: LicenseAcceptance) -> Result<(), String> {
    license::validate(&acceptance).map_err(|e| e.message)
}

#[tauri::command]
fn get_lm_studio_status(override_path: Option<String>) -> lmstudio::LmStudioInstallationStatus {
    lmstudio::installation_status(override_path.as_deref())
}

#[tauri::command]
async fn start_install(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    options: InstallOptions,
) -> Result<(), String> {
    let cancel = CancelToken::new();
    *state.cancel.lock().await = Some(cancel.clone());

    let (tx, mut rx) = mpsc::unbounded_channel::<ProgressEvent>();
    let app_for_events = app.clone();
    let event_task = tokio::spawn(async move {
        while let Some(evt) = rx.recv().await {
            let _ = app_for_events.emit("install:event", &evt);
        }
    });

    let state_clone = state.inner().clone();
    let result = phases::run_install(options, tx, cancel).await;
    let _ = event_task.await;

    match result {
        Ok(paths) => {
            *state_clone.last_paths.lock().await = Some(paths);
            Ok(())
        }
        Err(err) => {
            // Save diagnostic report and emit error event.
            let last = state_clone.last_paths.lock().await.clone();
            let scope_str = last.as_ref().map(|p| match p.scope {
                InstallScope::System => "system",
                InstallScope::User => "user",
            });
            let install_root = last.as_ref().map(|p| p.install_root.clone());
            let diagnostics_dir = last
                .as_ref()
                .map(|p| p.diagnostics_dir.clone())
                .unwrap_or_else(|| std::env::temp_dir().join("llm-toolkit-diagnostics"));

            let report = diagnostics::build_report(
                Some(err.clone()),
                Some(err.phase),
                scope_str,
                install_root.as_deref(),
            );
            let saved = diagnostics::save_report(&diagnostics_dir, &report).ok();
            let issue_url = github_issue::build_issue_url(&report, saved.as_deref());
            let _ = app.emit(
                "install:error",
                &serde_json::json!({
                    "error": err,
                    "report_path": saved,
                    "issue_url": issue_url,
                }),
            );
            Err(err.message)
        }
    }
}

#[tauri::command]
async fn cancel_install(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if let Some(c) = state.cancel.lock().await.as_ref() {
        c.cancel().await;
    }
    Ok(())
}

#[tauri::command]
fn save_diagnostic_report(
    error: Option<llmtk_core::error::InstallError>,
) -> Result<PathBuf, String> {
    let dir = paths::resolve(InstallScope::User).diagnostics_dir;
    let report = diagnostics::build_report(error.clone(), error.as_ref().map(|e| e.phase), None, None);
    diagnostics::save_report(&dir, &report).map_err(|e| e.message)
}

#[tauri::command]
fn build_github_issue_url(
    error: Option<llmtk_core::error::InstallError>,
    report_path: Option<PathBuf>,
) -> String {
    let report = diagnostics::build_report(error.clone(), error.as_ref().map(|e| e.phase), None, None);
    github_issue::build_issue_url(&report, report_path.as_deref())
}

#[tauri::command]
fn list_tools() -> Result<Vec<tools::ToolDescriptor>, String> {
    tools::load_bundled().map_err(|e| e.to_string())
}

fn main() {
    env_logger::init();
    let state = Arc::new(AppState::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            get_license_text,
            validate_license,
            get_lm_studio_status,
            start_install,
            cancel_install,
            save_diagnostic_report,
            build_github_issue_url,
            list_tools,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            if let Some(win) = app.get_webview_window("main") {
                win.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
