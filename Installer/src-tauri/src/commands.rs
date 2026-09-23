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

/// Start the installation process at the given path
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
