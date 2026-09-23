// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bundle;
mod commands;
mod config_gen;
mod dependency;
mod downloader;
mod installer;
mod lmstudio;
mod logger;
mod manifest;
mod path_validation;
mod registry;
mod tool_payload;

fn main() {
    // Check for CLI flags before launching the UI.
    // Silent mode (/S or --silent) runs installation without the Tauri window.
    // Uninstall mode (--uninstall <path>) removes files and registry entries.
    match registry::parse_cli_args() {
        registry::CliMode::Silent(custom_path) => {
            let exit_code = registry::run_silent_installation(custom_path);
            std::process::exit(exit_code);
        }
        registry::CliMode::Uninstall(install_path) => {
            eprintln!("LLM Toolkit Installer — Uninstall Mode");
            eprintln!("Removing installation from: {}", install_path);

            match registry::uninstall(&install_path) {
                Ok(()) => {
                    eprintln!("Uninstallation completed successfully.");
                    std::process::exit(0);
                }
                Err(e) => {
                    eprintln!("Uninstallation failed: {}", e);
                    std::process::exit(1);
                }
            }
        }
        registry::CliMode::Normal => {
            // Launch the standard Tauri GUI installer
            tauri::Builder::default()
                .invoke_handler(tauri::generate_handler![
                    commands::check_dependencies,
                    commands::validate_install_path,
                    commands::get_default_install_path,
                    commands::start_installation,
                    commands::cancel_installation,
                    commands::get_install_log,
                ])
                .run(tauri::generate_context!())
                .expect("error while running tauri application");
        }
    }
}
