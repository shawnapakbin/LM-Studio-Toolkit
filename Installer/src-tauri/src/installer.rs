//! Installation orchestrator.
//!
//! This module drives the *bundle-and-copy* install pipeline: it runs the five
//! provisioning steps named in Requirement 9.1 in order, with fail-fast
//! semantics (Req 9.3) and per-step logging (Req 9.4). Each step reports its
//! human-readable name to the frontend (Req 9.1).
//!
//! ## Migration note (design.md Architecture section)
//!
//! The previous pipeline cloned a git repository and built the tools on the end
//! user's machine (`DependencyDownload → RepositorySetup → Build → Configuration
//! → LmStudioSync`). That model contradicts Requirements 3, 5, 6, and 7, so it
//! has been retired. This file now defines the five-step [`Step`] enum and the
//! ordered, fail-fast, retryable, cancellable pipeline around it. The retry,
//! cancellation, and logging scaffolding is preserved verbatim.
//!
//! ## Step seams
//!
//! Each `Step` body is a clearly-marked seam that a later task fills in:
//!
//! | Step                     | Requirement | Implemented by task |
//! | ------------------------ | ----------- | ------------------- |
//! | `Runtimes`               | Req 4       | 7.5                 |
//! | `CopyTools`              | Req 5       | 8.3 (via `bundle`)  |
//! | `LmStudioPluginDirs`     | Req 6       | 9.2 (via `lmstudio`)|
//! | `EnvConfig`              | Req 7       | 10.2 (via `config_gen`) |
//! | `UninstallRegistration`  | Req 8       | 12.3 (abort+rollback)   |
//!
//! Until those tasks land, each seam is a no-op stub that logs the step and
//! succeeds, so the orchestrator, retry, cancellation, and reporting behavior
//! can be exercised end-to-end.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use crate::bundle;
use crate::config_gen;
use crate::dependency;
use crate::downloader;
use crate::lmstudio;
use crate::logger;
use crate::manifest;
use crate::path_validation;
use crate::registry;

/// Global cancellation flag — set by `cancel()`, checked by each step.
static CANCELLED: OnceLock<AtomicBool> = OnceLock::new();

fn cancelled_flag() -> &'static AtomicBool {
    CANCELLED.get_or_init(|| AtomicBool::new(false))
}

/// Maximum number of retry attempts per step (initial + retries)
const MAX_STEP_RETRIES: u32 = 3;

/// Result of an installation attempt.
///
/// `step` carries one of the five provisioning step names (see
/// [`Step::name`]) or one of the pipeline-level names `"validation"` /
/// `"complete"`. This matches the design Data Models section.
#[derive(Debug, Clone, Serialize)]
pub struct InstallationResult {
    pub success: bool,
    pub step: String,
    pub message: String,
}

/// The five ordered provisioning steps (Req 9.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// Step 1 — detect and, if needed, provision Node.js and Python (Req 4).
    Runtimes,
    /// Step 2 — copy the bundled payload (16 tool `dist/` trees) into the
    /// install directory (Req 5).
    CopyTools,
    /// Step 3 — provision one LM Studio plugin directory per MCP server (Req 6).
    LmStudioPluginDirs,
    /// Step 4 — derive and write per-tool environment configuration (Req 7).
    EnvConfig,
    /// Step 5 — write the Windows uninstall registry entry (Req 8).
    UninstallRegistration,
}

impl Step {
    /// The machine-readable step identifier carried in
    /// [`InstallationResult::step`] and used as the logger phase key.
    ///
    /// These values are part of the frontend contract (design Data Models):
    /// `"runtimes" | "copy-tools" | "lm-studio-plugin-dirs" | "env-config"
    /// | "uninstall-registration"`.
    pub fn name(&self) -> &'static str {
        match self {
            Step::Runtimes => "runtimes",
            Step::CopyTools => "copy-tools",
            Step::LmStudioPluginDirs => "lm-studio-plugin-dirs",
            Step::EnvConfig => "env-config",
            Step::UninstallRegistration => "uninstall-registration",
        }
    }

    /// The human-readable step name shown to the end user (Req 9.1).
    pub fn display_name(&self) -> &'static str {
        match self {
            Step::Runtimes => "Runtimes",
            Step::CopyTools => "Copy Tools",
            Step::LmStudioPluginDirs => "LM Studio Plugin Dirs",
            Step::EnvConfig => "Env Config",
            Step::UninstallRegistration => "Uninstall Registration",
        }
    }
}

/// Ordered list of all provisioning steps. The orchestrator iterates this in
/// order and stops at the first failure (Req 9.3).
pub const STEPS: &[Step] = &[
    Step::Runtimes,
    Step::CopyTools,
    Step::LmStudioPluginDirs,
    Step::EnvConfig,
    Step::UninstallRegistration,
];

/// Outcome of the pure fail-fast orchestration core (see [`orchestrate_steps`]).
///
/// This is the testable heart of the pipeline (Property 14): it captures which
/// step failed (if any) without performing any I/O itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrchestrationOutcome {
    /// Every step ran and succeeded.
    Complete,
    /// The step named `failed_step` returned an error. No step after it ran.
    Failed {
        /// The `Step::name()` of the step that failed (Req 9.3).
        failed_step: &'static str,
        /// The error message the failing executor returned.
        message: String,
    },
}

