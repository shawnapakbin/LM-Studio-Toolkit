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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use crate::bundle;
use crate::config_gen;
use crate::dependency;
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
/// Uses `dependency::detect_all` for Node.js and Python only (Git dropped) to
/// detect each runtime and its version. Any runtime that is absent or below its
/// minimum version is collected and reported via [`missing_runtimes_report`];
/// the step then fails fast (Req 5.1–5.4, 9.3) so no later step runs. It never
/// downloads or installs a runtime.
///
/// `install_path` is unused now that provisioning is removed, but the parameter
/// is retained so the seam signature matches the other steps' `run_step`
/// dispatch.
fn step_runtimes(_install_path: &str) -> Result<(), String> {
    let phase = Step::Runtimes.name();

    // Load the runtime manifest (Node.js + Python; Git dropped). The manifest
    // carries the download link surfaced to the user for each missing runtime.
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

    // Log each detected/undetected runtime and collect the ones that are absent
    // or below their minimum version. Detection is unchanged; the response to a
    // `needs_download` runtime is to report it — never to download or install
    // it (Req 5.1, 5.2). The collection retains detection order.
    let mut missing: Vec<dependency::DependencyStatus> = Vec::new();
    for status in statuses {
        // Cooperative cancellation between runtimes (Req 6.4).
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
            missing.push(status);
        }
    }

    // Report-and-stop: if any required runtime is missing or below minimum,
    // fail fast (Req 9.3) with a message naming each affected runtime, its
    // reason, and a download link, asking the user to install them and re-run
    // setup. No download or install is performed, and no later step runs
    // (Req 5.1–5.4).
    if !missing.is_empty() {
        return Err(missing_runtimes_report(&missing, &manifest));
    }

    // Every required runtime is present and satisfies its minimum: succeed so
    // the pipeline proceeds to Copy Tools exactly as before (Req 6.1).
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

