use crate::dependency::DependencyStatus;
use crate::installer::InstallationResult;
use crate::path_validation::PathValidationResult;

/// Check which dependencies are installed and their versions
#[tauri::command]
pub fn check_dependencies() -> Vec<DependencyStatus> {
    crate::dependency::detect_all()
}

/// Validate an installation path before proceeding
#[tauri::command]
pub fn validate_install_path(path: String) -> PathValidationResult {
    crate::path_validation::validate_install_path(&path)
}

/// Get the default installation path
#[tauri::command]
pub fn get_default_install_path() -> String {
    crate::path_validation::default_install_path()
}

/// Start the installation process at the given path.
///
/// Returns the full [`InstallationResult`] to the frontend. When the elevation
/// gate declines (declined UAC / 120s no-response), the returned result has
/// `success == false`, `step == ELEVATION_STEP`, and `message ==
/// ADMIN_REQUIRED_MESSAGE`, so the UI can recognize the elevation-declined
/// outcome specifically and surface the admin-required message — the GUI
/// analogue of the silent path's non-zero exit code (Req 1.4, task 6.3).
#[tauri::command]
pub fn start_installation(install_path: String) -> InstallationResult {
    crate::installer::run_installation(&install_path)
}

/// Cancel an in-progress installation
#[tauri::command]
pub fn cancel_installation() -> bool {
    crate::installer::cancel()
}

/// Retrieve the current install log entries
#[tauri::command]
pub fn get_install_log() -> Vec<String> {
    crate::logger::get_entries()
}

/// Close the installer window / exit the application.
///
/// The GUI's "Close Installer" button on the completion screen invokes this
/// instead of the browser `window.close()`, which is a no-op in a Tauri webview
/// unless the frontend holds the `core:window:allow-close` capability (this
/// installer ships no capabilities, so the JS close silently did nothing and
/// the window stayed open after a successful install). Exiting through the
/// `AppHandle` tears the whole single-window app down cleanly and reliably,
/// requiring no frontend capability — only the already-permitted `invoke`.
#[tauri::command]
pub fn exit_installer(app: tauri::AppHandle) {
    app.exit(0);
}