/// Pure fail-fast orchestration core (Req 9.3, Property 14).
///
/// Iterates `steps` in order, invoking `execute` on each. Stops at the first
/// step whose executor returns `Err`, and reports that step by name. No step
/// after the failing one is executed. If every step succeeds the outcome is
/// [`OrchestrationOutcome::Complete`].
///
/// This function performs no I/O of its own: all side effects (logging,
/// filesystem work, cancellation checks, retry) live inside the caller-supplied
/// `execute` closure. That separation is what makes the fail-fast contract
/// testable without real provisioning side effects — a test injects a closure
/// that fails at a chosen step and records which steps ran.
pub fn orchestrate_steps<F>(steps: &[Step], mut execute: F) -> OrchestrationOutcome
where
    F: FnMut(&Step) -> Result<(), String>,
{
    for step in steps {
        if let Err(message) = execute(step) {
            // Fail-fast: stop here, do not run any later step, and report the
            // failed step by name (Req 9.3).
            return OrchestrationOutcome::Failed {
                failed_step: step.name(),
                message,
            };
        }
    }
    OrchestrationOutcome::Complete
}

/// Run the full installation pipeline at the given path.
///
/// Orchestrates the five provisioning steps sequentially with fail-fast
/// semantics: runtimes → copy tools → LM Studio plugin dirs → env config →
/// uninstall registration. Each step supports retry on failure, checks the
/// cancellation flag at its boundaries, and reports its name on success or
/// failure (Req 9.1, 9.3, 9.4).
pub fn run_installation(install_path: &str) -> InstallationResult {
    // Reset cancellation flag at the start of a new installation
    cancelled_flag().store(false, Ordering::SeqCst);

    // Validate the installation path first
    let validation = path_validation::validate_install_path(install_path);
    if !validation.valid {
        return InstallationResult {
            success: false,
            step: "validation".to_string(),
            message: format!(
                "Invalid installation path: {}",
                validation.error.unwrap_or_default()
            ),
        };
    }

    // Initialize the logger with the install directory
    logger::init(install_path);
    logger::log_info(
        "installer",
        &format!("Starting installation at: {}", install_path),
    );

    // Ensure the installation directory exists
    if let Err(e) = fs::create_dir_all(install_path) {
        return InstallationResult {
            success: false,
            step: "validation".to_string(),
            message: format!("Failed to create installation directory: {}", e),
        };
    }

    // Sentinel raised by the executor closure when cancellation is detected at
    // a step boundary. Cancellation is reported distinctly from a step failure
    // (a different message plus install-dir cleanup), so it is threaded out of
    // the pure orchestration core rather than folded into it.
    let mut cancelled_at: Option<&'static str> = None;

    // Execute each step in order, fail-fast (Req 9.3), driving the pure
    // orchestration core. All side effects (cancellation checks, per-step
    // logging, retry) live in this closure; `orchestrate_steps` only enforces
    // the fail-fast iteration and names the failed step.
    let outcome = orchestrate_steps(STEPS, |step| {
        // Check for cancellation before starting the step.
        if is_cancelled() {
            cancelled_at = Some(step.name());
            return Err("Installation cancelled by user".to_string());
        }

        logger::log_phase_start(step.name());

        let result = execute_step_with_retry(step, install_path);

        // Cancellation may have been requested mid-step.
        if is_cancelled() {
            cancelled_at = Some(step.name());
            return Err("Installation cancelled by user".to_string());
        }

        match result {
            Ok(()) => {
                logger::log_phase_complete(step.name());
                Ok(())
            }
            Err(err_msg) => {
                // Fail-fast: log the failed step by name; the orchestrator core
                // stops the pipeline here (Req 9.3, 9.4).
                logger::log_error(step.name(), &err_msg);
                Err(err_msg)
            }
        }
    });

    match outcome {
        OrchestrationOutcome::Failed {
            failed_step,
            message,
        } => {
            // A cancellation raised the sentinel; clean up and report it as a
            // cancellation rather than a step failure.
            if let Some(step_name) = cancelled_at {
                cleanup_installation(install_path);
                return InstallationResult {
                    success: false,
                    step: step_name.to_string(),
                    message: "Installation cancelled by user".to_string(),
                };
            }
            InstallationResult {
                success: false,
                step: failed_step.to_string(),
                message,
            }
        }
        OrchestrationOutcome::Complete => {
            logger::log_info("installer", "Installation complete.");
            InstallationResult {
                success: true,
                step: "complete".to_string(),
                message: "Installation completed successfully.".to_string(),
            }
        }
    }
}

/// Execute a single step with retry support (up to `MAX_STEP_RETRIES` attempts).
fn execute_step_with_retry(step: &Step, install_path: &str) -> Result<(), String> {
    let mut last_error = String::new();

    for attempt in 1..=MAX_STEP_RETRIES {
        if is_cancelled() {
            return Err("Installation cancelled by user".to_string());
        }

        if attempt > 1 {
            logger::log_info(
                step.name(),
                &format!(
                    "Retrying {} (attempt {}/{})",
                    step.display_name(),
                    attempt,
                    MAX_STEP_RETRIES
                ),
            );
        }

        match execute_step(step, install_path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                let retry_msg = if attempt < MAX_STEP_RETRIES {
                    format!(" — will retry ({}/{})", attempt, MAX_STEP_RETRIES)
                } else {
                    " — all retries exhausted".to_string()
                };

                logger::log_warn(
                    step.name(),
                    &format!("{} failed: {}{}", step.display_name(), e, retry_msg),
                );
                last_error = e;
            }
        }
    }

    Err(format!(
        "{} failed after {} attempts: {}",
        step.display_name(),
        MAX_STEP_RETRIES,
        last_error
    ))
}