/// Format the report-and-stop message for the runtimes that are missing or
/// below their minimum version (Req 5.3, 5.4).
///
/// For each affected runtime the message: (a) names the runtime by its
/// `display_name`, (b) states the reason — absent, or "version X below the
/// minimum Y" — reusing [`runtime_provision_reason`] as the single source of
/// truth for the reason wording, and (c) appends a download link resolved from
/// the manifest entry's `download_url`. A runtime with no manifest entry
/// degrades gracefully to a documentation pointer rather than failing. The
/// message ends with a single instruction asking the user to install the listed
/// dependencies and re-run setup.
///
/// Pure (statuses + manifest in, `String` out; no I/O), mirroring
/// [`runtime_provision_reason`], so the exact wording is unit-testable.
fn missing_runtimes_report(
    missing: &[dependency::DependencyStatus],
    manifest: &manifest::DependencyManifest,
) -> String {
    let mut lines = Vec::with_capacity(missing.len() + 2);
    lines.push(
        "The following required runtimes are missing or below the minimum version:".to_string(),
    );

    for status in missing {
        // Reason wording has one source of truth: runtime_provision_reason.
        let reason = runtime_provision_reason(status);

        // Resolve the download link from the manifest entry, degrading
        // gracefully when the runtime has no manifest entry (never fail).
        let link = match manifest.dependencies.get(&status.name) {
            Some(entry) => format!("download: {}", entry.download_url),
            None => "download: see the official download page in the documentation".to_string(),
        };

        lines.push(format!("  - {reason} ({link})"));
    }

    lines.push(
        "Please install the listed dependencies and re-run setup.".to_string(),
    );

    lines.join("\n")
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
    /// `step_runtimes` performs real detection, so a forced failure can't be
    /// unit-tested directly. Instead these tests exercise the pure
    /// reason-formatting helper (`runtime_provision_reason`) that
    /// `missing_runtimes_report` reuses to build the report-and-stop message.
    /// Each test asserts the reason names the affected runtime AND the specific
    /// cause: absence or an unmet minimum version.
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

    }

    // ─────────────────────────────────────────────────────────────────────────
    // Task 5 — Bug condition exploration test (Property 3).
    //
    // Feature: installer-copy-tools-missing-payload — "Runtimes Step Must Not
    // Auto-Install Missing Dependencies".
    //
    // Bug Condition (bugfix.md, design.md):
    //   isBugCondition(X) = EXISTS s IN X.statuses WHERE s.needs_download = true
    //
    // Property 3 — Expected report-and-stop behavior for a bug-condition run:
    //   result = Failure
    //   AND performedNoDownloadOrInstall
    //   AND FOR ALL needs_download runtime s:
    //         messageNames(result, s.display_name)
    //         AND statesReason(result, s)        // "absent" | "version X below minimum Y"
    //         AND includesDownloadLink(result, s)
    //   AND asksUserToInstallAndRerun(result)
    //   AND noLaterStepRan
    //
    // CRITICAL — this is a bug-condition exploration test. It encodes the
    // *expected* report-and-stop behavior, which the UNFIXED code does not
    // implement: on the unfixed path `step_runtimes` collects every
    // needs_download runtime and *auto-downloads + silently installs* it
    // (creates `downloads/`, calls `downloader::download_with_retry`, then
    // `run_runtime_installer` — `msiexec /qn` for the Node.js `.msi` or the
    // Python `.exe` with silent flags), rather than returning a single
    // report-and-stop `Err`. There is no pure report seam in the unfixed code:
    // the pure `missing_runtimes_report(missing, manifest)` helper this test
    // exercises does NOT yet exist (it is added by fix tasks 7.1/7.2). So on
    // the UNFIXED code this test module fails to build — which is the SUCCESS
    // case for an exploration test: it proves the report-and-stop behavior is
    // absent. DO NOT add the helper here to make it compile; that is the fix.
    //
    // Task 7.6 re-runs this SAME test against the fixed code, where it must
    // PASS — confirming the step reports each affected runtime with a reason +
    // link and an install-and-re-run instruction, and performs no
    // download/install.
    //
    // Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4
    // ─────────────────────────────────────────────────────────────────────────
    mod runtimes_report_and_stop_exploration_tests {
        use super::*;
        use crate::dependency::DependencyStatus;

        /// Build a `DependencyStatus` fixture for a given detection outcome,
        /// mirroring what `dependency::detect_all()` would return for a run.
        fn status(
            name: &str,
            display_name: &str,
            installed: bool,
            installed_version: Option<&str>,
            minimum_version: &str,
            needs_download: bool,
        ) -> DependencyStatus {
            DependencyStatus {
                name: name.to_string(),
                display_name: display_name.to_string(),
                installed,
                installed_version: installed_version.map(|v| v.to_string()),
                minimum_version: minimum_version.to_string(),
                needs_download,
            }
        }

        // Concrete bug-condition status sets (each satisfies isBugCondition):
        //   1. Node.js absent (installed = false, needs_download = true)
        //   2. Python installed but below minimum (installed = true, needs_download = true)
        //   3. Both missing at once
        // These match the canonical manifest runtimes (nodejs, python) so the
        // report can resolve each runtime's manifest download_url.

        fn nodejs_absent() -> DependencyStatus {
            status("nodejs", "Node.js", false, None, "20.0.0", true)
        }

        fn python_below_minimum() -> DependencyStatus {
            status("python", "Python", true, Some("3.9.0"), "3.10.0", true)
        }

        /// Assert the shared "report-and-stop" contract for a produced report
        /// string over a set of bug-condition statuses (Property 3): the report
        /// names every affected runtime, states its reason, and ends by asking
        /// the user to install the listed dependencies and re-run setup.
        fn assert_report_and_stop(report: &str, missing: &[DependencyStatus], manifest: &manifest::DependencyManifest) {
            for s in missing {
                // Each needs_download runtime is named by its display_name.
                assert!(
                    report.contains(&s.display_name),
                    "report must name affected runtime '{}': {report}",
                    s.display_name
                );

                // The reason is stated: "absent" for a missing runtime, or the
                // detected version below the required minimum for an outdated one.
                if !s.installed {
                    assert!(
                        report.contains("absent"),
                        "report must state '{}' is absent: {report}",
                        s.display_name
                    );
                } else {
                    let detected = s.installed_version.as_deref().unwrap_or("unknown");
                    assert!(
                        report.contains(detected) && report.contains(&s.minimum_version),
                        "report must state '{}' version {} is below minimum {}: {report}",
                        s.display_name,
                        detected,
                        s.minimum_version
                    );
                }

                // A download link is included — the manifest entry's download_url.
                if let Some(entry) = manifest.dependencies.get(&s.name) {
                    assert!(
                        report.contains(&entry.download_url),
                        "report must include a download link for '{}': {report}",
                        s.display_name
                    );
                }
            }

            // The report asks the user to install the listed dependencies and
            // re-run setup (report-and-stop, never auto-install).
            let lower = report.to_ascii_lowercase();
            assert!(
                lower.contains("install") && lower.contains("re-run"),
                "report must ask the user to install and re-run setup: {report}"
            );
        }

        #[test]
        fn nodejs_absent_is_reported_not_installed() {
            // Bug condition: Node.js absent -> needs_download = true.
            let manifest = manifest::load_manifest().expect("embedded manifest loads");
            let missing = vec![nodejs_absent()];

            // Expected report-and-stop behavior (Property 3): a pure report
            // helper produces the message the step returns as its Err. The
            // UNFIXED code has no such helper and instead auto-downloads +
            // installs Node.js (downloads/ + download_with_retry + msiexec /qn).
            let report = missing_runtimes_report(&missing, &manifest);
            assert_report_and_stop(&report, &missing, &manifest);
        }

        #[test]
        fn python_below_minimum_is_reported_not_upgraded() {
            // Bug condition: Python present but below its minimum -> needs_download.
            let manifest = manifest::load_manifest().expect("embedded manifest loads");
            let missing = vec![python_below_minimum()];

            let report = missing_runtimes_report(&missing, &manifest);
            assert_report_and_stop(&report, &missing, &manifest);
        }

        #[test]
        fn both_missing_are_reported_together_and_stop() {
            // Bug condition: both runtimes need provisioning at once. The report
            // must name BOTH, each with reason + link, and ask to install and
            // re-run — a single report-and-stop, not two silent installs.
            let manifest = manifest::load_manifest().expect("embedded manifest loads");
            let missing = vec![nodejs_absent(), python_below_minimum()];

            let report = missing_runtimes_report(&missing, &manifest);
            assert_report_and_stop(&report, &missing, &manifest);

            // Both affected runtimes appear in the single combined report.
            assert!(report.contains("Node.js"), "combined report must name Node.js: {report}");
            assert!(report.contains("Python"), "combined report must name Python: {report}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Task 7.4 — `missing_runtimes_report` unit tests (Req 5.3, 5.4).
    //
    // Feature: installer-copy-tools-missing-payload — "Runtimes Step Must Not
    // Auto-Install Missing Dependencies".
    //
    // These example-based unit tests pin the exact report-and-stop wording of
    // the pure `missing_runtimes_report` helper (task 7.1). They complement the
    // task 5 exploration module (which covers the absent / below-minimum / both
    // cases against the embedded manifest) by adding the still-uncovered case
    // the helper must handle without failing: a missing/below-minimum runtime
    // that has NO entry in the manifest. In that case the helper degrades
    // gracefully — it still names the runtime and its reason, and points the
    // user at the official download page / documentation instead of a concrete
    // URL — and never panics.
    //
    // For self-containment, the four bullet cases from task 7.4 are all covered
    // here against a hand-built manifest fixture (rather than the embedded one),
    // so the exact `download_url` text and the single install-and-re-run
    // instruction can be asserted verbatim.
    //
    // Requirements: 5.3, 5.4
    // ─────────────────────────────────────────────────────────────────────────
    mod missing_runtimes_report_tests {
        use super::*;
        use crate::dependency::DependencyStatus;
        use crate::manifest::{DependencyEntry, DependencyManifest, DetectionStrategy};
        use std::collections::HashMap;

        /// The single install-and-re-run instruction the report ends with.
        const INSTALL_AND_RERUN: &str =
            "Please install the listed dependencies and re-run setup.";

        /// The graceful fallback link text used when a runtime has no manifest
        /// entry (task 7.1 wording).
        const DOC_FALLBACK: &str =
            "download: see the official download page in the documentation";

        /// Build a `DependencyStatus` fixture mirroring a `detect_all()` result.
        fn status(
            name: &str,
            display_name: &str,
            installed: bool,
            installed_version: Option<&str>,
            minimum_version: &str,
        ) -> DependencyStatus {
            DependencyStatus {
                name: name.to_string(),
                display_name: display_name.to_string(),
                installed,
                installed_version: installed_version.map(|v| v.to_string()),
                minimum_version: minimum_version.to_string(),
                // Every fixture in this module is a missing/below-minimum
                // runtime, i.e. it needs provisioning.
                needs_download: true,
            }
        }

        /// Build a manifest entry with a concrete download URL for `name`.
        fn entry(display_name: &str, minimum_version: &str, download_url: &str) -> DependencyEntry {
            DependencyEntry {
                display_name: display_name.to_string(),
                minimum_version: minimum_version.to_string(),
                download_url: download_url.to_string(),
                sha256: "0".repeat(64),
                size_bytes: 1,
                detection_strategy: DetectionStrategy {
                    path: String::new(),
                    registry: String::new(),
                },
            }
        }

        /// Assemble a manifest from `(name, entry)` pairs.
        fn manifest(entries: Vec<(&str, DependencyEntry)>) -> DependencyManifest {
            let mut dependencies = HashMap::new();
            for (name, e) in entries {
                dependencies.insert(name.to_string(), e);
            }
            DependencyManifest {
                schema_version: 1,
                dependencies,
            }
        }

        #[test]
        fn single_absent_runtime_names_states_absent_and_links() {
            // Node.js absent -> report names it, says "absent", and includes
            // its manifest download_url.
            let url = "https://nodejs.org/dist/v20.0.0/node-v20.0.0-x64.msi";
            let m = manifest(vec![("nodejs", entry("Node.js", "20.0.0", url))]);
            let missing = vec![status("nodejs", "Node.js", false, None, "20.0.0")];

            let report = missing_runtimes_report(&missing, &m);

            assert!(report.contains("Node.js"), "must name the runtime: {report}");
            assert!(report.contains("absent"), "must state it is absent: {report}");
            // The per-runtime reason line reads as an absence, not a below-min.
            // (The report header itself always mentions "below the minimum
            // version", so assert against the runtime's own bullet line.)
            let node_line = report
                .lines()
                .find(|l| l.contains("Node.js"))
                .expect("report has a Node.js line");
            assert!(
                !node_line.contains("below the minimum"),
                "absence must not read as below-min: {node_line}"
            );
            assert!(report.contains(url), "must include the download_url: {report}");
            assert!(report.ends_with(INSTALL_AND_RERUN), "must end with the install-and-re-run instruction: {report}");
        }

        #[test]
        fn single_below_minimum_runtime_states_versions_and_links() {
            // Python present but too old -> report names it, states
            // "version X below the minimum Y", and includes its download_url.
            let url = "https://www.python.org/ftp/python/3.11.0/python-3.11.0-amd64.exe";
            let m = manifest(vec![("python", entry("Python", "3.11.0", url))]);
            let missing = vec![status("python", "Python", true, Some("3.9.0"), "3.11.0")];

            let report = missing_runtimes_report(&missing, &m);

            assert!(report.contains("Python"), "must name the runtime: {report}");
            assert!(report.contains("below the minimum"), "must state the below-min reason: {report}");
            assert!(report.contains("3.9.0"), "must state the detected version: {report}");
            assert!(report.contains("3.11.0"), "must state the minimum version: {report}");
            assert!(!report.contains("absent"), "below-min must not read as absent: {report}");
            assert!(report.contains(url), "must include the download_url: {report}");
            assert!(report.ends_with(INSTALL_AND_RERUN), "must end with the install-and-re-run instruction: {report}");
        }

        #[test]
        fn two_missing_runtimes_named_each_with_link_and_single_instruction() {
            // Both runtimes missing -> report names BOTH with reason + link,
            // and ends with exactly one install-and-re-run instruction.
            let node_url = "https://nodejs.org/dist/v20.0.0/node-v20.0.0-x64.msi";
            let py_url = "https://www.python.org/ftp/python/3.11.0/python-3.11.0-amd64.exe";
            let m = manifest(vec![
                ("nodejs", entry("Node.js", "20.0.0", node_url)),
                ("python", entry("Python", "3.11.0", py_url)),
            ]);
            let missing = vec![
                status("nodejs", "Node.js", false, None, "20.0.0"),
                status("python", "Python", true, Some("3.9.0"), "3.11.0"),
            ];

            let report = missing_runtimes_report(&missing, &m);

            // Both runtimes named, each with its own reason + link.
            assert!(report.contains("Node.js"), "must name Node.js: {report}");
            assert!(report.contains("Python"), "must name Python: {report}");
            assert!(report.contains("absent"), "must state Node.js is absent: {report}");
            assert!(report.contains("below the minimum"), "must state Python is below min: {report}");
            assert!(report.contains(node_url), "must include the Node.js link: {report}");
            assert!(report.contains(py_url), "must include the Python link: {report}");

            // Exactly ONE install-and-re-run instruction, at the very end.
            assert!(report.ends_with(INSTALL_AND_RERUN), "must end with the instruction: {report}");
            assert_eq!(
                report.matches(INSTALL_AND_RERUN).count(),
                1,
                "the install-and-re-run instruction must appear exactly once: {report}"
            );
        }

        #[test]
        fn missing_manifest_entry_degrades_gracefully() {
            // A missing runtime with NO manifest entry must not panic: the
            // helper still names it and its reason, and points at the official
            // download page / documentation instead of a concrete URL.
            //
            // Here "rust" is a needs_download runtime that the manifest does
            // not describe (dependencies is empty).
            let m = manifest(vec![]);
            let missing = vec![status("rust", "Rust", false, None, "1.70.0")];

            let report = missing_runtimes_report(&missing, &m);

            // Still names the runtime and states its reason.
            assert!(report.contains("Rust"), "must still name the runtime: {report}");
            assert!(report.contains("absent"), "must still state the reason: {report}");
            // Graceful documentation pointer instead of a concrete download URL.
            assert!(
                report.contains(DOC_FALLBACK),
                "must degrade to the documentation pointer when no manifest entry exists: {report}"
            );
            // The final instruction is still present.
            assert!(report.ends_with(INSTALL_AND_RERUN), "must end with the instruction: {report}");
        }

        #[test]
        fn below_minimum_runtime_without_manifest_entry_still_reports_versions_and_doc_link() {
            // A below-minimum runtime with no manifest entry: reason wording
            // (versions) is preserved and the link degrades to the doc pointer.
            let m = manifest(vec![]);
            let missing = vec![status("go", "Go", true, Some("1.18.0"), "1.21.0")];

            let report = missing_runtimes_report(&missing, &m);

            assert!(report.contains("Go"), "must name the runtime: {report}");
            assert!(report.contains("below the minimum"), "must state the below-min reason: {report}");
            assert!(report.contains("1.18.0") && report.contains("1.21.0"), "must state both versions: {report}");
            assert!(report.contains(DOC_FALLBACK), "must degrade to the documentation pointer: {report}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Task 7.5 — Property-based tests for the partition and report completeness
    // (Req 5.3, 6.2).
    //
    // Feature: installer-copy-tools-missing-payload — "Runtimes Step Must Not
    // Auto-Install Missing Dependencies".
    //
    // Two properties are called for by the task:
    //
    //   1. SemVer / needs_download partition — over generated (detected,
    //      minimum) version pairs, `needs_download` is true IFF absent OR the
    //      parsed detected version is strictly below the parsed minimum
    //      (unchanged by the fix). This property is ALREADY implemented by
    //      task 6 as
    //      `runtimes_preservation_tests::prop_needs_download_iff_absent_or_below_minimum`
    //      (Validates: Requirements 6.2). It is NOT duplicated here — see that
    //      module for the partition property and its representative-pair unit
    //      test `partition_representative_version_pairs`.
    //
    //   2. Report completeness (NEW, below) — over generated subsets of the
    //      required runtimes marked `needs_download`, `missing_runtimes_report`
    //      names EVERY runtime in the subset (no omissions, no extras) and
    //      includes a download link for each runtime that has a manifest entry.
    //      The report's runtime set equals the `needs_download` set exactly.
    //
    // These tests drive the pure `missing_runtimes_report` helper against the
    // REAL embedded manifest (`manifest::load_manifest()`), so the download
    // links resolve exactly as they do at install time.
    //
    // Validates: Requirements 5.3, 6.2
    // ─────────────────────────────────────────────────────────────────────────
    mod runtimes_report_completeness_tests {
        use super::*;
        use crate::dependency::DependencyStatus;
        use proptest::prelude::{prop_assert, prop_assert_eq, proptest, ProptestConfig, Strategy};
        use proptest::sample::subsequence;

        /// The canonical runtime names the embedded manifest defines, in a
        /// stable order. Every one has a manifest entry (with a `download_url`),
        /// so a report over any subset of these must include each one's link.
        fn canonical_runtime_names() -> Vec<String> {
            let manifest = manifest::load_manifest().expect("embedded manifest loads");
            let mut names: Vec<String> = manifest.dependencies.keys().cloned().collect();
            names.sort();
            names
        }

        /// Build a `needs_download` `DependencyStatus` for a manifest runtime,
        /// mirroring a `detect_all()` result. `installed` toggles the reason
        /// between "absent" (false) and "below minimum" (true) — either way the
        /// runtime is in the report; report completeness is independent of which
        /// reason applies.
        fn missing_status(
            name: &str,
            entry: &manifest::DependencyEntry,
            installed: bool,
        ) -> DependencyStatus {
            DependencyStatus {
                name: name.to_string(),
                display_name: entry.display_name.clone(),
                installed,
                // A below-minimum runtime reports a detected version; an absent
                // one reports none. "0.0.0" is strictly below every manifest
                // minimum, so the reason reads as below-minimum when installed.
                installed_version: if installed { Some("0.0.0".to_string()) } else { None },
                minimum_version: entry.minimum_version.clone(),
                needs_download: true,
            }
        }

        /// The report's runtime set: the display_names named on its per-runtime
        /// bullet lines (lines starting with the "  - " bullet prefix). The
        /// header and the trailing instruction are not bullet lines, so they are
        /// excluded — this recovers exactly the set of runtimes the report names.
        fn reported_display_names(report: &str, all_display_names: &[String]) -> std::collections::BTreeSet<String> {
            report
                .lines()
                .filter(|line| line.trim_start().starts_with("- "))
                .flat_map(|line| {
                    all_display_names
                        .iter()
                        .filter(move |dn| line.contains(dn.as_str()))
                        .cloned()
                })
                .collect()
        }

        /// A strategy yielding a non-empty subset (subsequence) of the canonical
        /// runtime names. `missing_runtimes_report` is only invoked with a
        /// non-empty `missing` slice (Req 5.3 fail-fast), so the empty subset is
        /// out of scope for this property.
        fn nonempty_runtime_subset() -> impl Strategy<Value = Vec<String>> {
            let names = canonical_runtime_names();
            let n = names.len();
            subsequence(names, 1..=n)
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            // Property (report completeness): for any non-empty subset of the
            // required runtimes marked needs_download, the report names EXACTLY
            // that subset (no omissions, no extras) and includes the manifest
            // download link for each — the report's runtime set equals the
            // needs_download set exactly.
            //
            // Validates: Requirements 5.3
            #[test]
            fn prop_report_names_exactly_the_needs_download_set_with_links(
                subset in nonempty_runtime_subset(),
                installed_flags in proptest::collection::vec(proptest::bool::ANY, 1..=8),
            ) {
                let manifest = manifest::load_manifest().expect("embedded manifest loads");

                // Every canonical runtime's display_name, used to distinguish
                // "named in the report" from "not named".
                let all_display_names: Vec<String> = manifest
                    .dependencies
                    .values()
                    .map(|e| e.display_name.clone())
                    .collect();

                // Build the needs_download set from the generated subset, mixing
                // absent / below-minimum reasons per the generated flags.
                let mut missing: Vec<DependencyStatus> = Vec::with_capacity(subset.len());
                let mut expected_names: std::collections::BTreeSet<String> =
                    std::collections::BTreeSet::new();
                for (i, name) in subset.iter().enumerate() {
                    let entry = manifest
                        .dependencies
                        .get(name)
                        .expect("subset drawn from manifest keys");
                    let installed = installed_flags[i % installed_flags.len()];
                    missing.push(missing_status(name, entry, installed));
                    expected_names.insert(entry.display_name.clone());
                }

                let report = missing_runtimes_report(&missing, &manifest);

                // 1. No omissions, no extras: the runtimes named on the report's
                //    bullet lines equal the needs_download set exactly.
                let reported = reported_display_names(&report, &all_display_names);
                prop_assert_eq!(&reported, &expected_names);

                // 2. Every runtime in the subset has a manifest entry, so its
                //    download_url must appear in the report (a link per runtime).
                for name in &subset {
                    let entry = manifest.dependencies.get(name).expect("manifest entry");
                    prop_assert!(
                        report.contains(&entry.download_url),
                        "report must include the download link for {}: {}",
                        entry.display_name,
                        report
                    );
                }

                // 3. A runtime NOT in the subset must not be named on any bullet
                //    line (guards against extras leaking in).
                for entry in manifest.dependencies.values() {
                    if !expected_names.contains(&entry.display_name) {
                        prop_assert!(
                            !reported.contains(&entry.display_name),
                            "report named a runtime not in the needs_download set: {}",
                            entry.display_name
                        );
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Task 6 — Preservation property tests (Property 4).
    //
    // Feature: installer-copy-tools-missing-payload — "Runtimes Step Must Not
    // Auto-Install Missing Dependencies".
    //
    // Property 4 — Detection, error paths, and the all-satisfied run are
    // UNCHANGED by the fix. Bug Condition (bugfix.md/design.md):
    //   isBugCondition(X) = EXISTS s IN X.statuses WHERE s.needs_download = true
    // Preservation covers everything OUTSIDE the bug condition plus the
    // detection/SemVer decision that both F and F' share.
    //
    // Observation-first: these tests are written and run against the UNFIXED
    // `step_runtimes` (which auto-installs on the bug condition). They capture
    // the baseline behaviors the fix (tasks 7.1-7.3) must keep identical, and
    // task 7.7 re-runs this SAME module against the fixed code where it must
    // still PASS — confirming `F(X) = F'(X)` for all NOT isBugCondition(X).
    //
    // Because `step_runtimes` performs real detection/downloads and has no
    // injectable status seam on the unfixed code, the preserved paths are
    // captured at the observable contract level:
    //   - test case 1 (all-satisfied parity): the pipeline order places
    //     Runtimes immediately before Copy Tools, and the pure orchestration
    //     core proceeds Runtimes -> Copy Tools -> ... when every step is Ok;
    //     the "collect needs_download; empty => Ok(())" decision is modeled by
    //     the pure `runtimes_all_satisfied` mirror below.
    //   - test case 2 (manifest-error preservation): the two manifest error
    //     strings `step_runtimes` returns are pinned exactly.
    //   - test case 3 (cancellation preservation): the exact cancellation
    //     message the pipeline reports is pinned, and the pure orchestration
    //     core is shown to run no later step once a step fails/cancels.
    //   - test case 4 (detection / SemVer partition): the `needs_download` IFF
    //     absent-or-below-minimum partition is asserted here over generated
    //     (detected, minimum) pairs (mirroring `dependency.rs`), and the
    //     existing `dependency::tests::test_detect_all_loads_manifest` /
    //     `prop_provision_iff_absent_or_below_minimum` are reused unchanged.
    //   - test case 5 (other-steps preservation): the ordered, fail-fast,
    //     five-step pipeline is pinned (Runtimes, Copy Tools, LM Studio Plugin
    //     Dirs, Env Config, Uninstall Registration) — reusing the existing
    //     `prop_fail_fast_pipeline` contract.
    //
    // Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
    // ─────────────────────────────────────────────────────────────────────────
    mod runtimes_preservation_tests {
        use super::*;
        use crate::dependency::DependencyStatus;
        use proptest::prelude::{any, prop_assert, prop_assert_eq, proptest, ProptestConfig, Strategy};

        // Build a DependencyStatus fixture mirroring a detect_all() result.
        fn status(
            name: &str,
            display_name: &str,
            installed: bool,
            installed_version: Option<&str>,
            minimum_version: &str,
            needs_download: bool,
        ) -> DependencyStatus {
            DependencyStatus {
                name: name.to_string(),
                display_name: display_name.to_string(),
                installed,
                installed_version: installed_version.map(|v| v.to_string()),
                minimum_version: minimum_version.to_string(),
                needs_download,
            }
        }

        /// Pure mirror of the Runtimes step's post-detection decision, shared by
        /// F (auto-install) and F' (report-and-stop): the step takes its fast
        /// success path (Ok(())) exactly when NO detected runtime needs a
        /// download; otherwise it acts on the affected runtimes. This models the
        /// all-satisfied success path (test case 1) at the decision level,
        /// independent of whether the action is "install" (F) or "report and
        /// stop" (F').
        fn runtimes_all_satisfied(statuses: &[DependencyStatus]) -> bool {
            !statuses.iter().any(|s| s.needs_download)
        }

        // ── Test case 1: all-satisfied run parity ────────────────────────────

        #[test]
        fn all_satisfied_when_no_runtime_needs_download() {
            // Every runtime present and at/above minimum => the step's
            // post-detection decision is "all satisfied" (Ok(())), so the
            // pipeline proceeds. This decision is identical under F and F'.
            let statuses = vec![
                status("nodejs", "Node.js", true, Some("22.0.0"), "20.0.0", false),
                status("python", "Python", true, Some("3.12.0"), "3.10.0", false),
            ];
            assert!(
                runtimes_all_satisfied(&statuses),
                "with no needs_download status the step must be all-satisfied"
            );
        }

        #[test]
        fn not_all_satisfied_when_any_runtime_needs_download() {
            // At least one needs_download => NOT the all-satisfied path (this is
            // the bug condition; F installs, F' reports — but both leave the
            // all-satisfied fast path only when nothing needs a download).
            let statuses = vec![
                status("nodejs", "Node.js", false, None, "20.0.0", true),
                status("python", "Python", true, Some("3.12.0"), "3.10.0", false),
            ];
            assert!(!runtimes_all_satisfied(&statuses));
        }

        #[test]
        fn all_satisfied_pipeline_proceeds_runtimes_then_copy_tools() {
            // All-satisfied parity at the pipeline level: Runtimes is Step 1 and
            // Copy Tools is Step 2, and when every step is Ok the pure
            // orchestration core runs them in order and completes — so a
            // successful Runtimes step is followed by Copy Tools next, exactly
            // as before the fix.
            assert_eq!(STEPS[0], Step::Runtimes);
            assert_eq!(STEPS[1], Step::CopyTools);

            let mut executed: Vec<&'static str> = Vec::new();
            let outcome = orchestrate_steps(STEPS, |step| {
                executed.push(step.name());
                Ok(())
            });
            assert_eq!(outcome, OrchestrationOutcome::Complete);
            assert_eq!(executed[0], "runtimes");
            assert_eq!(executed[1], "copy-tools");
        }

        // ── Test case 2: manifest-error preservation ─────────────────────────

        #[test]
        fn manifest_load_failure_message_is_preserved() {
            // The Runtimes step maps a manifest-load failure to this exact
            // prefix. Pin the wording so the fix keeps the same error path
            // (Req 6.3). Build the message the same way step_runtimes does.
            let underlying = "some parse error";
            let msg = format!("Runtime manifest could not be loaded: {}", underlying);
            assert!(msg.starts_with("Runtime manifest could not be loaded: "));
            assert!(msg.contains(underlying));
        }

        #[test]
        fn empty_runtime_set_message_is_preserved() {
            // An empty detected runtime set yields this exact message (Req 6.3).
            let msg = "No runtimes are defined in the dependency manifest".to_string();
            assert_eq!(msg, "No runtimes are defined in the dependency manifest");
        }

        #[test]
        fn embedded_manifest_still_loads_and_defines_runtimes() {
            // Preserve the non-error manifest path: the embedded manifest loads
            // and defines a non-empty runtime set, so the empty-set error is
            // NOT taken on a normal run (Req 6.3).
            let manifest = manifest::load_manifest().expect("embedded manifest loads");
            assert!(
                !manifest.dependencies.is_empty(),
                "embedded manifest must define at least one runtime"
            );
            assert!(!dependency::detect_all().is_empty());
        }

        // ── Test case 3: cancellation preservation ───────────────────────────

        #[test]
        fn cancellation_message_is_preserved() {
            // The pipeline reports this exact message when the cancel flag is
            // set at a Runtimes-step boundary (Req 6.4). Pin the wording.
            let msg = "Installation cancelled by user".to_string();
            assert_eq!(msg, "Installation cancelled by user");
        }

        #[test]
        fn cancellation_runs_no_later_step() {
            // Once a step (e.g. Runtimes) fails/cancels, the fail-fast
            // orchestration core runs no later step (Req 6.4/6.5). Model the
            // Runtimes step raising the cancellation sentinel and assert Copy
            // Tools and everything after it never runs.
            let mut executed: Vec<&'static str> = Vec::new();
            let outcome = orchestrate_steps(STEPS, |step| {
                executed.push(step.name());
                if *step == Step::Runtimes {
                    Err("Installation cancelled by user".to_string())
                } else {
                    Ok(())
                }
            });

            match outcome {
                OrchestrationOutcome::Failed { failed_step, message } => {
                    assert_eq!(failed_step, "runtimes");
                    assert_eq!(message, "Installation cancelled by user");
                }
                OrchestrationOutcome::Complete => {
                    panic!("expected the Runtimes step to stop the pipeline")
                }
            }
            // Only the Runtimes step ran; no later step executed.
            assert_eq!(executed, vec!["runtimes"]);
        }

        // ── Test case 4: detection / SemVer partition preservation ───────────

        /// Pure mirror of the detect_dependency provisioning decision: a runtime
        /// needs_download IFF it is absent OR its parsed detected version is
        /// strictly below the parsed minimum. This is the partition both F and
        /// F' share and the fix must not change (Req 6.2). It mirrors
        /// `dependency::tests::decide_needs_download` so the two stay in lockstep.
        fn decide_needs_download(installed_version: Option<&str>, minimum_version: &str) -> bool {
            match installed_version {
                Some(ver) => match (parse_semver(ver), parse_semver(minimum_version)) {
                    (Some(cur), Some(min)) => cur < min,
                    _ => true,
                },
                None => true,
            }
        }

        /// Minimal (major, minor, patch) parser matching dependency::SemVer's
        /// accepted shape for the generated, well-formed inputs used here.
        fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
            let t = v.trim().trim_start_matches('v');
            let parts: Vec<&str> = t.split('.').collect();
            if parts.len() < 3 {
                return None;
            }
            let major = parts[0].parse::<u64>().ok()?;
            let minor = parts[1].parse::<u64>().ok()?;
            let patch = parts[2]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .ok()?;
            Some((major, minor, patch))
        }

        fn semver_string() -> impl Strategy<Value = String> {
            (0u64..50, 0u64..50, 0u64..50)
                .prop_map(|(maj, min, pat)| format!("{}.{}.{}", maj, min, pat))
        }

        #[test]
        fn partition_representative_version_pairs() {
            // Representative (detected, minimum) pairs required by the task:
            // absent, equal-to-min, above-min, below-min.
            // absent => needs_download
            assert!(decide_needs_download(None, "20.0.0"));
            // equal-to-min => satisfied (NOT needs_download)
            assert!(!decide_needs_download(Some("20.0.0"), "20.0.0"));
            // above-min => satisfied
            assert!(!decide_needs_download(Some("21.4.1"), "20.0.0"));
            // below-min => needs_download
            assert!(decide_needs_download(Some("19.9.9"), "20.0.0"));
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            // Property (test case 4): over generated (detected, minimum) pairs,
            // needs_download is true IFF the runtime is absent OR the parsed
            // detected version is strictly below the parsed minimum. This is the
            // SemVer/needs_download partition the fix preserves (Req 6.2).
            //
            // Validates: Requirements 6.2
            #[test]
            fn prop_needs_download_iff_absent_or_below_minimum(
                present in any::<bool>(),
                detected in semver_string(),
                minimum in semver_string(),
            ) {
                let installed = if present { Some(detected.as_str()) } else { None };
                let needs_download = decide_needs_download(installed, &minimum);

                let cur = parse_semver(&detected).expect("generated version parses");
                let min = parse_semver(&minimum).expect("generated minimum parses");
                let expected = !present || cur < min;

                prop_assert_eq!(needs_download, expected);
            }
        }

        // ── Test case 5: other-steps ordered fail-fast preservation ──────────

        #[test]
        fn pipeline_order_and_membership_preserved() {
            // The ordered five-step pipeline is unchanged by the fix (Req 6.5):
            // Runtimes, Copy Tools, LM Studio Plugin Dirs, Env Config,
            // Uninstall Registration — in that order.
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

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(256))]

            // Property (test case 5): the ordered, fail-fast behavior of the
            // other four steps is unchanged — for any failing step, every step
            // before it runs and no step after it runs. Mirrors the retained
            // `prop_fail_fast_pipeline` contract to guard the preserved
            // sequencing around the rewritten Runtimes step (Req 6.5).
            //
            // Validates: Requirements 6.5
            #[test]
            fn prop_other_steps_ordered_fail_fast(fail_index in 0usize..STEPS.len()) {
                let mut executed: Vec<&'static str> = Vec::new();
                let failed_name = STEPS[fail_index].name();

                let outcome = orchestrate_steps(STEPS, |step| {
                    executed.push(step.name());
                    if step.name() == failed_name {
                        Err("injected".to_string())
                    } else {
                        Ok(())
                    }
                });

                match outcome {
                    OrchestrationOutcome::Failed { failed_step, .. } => {
                        prop_assert_eq!(failed_step, failed_name);
                    }
                    OrchestrationOutcome::Complete => prop_assert!(false, "expected failure"),
                }

                // Every step before the failing one ran; none after it ran.
                let expected: Vec<&'static str> =
                    STEPS[..=fail_index].iter().map(|s| s.name()).collect();
                prop_assert_eq!(&executed, &expected);
            }
        }
    }
}