/// Execute a single step (no retry logic — that's handled by the caller).
fn execute_step(step: &Step, install_path: &str) -> Result<(), String> {
    match step {
        Step::Runtimes => step_runtimes(install_path),
        Step::CopyTools => step_copy_tools(install_path),
        Step::LmStudioPluginDirs => step_lm_studio_plugin_dirs(install_path),
        Step::EnvConfig => step_env_config(install_path),
        Step::UninstallRegistration => step_uninstall_registration(install_path),
    }
}

// ─── Step seams ──────────────────────────────────────────────────────────────
//
// Each function below is a seam filled in by a later task. For now they log the
// step and return Ok(()) so the orchestrator, retry, cancellation, and
// reporting scaffolding can run end-to-end. The `_install_path` parameter is
// retained so the signatures match what the real implementations need.

/// Step 1 — Runtimes (Req 4). Implemented by task 7.5.
///
/// Will reuse `dependency::detect_all` + `downloader` for Node.js and Python
/// only (Git dropped): detect each runtime and its version, provision when
/// absent or below minimum, verify each meets the minimum, and on failure
/// report the affected runtime and cause without rolling back already-installed
/// runtimes (Req 4.6).
fn step_runtimes(install_path: &str) -> Result<(), String> {
    let phase = Step::Runtimes.name();

    // Load the runtime manifest (Node.js + Python; Git dropped). The manifest
    // carries the download URL and SHA-256 needed to provision an absent or
    // below-minimum runtime.
    let manifest = manifest::load_manifest().map_err(|e| {
        // No specific runtime to attribute here — the manifest itself is the
        // failure. Report it as an installation error (Req 4.6).
        format!("Runtime manifest could not be loaded: {}", e)
    })?;

    // Detect each required runtime and record its version (Req 4.1). `detect_all`
    // reads the same manifest and returns one status per runtime, sorted by name.
    let statuses = dependency::detect_all();
    if statuses.is_empty() {
        return Err("No runtimes are defined in the dependency manifest".to_string());
    }

    // Scratch directory for downloaded runtime installers.
    let downloads_dir = Path::new(install_path).join("downloads");
    if let Err(e) = fs::create_dir_all(&downloads_dir) {
        return Err(format!(
            "Failed to create downloads directory '{}': {}",
            downloads_dir.display(),
            e
        ));
    }

    // Provision each runtime that is absent or below minimum, then verify it
    // meets the minimum. On any failure, halt and report the affected runtime
    // and cause; already-installed runtimes are left in place (Req 4.6).
    for status in &statuses {
        // Cooperative cancellation between runtimes.
        if is_cancelled() {
            return Err("Installation cancelled by user".to_string());
        }

        if status.installed {
            logger::log_info(
                phase,
                &format!(
                    "Detected {} version {}",
                    status.display_name,
                    status.installed_version.as_deref().unwrap_or("unknown")
                ),
            );
        } else {
            logger::log_info(
                phase,
                &format!("{} not detected on this machine", status.display_name),
            );
        }

        if status.needs_download {
            // Distinguish absence from an unmet minimum for logging/attribution.
            let reason = runtime_provision_reason(status);
            logger::log_info(
                phase,
                &format!("Provisioning {} — {}", status.display_name, reason),
            );

            // Look up the manifest entry for this runtime to get the installer
            // URL and expected SHA-256.
            let entry = manifest.dependencies.get(&status.name).ok_or_else(|| {
                format!(
                    "{} installation error: no manifest entry named '{}'",
                    status.display_name, status.name
                )
            })?;

            // Download + verify SHA-256 with retry. On failure, attribute the
            // cause to this runtime (Req 4.6).
            let download = downloader::download_with_retry(
                &status.display_name,
                &entry.download_url,
                &entry.sha256,
                &downloads_dir,
                Duration::from_secs(downloader::DEFAULT_TIMEOUT_SECS),
            )
            .map_err(|e| {
                format!(
                    "{} installation error: failed to download and verify installer: {}",
                    status.display_name, e
                )
            })?;

            // Run the verified installer silently to provision the runtime.
            run_runtime_installer(&status.display_name, &download.file_path)?;
        }
    }

    // Re-detect and verify every required runtime is present and meets the
    // minimum after provisioning (Req 4.4). This is a fresh detection so it
    // reflects any runtime just installed.
    for status in dependency::detect_all() {
        if is_cancelled() {
            return Err("Installation cancelled by user".to_string());
        }

        if !status.installed {
            // Provisioning ran (if it was needed) but the runtime still isn't
            // detectable — report absence (Req 4.6).
            return Err(runtime_verification_failure(&status));
        }

        if status.needs_download {
            // Present but still below the minimum version (Req 4.6).
            return Err(runtime_verification_failure(&status));
        }

        logger::log_info(
            phase,
            &format!(
                "Verified {} version {} meets minimum {}",
                status.display_name,
                status.installed_version.as_deref().unwrap_or("unknown"),
                status.minimum_version
            ),
        );
    }

    logger::log_info(phase, "All required runtimes are present and satisfy the minimum version");
    Ok(())
}

/// Format the human-readable reason a runtime needs provisioning, naming the
/// affected runtime and distinguishing absence from an unmet minimum (Req 4.6).
///
/// Pure so the error-attribution wording can be asserted directly in tests
/// without driving real detection/downloads. Callers embed the returned string
/// in provisioning log/attribution messages.
fn runtime_provision_reason(status: &dependency::DependencyStatus) -> String {
    if !status.installed {
        format!("{} is absent", status.display_name)
    } else {
        format!(
            "{} version {} is below the minimum {}",
            status.display_name,
            status.installed_version.as_deref().unwrap_or("unknown"),
            status.minimum_version
        )
    }
}

/// Format the post-provisioning verification failure for a runtime, naming the
/// affected runtime and distinguishing absence from an unmet minimum (Req 4.6).
///
/// Pure so the error-attribution wording can be asserted directly in tests.
/// Only meaningful when the runtime failed verification (absent, or present but
/// still below the minimum).
fn runtime_verification_failure(status: &dependency::DependencyStatus) -> String {
    if !status.installed {
        format!(
            "{} verification failed: runtime is absent after provisioning",
            status.display_name
        )
    } else {
        format!(
            "{} verification failed: detected version {} is below the minimum {}",
            status.display_name,
            status.installed_version.as_deref().unwrap_or("unknown"),
            status.minimum_version
        )
    }
}

/// Run a downloaded runtime installer silently.
///
/// Node.js ships an `.msi` (installed via `msiexec /qn`); Python ships an
/// `.exe` (installed with its own silent flags). Any other extension is invoked
/// directly. A non-success exit status is reported as an installation error
/// attributed to the runtime (Req 4.6). Already-installed runtimes are never
/// rolled back here.
fn run_runtime_installer(display_name: &str, installer_path: &Path) -> Result<(), String> {
    let phase = Step::Runtimes.name();
    logger::log_info(
        phase,
        &format!(
            "Running {} installer: {}",
            display_name,
            installer_path.display()
        ),
    );

    let extension = installer_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    let path_str = installer_path.to_string_lossy().to_string();

    let output = if extension == "msi" {
        // Windows Installer package: silent, no UI.
        Command::new("msiexec")
            .args(["/i", &path_str, "/qn", "/norestart"])
            .output()
    } else if extension == "exe" {
        // Python's official installer supports these silent flags; they are
        // harmless for other self-contained EXE installers.
        Command::new(&path_str)
            .args(["/quiet", "InstallAllUsers=1", "PrependPath=1"])
            .output()
    } else {
        Command::new(&path_str).output()
    };

    let output = output.map_err(|e| {
        format!(
            "{} installation error: failed to launch installer '{}': {}",
            display_name,
            installer_path.display(),
            e
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{} installation error: installer exited with status {} ({})",
            display_name,
            output.status,
            stderr.trim()
        ));
    }

    logger::log_info(
        phase,
        &format!("{} installer completed successfully", display_name),
    );
    Ok(())
}

/// The subdirectory (relative to the app's resource dir) where the bundled
/// tool payload lands at install time.
///
/// The payload is declared in `tauri.conf.json` as `bundle.resources:
/// ["payload/"]` (task 4.2). Tauri preserves the declared directory name, so a
/// resource dir of `<X>/resources` places the payload at
/// `<X>/resources/payload/<server_name>/`.
const PAYLOAD_RESOURCE_SUBDIR: &str = "payload";

/// The resource directory name Tauri/NSIS places bundled resources under,
/// alongside the installed executable.
const RESOURCE_DIR_NAME: &str = "resources";

/// Compute the bundled-payload resource root for a given executable directory.
///
/// For a bundled Tauri v2 NSIS (`perMachine`) app the executable is installed
/// at the install root and its bundled resources are laid out beside it under
/// `resources/`. The payload declared as `resources: ["payload/"]` therefore
/// resolves to `<exe_dir>/resources/payload/`, with each tool at
/// `.../payload/<server_name>/`.
///
/// Kept pure (no `current_exe()` call, no filesystem probing) so the path
/// derivation is unit-testable without a real install layout. The live
/// resolver [`resolve_payload_resource_root`] feeds it the real exe directory.
fn payload_root_for_exe_dir(exe_dir: &Path) -> std::path::PathBuf {
    exe_dir.join(RESOURCE_DIR_NAME).join(PAYLOAD_RESOURCE_SUBDIR)
}

/// Resolve the bundled-payload resource root at install time.
///
/// The orchestrator runs in both GUI and silent (headless) modes and has no
/// Tauri `AppHandle` in scope (see `commands::start_installation` /
/// `registry::run_silent_installation`), so the Tauri resource-path API is not
/// available here. Instead the root is resolved relative to the running
/// executable — the same `std::env::current_exe()` approach `registry.rs` uses
/// for the uninstall command — which works identically in both modes for a
/// bundled NSIS app: `<exe_dir>/resources/payload/`.
///
/// Returns an error string (attributed to the copy step) if the executable
/// path cannot be determined.
fn resolve_payload_resource_root() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("could not locate the installer executable: {}", e))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "installer executable has no parent directory".to_string())?;
    Ok(payload_root_for_exe_dir(exe_dir))
}

/// Step 2 — Copy tools (Req 5). Implemented via `bundle.rs`.
///
/// Resolves the bundled payload resource root (`<exe_dir>/resources/payload/`),
/// then hands the end-to-end copy to [`bundle::copy_payload`], which copies all
/// 16 tool `dist/` trees into the install directory with no network access
/// (Req 3.4 / 5.1), verifies every output is present and non-empty (Req 5.2),
/// and — on any failure — immediately deletes the partially copied outputs
/// before returning (Req 5.5). On failure this maps the [`bundle::CopyError`]
/// to a message that names the affected tool or copy operation (Req 5.4) and
/// returns `Err`, so the orchestrator fails fast (Req 9.3). On success the
/// install directory is left fully populated; it is the value already recorded
/// for uninstall (`install_path`), satisfying Req 5.6.
fn step_copy_tools(install_path: &str) -> Result<(), String> {
    let phase = Step::CopyTools.name();

    // Resolve where the bundled payload was unpacked next to the installer exe.
    let resource_root = resolve_payload_resource_root()?;
    logger::log_info(
        phase,
        &format!(
            "Copying bundled payload from {} into {}",
            resource_root.display(),
            install_path
        ),
    );

    // copy_payload performs the full copy → verify → rollback pipeline. Its
    // CopyError Display already names the affected tool / copy operation
    // (Req 5.4), and it has already rolled back any partial outputs by the time
    // it returns Err (Req 5.5), so here we only surface the message.
    match bundle::copy_payload(&resource_root, Path::new(install_path)) {
        Ok(()) => {
            logger::log_info(
                phase,
                "Copied and verified the bundled payload for all 16 tools",
            );
            Ok(())
        }
        Err(e) => Err(format!("Copy Tools failed: {}", e)),
    }
}

/// Step 3 — LM Studio plugin dirs (Req 6). Implemented by task 9.2 via
/// `lmstudio.rs`.
///
/// Will provision exactly one plugin directory per MCP server under
/// `~/.lmstudio/extensions/plugins/mcp/{server}/`, write the three required
/// files with the `_owner: "llm-toolkit"` marker, and remove orphaned/misnamed
/// owned directories while leaving foreign directories untouched (Req 6.4).
fn step_lm_studio_plugin_dirs(install_path: &str) -> Result<(), String> {
    let step = Step::LmStudioPluginDirs.name();

    // 1. Resolve the LM Studio MCP plugin root (Req 6.1). Attribute any failure
    //    to this step.
    let plugin_root = lmstudio::resolve_plugin_root()
        .map_err(|e| format!("{step}: failed to resolve LM Studio plugin root: {e}"))?;
    logger::log_info(
        step,
        &format!("Resolved LM Studio plugin root: {}", plugin_root.display()),
    );

    // 2. Build the bridge configs for the 16 canonical servers (Req 6.2). Env
    //    maps are intentionally empty here — per-tool env population is the
    //    EnvConfig step's job (task 10.2). This step provisions the plugin dirs
    //    and marker files.
    let servers = lmstudio::default_bridge_configs(Path::new(install_path));

    // 3. Provision exactly one plugin directory per server (Req 6.3, 6.4). On
    //    failure the message already names the affected server (Req 6.5) and the
    //    affected server's partial directory has already been rolled back
    //    (Req 6.6); propagate the error as-is.
    let result = lmstudio::provision_plugin_dirs(&plugin_root, &servers)?;

    logger::log_info(
        step,
        &format!(
            "Provisioned {} LM Studio plugin dir(s): {} (removed {} orphaned/legacy dir(s))",
            result.provisioned.len(),
            result.provisioned.join(", "),
            result.removed.len(),
        ),
    );
    Ok(())
}

/// Step 4 — Env config (Req 7). Implemented by task 10.2 via `config_gen.rs`.
///
/// Will derive per-tool environment configuration for all 16 tools from the
/// unified `llm-toolkit.config.yaml` model, write each user-scoped config
/// before the next tool, keep secrets out of world-readable locations, and on
/// failure report the affected tool and leave no partial config (Req 7.4).
fn step_env_config(install_path: &str) -> Result<(), String> {
    let step = Step::EnvConfig.name();

    // 1. Locate the unified Toolkit config.
    //
    //    `llm-toolkit.config.yaml` is *not* part of the bundled payload — the
    //    NSIS bundle ships only the 16 tool `dist/` trees (`payload/`, see
    //    `bundle.rs` / `tauri.conf.json`). So at install time a config file is
    //    normally absent. We nonetheless honor one if it has been placed in the
    //    install directory (e.g. an admin dropping a customized config next to
    //    the copied tools), reading `<install_path>/llm-toolkit.config.yaml`.
    //
    //    When no config file is present we fall back to `ToolkitConfig::default`
    //    — every section empty, so `derive_all` yields all 16 tools with their
    //    canonical `mcp-config.js` default env values. This satisfies Req 7.1
    //    (derive per-tool env for all 16) with sensible defaults rather than
    //    failing the install for a missing optional file.
    let config_path = Path::new(install_path).join("llm-toolkit.config.yaml");
    let config = if config_path.is_file() {
        match fs::read_to_string(&config_path) {
            Ok(yaml) => match config_gen::parse_toolkit_config(&yaml) {
                Ok(cfg) => {
                    logger::log_info(
                        step,
                        &format!("Loaded Toolkit config from {}", config_path.display()),
                    );
                    cfg
                }
                // A present-but-malformed config is a real error the operator
                // should see, not something to silently paper over.
                Err(e) => {
                    return Err(format!(
                        "Failed to parse Toolkit config {}: {}",
                        config_path.display(),
                        e
                    ));
                }
            },
            Err(e) => {
                return Err(format!(
                    "Failed to read Toolkit config {}: {}",
                    config_path.display(),
                    e
                ));
            }
        }
    } else {
        logger::log_info(
            step,
            "No llm-toolkit.config.yaml at install path — using canonical defaults for all 16 tools",
        );
        config_gen::ToolkitConfig::default()
    };

    // 2. Derive the per-tool env config for all 16 tools (pure; Req 7.1).
    let config_set = config_gen::derive_all(&config);

    // 3. Write each tool's config to the current-user-scoped config dir, one
    //    file fully before the next (Req 7.2), never into a world-readable
    //    location (Req 7.3). On failure the error already names the affected
    //    tool and cause and left no partial config for it (Req 7.4) — surface
    //    it so the orchestrator fails fast on this step (Req 9.3).
    match config_gen::write_all(&config_set) {
        Ok(written) => {
            logger::log_info(
                step,
                &format!("Wrote env config for {} tool(s)", written.len()),
            );
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Step 5 — Uninstall registration (Req 8). Implemented by task 12.1.
///
/// Writes the Windows uninstall registry entry (`DisplayName`, `DisplayVersion`,
/// `UninstallString`, `InstallLocation`, `Publisher` — Req 8.1/8.2) via
/// [`registry::write_uninstall_entry`]. On a registry-write failure the install
/// is aborted and the copied payload already written to the install directory is
/// rolled back (Req 8.3 / Property 6): every canonical tool output under the
/// install directory is removed via [`bundle::rollback_payload`] before the
/// error is returned, so a failed registration leaves no toolkit-owned payload
/// behind. Returning `Err` here makes the orchestrator fail-fast on this step
/// and report the registration failure by name (Req 9.3).
fn step_uninstall_registration(install_path: &str) -> Result<(), String> {
    let phase = Step::UninstallRegistration.name();

    match registry::write_uninstall_entry(install_path) {
        Ok(()) => {
            logger::log_info(phase, "Wrote uninstall registry entry");
            Ok(())
        }
        Err(e) => {
            // Registry write failed: abort the install and roll back the copied
            // payload already written to the install directory (Req 8.3). The
            // rollback is best-effort and must not mask the original failure.
            logger::log_error(
                phase,
                &format!(
                    "Failed to write uninstall registration: {} — rolling back copied payload",
                    e
                ),
            );
            bundle::rollback_payload(Path::new(install_path));
            Err(format!(
                "Uninstall registration failed: {}. The installation was aborted and the copied payload was removed.",
                e
            ))
        }
    }
}

// ─── Cancellation ────────────────────────────────────────────────────────────

/// Cancel an in-progress installation.
///
/// Sets the cancellation flag. The currently executing step will check this
/// flag at its next checkpoint and halt. Partial toolkit-owned files are
/// cleaned up.
pub fn cancel() -> bool {
    logger::log_info("installer", "Cancellation requested");
    cancelled_flag().store(true, Ordering::SeqCst);
    true
}

/// Check if cancellation has been requested.
fn is_cancelled() -> bool {
    cancelled_flag().load(Ordering::SeqCst)
}

/// Clean up partially installed components from the installation directory.
///
/// Removes toolkit-owned scratch/output directories left behind by a cancelled
/// or failed install. The parent install directory itself is preserved. The
/// per-step rollback of specific artifacts (copied payload, plugin dirs, config
/// files) is layered on top of this in later tasks (8.3, 9.2, 10.2, 12.3).
fn cleanup_installation(install_path: &str) {
    logger::log_info("installer", "Cleaning up partially installed components...");

    let path = Path::new(install_path);

    // Remove the downloads directory (runtime installers scratch space).
    let downloads_dir = path.join("downloads");
    if downloads_dir.exists() {
        if let Err(e) = fs::remove_dir_all(&downloads_dir) {
            logger::log_warn(
                "installer",
                &format!("Failed to remove downloads directory: {}", e),
            );
        }
    }

    logger::log_info("installer", "Cleanup completed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn test_step_names() {
        assert_eq!(Step::Runtimes.name(), "runtimes");
        assert_eq!(Step::CopyTools.name(), "copy-tools");
        assert_eq!(Step::LmStudioPluginDirs.name(), "lm-studio-plugin-dirs");
        assert_eq!(Step::EnvConfig.name(), "env-config");
        assert_eq!(Step::UninstallRegistration.name(), "uninstall-registration");
    }

    #[test]
    fn test_step_display_names() {
        assert_eq!(Step::Runtimes.display_name(), "Runtimes");
        assert_eq!(Step::CopyTools.display_name(), "Copy Tools");
        assert_eq!(
            Step::LmStudioPluginDirs.display_name(),
            "LM Studio Plugin Dirs"
        );
        assert_eq!(Step::EnvConfig.display_name(), "Env Config");
        assert_eq!(
            Step::UninstallRegistration.display_name(),
            "Uninstall Registration"
        );
    }

    #[test]
    fn test_steps_order() {
        // Exactly five steps, in the Req 9.1 order.
        assert_eq!(STEPS.len(), 5);
        assert_eq!(STEPS[0], Step::Runtimes);
        assert_eq!(STEPS[1], Step::CopyTools);
        assert_eq!(STEPS[2], Step::LmStudioPluginDirs);
        assert_eq!(STEPS[3], Step::EnvConfig);
        assert_eq!(STEPS[4], Step::UninstallRegistration);
    }

    #[test]
    fn test_step_name_values_match_data_model() {
        // The five names plus validation/complete are the only step string
        // values the frontend expects (design Data Models).
        let names: Vec<&str> = STEPS.iter().map(|s| s.name()).collect();
        assert_eq!(
            names,
            vec![
                "runtimes",
                "copy-tools",
                "lm-studio-plugin-dirs",
                "env-config",
                "uninstall-registration",
            ]
        );
    }

    #[test]
    fn test_cancel_sets_flag() {
        // Reset first
        cancelled_flag().store(false, Ordering::SeqCst);
        assert!(!is_cancelled());

        cancel();
        assert!(is_cancelled());

        // Reset for other tests
        cancelled_flag().store(false, Ordering::SeqCst);
    }

    #[test]
    fn test_run_installation_invalid_path() {
        // Reset cancel flag
        cancelled_flag().store(false, Ordering::SeqCst);

        let result = run_installation("");
        assert!(!result.success);
        assert_eq!(result.step, "validation");
        assert!(result.message.contains("Invalid installation path"));
    }

    #[test]
    fn test_run_installation_reports_runtimes_or_completes() {
        // Several steps now have real, environment-dependent behavior:
        // Step 1 (Runtimes) detects/provisions Node.js and Python; Step 2
        // (Copy Tools, task 8.3) resolves the bundled payload beside the exe
        // and copies it; and Step 5 (Uninstall Registration, task 12.1) writes
        // an HKLM registry key, which requires elevation. So the pipeline
        // outcome depends on the host: it either completes, or fails fast at
        // whichever of those steps first fails. In a plain test/dev run there
        // is no bundled payload beside the test binary, so Copy Tools is the
        // typical failure. The plugin-dirs/env-config seams in between remain
        // no-op stubs. Either way the orchestration must stay fail-fast: a
        // failure is reported against a real-behavior step and stops there.
        cancelled_flag().store(false, Ordering::SeqCst);

        let temp = std::env::temp_dir().join("llm_toolkit_test_complete");
        let _ = fs::remove_dir_all(&temp);
        let result = run_installation(&temp.to_string_lossy());

        if result.success {
            assert_eq!(result.step, "complete");
        } else {
            // Fail-fast: the steps with real behavior are runtimes, copy-tools,
            // and uninstall-registration, so any failure must be attributed to
            // one of them and stop the pipeline there.
            assert!(
                result.step == "runtimes"
                    || result.step == "copy-tools"
                    || result.step == "uninstall-registration",
                "expected a runtimes, copy-tools, or uninstall-registration failure, got step '{}': {}",
                result.step,
                result.message
            );
        }

        let _ = fs::remove_dir_all(&temp);
        cancelled_flag().store(false, Ordering::SeqCst);
    }

    #[test]
    fn test_cleanup_installation_removes_downloads_dir() {
        let temp = std::env::temp_dir().join("llm_toolkit_test_cleanup");
        let _ = fs::create_dir_all(temp.join("downloads"));
        let _ = fs::write(temp.join("downloads").join("test.bin"), "test");

        cleanup_installation(&temp.to_string_lossy());

        assert!(!temp.join("downloads").exists());

        // Cleanup the temp dir itself
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_is_cancelled_default_false() {
        cancelled_flag().store(false, Ordering::SeqCst);
        assert!(!is_cancelled());
    }

    #[test]
    fn test_payload_root_for_exe_dir_layout() {
        // For a bundled NSIS app the payload lives at
        // <exe_dir>/resources/payload/ (Req 5 resource resolution).
        let exe_dir = Path::new("C:\\Program Files\\LLM Toolkit");
        let root = payload_root_for_exe_dir(exe_dir);
        assert_eq!(root, exe_dir.join("resources").join("payload"));
        // The per-tool source is resolved as root/<server_name>/ by copy_payload.
        assert!(root.ends_with("payload"));
    }

    #[test]
    fn test_resolve_payload_resource_root_is_relative_to_current_exe() {
        // The resolver derives the payload root from the running executable, so
        // it must sit under <exe_dir>/resources/payload — matching the pure
        // helper's layout for whatever the current exe's directory is.
        let resolved = resolve_payload_resource_root().expect("resolve payload root");
        let exe = std::env::current_exe().expect("current exe");
        let exe_dir = exe.parent().expect("exe parent");
        assert_eq!(resolved, payload_root_for_exe_dir(exe_dir));
    }

    #[test]
    fn test_step_copy_tools_reports_missing_payload_by_message() {
        // In the test harness there is no bundled payload beside the test
        // binary, so copy_payload hits a missing-resource-root or missing-tool
        // failure. Whichever it is, step_copy_tools must surface it as a
        // "Copy Tools failed" error (Req 5.4) rather than silently succeeding,
        // and must NOT leave tool outputs behind (rollback — Req 5.5).
        cancelled_flag().store(false, Ordering::SeqCst);

        let temp = std::env::temp_dir().join("llm_toolkit_test_copy_tools");
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).expect("create temp install dir");

        let result = step_copy_tools(&temp.to_string_lossy());
        assert!(result.is_err(), "expected a copy failure without a real payload");
        let msg = result.unwrap_err();
        assert!(
            msg.starts_with("Copy Tools failed:"),
            "message must be attributed to the copy step: {msg}"
        );

        // Rollback contract: no canonical tool output remains in the install dir.
        let plan = bundle::verify_install_dir(&temp);
        assert!(
            plan.present.is_empty(),
            "a failed copy must leave no tool outputs behind, found: {:?}",
            plan.present
        );

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_orchestrate_all_succeed_runs_all_and_completes() {
        // When every step succeeds, all five run and the outcome is Complete.
        let mut executed: Vec<&'static str> = Vec::new();
        let outcome = orchestrate_steps(STEPS, |step| {
            executed.push(step.name());
            Ok(())
        });

        assert_eq!(outcome, OrchestrationOutcome::Complete);
        let all_names: Vec<&'static str> = STEPS.iter().map(|s| s.name()).collect();
        assert_eq!(executed, all_names);
    }

    // Feature: windows-installer-setup-exe, Property 14: Fail-fast pipeline
    //
    // For all choices of a failing step among the five provisioning steps, no
    // step after the failing one executes, and the reported failure identifies
    // the failed step by name.
    //
    // Validates: Requirements 9.3
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        #[test]
        fn prop_fail_fast_pipeline(fail_index in 0usize..STEPS.len()) {
            // Drive the pure orchestration core with an executor that fails at
            // exactly the generated step index and records every step it runs.
            let mut executed: Vec<&'static str> = Vec::new();
            let failed_step_name = STEPS[fail_index].name();
            let failure_message = format!("injected failure at step index {}", fail_index);

            let outcome = orchestrate_steps(STEPS, |step| {
                executed.push(step.name());
                if step.name() == failed_step_name {
                    Err(failure_message.clone())
                } else {
                    Ok(())
                }
            });

            // (3) The reported failure names the failed step by its .name().
            match &outcome {
                OrchestrationOutcome::Failed { failed_step, message } => {
                    prop_assert_eq!(*failed_step, failed_step_name);
                    prop_assert_eq!(message, &failure_message);
                }
                OrchestrationOutcome::Complete => {
                    prop_assert!(false, "expected a failure at index {}", fail_index);
                }
            }

            // (2) Every step BEFORE the failing one executed.
            let expected_executed: Vec<&'static str> =
                STEPS[..=fail_index].iter().map(|s| s.name()).collect();
            prop_assert_eq!(&executed, &expected_executed);

            // (1) No step AFTER the failing one executed.
            for step in &STEPS[fail_index + 1..] {
                prop_assert!(
                    !executed.contains(&step.name()),
                    "step '{}' after the failing step '{}' must not execute",
                    step.name(),
                    failed_step_name
                );
            }
            // The failing step itself did run; nothing past it did.
            prop_assert!(executed.contains(&failed_step_name));
            prop_assert_eq!(executed.len(), fail_index + 1);
        }
    }

    /// Error-attribution examples for runtime provisioning failures (Req 4.6).
    ///
    /// `step_runtimes` performs real detection/downloads, so a forced failure
    /// can't be unit-tested directly. Instead these tests exercise the pure
    /// reason-formatting helpers (`runtime_provision_reason`,
    /// `runtime_verification_failure`) that `step_runtimes` uses to build its
    /// failure messages. Each test asserts the message names the affected
    /// runtime AND the specific cause: absence, an unmet minimum version, or an
    /// installation error.
    mod runtime_error_attribution_tests {
        use super::*;
        use crate::dependency::DependencyStatus;

        // Build a DependencyStatus fixture for the given detection outcome.
        fn status(
            display_name: &str,
            installed: bool,
            installed_version: Option<&str>,
            minimum_version: &str,
            needs_download: bool,
        ) -> DependencyStatus {
            DependencyStatus {
                name: display_name.to_ascii_lowercase(),
                display_name: display_name.to_string(),
                installed,
                installed_version: installed_version.map(|v| v.to_string()),
                minimum_version: minimum_version.to_string(),
                needs_download,
            }
        }

        #[test]
        fn provision_reason_absent_names_runtime_and_absence() {
            // Node.js not detected at all -> reason must name the runtime and
            // attribute the cause to absence.
            let s = status("Node.js", false, None, "20.0.0", true);
            let reason = runtime_provision_reason(&s);

            assert!(reason.contains("Node.js"), "reason must name the runtime: {reason}");
            assert!(reason.contains("absent"), "reason must attribute absence: {reason}");
            // Absence is distinct from a below-minimum message.
            assert!(!reason.contains("below the minimum"), "absence must not read as below-min: {reason}");
        }

        #[test]
        fn provision_reason_below_minimum_names_runtime_versions_and_cause() {
            // Python present but too old -> reason names the runtime, the
            // detected version, the minimum, and the below-minimum cause.
            let s = status("Python", true, Some("3.9.0"), "3.11.0", true);
            let reason = runtime_provision_reason(&s);

            assert!(reason.contains("Python"), "reason must name the runtime: {reason}");
            assert!(reason.contains("below the minimum"), "reason must attribute below-min cause: {reason}");
            assert!(reason.contains("3.9.0"), "reason must state the detected version: {reason}");
            assert!(reason.contains("3.11.0"), "reason must state the minimum version: {reason}");
            assert!(!reason.contains("absent"), "below-min must not read as absent: {reason}");
        }

        #[test]
        fn verification_failure_absent_names_runtime_and_absence() {
            // Post-provisioning the runtime is still undetectable.
            let s = status("Node.js", false, None, "20.0.0", true);
            let msg = runtime_verification_failure(&s);

            assert!(msg.contains("Node.js"), "message must name the runtime: {msg}");
            assert!(msg.contains("verification failed"), "message must mark a verification failure: {msg}");
            assert!(msg.contains("absent"), "message must attribute absence: {msg}");
        }

        #[test]
        fn verification_failure_below_minimum_names_runtime_versions_and_cause() {
            // Post-provisioning the runtime is present but still below minimum.
            let s = status("Python", true, Some("3.10.0"), "3.11.0", true);
            let msg = runtime_verification_failure(&s);

            assert!(msg.contains("Python"), "message must name the runtime: {msg}");
            assert!(msg.contains("verification failed"), "message must mark a verification failure: {msg}");
            assert!(msg.contains("below the minimum"), "message must attribute below-min cause: {msg}");
            assert!(msg.contains("3.10.0"), "message must state the detected version: {msg}");
            assert!(msg.contains("3.11.0"), "message must state the minimum version: {msg}");
        }

        #[test]
        fn run_runtime_installer_error_names_runtime_and_install_error() {
            // A missing installer path makes the installer launch fail; the
            // error must name the runtime and attribute an installation error.
            let missing = Path::new("this-installer-does-not-exist-xyz.exe");
            let result = run_runtime_installer("Node.js", missing);

            let err = result.expect_err("launching a missing installer must fail");
            assert!(err.contains("Node.js"), "error must name the runtime: {err}");
            assert!(err.contains("installation error"), "error must attribute an install error: {err}");
        }
    }
}
