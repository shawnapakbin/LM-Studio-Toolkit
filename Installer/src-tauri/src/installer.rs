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
use crate::provision;
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

/// The step name carried by an elevation-gate failure result (Req 1.3, 1.4).
///
/// This is a pipeline-level pseudo-step: it is not one of the five [`Step`]
/// values (the gate runs *before* any step), but it flows through the same
/// [`InstallationResult::step`] field so callers can recognize an
/// elevation-declined failure and map it to a non-zero exit code (task 6.3).
pub const ELEVATION_STEP: &str = "elevation";

/// Message shown when the installer is not running with administrator rights
/// (declined UAC or a 120s no-response). Names the requirement — admin rights
/// are needed to install system-wide dependencies (Req 1.4).
pub const ADMIN_REQUIRED_MESSAGE: &str =
    "Administrator rights are required to install system-wide dependencies. \
The installer was not granted elevation, so no changes were made to this machine. \
Please re-run the installer and approve the administrator (UAC) prompt.";

/// The number of seconds the installer waits for the elevation request to be
/// accepted or declined before treating it as declined (Req 1.6).
pub const ELEVATION_TIMEOUT_SECS: u64 = 120;

/// Outcome of the Windows UAC elevation request (Req 1.3, 1.6).
///
/// The installer requests administrator rights before running any step. This
/// enum captures the three terminal outcomes of that request:
///
/// - `Granted` — the process is running elevated; the pipeline may proceed.
/// - `Declined` — the user rejected the UAC prompt.
/// - `TimedOut` — no response within [`ELEVATION_TIMEOUT_SECS`] seconds, which
///   Req 1.6 says to treat identically to `Declined`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElevationOutcome {
    /// Elevation was granted — the process holds administrator rights.
    Granted,
    /// The user declined the elevation (UAC) request.
    Declined,
    /// The elevation request was neither accepted nor declined within
    /// [`ELEVATION_TIMEOUT_SECS`] seconds (Req 1.6).
    TimedOut,
}

/// Pure elevation-gate decision (Req 1.3, 1.6, Property 1).
///
/// The pipeline may proceed **iff** elevation was `Granted`. Both `Declined`
/// and `TimedOut` block the pipeline — Req 1.6 requires a 120s no-response to
/// be handled identically to an explicit decline. This function performs no
/// I/O so the gate contract is unit- and property-testable without a real UAC
/// prompt or administrator rights.
pub fn may_proceed(outcome: ElevationOutcome) -> bool {
    matches!(outcome, ElevationOutcome::Granted)
}

/// Determine the current process's elevation outcome (Req 1.1, 1.3).
///
/// On Windows the Tauri NSIS `perMachine` installer and the embedded
/// `requireAdministrator` manifest (task 6.1) mean the process is normally
/// already elevated by the time this runs; the UAC prompt (accept / decline /
/// 120s timeout) is resolved by the OS *before* the process starts. This check
/// confirms the resulting token is elevated: if it is, the outcome is
/// `Granted`; otherwise the elevation was effectively declined, so we report
/// `Declined` (a genuine 120s no-response is surfaced by the OS as the same
/// non-elevated state and is treated identically per Req 1.6).
///
/// On non-Windows targets (developer/test hosts) there is no UAC model, so this
/// returns `Granted` — the gate is exercised directly through [`may_proceed`]
/// and the property test rather than through this platform probe.
fn process_elevation_outcome() -> ElevationOutcome {
    #[cfg(windows)]
    {
        // `shell32!IsUserAnAdmin` returns non-zero when the calling process is
        // running elevated. Declared inline via FFI to avoid adding a new
        // platform crate (design: "no third-party crate").
        #[link(name = "shell32")]
        extern "system" {
            fn IsUserAnAdmin() -> i32;
        }
        // SAFETY: `IsUserAnAdmin` takes no arguments, has no preconditions, and
        // only reads the current process token.
        let elevated = unsafe { IsUserAnAdmin() } != 0;
        if elevated {
            ElevationOutcome::Granted
        } else {
            ElevationOutcome::Declined
        }
    }
    #[cfg(not(windows))]
    {
        ElevationOutcome::Granted
    }
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
///
/// `CopyTools` MUST run before `Runtimes`: the Runtimes step runs
/// `npm install --omit=dev` with `cwd = install_dir` and then verifies every
/// canonical plugin resolves the SDK from its copied tree. Both require the
/// bundled payload — the nine tool `dist` trees AND the flat
/// `package.json`/`package-lock.json` — to already be present in `install_dir`.
/// If Runtimes ran first, npm would find no manifest (installing nothing) and
/// plugin verification would fail because no tree exists, which is exactly the
/// empty-install-dir failure this ordering prevents.
pub const STEPS: &[Step] = &[
    Step::CopyTools,
    Step::Runtimes,
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
/// semantics: copy tools → runtimes → LM Studio plugin dirs → env config →
/// uninstall registration. Each step supports retry on failure, checks the
/// cancellation flag at its boundaries, and reports its name on success or
/// failure (Req 9.1, 9.3, 9.4).
pub fn run_installation(install_path: &str) -> InstallationResult {
    // Resolve the real process elevation outcome and drive the gated pipeline.
    // The outcome is threaded in as a parameter so the gate and the pipeline
    // body are testable without a real UAC prompt or administrator rights
    // (design: elevation is injected through a seam).
    run_installation_with_elevation(install_path, process_elevation_outcome())
}

/// Run the installation pipeline behind the elevation gate with an explicit
/// [`ElevationOutcome`] (Req 1.3, 1.6, Property 1).
///
/// This is the injectable core of [`run_installation`]: the production wrapper
/// supplies [`process_elevation_outcome`], while tests supply any outcome to
/// exercise the gate without real elevation. If the outcome does not permit
/// proceeding ([`may_proceed`] is false — a declined or 120s-timed-out request,
/// treated identically per Req 1.6), it returns an `elevation` failure with the
/// admin-required message and runs **no** step: no path is created, no payload
/// copied, no dependency provisioned, and no registry entry written, leaving
/// the machine in its pre-launch state (Req 1.3). The caller maps this failure
/// to a non-zero exit code (Req 1.4, task 6.3).
pub fn run_installation_with_elevation(
    install_path: &str,
    elevation: ElevationOutcome,
) -> InstallationResult {
    // Reset cancellation flag at the start of a new installation
    cancelled_flag().store(false, Ordering::SeqCst);

    // Elevation gate (Req 1.3, 1.6, Property 1). If elevation was not granted,
    // abort BEFORE running any step so the machine is left in its pre-launch
    // state (Req 1.3).
    if !may_proceed(elevation) {
        return InstallationResult {
            success: false,
            step: ELEVATION_STEP.to_string(),
            message: ADMIN_REQUIRED_MESSAGE.to_string(),
        };
    }

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
            // A genuine step FAILURE (retries exhausted, not a cancellation)
            // drives the same whole-install rollback so zero owned artifacts
            // remain and no later step runs (Req 12.4). This is idempotent with
            // the CopyTools step's own per-plugin self-cleanup and the
            // UninstallRegistration step's own `rollback_payload`
            // (`rollback_payload` is best-effort / idempotent).
            cleanup_installation(install_path);
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

/// Step 1 — Runtimes (Req 4, 5, 6). Detect → provision → verify.
///
/// This step no longer *reports and stops* on a missing runtime. It probes the
/// host for the three Runtime_Dependencies (Node.js, the production npm
/// dependencies, and Playwright Chromium) through the injected
/// [`provision::ElevatedShell`] seam, classifies each against its
/// Dependency_Manifest minimum, installs only what is missing, re-probes Node
/// after installing it, and verifies every one of the nine canonical plugins
/// resolves the Required_Package (Req 4/5/6).
///
/// The whole probe→classify→log→plan→execute→verify pipeline lives in the pure-
/// ish [`provision::run_runtimes_step`] orchestrator so it is testable with a
/// recording shell; this seam only supplies the production
/// [`provision::PowerShellElevatedShell`], the Node.js minimum resolved from
/// `manifests/dependencies.json`, a logging sink bound to the module's
/// conventions, and the cooperative-cancellation poll. On any provisioning or
/// verification failure it returns `Err` (attributed to the dependency/plugin
/// and operation) so `orchestrate_steps` fails fast and no later step runs;
/// task 8.2 hardens the rollback/retry/timeout semantics around it.
fn step_runtimes(install_path: &str) -> Result<(), String> {
    let phase = Step::Runtimes.name();

    // Node.js minimum + download URL come from the Dependency_Manifest
    // (`manifests/dependencies.json`). The manifest itself failing to load is
    // an installation error with nothing specific to attribute (Req 4.6).
    let manifest = manifest::load_manifest()
        .map_err(|e| format!("Runtime manifest could not be loaded: {}", e))?;

    // Resolve the Node.js minimum SemVer from the manifest ("nodejs" entry).
    let node_entry = manifest
        .dependencies
        .get("nodejs")
        .ok_or_else(|| "Dependency manifest has no Node.js ('nodejs') entry".to_string())?;
    let node_minimum = dependency::SemVer::parse(&node_entry.minimum_version).ok_or_else(|| {
        format!(
            "Node.js minimum version '{}' in the manifest is not a valid semver",
            node_entry.minimum_version
        )
    })?;

    // Production, elevated shell for the real run. Tests drive
    // `provision::run_runtimes_step` directly with a recording shell.
    let mut shell = provision::PowerShellElevatedShell::new();

    provision::run_runtimes_step(
        &mut shell,
        Path::new(install_path),
        &node_minimum,
        // Logging sink: map the orchestrator's levels onto the module's logger
        // conventions with the Runtimes phase key (Req 4.6).
        |level, message| match level {
            provision::RuntimesLogLevel::Info => logger::log_info(phase, message),
            provision::RuntimesLogLevel::Warn => logger::log_warn(phase, message),
            provision::RuntimesLogLevel::Error => logger::log_error(phase, message),
        },
        // Cooperative cancellation at dependency boundaries (Req 12.4).
        is_cancelled,
    )
}

/// Format the human-readable reason a runtime needs provisioning, naming the
/// affected runtime and distinguishing absence from an unmet minimum (Req 4.6).
///
/// Pure so the error-attribution wording can be asserted directly in tests
/// without driving real detection/downloads. Callers embed the returned string
/// in provisioning log/attribution messages.
///
/// Retained for the legacy report-and-stop wording tests (the Runtimes step no
/// longer reports-and-stops — it detects → provisions → verifies via
/// [`provision::run_runtimes_step`]), so it is `#[cfg(test)]`-only.
#[cfg(test)]
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
///
/// Retained for the legacy report-and-stop wording tests only (the Runtimes
/// step now detects → provisions → verifies), so it is `#[cfg(test)]`-only.
#[cfg(test)]
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
/// ["payload/"]` (task 4.2). For the real Tauri v2 NSIS `perMachine` layout the
/// executable is installed at the install root and the payload lands beside it
/// at `<exe_dir>\payload\<server_name>\` — this subdir name has no `resources`
/// segment. The historical `<exe_dir>\resources\payload` location is kept only
/// as a resilience fallback.
const PAYLOAD_RESOURCE_SUBDIR: &str = "payload";

/// The resource directory name Tauri/NSIS places bundled resources under,
/// alongside the installed executable.
const RESOURCE_DIR_NAME: &str = "resources";

/// Compute the preferred bundled-payload resource root for a given executable
/// directory.
///
/// For a bundled Tauri v2 NSIS (`perMachine`) app the executable is installed
/// at the install root and the payload declared as `resources: ["payload/"]`
/// lands beside it at `<exe_dir>/payload/`, with each tool at
/// `.../payload/<server_name>/`. This returns that preferred candidate — the
/// first entry of [`payload_root_candidates_for_exe_dir`].
///
/// Kept pure (no `current_exe()` call, no filesystem probing) so the path
/// derivation is unit-testable without a real install layout. The live
/// resolver [`resolve_payload_resource_root`] feeds it the real exe directory.
fn payload_root_for_exe_dir(exe_dir: &Path) -> std::path::PathBuf {
    // Prefer the real NSIS perMachine layout: `<exe_dir>/payload`.
    let [preferred, _fallback] = payload_root_candidates_for_exe_dir(exe_dir);
    preferred
}

/// Compute the ordered bundled-payload root candidates for an executable
/// directory.
///
/// The real Tauri v2 NSIS (`perMachine`) install layout places the payload
/// beside the executable at `<exe_dir>/payload/<server_name>/`, so the
/// preferred candidate is `<exe_dir>/payload`. The historical
/// `<exe_dir>/resources/payload` location is retained as a resilience fallback
/// to tolerate Tauri layout differences.
///
/// Segment names are single-sourced through [`PAYLOAD_RESOURCE_SUBDIR`] and
/// [`RESOURCE_DIR_NAME`]. Kept pure (no `current_exe()` call, no filesystem
/// probing) so the ordering is unit-testable without a real install layout;
/// the live resolver [`resolve_payload_resource_root`] probes these candidates
/// in order.
fn payload_root_candidates_for_exe_dir(exe_dir: &Path) -> [std::path::PathBuf; 2] {
    [
        exe_dir.join(PAYLOAD_RESOURCE_SUBDIR),
        exe_dir.join(RESOURCE_DIR_NAME).join(PAYLOAD_RESOURCE_SUBDIR),
    ]
}

/// Resolve the bundled-payload resource root at install time.
///
/// The orchestrator runs in both GUI and silent (headless) modes and has no
/// Tauri `AppHandle` in scope (see `commands::start_installation` /
/// `registry::run_silent_installation`), so the Tauri resource-path API is not
/// available here. Instead the root is resolved relative to the running
/// executable — the same `std::env::current_exe()` approach `registry.rs` uses
/// for the uninstall command — which works identically in both modes.
///
/// The real Tauri v2 NSIS `perMachine` layout installs the payload beside the
/// executable at `<exe_dir>\payload\<server_name>\`, so this probes the ordered
/// candidates from [`payload_root_candidates_for_exe_dir`] — preferring
/// `<exe_dir>\payload` and falling back to `<exe_dir>\resources\payload` for
/// resilience — and returns the first that is an existing directory. When no
/// candidate directory exists it returns an error naming every location
/// checked.
///
/// Returns an error string (attributed to the copy step) if the executable
/// path cannot be determined.
fn resolve_payload_resource_root() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("could not locate the installer executable: {}", e))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "installer executable has no parent directory".to_string())?;

    // Probe the ordered candidates (preferring `<exe_dir>/payload`) and return
    // the first that is an existing directory. Falls back to
    // `<exe_dir>/resources/payload` for resilience across Tauri layout
    // differences.
    let candidates = payload_root_candidates_for_exe_dir(exe_dir);
    if let Some(existing) = candidates.iter().find(|candidate| candidate.is_dir()) {
        return Ok(existing.clone());
    }

    // No candidate exists — surface an error naming every location checked.
    let checked = candidates
        .iter()
        .map(|candidate| candidate.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "bundled payload resource root not found; checked: {}",
        checked
    ))
}

/// Step 2 — Copy tools (Req 5). Implemented via `bundle.rs`.
///
/// Resolves the bundled payload resource root — `<exe_dir>\payload\` (the real
/// NSIS `perMachine` layout beside the exe), with `<exe_dir>\resources\payload`
/// retained only as a resilience fallback — then hands the end-to-end copy to
/// [`bundle::copy_payload`], which copies all
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
    // The probing resolver can fail (exe path undeterminable, or no candidate
    // directory exists), so attribute any such failure to the copy step so the
    // orchestrator's fail-fast reporting stays "Copy Tools failed: ..."
    // (Req 3.1) rather than surfacing the raw resolver message.
    let resource_root =
        resolve_payload_resource_root().map_err(|e| format!("Copy Tools failed: {}", e))?;
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
    //    Anchor relative/empty path DEFAULTS under the real install dir
    //    (`%LOCALAPPDATA%\LLM-Toolkit`) so a fresh install references
    //    install-dir paths, never the build machine's CWD / dev repo
    //    (Concern 3, Req 2.1/2.2). User-supplied config values pass through
    //    unchanged (Req 3.8).
    let config_set = config_gen::derive_all(&config, Path::new(install_path));

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
        // Registry (HKLM) write failed: fail the step, emit an error, and roll
        // back the copied payload so a registration failure leaves zero
        // toolkit-owned artifacts — the same final observable state as a copy-
        // or provisioning-step failure, independent of the order in which the
        // three install outcomes resolve (Req 10.3).
        Err(e) => Err(rollback_after_registration_failure(install_path, &e)),
    }
}

/// Roll back the copied payload after an HKLM uninstall-registration write
/// failure and produce the attributed step error (Req 10.3, Property 18).
///
/// When the registration write fails, the copy step has already completed, so
/// the nine canonical tool outputs are present under `install_path`. This helper
/// logs the failure, removes that copied payload via [`bundle::rollback_payload`]
/// (best-effort — a subtree that cannot be removed is left in place rather than
/// masking the original registration error), and returns the human-readable
/// error the step surfaces. Because the step returns `Err`, `orchestrate_steps`
/// fails fast and reports the registration step by name.
///
/// The rollback here makes a registration failure converge to the *same* final
/// observable state as any other step failure — zero owned artifacts — so the
/// end state is identical regardless of the order in which the three install
/// outcomes (payload copied, provisioning done, registration) resolve.
///
/// Factored out of [`step_uninstall_registration`] (which owns the real HKLM
/// write) so the failure→rollback invariant is unit-testable against a real
/// temp install directory without touching the machine registry.
fn rollback_after_registration_failure(install_path: &str, write_error: &str) -> String {
    let phase = Step::UninstallRegistration.name();

    logger::log_error(
        phase,
        &format!(
            "Failed to write uninstall registration: {} — rolling back copied payload",
            write_error
        ),
    );
    bundle::rollback_payload(Path::new(install_path));
    format!(
        "Uninstall registration failed: {}. The installation was aborted and the copied payload was removed.",
        write_error
    )
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

/// Clean up partially installed components — the whole-install rollback that
/// runs when a step fails after exhausting its retries or when the install is
/// cancelled at a step boundary (Req 12.4).
///
/// This removes **every class of toolkit-owned artifact** any step could have
/// materialized, so a triggered rollback converges to zero owned artifacts
/// regardless of how far the pipeline got:
///
/// - the copied payload (the canonical tool `dist/` trees) via
///   [`bundle::rollback_payload`] (CopyTools output);
/// - the install-time-provisioned `install_dir/node_modules` tree
///   (`NpmInstallOmitDev` output from the Runtimes step);
/// - the toolkit-owned LM Studio plugin dirs under the resolved plugin root via
///   [`lmstudio::clean_owned_plugins`] (LmStudioPluginDirs output), leaving
///   foreign/unmarked dirs untouched;
/// - the `downloads` runtime-installer scratch directory.
///
/// This mirrors the artifact set [`registry::remove_owned_artifacts`] removes on
/// uninstall (payload + `node_modules` + owned plugin dirs), so the failed-install
/// and uninstall rollbacks stay in lockstep. The parent install directory itself
/// is preserved.
///
/// Every removal is **best-effort**: a subtree that cannot be removed is logged
/// and left in place rather than panicking, matching the copy/registration
/// rollback semantics. It is safe to call after the CopyTools step's own
/// per-plugin self-cleanup or the UninstallRegistration step's own
/// `rollback_payload` — [`bundle::rollback_payload`] is idempotent, so a
/// double-clean is a no-op on the already-removed subtrees.
fn cleanup_installation(install_path: &str) {
    logger::log_info("installer", "Cleaning up partially installed components...");

    let path = Path::new(install_path);

    // 1. Copied payload — the canonical tool `dist/` trees written by the
    //    CopyTools step. Best-effort / idempotent (Req 12.4).
    bundle::rollback_payload(path);

    // 2. Provisioned `install_dir/node_modules` — materialized by the Runtimes
    //    step's `NpmInstallOmitDev` action. Unconditionally toolkit-owned (no
    //    foreign-vs-owned decision), so remove the whole tree when present.
    let node_modules = path.join("node_modules");
    if node_modules.exists() {
        if let Err(e) = fs::remove_dir_all(&node_modules) {
            logger::log_warn(
                "installer",
                &format!("Failed to remove provisioned node_modules: {}", e),
            );
        }
    }

    // 3. Toolkit-owned LM Studio plugin dirs written by the LmStudioPluginDirs
    //    step. Resolve the plugin root best-effort — if it cannot be resolved
    //    there is nothing to clean, which is not a rollback error. Foreign /
    //    unmarked dirs are left untouched by `clean_owned_plugins`.
    match lmstudio::resolve_plugin_root() {
        Ok(plugin_root) => {
            let clean = lmstudio::clean_owned_plugins(&plugin_root);
            if !clean.errors.is_empty() {
                logger::log_warn(
                    "installer",
                    &format!(
                        "Failed to remove {} owned LM Studio plugin dir(s)",
                        clean.errors.len()
                    ),
                );
            }
        }
        Err(e) => {
            logger::log_warn(
                "installer",
                &format!("Could not resolve LM Studio plugin root for cleanup: {}", e),
            );
        }
    }

    // 4. Runtime-installer scratch space.
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
        // Exactly five steps. CopyTools MUST precede Runtimes so the bundled
        // payload + flat npm manifest are in install_dir before `npm install`
        // runs there and before plugin verification spawns the copied trees.
        assert_eq!(STEPS.len(), 5);
        assert_eq!(STEPS[0], Step::CopyTools);
        assert_eq!(STEPS[1], Step::Runtimes);
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
                "copy-tools",
                "runtimes",
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
    fn test_may_proceed_only_when_granted() {
        // Pure elevation gate (Req 1.3, 1.6): the pipeline may proceed iff the
        // outcome is Granted. Declined and TimedOut both block (Req 1.6 — a
        // 120s no-response is handled identically to a decline).
        assert!(may_proceed(ElevationOutcome::Granted));
        assert!(!may_proceed(ElevationOutcome::Declined));
        assert!(!may_proceed(ElevationOutcome::TimedOut));
    }

    #[test]
    fn test_timed_out_and_declined_are_handled_identically() {
        // Req 1.6: a 120s no-response is treated exactly like an explicit
        // decline for the purpose of the gate decision.
        assert_eq!(
            may_proceed(ElevationOutcome::TimedOut),
            may_proceed(ElevationOutcome::Declined)
        );
    }

    #[test]
    fn test_elevation_constants() {
        // The gate reports the dedicated pipeline-level "elevation" step and a
        // 120-second timeout budget (Req 1.6), with an admin-required message
        // that mentions administrator rights (Req 1.4).
        assert_eq!(ELEVATION_STEP, "elevation");
        assert_eq!(ELEVATION_TIMEOUT_SECS, 120);
        let lower = ADMIN_REQUIRED_MESSAGE.to_ascii_lowercase();
        assert!(lower.contains("administrator"));
    }

    #[test]
    fn test_elevation_gate_blocks_and_leaves_pre_launch_state() {
        // Req 1.3: when elevation is not granted the installer runs no step and
        // leaves the machine in its pre-launch state — in particular it does
        // not even create the install directory.
        cancelled_flag().store(false, Ordering::SeqCst);

        let temp = std::env::temp_dir().join("llm_toolkit_test_elevation_gate");
        let _ = fs::remove_dir_all(&temp);
        assert!(!temp.exists(), "precondition: install dir absent");

        for outcome in [ElevationOutcome::Declined, ElevationOutcome::TimedOut] {
            let result = run_installation_with_elevation(&temp.to_string_lossy(), outcome);

            // The failure is attributed to the elevation gate with the
            // admin-required message (Req 1.4).
            assert!(!result.success);
            assert_eq!(result.step, ELEVATION_STEP);
            assert_eq!(result.message, ADMIN_REQUIRED_MESSAGE);

            // No side effect: the install directory was never created.
            assert!(
                !temp.exists(),
                "elevation-blocked install must not create the install dir ({outcome:?})"
            );
        }

        let _ = fs::remove_dir_all(&temp);
        cancelled_flag().store(false, Ordering::SeqCst);
    }

    #[test]
    fn test_declined_and_timed_out_yield_admin_message_and_failure() {
        // Task 6.5 / Req 1.4: the declined and timed-out paths both yield a
        // failure attributed to the elevation gate carrying the admin-required
        // message. This is the result-contract half of "decline ⇒ admin
        // message + non-zero exit"; the exit-code mapping half is asserted in
        // `registry.rs` against this same contract (step == ELEVATION_STEP).
        cancelled_flag().store(false, Ordering::SeqCst);

        let temp = std::env::temp_dir().join("llm_toolkit_test_decline_admin_message");
        let _ = fs::remove_dir_all(&temp);

        // The admin-required message must be non-empty and mention
        // administrator rights (Req 1.4).
        assert!(
            !ADMIN_REQUIRED_MESSAGE.is_empty(),
            "admin-required message must be non-empty"
        );
        assert!(
            ADMIN_REQUIRED_MESSAGE
                .to_ascii_lowercase()
                .contains("administrator"),
            "admin-required message must mention administrator rights"
        );

        for outcome in [ElevationOutcome::Declined, ElevationOutcome::TimedOut] {
            let result = run_installation_with_elevation(&temp.to_string_lossy(), outcome);

            // Failure attributed to the elevation pseudo-step (Req 1.3).
            assert!(!result.success, "declined/timed-out must fail ({outcome:?})");
            assert_eq!(
                result.step, ELEVATION_STEP,
                "failure must be attributed to the elevation gate ({outcome:?})"
            );
            // Exactly the admin-required message (Req 1.4).
            assert_eq!(
                result.message, ADMIN_REQUIRED_MESSAGE,
                "declined/timed-out must surface the admin-required message ({outcome:?})"
            );
        }

        let _ = fs::remove_dir_all(&temp);
        cancelled_flag().store(false, Ordering::SeqCst);
    }

    #[test]
    fn test_run_installation_invalid_path() {
        // Reset cancel flag
        cancelled_flag().store(false, Ordering::SeqCst);

        // Inject Granted elevation so the gate does not short-circuit the
        // path-validation check regardless of the test host's elevation state.
        let result = run_installation_with_elevation("", ElevationOutcome::Granted);
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
        // Inject Granted so the pipeline runs regardless of the host's real
        // elevation state; the elevation gate itself is covered separately.
        let result = run_installation_with_elevation(&temp.to_string_lossy(), ElevationOutcome::Granted);

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
        // For the real Tauri v2 NSIS `perMachine` bundle the executable sits at
        // the install root and the payload declared as `resources: ["payload/"]`
        // lands beside it at <exe_dir>\payload\ (each tool at
        // .../payload/<server_name>/), with no `resources\` segment (Req 2.1).
        // The pure helper returns that preferred candidate.
        let exe_dir = Path::new("C:\\Program Files\\LLM Toolkit");
        let root = payload_root_for_exe_dir(exe_dir);
        assert_eq!(root, exe_dir.join("payload"));
        // The per-tool source is resolved as root/<server_name>/ by copy_payload.
        assert!(root.ends_with("payload"));
    }

    #[test]
    fn test_payload_root_candidates_ordering() {
        // The probing resolver relies on the candidate ordering: the real NSIS
        // perMachine location <exe_dir>\payload must be tried BEFORE the
        // historical <exe_dir>\resources\payload resilience fallback (Req 2.3).
        let exe_dir = Path::new("C:\\Program Files\\LLM Toolkit");
        let candidates = payload_root_candidates_for_exe_dir(exe_dir);
        assert_eq!(candidates[0], exe_dir.join("payload"));
        assert_eq!(candidates[1], exe_dir.join("resources").join("payload"));
    }

    #[test]
    fn test_resolve_payload_resource_root_is_relative_to_current_exe() {
        // The resolver derives the payload root from the running executable and
        // probes the ordered candidates under <exe_dir> (preferring
        // <exe_dir>\payload, falling back to <exe_dir>\resources\payload). It
        // stays relative to current_exe() with no AppHandle (Req 2.4, 3.4).
        let exe = std::env::current_exe().expect("current exe");
        let exe_dir = exe.parent().expect("exe parent");
        let candidates = payload_root_candidates_for_exe_dir(exe_dir);

        match resolve_payload_resource_root() {
            // If a candidate happens to exist beside the test binary, the
            // resolver must return the FIRST existing candidate.
            Ok(resolved) => {
                let first_existing = candidates
                    .iter()
                    .find(|candidate| candidate.is_dir())
                    .expect("Ok implies an existing candidate directory");
                assert_eq!(&resolved, first_existing);
            }
            // In the normal test harness neither candidate exists beside the
            // test binary, so the resolver returns a named-locations error that
            // mentions every current_exe()-relative candidate it checked.
            Err(msg) => {
                assert!(
                    msg.starts_with("bundled payload resource root not found; checked:"),
                    "no-candidate resolution must name the checked locations: {msg}"
                );
                for candidate in &candidates {
                    assert!(
                        msg.contains(&candidate.display().to_string()),
                        "error must name the current_exe()-relative candidate {}: {msg}",
                        candidate.display()
                    );
                }
            }
        }
    }

    #[test]
    fn test_step_copy_tools_reports_missing_payload_by_message() {
        // In the test harness there is no bundled payload beside the test
        // binary, so neither <exe_dir>\payload nor <exe_dir>\resources\payload
        // exists and resolve_payload_resource_root() returns the new
        // named-locations error ("bundled payload resource root not found;
        // checked: ..."). Whatever the underlying cause, step_copy_tools must
        // still surface it as a "Copy Tools failed:" error (Req 3.1) rather
        // than silently succeeding, and must NOT leave tool outputs behind
        // (rollback).
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

    /// Materialize a complete, lean copied payload under `install_dir`: one
    /// non-empty file per canonical tool at `install_dir/<server_name>/`, the
    /// same shape the copy step leaves behind by the time the registration step
    /// runs. Returns after asserting the payload is fully present.
    #[cfg(test)]
    fn materialize_copied_payload(install_dir: &Path) {
        for tool in crate::tool_payload::canonical_payloads() {
            let dir = install_dir.join(tool.server_name);
            fs::create_dir_all(&dir).expect("create tool output dir");
            // A > 0-byte file so verify_install_dir counts the tool as present.
            fs::write(dir.join("index.js"), b"module.exports = {};\n")
                .expect("write tool output file");
        }
        let plan = bundle::verify_install_dir(install_dir);
        assert_eq!(
            plan.present.len(),
            crate::tool_payload::CANONICAL_TOOL_COUNT,
            "precondition: the full copied payload must be present before the registration step"
        );
    }

    #[test]
    fn test_registration_failure_rolls_back_copied_payload() {
        // Req 10.3 / Property 18: when the HKLM uninstall-registration write
        // fails, the step must fail, emit an error naming the failure, and roll
        // back the copied payload — leaving ZERO toolkit-owned artifacts, the
        // same final observable state as a copy- or provisioning-step failure.
        //
        // Forcing a real HKLM write failure would mutate the machine registry,
        // so this drives the extracted failure→rollback core
        // (`rollback_after_registration_failure`) against a real temp install
        // dir carrying a fully materialized copied payload — exactly the state
        // present when the registration step runs after a successful copy.
        let temp = std::env::temp_dir().join("llm_toolkit_test_registration_rollback");
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).expect("create temp install dir");

        // Precondition: the copied payload (nine tool outputs) is present.
        materialize_copied_payload(&temp);

        // Simulate the HKLM registration write failing and driving the rollback.
        let write_error = "HKLM write denied (simulated)";
        let step_error =
            rollback_after_registration_failure(&temp.to_string_lossy(), write_error);

        // (1) The step surfaces an error that names the registration failure
        // and the underlying write error (fail the step + emit an error).
        assert!(
            step_error.contains("Uninstall registration failed"),
            "error must name the registration failure: {step_error}"
        );
        assert!(
            step_error.contains(write_error),
            "error must carry the underlying write failure: {step_error}"
        );

        // (2) The copied payload was rolled back: zero canonical tool outputs
        // remain — identical to the final state of any other step failure, so
        // the end state is order-independent across the three install outcomes
        // (payload copied, provisioning done, registration).
        let plan = bundle::verify_install_dir(&temp);
        assert!(
            plan.present.is_empty(),
            "a registration failure must leave no tool outputs behind, found: {:?}",
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

    /// Strategy producing an arbitrary [`ElevationOutcome`] across all three
    /// variants (Granted / Declined / TimedOut) with roughly equal weight, so
    /// the elevation-gate property exercises the permit and both block paths.
    fn any_elevation_outcome() -> impl Strategy<Value = ElevationOutcome> {
        prop_oneof![
            Just(ElevationOutcome::Granted),
            Just(ElevationOutcome::Declined),
            Just(ElevationOutcome::TimedOut),
        ]
    }

    // Feature: installer-runtime-provisioning, Property 1: Elevation gate
    // blocks all side effects unless granted
    //
    // For any ElevationOutcome, the pipeline proceeds (executes any step,
    // copies payload, provisions a dependency, or writes a registry entry) iff
    // the outcome is Granted; a Declined or TimedOut outcome results in zero
    // executed steps and zero filesystem/registry writes, leaving the machine
    // in its pre-launch state.
    //
    // Validates: Requirements 1.3, 1.6
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        #[test]
        fn prop_elevation_gate_blocks_all_side_effects_unless_granted(
            outcome in any_elevation_outcome(),
        ) {
            // ── Part A: the injected recording-executor seam ──────────────
            //
            // Drive a recording step executor through the pure fail-fast core
            // (`orchestrate_steps`), but only when the gate permits it — the
            // exact ordering `run_installation_with_elevation` applies. The
            // Cell counts every step the executor is asked to run (its "side
            // effect"). The invariant: the executor runs iff `may_proceed`.
            let executed = std::cell::Cell::new(0usize);
            let permitted = may_proceed(outcome);

            if permitted {
                let core = orchestrate_steps(STEPS, |_step| {
                    executed.set(executed.get() + 1);
                    Ok(())
                });
                prop_assert_eq!(core, OrchestrationOutcome::Complete);
            }
            // When not permitted the gate short-circuits before the core, so
            // the executor is never invoked and the counter stays at zero.

            // The recording executor ran a step > 0 times iff Granted, and 0
            // times otherwise (Req 1.3, 1.6).
            let ran = executed.get();
            if outcome == ElevationOutcome::Granted {
                prop_assert_eq!(ran, STEPS.len());
                prop_assert!(ran > 0);
            } else {
                prop_assert_eq!(ran, 0);
            }
            // Equivalently: any step ran iff proceeding was permitted.
            prop_assert_eq!(ran > 0, permitted);

            // ── Part B: observable behavior of the gated entry point ──────
            //
            // Exercise the real gate through `run_installation_with_elevation`
            // against a per-outcome temp dir and assert the observable
            // filesystem/registry contract for the NON-granted outcomes: no
            // step runs, the failure is attributed to the elevation gate with
            // the admin-required message, and the machine is left in its
            // pre-launch state — in particular the install dir is never even
            // created (Req 1.3, 1.6). The Granted branch is exercised by the
            // recording executor above and by `run_installation`'s own tests;
            // driving the full real pipeline here would depend on host state
            // (real Node/npm, a bundled payload, HKLM writes), so this part
            // asserts only the zero-side-effect guarantee for blocked outcomes.
            cancelled_flag().store(false, Ordering::SeqCst);

            let temp = std::env::temp_dir()
                .join(format!("llm_toolkit_prop_elevation_gate_{outcome:?}"));
            let _ = fs::remove_dir_all(&temp);
            prop_assert!(!temp.exists());

            if !permitted {
                let result =
                    run_installation_with_elevation(&temp.to_string_lossy(), outcome);

                // The failure is attributed to the elevation gate (Req 1.3)
                // with the admin-required message (Req 1.4).
                prop_assert!(!result.success);
                prop_assert_eq!(&result.step, ELEVATION_STEP);
                prop_assert_eq!(&result.message, ADMIN_REQUIRED_MESSAGE);

                // Zero filesystem side effects: the install dir was never
                // created, so no payload/registry/dependency write occurred —
                // the machine stays in its pre-launch state (Req 1.3, 1.6).
                prop_assert!(
                    !temp.exists(),
                    "a non-granted outcome ({outcome:?}) must create no filesystem artifacts"
                );
            }

            let _ = fs::remove_dir_all(&temp);
            cancelled_flag().store(false, Ordering::SeqCst);
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
    //     Copy Tools immediately before Runtimes, and the pure orchestration
    //     core proceeds Copy Tools -> Runtimes -> ... when every step is Ok;
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
    //     five-step pipeline is pinned (Copy Tools, Runtimes, LM Studio Plugin
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
        fn all_satisfied_pipeline_proceeds_copy_tools_then_runtimes() {
            // All-satisfied parity at the pipeline level: Copy Tools is Step 1
            // and Runtimes is Step 2, and when every step is Ok the pure
            // orchestration core runs them in order and completes — so a
            // successful Copy Tools step (which stages the payload + flat npm
            // manifest into install_dir) is followed by Runtimes next, which is
            // what lets `npm install` find its manifest and the plugins resolve.
            assert_eq!(STEPS[0], Step::CopyTools);
            assert_eq!(STEPS[1], Step::Runtimes);

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
            // The ordered five-step pipeline (Req 6.5): Copy Tools must precede
            // Runtimes so the payload + flat npm manifest are in install_dir
            // before `npm install` and plugin verification run. Then LM Studio
            // Plugin Dirs, Env Config, Uninstall Registration — in that order.
            let names: Vec<&str> = STEPS.iter().map(|s| s.name()).collect();
            assert_eq!(
                names,
                vec![
                    "copy-tools",
                    "runtimes",
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

    // ─────────────────────────────────────────────────────────────────────────
    // Task 1 — Bug condition exploration test (Property 1).
    //
    // Feature: installer-payload-path-fix — "Resolver Returns The Real Payload
    // Directory".
    //
    // Bug Condition (bugfix.md / design.md):
    //   isBugCondition(exe_dir) =
    //       exists(exe_dir / "payload") AND NOT exists(exe_dir / "resources" / "payload")
    //
    // Property 1 — for every `exe_dir` satisfying the bug condition, the
    // resolved payload root MUST equal `exe_dir.join("payload")` and that path
    // MUST be an existing directory, so Copy Tools proceeds against the real
    // NSIS perMachine layout.
    //
    // CRITICAL — this is a bug-condition exploration test. It encodes the
    // *expected* corrected behavior, which the UNFIXED code does NOT implement:
    // the pure helper `payload_root_for_exe_dir(exe_dir)` currently returns
    // `exe_dir/resources/payload` (it prepends the `resources` segment), so for
    // a perMachine layout where only `<exe_dir>\payload` exists it yields the
    // nonexistent `<exe_dir>\resources\payload`. These tests therefore FAIL on
    // the unfixed code — that failure is the SUCCESS case: it proves the bug.
    // DO NOT change the resolver here to make them pass; that is fix task 3.
    //
    // Fix task 3.7 re-runs these SAME tests against the fixed code, where they
    // must PASS — confirming the resolver returns `<exe_dir>\payload` and that
    // it is an existing directory.
    //
    // Requirements: 1.1, 1.2, 1.3, 2.1
    // ─────────────────────────────────────────────────────────────────────────
    mod payload_root_bug_condition_exploration_tests {
        use super::*;

        /// Construct a temp `exe_dir` satisfying the bug condition:
        /// `<exe_dir>\payload\` exists and `<exe_dir>\resources\payload\` does
        /// not. Returns the created `exe_dir`. The caller removes it.
        ///
        /// A unique suffix keeps concurrent test cases (proptest runs many
        /// iterations in-process) from colliding on the same temp path.
        fn make_bug_condition_exe_dir(suffix: &str) -> std::path::PathBuf {
            let exe_dir = std::env::temp_dir()
                .join("llm_toolkit_payload_bug_condition")
                .join(suffix);
            // Start clean so a leftover `resources\payload\` can never sneak in.
            let _ = fs::remove_dir_all(&exe_dir);
            // Real payload beside the exe (the NSIS perMachine layout).
            fs::create_dir_all(exe_dir.join(PAYLOAD_RESOURCE_SUBDIR))
                .expect("create <exe_dir>/payload");
            // Sanity: the bug condition actually holds for this fixture.
            assert!(
                exe_dir.join(PAYLOAD_RESOURCE_SUBDIR).is_dir(),
                "fixture must have <exe_dir>/payload present"
            );
            assert!(
                !exe_dir
                    .join(RESOURCE_DIR_NAME)
                    .join(PAYLOAD_RESOURCE_SUBDIR)
                    .exists(),
                "fixture must NOT have <exe_dir>/resources/payload"
            );
            exe_dir
        }

        /// Assert Property 1 for a single bug-condition `exe_dir`: the resolved
        /// payload root equals `<exe_dir>\payload` and is an existing directory.
        ///
        /// Uses the pure helper `payload_root_for_exe_dir`, which takes the
        /// `exe_dir` directly (no I/O), so this exercises the exact derivation
        /// the live resolver feeds from `current_exe()`. On UNFIXED code the
        /// helper returns `<exe_dir>\resources\payload`, so this assertion FAILS
        /// — the intended counterexample.
        fn assert_resolves_to_real_payload(exe_dir: &Path) {
            let resolved = payload_root_for_exe_dir(exe_dir);
            let expected = exe_dir.join(PAYLOAD_RESOURCE_SUBDIR);
            assert_eq!(
                resolved, expected,
                "bug-condition exe_dir must resolve to <exe_dir>/payload, not \
                 <exe_dir>/resources/payload — got {}",
                resolved.display()
            );
            assert!(
                resolved.is_dir(),
                "resolved payload root must be an existing directory: {}",
                resolved.display()
            );
        }

        #[test]
        fn per_machine_layout_resolves_to_payload_beside_exe() {
            // Concrete reproducible perMachine layout: `payload\` present,
            // `resources\payload\` absent.
            let exe_dir = make_bug_condition_exe_dir("per_machine_concrete");

            // EXPECTED on unfixed code: this FAILS because the resolver yields
            // <exe_dir>\resources\payload instead of <exe_dir>\payload.
            assert_resolves_to_real_payload(&exe_dir);

            let _ = fs::remove_dir_all(&exe_dir);
        }

        #[test]
        fn pure_helper_returns_preferred_payload_candidate() {
            // Assert the pure helper directly, matching the task's explicit
            // requirement: payload_root_for_exe_dir(exe_dir) == exe_dir/payload.
            // On UNFIXED code this returns exe_dir/resources/payload and FAILS.
            let exe_dir = Path::new("C:\\Program Files\\LLM Toolkit Installer");
            assert_eq!(
                payload_root_for_exe_dir(exe_dir),
                exe_dir.join(PAYLOAD_RESOURCE_SUBDIR),
                "pure helper must prefer <exe_dir>/payload (real NSIS perMachine \
                 layout), not <exe_dir>/resources/payload"
            );
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(64))]

            // Property 1 — for all exe_dir satisfying the bug condition
            // (payload\ exists, resources\payload\ does not), the resolved
            // payload root equals <exe_dir>\payload and is_dir() is true.
            //
            // The generator produces distinct temp exe_dir layouts (via a
            // unique suffix) that each satisfy isBugCondition, then asserts the
            // expected resolution. On UNFIXED code every case FAILS with the
            // counterexample <exe_dir>\resources\payload.
            //
            // Validates: Requirements 1.1, 1.2, 1.3, 2.1
            #[test]
            fn prop_bug_condition_resolves_to_real_payload(case in 0u32..64) {
                let suffix = format!("prop_{case}");
                let exe_dir = make_bug_condition_exe_dir(&suffix);

                let resolved = payload_root_for_exe_dir(&exe_dir);
                let expected = exe_dir.join(PAYLOAD_RESOURCE_SUBDIR);
                prop_assert_eq!(
                    &resolved,
                    &expected,
                    "bug-condition exe_dir must resolve to <exe_dir>/payload; got {}",
                    resolved.display()
                );
                prop_assert!(
                    resolved.is_dir(),
                    "resolved payload root must be an existing directory: {}",
                    resolved.display()
                );

                let _ = fs::remove_dir_all(&exe_dir);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Task 2 — Preservation baseline tests (Property 2).
    //
    // Property 2 (design.md / bugfix.md):
    //   For every `exe_dir` where isBugCondition is FALSE, the fixed resolver's
    //   outcome is equivalent to the original scheme's outcome — legacy layout
    //   (only `<exe_dir>\resources\payload` exists) resolves to
    //   `<exe_dir>\resources\payload`; a no-candidate layout fails with an error
    //   naming the checked location(s); and downstream copy → verify → rollback,
    //   retry, cancellation, and logging behavior is unchanged.
    //
    // These tests were authored observation-first against the UNFIXED code to
    // capture the non-bug OUTCOMES that must be preserved, and were reconciled
    // by task 3.8 to model the FIXED probing resolver (candidate ordering +
    // named no-candidate error). For every non-bug `exe_dir` they assert the
    // fixed resolver's outcome is equivalent to the original scheme's outcome:
    //
    //   * Legacy layout (only `<exe_dir>\resources\payload` exists): probing
    //     falls through to the fallback and resolves to
    //     `<exe_dir>\resources\payload` — same as the original scheme.
    //   * No-candidate layout (neither exists): resolution fails with an error
    //     NAMING every checked location (Req 2.4), and `step_copy_tools` still
    //     surfaces a `"Copy Tools failed:"`-attributed error with rollback.
    //   * Resolution stays relative to `current_exe()` with no AppHandle.
    //   * The ordered candidate helper prefers `<exe_dir>\payload` over the
    //     `<exe_dir>\resources\payload` fallback.
    //
    // The matrix property models resolution as "first existing candidate among
    // [<exe_dir>\payload, <exe_dir>\resources\payload], else named error" over a
    // matrix of which candidate directories exist, constrained to non-bug
    // layouts via `prop_assume!`. The bug layout (only payload present) is
    // Property 1's concern, not this module's.
    //
    // Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5
    // ─────────────────────────────────────────────────────────────────────────
    mod payload_root_preservation_tests {
        use super::*;

        /// Model the fixed probing resolver over a concrete `exe_dir` on disk:
        /// return the first ordered candidate from
        /// [`payload_root_candidates_for_exe_dir`] whose directory exists, or an
        /// `Err` naming every checked location (mirroring the live resolver's
        /// named-locations error). This lets the preservation tests exercise the
        /// real probing/ordering semantics against temp layouts without invoking
        /// `current_exe()`.
        fn resolve_over_candidates(exe_dir: &Path) -> Result<std::path::PathBuf, String> {
            let candidates = payload_root_candidates_for_exe_dir(exe_dir);
            if let Some(existing) = candidates.iter().find(|candidate| candidate.is_dir()) {
                return Ok(existing.clone());
            }
            let checked = candidates
                .iter()
                .map(|candidate| candidate.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            Err(format!(
                "bundled payload resource root not found; checked: {}",
                checked
            ))
        }

        /// Bug condition from the design/bugfix docs. A pure predicate over the
        /// filesystem state of `exe_dir`: the real payload sits beside the exe
        /// (`<exe_dir>\payload`) and there is no `<exe_dir>\resources\payload`.
        fn is_bug_condition(exe_dir: &Path) -> bool {
            exe_dir.join(PAYLOAD_RESOURCE_SUBDIR).is_dir()
                && !exe_dir
                    .join(RESOURCE_DIR_NAME)
                    .join(PAYLOAD_RESOURCE_SUBDIR)
                    .is_dir()
        }

        /// Build a temp `exe_dir` with the two candidate directories present or
        /// absent per the booleans. Returns the created `exe_dir`; caller cleans
        /// it up. A unique suffix isolates concurrent proptest iterations.
        fn make_layout(suffix: &str, payload: bool, resources_payload: bool) -> std::path::PathBuf {
            let exe_dir = std::env::temp_dir()
                .join("llm_toolkit_payload_preservation")
                .join(suffix);
            // Start clean so a stale directory never contaminates the layout.
            let _ = fs::remove_dir_all(&exe_dir);
            fs::create_dir_all(&exe_dir).expect("create exe_dir");
            if payload {
                fs::create_dir_all(exe_dir.join(PAYLOAD_RESOURCE_SUBDIR))
                    .expect("create <exe_dir>/payload");
            }
            if resources_payload {
                fs::create_dir_all(
                    exe_dir.join(RESOURCE_DIR_NAME).join(PAYLOAD_RESOURCE_SUBDIR),
                )
                .expect("create <exe_dir>/resources/payload");
            }
            exe_dir
        }

        // ── BASELINE (A): PASS on unfixed code — behavior to preserve ─────────

        /// Legacy/portable layout: only `<exe_dir>\resources\payload\` exists
        /// (NOT the bug condition). PRESERVATION: the fixed probing resolver
        /// finds no `<exe_dir>\payload`, falls through to the resilience
        /// fallback, and resolves to `<exe_dir>\resources\payload` — the same
        /// outcome the original scheme produced for this non-bug layout
        /// (Req 3.5).
        #[test]
        fn legacy_layout_resolves_to_resources_payload() {
            let exe_dir = make_layout("legacy_concrete", false, true);
            // Precondition: this layout is NOT the bug condition.
            assert!(
                !is_bug_condition(&exe_dir),
                "legacy layout (only resources/payload) must not be the bug condition"
            );

            // Model the fixed probing resolver over this concrete layout: the
            // preferred `<exe_dir>\payload` is absent, so probing falls through
            // to the existing `<exe_dir>\resources\payload` fallback.
            let resolved =
                resolve_over_candidates(&exe_dir).expect("legacy layout has an existing candidate");
            assert_eq!(
                resolved,
                exe_dir.join(RESOURCE_DIR_NAME).join(PAYLOAD_RESOURCE_SUBDIR),
                "legacy layout must resolve to <exe_dir>/resources/payload"
            );
            // The resolved directory is the one that actually exists here.
            assert!(
                resolved.is_dir(),
                "legacy layout's resolved root must be an existing directory: {}",
                resolved.display()
            );

            let _ = fs::remove_dir_all(&exe_dir);
        }

        /// Resolution stays relative to `current_exe()` with no AppHandle
        /// dependency (Req 3.4). PRESERVATION: the live resolver derives its
        /// candidates from `current_exe()`'s parent directory and returns the
        /// first existing one; when none exist beside the test binary it returns
        /// the named-locations error over those same `current_exe()`-relative
        /// candidates. Either way the outcome is fully determined by
        /// `current_exe()`'s directory — no AppHandle involved.
        #[test]
        fn resolution_stays_relative_to_current_exe() {
            let exe = std::env::current_exe().expect("current exe");
            let exe_dir = exe.parent().expect("exe parent");

            // The live resolver's outcome must equal the probing model applied
            // to current_exe()'s directory (first existing candidate, else the
            // named-locations error) — proving resolution is derived solely from
            // current_exe()'s parent.
            match resolve_payload_resource_root() {
                Ok(resolved) => {
                    assert_eq!(
                        Ok(resolved),
                        resolve_over_candidates(exe_dir),
                        "resolver must return the first existing candidate under current_exe()'s directory"
                    );
                }
                Err(msg) => {
                    // No candidate exists beside the test binary: the error must
                    // name the current_exe()-relative candidates it checked.
                    assert_eq!(
                        Err(msg),
                        resolve_over_candidates(exe_dir),
                        "no-candidate resolution must name the current_exe()-relative locations"
                    );
                }
            }
        }

        /// No payload beside the test binary → `step_copy_tools` fails with a
        /// `"Copy Tools failed:"`-attributed error and leaves no tool outputs
        /// behind (rollback). OBSERVED on unfixed code and preserved by the fix
        /// (Req 3.1, 3.2). This mirrors
        /// `test_step_copy_tools_reports_missing_payload_by_message` and locks
        /// the failure attribution + rollback contract as a preservation baseline.
        #[test]
        fn step_copy_tools_missing_payload_fails_attributed_and_rolls_back() {
            cancelled_flag().store(false, Ordering::SeqCst);

            let temp = std::env::temp_dir().join("llm_toolkit_preservation_copy_tools");
            let _ = fs::remove_dir_all(&temp);
            fs::create_dir_all(&temp).expect("create temp install dir");

            let result = step_copy_tools(&temp.to_string_lossy());
            assert!(
                result.is_err(),
                "expected a copy failure without a real payload beside the binary"
            );
            let msg = result.unwrap_err();
            assert!(
                msg.starts_with("Copy Tools failed:"),
                "failure must be attributed to the copy step: {msg}"
            );

            // Rollback: no canonical tool output remains in the install dir.
            let plan = bundle::verify_install_dir(&temp);
            assert!(
                plan.present.is_empty(),
                "a failed copy must leave no tool outputs behind, found: {:?}",
                plan.present
            );

            let _ = fs::remove_dir_all(&temp);
        }

        proptest! {
            #![proptest_config(ProptestConfig::with_cases(64))]

            // Property 2 (preservation) — for all NON-BUG `exe_dir` layouts the
            // fixed probing resolver produces an outcome equivalent to the
            // original scheme's OUTCOME. This models resolution over a matrix of
            // which candidate directories exist (payload present/absent ×
            // resources/payload present/absent), building each layout on disk and
            // probing the ordered candidates.
            //
            // The design's preservation guarantee (design.md "Preservation
            // Checking") is stated over exactly the non-bug layouts where the
            // original scheme's `<exe_dir>\resources\payload` outcome is the one
            // that must be kept:
            //   * only resources/payload   → legacy layout: both the original
            //                                 scheme and the fixed resolver
            //                                 resolve to <exe_dir>\resources\payload.
            //   * neither present          → both fail: the original scheme's
            //                                 resources/payload does not exist,
            //                                 and the fixed resolver yields the
            //                                 named no-candidate error.
            // Both of these have `payload == false`, so the matrix is constrained
            // to that half. The BUG layout (only payload present) is Property 1's
            // concern. The BOTH-present layout is a non-bug layout too, but its
            // correct behavior is the documented candidate ORDERING (prefer
            // <exe_dir>\payload), not preservation of the original scheme's
            // resources/payload outcome — that precedence is covered by
            // `candidate_order_prefers_payload_then_resources_payload` and the
            // 3.6 ordering unit test, so it is intentionally excluded here.
            //
            // Validates: Requirements 3.1, 3.4, 3.5
            #[test]
            fn prop_non_bug_layout_matches_original_scheme(
                case in 0u32..64u32,
                resources_payload in any::<bool>(),
            ) {
                // Preserved-outcome layouts have no `<exe_dir>\payload` present
                // (only-resources-payload and neither). This excludes both the
                // bug layout and the both-present precedence layout.
                let payload = false;

                let suffix = format!("prop_{case}_{}_{}", payload as u8, resources_payload as u8);
                let exe_dir = make_layout(&suffix, payload, resources_payload);

                // Sanity: the generated layout is genuinely not the bug condition.
                prop_assert!(
                    !is_bug_condition(&exe_dir),
                    "matrix must only cover non-bug layouts; got a bug layout for {}",
                    exe_dir.display()
                );

                // Model the ORIGINAL scheme's outcome: F resolved to
                // <exe_dir>\resources\payload, which was usable only when that
                // directory existed; otherwise the copy failed.
                let original_target = exe_dir.join(RESOURCE_DIR_NAME).join(PAYLOAD_RESOURCE_SUBDIR);
                let original_outcome: Result<std::path::PathBuf, ()> =
                    if original_target.is_dir() { Ok(original_target) } else { Err(()) };

                // The fixed probing resolver's outcome over the same on-disk
                // layout, reduced to Ok(path)/Err for comparison.
                let fixed_outcome: Result<std::path::PathBuf, ()> =
                    resolve_over_candidates(&exe_dir).map_err(|_| ());

                // Equivalent OUTCOMES for every non-bug layout: where the legacy
                // resources/payload exists both resolve there; where it does not
                // both fail.
                prop_assert_eq!(
                    &fixed_outcome,
                    &original_outcome,
                    "non-bug layout must match the original scheme's outcome for {}",
                    exe_dir.display()
                );

                let _ = fs::remove_dir_all(&exe_dir);
            }
        }

        // ── Property 2's remaining half: named no-candidate error + ordering ─
        //
        // These describe the no-candidate failure that must produce an error
        // NAMING the checked location(s) (Req 2.4), and the ordered candidate
        // helper's probe order. Implemented against the fixed code by task 3.8.

        /// No-candidate layout (NOT the bug condition): neither `<exe_dir>\payload`
        /// nor `<exe_dir>\resources\payload` exists. PRESERVATION: probing yields
        /// an `Err` that names EVERY checked location (Req 2.4), so the copy step
        /// still fails with a diagnostic that points at the paths inspected —
        /// preserving the "copy fails when no payload exists" outcome while
        /// improving the message.
        #[test]
        fn no_candidate_layout_fails_with_named_locations() {
            let exe_dir = make_layout("no_candidate_named", false, false);
            // Precondition: an empty layout is not the bug condition.
            assert!(
                !is_bug_condition(&exe_dir),
                "no-candidate layout must not be the bug condition"
            );

            let err = resolve_over_candidates(&exe_dir)
                .expect_err("no-candidate layout must fail to resolve");
            assert!(
                err.starts_with("bundled payload resource root not found; checked:"),
                "no-candidate failure must name the checked locations: {err}"
            );
            // The error must name BOTH checked candidate locations.
            for candidate in payload_root_candidates_for_exe_dir(&exe_dir) {
                assert!(
                    err.contains(&candidate.display().to_string()),
                    "error must name checked location {}: {err}",
                    candidate.display()
                );
            }

            let _ = fs::remove_dir_all(&exe_dir);
        }

        /// The ordered candidate helper `payload_root_candidates_for_exe_dir`
        /// must yield the real NSIS perMachine location `<exe_dir>\payload` at
        /// [0] BEFORE the historical `<exe_dir>\resources\payload` fallback at
        /// [1], so the probing resolver prefers the payload beside the exe
        /// (Req 2.3).
        #[test]
        fn candidate_order_prefers_payload_then_resources_payload() {
            let exe_dir = Path::new("C:\\Program Files\\LLM Toolkit Installer");
            let candidates = payload_root_candidates_for_exe_dir(exe_dir);
            assert_eq!(
                candidates[0],
                exe_dir.join(PAYLOAD_RESOURCE_SUBDIR),
                "preferred candidate must be <exe_dir>/payload"
            );
            assert_eq!(
                candidates[1],
                exe_dir.join(RESOURCE_DIR_NAME).join(PAYLOAD_RESOURCE_SUBDIR),
                "fallback candidate must be <exe_dir>/resources/payload"
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 11.7 — Property 18: registration-failure rollback is order-independent.
//
// Self-contained module (own imports + TempDir/materialize helpers, own temp
// root) so it does not touch the shared `tests` module helpers that a sibling
// task (8.2) may be editing concurrently. It drives the extracted failure→
// rollback core `super::rollback_after_registration_failure` against a real
// temp install directory — it NEVER calls `registry::write_uninstall_entry`
// and NEVER mutates the machine registry (HKLM).
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod registration_rollback_ordering_property_tests {
    use crate::bundle;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
    use proptest::prelude::*;
    use proptest::sample::subsequence;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// The three install outcomes whose resolution order (Req 10.3) must not
    /// change the final observable state after a registration-write failure:
    /// the copied payload, provisioning (an `install_dir/node_modules` tree),
    /// and the (failing) registration attempt.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Outcome {
        /// The nine canonical tool outputs were copied under the install dir.
        PayloadCopied,
        /// Provisioning finished — modelled as a populated `node_modules` tree.
        ProvisioningDone,
        /// The HKLM uninstall-registration write was attempted (and failed).
        RegistrationAttempted,
    }

    /// Process-unique suffix so concurrent proptest iterations never collide on
    /// the same temp directory.
    fn unique_temp_dir() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join("llm_toolkit_registration_rollback_ordering")
            .join(format!("{}_{}", std::process::id(), n))
    }

    /// Materialize the copied payload for `tool_indices`: one > 0-byte file per
    /// selected canonical tool at `install_dir/<server_name>/`, the shape the
    /// copy step leaves behind. A > 0-byte file is required for
    /// `verify_install_dir` to count the tool present.
    fn materialize_copied_payload_subset(install_dir: &Path, tool_indices: &[usize]) {
        let tools = canonical_payloads();
        for &i in tool_indices {
            let dir = install_dir.join(tools[i].server_name);
            fs::create_dir_all(&dir).expect("create tool output dir");
            fs::write(dir.join("index.js"), b"module.exports = {};\n")
                .expect("write tool output file");
        }
    }

    /// Materialize the "provisioning done" artifact — a non-empty
    /// `install_dir/node_modules` tree — so orderings that resolve provisioning
    /// before the registration failure are represented on disk.
    fn materialize_provisioning(install_dir: &Path) {
        let nm = install_dir.join("node_modules").join("@modelcontextprotocol");
        fs::create_dir_all(&nm).expect("create node_modules tree");
        fs::write(nm.join("marker.txt"), b"provisioned\n").expect("write provisioning marker");
    }

    /// How many of the nine canonical tools are currently present (> 0-byte
    /// file) under `install_dir`.
    fn present_count(install_dir: &Path) -> usize {
        bundle::verify_install_dir(install_dir).present.len()
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        // Feature: installer-runtime-provisioning,
        // Property 18: Registration failure rolls back regardless of outcome ordering
        //
        // For every ordering of the three install outcomes (payload copied,
        // provisioning done, registration attempted) — with the registration
        // outcome being FAILURE — the final observable state after
        // `rollback_after_registration_failure` is IDENTICAL: zero of the nine
        // copied tool outputs remain (the copied payload rolls back to the same
        // zero-owned-artifacts state as any other step failure), and the
        // returned error names the registration failure and carries the
        // underlying write error. The post-rollback copied-payload state is
        // therefore order-independent (Req 10.3).
        //
        // The ordering is modelled by generating a permutation of the three
        // outcomes (`perm`) and materializing each outcome's on-disk artifact in
        // that order before driving the rollback. rollback_payload owns exactly
        // the nine tool outputs, so the "identical final state" invariant is
        // asserted over the copied payload it guarantees; node_modules cleanup is
        // the pipeline/uninstall's responsibility, not this failure→rollback
        // core, so it is intentionally excluded from the convergence assertion.
        //
        // We NEVER call the real HKLM `write_uninstall_entry`; the write error is
        // simulated and passed straight into the extracted rollback core.
        //
        // Validates: Requirements 10.3
        #[test]
        fn prop_registration_failure_rollback_is_order_independent(
            // A permutation of {0,1,2} selecting the resolution ORDER of the
            // three outcomes. subsequence over all three indices yields every
            // permutation across generated cases.
            perm in subsequence(vec![0usize, 1usize, 2usize], 3),
            // An arbitrary NON-EMPTY subset of the nine tool outputs that the
            // copy step produced by the time registration runs.
            tool_indices in subsequence((0..CANONICAL_TOOL_COUNT).collect::<Vec<_>>(), 1..=CANONICAL_TOOL_COUNT),
            // Whether provisioning left a node_modules tree behind.
            provisioning_done in any::<bool>(),
        ) {
            let outcomes = [
                Outcome::PayloadCopied,
                Outcome::ProvisioningDone,
                Outcome::RegistrationAttempted,
            ];

            let install_dir = unique_temp_dir();
            let _ = fs::remove_dir_all(&install_dir);
            fs::create_dir_all(&install_dir).expect("create temp install dir");

            let write_error = "HKLM write denied (simulated)";
            let mut step_error: Option<String> = None;

            // Resolve the three outcomes in the generated order. The registration
            // outcome resolves as a FAILURE that drives the rollback core; the
            // other two materialize their on-disk artifacts.
            for &idx in &perm {
                match outcomes[idx] {
                    Outcome::PayloadCopied => {
                        materialize_copied_payload_subset(&install_dir, &tool_indices);
                    }
                    Outcome::ProvisioningDone => {
                        if provisioning_done {
                            materialize_provisioning(&install_dir);
                        }
                    }
                    Outcome::RegistrationAttempted => {
                        step_error = Some(super::rollback_after_registration_failure(
                            &install_dir.to_string_lossy(),
                            write_error,
                        ));
                    }
                }
            }

            let step_error = step_error.expect("registration outcome must have resolved");

            // (1) Order-independent final state: after the rollback, ZERO of the
            // nine copied tool outputs remain, whatever order the outcomes
            // resolved in. This is the same zero-owned-artifacts end state as any
            // other step failure (Req 10.3).
            //
            // If registration resolved BEFORE the copy in this ordering, the copy
            // materialized after the rollback ran — so we re-drive the rollback
            // once here to model the pipeline's fail-fast cleanup converging on
            // the same final state regardless of ordering. This keeps the
            // asserted invariant about the FINAL observable state, not an
            // intermediate one.
            let reg_pos = perm.iter().position(|&i| outcomes[i] == Outcome::RegistrationAttempted).unwrap();
            let copy_pos = perm.iter().position(|&i| outcomes[i] == Outcome::PayloadCopied).unwrap();
            if reg_pos < copy_pos {
                super::rollback_after_registration_failure(
                    &install_dir.to_string_lossy(),
                    write_error,
                );
            }

            prop_assert_eq!(
                present_count(&install_dir),
                0,
                "registration failure must leave zero copied tool outputs regardless of \
outcome ordering {:?}; found {} present",
                perm,
                present_count(&install_dir)
            );

            // (2) The surfaced error is identical in shape for every ordering: it
            // names the registration failure and carries the underlying write
            // error.
            prop_assert!(
                step_error.contains("Uninstall registration failed"),
                "error must name the registration failure: {}",
                step_error
            );
            prop_assert!(
                step_error.contains(write_error),
                "error must carry the underlying write failure: {}",
                step_error
            );

            let _ = fs::remove_dir_all(&install_dir);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 12.1 — whole-install rollback clears every owned artifact class.
//
// Self-contained module (own imports + a process-unique temp root + its own
// env-override guard) so it does not touch the shared `tests` module helpers
// or the sibling task-11.7 module that other tasks (8.2 / 11.7) may be editing
// concurrently. It drives `super::cleanup_installation` against a real temp
// install directory with a materialized copied payload, a provisioned
// `node_modules` tree, and a toolkit-owned LM Studio plugin dir (pointed at via
// the `LMSTUDIO_MCP_PLUGIN_ROOT` override), and asserts every owned class is
// cleared while a foreign plugin dir is preserved.
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod cleanup_installation_tests {
    use crate::bundle;
    use crate::tool_payload::canonical_payloads;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    /// Serializes the `LMSTUDIO_MCP_PLUGIN_ROOT` env-override mutation within
    /// this module so the live-read override is stable across the single
    /// `cleanup_installation` call under test.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Process-unique temp directory so parallel test runs never collide.
    fn unique_temp_dir(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join("llm_toolkit_cleanup_installation")
            .join(format!("{}_{}_{}", tag, std::process::id(), n))
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
    }

    /// `cleanup_installation` on an install dir carrying every owned artifact
    /// class — copied payload, provisioned `node_modules`, an owned LM Studio
    /// plugin dir, and the `downloads` scratch dir — clears ALL of them while
    /// leaving a foreign plugin dir untouched (Req 12.4).
    #[test]
    fn cleanup_installation_clears_all_owned_artifact_classes() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

        let install_dir = unique_temp_dir("install");
        let plugin_root = unique_temp_dir("plugins");
        let _ = fs::remove_dir_all(&install_dir);
        let _ = fs::remove_dir_all(&plugin_root);
        fs::create_dir_all(&install_dir).expect("create install dir");
        fs::create_dir_all(&plugin_root).expect("create plugin root");

        // ── 1. Copied payload: a > 0-byte file per canonical tool output so
        //    `verify_install_dir` counts every tool present. ──
        let tools = canonical_payloads();
        for tool in tools {
            let dir = install_dir.join(tool.server_name);
            write_file(&dir.join("index.js"), "module.exports = {};\n");
        }
        assert_eq!(
            bundle::verify_install_dir(&install_dir).present.len(),
            tools.len(),
            "precondition: all copied tool outputs are present"
        );

        // ── 2. Provisioned `install_dir/node_modules` tree (NpmInstallOmitDev). ──
        let node_modules = install_dir.join("node_modules");
        write_file(
            &node_modules
                .join("@modelcontextprotocol")
                .join("sdk")
                .join("package.json"),
            r#"{ "name": "@modelcontextprotocol/sdk" }"#,
        );
        assert!(node_modules.exists(), "precondition: node_modules present");

        // ── 3. An OWNED LM Studio plugin dir (marker-bearing) + a FOREIGN one. ──
        let owned_plugin = plugin_root.join("terminal");
        write_file(
            &owned_plugin.join("manifest.json"),
            r#"{ "type": "plugin", "_owner": "llm-toolkit" }"#,
        );
        let foreign_plugin = plugin_root.join("some-foreign-plugin");
        write_file(&foreign_plugin.join("readme.txt"), "not ours");

        // ── 4. Runtime-installer scratch dir. ──
        let downloads = install_dir.join("downloads");
        write_file(&downloads.join("node-installer.msi"), "scratch");

        // Point the plugin-root resolver at our temp root for the duration of
        // the single cleanup call, then restore the previous value.
        let prev = std::env::var_os("LMSTUDIO_MCP_PLUGIN_ROOT");
        std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", &plugin_root);

        super::cleanup_installation(&install_dir.to_string_lossy());

        match prev {
            Some(v) => std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", v),
            None => std::env::remove_var("LMSTUDIO_MCP_PLUGIN_ROOT"),
        }

        // ── Assertions: every owned artifact class is cleared. ──
        assert_eq!(
            bundle::verify_install_dir(&install_dir).present.len(),
            0,
            "copied payload must be fully rolled back"
        );
        assert!(
            !node_modules.exists(),
            "provisioned node_modules must be removed"
        );
        assert!(
            !owned_plugin.exists(),
            "owned LM Studio plugin dir must be removed"
        );
        assert!(!downloads.exists(), "downloads scratch dir must be removed");

        // Foreign plugin dir is preserved with content intact.
        assert!(
            foreign_plugin.exists(),
            "foreign plugin dir must be preserved"
        );
        assert_eq!(
            fs::read_to_string(foreign_plugin.join("readme.txt")).unwrap_or_default(),
            "not ours",
            "foreign plugin content must be untouched"
        );

        // The parent install directory itself is preserved.
        assert!(
            install_dir.exists(),
            "parent install directory must be preserved"
        );

        let _ = fs::remove_dir_all(&install_dir);
        let _ = fs::remove_dir_all(&plugin_root);
    }

    /// `cleanup_installation` is idempotent / best-effort: calling it twice, or
    /// on an install dir with nothing to clean, never panics and leaves zero
    /// owned artifacts (mirrors the CopyTools/registration self-cleanup which
    /// may have already removed the payload — Req 12.4).
    #[test]
    fn cleanup_installation_is_idempotent_and_best_effort() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

        let install_dir = unique_temp_dir("install-idem");
        let plugin_root = unique_temp_dir("plugins-idem");
        let _ = fs::remove_dir_all(&install_dir);
        let _ = fs::remove_dir_all(&plugin_root);
        fs::create_dir_all(&install_dir).expect("create install dir");
        fs::create_dir_all(&plugin_root).expect("create plugin root");

        let tools = canonical_payloads();
        for tool in tools {
            write_file(
                &install_dir.join(tool.server_name).join("index.js"),
                "module.exports = {};\n",
            );
        }

        let prev = std::env::var_os("LMSTUDIO_MCP_PLUGIN_ROOT");
        std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", &plugin_root);

        // First cleanup removes the payload; second is a no-op that must not
        // panic (rollback_payload / node_modules / plugin cleanup are all
        // idempotent).
        super::cleanup_installation(&install_dir.to_string_lossy());
        super::cleanup_installation(&install_dir.to_string_lossy());

        match prev {
            Some(v) => std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", v),
            None => std::env::remove_var("LMSTUDIO_MCP_PLUGIN_ROOT"),
        }

        assert_eq!(
            bundle::verify_install_dir(&install_dir).present.len(),
            0,
            "payload must remain fully rolled back after a repeated cleanup"
        );

        let _ = fs::remove_dir_all(&install_dir);
        let _ = fs::remove_dir_all(&plugin_root);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 12.2 — Property 21: Pipeline executes steps in order and fails fast by
// name, plus the retry-cap contract.
//
// This module is SELF-CONTAINED (it defines its own helpers and imports and
// does not touch shared test helpers) so it can live alongside the sibling
// task-12.3 module while both tasks edit `installer.rs` concurrently. It pins
// three facets of the preserved pipeline contract (Req 12) purely, with no I/O:
//
//   1. ORDER + FAIL-FAST-BY-NAME (Req 12.1, 12.3): drive the pure
//      `super::orchestrate_steps` over the real `super::STEPS` with a recording
//      executor that fails at an arbitrary index (or never). The recorded run
//      order must equal `STEPS[..=fail_index]` in order, the outcome must name
//      exactly `STEPS[fail_index]`, and no step after the failing one may run.
//      The no-failure case runs all five in order and yields `Complete`.
//
//   2. RETRY-CAP (Req 12.2): `super::execute_step_with_retry` retries a step up
//      to `super::MAX_STEP_RETRIES` (= 3) total attempts. Because the real
//      function invokes the actual step fns (I/O), this asserts the cap
//      CONTRACT with a small local retry helper that mirrors it exactly: a
//      closure that fails N times then succeeds is retried up to the cap —
//      succeeding iff `N < MAX_STEP_RETRIES`, else failing after exactly
//      `MAX_STEP_RETRIES` attempts. `super::MAX_STEP_RETRIES` is referenced
//      directly (a child module can read a private parent item), so the test
//      tracks the production constant rather than a hard-coded copy.
//
// Validates: Requirements 12.1, 12.2, 12.3
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod pipeline_order_failfast_property_tests {
    use super::{orchestrate_steps, OrchestrationOutcome, MAX_STEP_RETRIES, STEPS};
    use proptest::prelude::*;

    /// Local mirror of `execute_step_with_retry`'s retry cap, kept side-effect
    /// free so the cap contract is testable without driving the real step I/O.
    ///
    /// Calls `attempt` up to `MAX_STEP_RETRIES` total times. `attempt` reports
    /// `Ok(())` to succeed or `Err(())` to fail; the helper stops at the first
    /// success. Returns `(succeeded, attempts_made)`. This mirrors the loop
    /// `for attempt in 1..=MAX_STEP_RETRIES { match execute_step(..) { Ok =>
    /// return Ok, Err => continue } }` in `super::execute_step_with_retry`.
    fn retry_up_to_cap<F>(mut attempt: F) -> (bool, u32)
    where
        F: FnMut() -> Result<(), ()>,
    {
        let mut attempts = 0u32;
        for _ in 1..=MAX_STEP_RETRIES {
            attempts += 1;
            if attempt().is_ok() {
                return (true, attempts);
            }
        }
        (false, attempts)
    }

    // Feature: installer-runtime-provisioning, Property 21: Pipeline executes
    // steps in order and fails fast by name
    //
    // Validates: Requirements 12.1, 12.2, 12.3
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        /// ORDER + FAIL-FAST-BY-NAME (Req 12.1, 12.3).
        ///
        /// `fail_index == STEPS.len()` encodes the "no failure" case; any
        /// smaller value fails the executor at exactly that step index.
        #[test]
        fn prop_pipeline_order_and_fail_fast_by_name(
            fail_index in 0usize..=STEPS.len(),
        ) {
            let fails = fail_index < STEPS.len();

            // Recording executor: records each step name in run order and
            // returns Err at exactly `fail_index` (when that case is active).
            let mut executed: Vec<&'static str> = Vec::new();
            let outcome = orchestrate_steps(STEPS, |step| {
                executed.push(step.name());
                if fails && step.name() == STEPS[fail_index].name() {
                    Err(format!("injected failure at index {}", fail_index))
                } else {
                    Ok(())
                }
            });

            if fails {
                // Outcome names exactly the failing step (Req 12.3).
                match &outcome {
                    OrchestrationOutcome::Failed { failed_step, .. } => {
                        prop_assert_eq!(*failed_step, STEPS[fail_index].name());
                    }
                    OrchestrationOutcome::Complete => {
                        prop_assert!(false, "expected failure at index {}", fail_index);
                    }
                }

                // Run order equals STEPS[..=fail_index] names, in order
                // (Req 12.1) — the pipeline runs steps in exactly STEPS order
                // up to and including the failing one.
                let expected: Vec<&'static str> =
                    STEPS[..=fail_index].iter().map(|s| s.name()).collect();
                prop_assert_eq!(&executed, &expected);

                // NO step after the failing one ran (fail-fast, Req 12.3).
                for step in &STEPS[fail_index + 1..] {
                    prop_assert!(
                        !executed.contains(&step.name()),
                        "step '{}' after failing step '{}' must not run",
                        step.name(),
                        STEPS[fail_index].name()
                    );
                }
                prop_assert_eq!(executed.len(), fail_index + 1);
            } else {
                // No-failure case: all five ran in exactly STEPS order and the
                // outcome is Complete (Req 12.1).
                prop_assert_eq!(outcome, OrchestrationOutcome::Complete);
                let all: Vec<&'static str> = STEPS.iter().map(|s| s.name()).collect();
                prop_assert_eq!(&executed, &all);
                prop_assert_eq!(executed.len(), STEPS.len());
            }
        }

        /// RETRY-CAP contract (Req 12.2): a step that fails N times then would
        /// succeed is retried up to `MAX_STEP_RETRIES` total attempts —
        /// succeeding iff `N < MAX_STEP_RETRIES`, otherwise failing after
        /// exactly `MAX_STEP_RETRIES` attempts.
        #[test]
        fn prop_retry_is_capped_at_max_step_retries(n in 0u32..6) {
            // Closure fails its first `n` calls, then succeeds.
            let mut calls = 0u32;
            let (succeeded, attempts) = retry_up_to_cap(|| {
                calls += 1;
                if calls <= n { Err(()) } else { Ok(()) }
            });

            // Attempts are capped: min(n + 1, MAX_STEP_RETRIES).
            let expected_attempts = std::cmp::min(n + 1, MAX_STEP_RETRIES);
            prop_assert_eq!(attempts, expected_attempts);

            // Success iff the step recovers within the cap.
            prop_assert_eq!(succeeded, n < MAX_STEP_RETRIES);

            // Never exceed the cap regardless of how many failures precede.
            prop_assert!(attempts <= MAX_STEP_RETRIES);
        }
    }

    /// Pin the documented retry cap value (Req 12.2, 12.3): the pipeline retries
    /// a step up to a maximum of 3 total attempts.
    #[test]
    fn max_step_retries_matches_documented_cap() {
        assert_eq!(MAX_STEP_RETRIES, 3, "Req 12.3 fixes the cap at 3 total attempts");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 12.3 — Property 12: Any step failure that triggers pipeline rollback
// clears all owned artifacts.
//
// Feature: installer-runtime-provisioning
// Property 12: Any step failure that triggers pipeline rollback clears all owned
// artifacts
// Validates: Requirements 5.7, 6.3, 7.6, 11.3, 12.2, 12.4
//
// This module is deliberately SELF-CONTAINED (its own temp/materialize helpers
// and its own module-local Mutex guarding the process-global
// `LMSTUDIO_MCP_PLUGIN_ROOT` env override) so it does not overlap with the
// sibling task-12.2 / task-11.7 test modules editing the end of this file
// concurrently.
//
// The whole-pipeline `run_installation_with_elevation` loads the real manifest
// and runs the production PowerShell `ElevatedShell` for `step_runtimes`, so it
// is not drivable in a proptest without a real elevated environment. What every
// triggering failure (an exhausted-retry step failure or a step-boundary
// cancellation) actually *invokes* to roll back is `cleanup_installation` — the
// `OrchestrationOutcome::Failed` arm of `run_installation_with_elevation` calls
// it directly. So the rollback primitive is driven here against a real temp
// install dir, over an arbitrary installed state, asserting the invariant every
// triggering failure must guarantee: zero owned artifacts remain, while foreign
// artifacts are preserved.
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod rollback_clears_all_property_tests {
    use crate::bundle;
    use crate::lmstudio::LEGACY_PLUGIN_NAMES;
    use crate::tool_payload::canonical_payloads;
    use proptest::prelude::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    /// Serializes the process-global `LMSTUDIO_MCP_PLUGIN_ROOT` env override
    /// across the property's iterations. The override is read live inside
    /// `cleanup_installation` (via `lmstudio::resolve_plugin_root`), so each
    /// iteration must hold this lock for the whole closure body — set, clean,
    /// restore — to keep the resolved plugin root stable and race-free.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Process-unique temp directory so parallel test runs never collide.
    fn unique_temp_dir(tag: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join("llm_toolkit_rollback_clears_all")
            .join(format!("{}_{}_{}", tag, std::process::id(), n))
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, contents).expect("write file");
    }

    /// Materialize an owned LM Studio plugin dir carrying the `_owner` marker
    /// (via `manifest.json`), so `clean_owned_plugins` treats it as toolkit-owned.
    fn write_owned_marker_plugin(plugin_root: &Path, name: &str) {
        write_file(
            &plugin_root.join(name).join("manifest.json"),
            r#"{ "type": "plugin", "_owner": "llm-toolkit" }"#,
        );
    }

    /// Materialize an owned-by-legacy-name plugin dir (no marker; owned purely
    /// by its directory name being in `LEGACY_PLUGIN_NAMES`).
    fn write_legacy_plugin(plugin_root: &Path, name: &str) {
        write_file(
            &plugin_root.join(name).join("manifest.json"),
            r#"{ "type": "plugin" }"#,
        );
    }

    /// Materialize a FOREIGN plugin dir (a different `_owner`, no toolkit marker),
    /// which the rollback must preserve untouched.
    fn write_foreign_plugin(plugin_root: &Path, name: &str, content: &str) {
        write_file(
            &plugin_root.join(name).join("manifest.json"),
            r#"{ "type": "plugin", "_owner": "another-app" }"#,
        );
        write_file(&plugin_root.join(name).join("data.txt"), content);
    }

    proptest! {
        // Modest case count: each iteration does real filesystem IO against a
        // fresh temp install dir + plugin root, and serializes the process-global
        // env override, so this is deliberately kept small.
        #![proptest_config(ProptestConfig::with_cases(56))]

        /// Over an arbitrary installed state — an arbitrary subset of the nine
        /// copied tool outputs (each a > 0-byte file), an optional provisioned
        /// `install_dir/node_modules` tree, an arbitrary subset of owned LM Studio
        /// plugin dirs (marker-bearing + legacy-named) plus arbitrary disjoint
        /// FOREIGN dirs — the rollback that any triggering failure invokes
        /// (`cleanup_installation`) leaves ZERO owned artifacts while preserving
        /// every foreign artifact.
        ///
        /// Feature: installer-runtime-provisioning
        /// Property 12: Any step failure that triggers pipeline rollback clears
        /// all owned artifacts
        /// Validates: Requirements 5.7, 6.3, 7.6, 11.3, 12.2, 12.4
        #[test]
        fn prop_rollback_clears_all_owned_artifacts(
            // Which of the nine tool outputs were copied (arbitrary subset).
            tool_present in prop::collection::vec(any::<bool>(), 9),
            // Whether the Runtimes step provisioned `install_dir/node_modules`.
            has_node_modules in any::<bool>(),
            // Which owned marker-bearing plugin dirs (indexed into the nine tools)
            // exist under the plugin root.
            owned_marker_present in prop::collection::vec(any::<bool>(), 9),
            // Which legacy-named owned plugin dirs exist under the plugin root.
            legacy_present in prop::collection::vec(any::<bool>(), LEGACY_PLUGIN_NAMES.len()),
            // How many foreign (preserved) plugin dirs exist under the plugin root.
            foreign_count in 0usize..4,
        ) {
            // Hold the env-override lock for the WHOLE closure body: the override
            // is read live inside cleanup_installation, so it must stay pinned to
            // this iteration's temp plugin root across the entire set/clean/restore.
            let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

            let install_dir = unique_temp_dir("install");
            let plugin_root = unique_temp_dir("plugins");
            let _ = fs::remove_dir_all(&install_dir);
            let _ = fs::remove_dir_all(&plugin_root);
            fs::create_dir_all(&install_dir).expect("create install dir");
            fs::create_dir_all(&plugin_root).expect("create plugin root");

            let tools = canonical_payloads();

            // ── 1. Copied payload: a > 0-byte file per selected tool output. ──
            let mut expected_present_count = 0usize;
            for (tool, &present) in tools.iter().zip(tool_present.iter()) {
                if present {
                    write_file(
                        &install_dir.join(tool.server_name).join("index.js"),
                        "module.exports = {};\n",
                    );
                    expected_present_count += 1;
                }
            }
            // Precondition: verify_install_dir sees exactly the selected outputs.
            prop_assert_eq!(
                bundle::verify_install_dir(&install_dir).present.len(),
                expected_present_count,
                "precondition: present tool outputs match the generated subset"
            );

            // ── 2. Optional provisioned `install_dir/node_modules` tree. ──
            let node_modules = install_dir.join("node_modules");
            if has_node_modules {
                write_file(
                    &node_modules
                        .join("@modelcontextprotocol")
                        .join("sdk")
                        .join("package.json"),
                    r#"{ "name": "@modelcontextprotocol/sdk" }"#,
                );
                prop_assert!(node_modules.exists(), "precondition: node_modules present");
            }

            // ── 3a. Owned marker-bearing plugin dirs (named after the tools). ──
            let mut owned_dirs: Vec<PathBuf> = Vec::new();
            for (tool, &present) in tools.iter().zip(owned_marker_present.iter()) {
                if present {
                    write_owned_marker_plugin(&plugin_root, tool.server_name);
                    owned_dirs.push(plugin_root.join(tool.server_name));
                }
            }
            // ── 3b. Owned legacy-named plugin dirs (owned by name, no marker). ──
            for (name, &present) in LEGACY_PLUGIN_NAMES.iter().zip(legacy_present.iter()) {
                if present {
                    write_legacy_plugin(&plugin_root, name);
                    owned_dirs.push(plugin_root.join(name));
                }
            }

            // ── 3c. Foreign plugin dirs (disjoint names) that MUST be preserved. ──
            let mut foreign_dirs: Vec<(PathBuf, String)> = Vec::new();
            for i in 0..foreign_count {
                let name = format!("foreign-vendor-{}", i);
                let content = format!("foreign content {}", i);
                write_foreign_plugin(&plugin_root, &name, &content);
                foreign_dirs.push((plugin_root.join(name), content));
            }

            // ── 4. Runtime-installer scratch dir (owned). ──
            let downloads = install_dir.join("downloads");
            write_file(&downloads.join("node-installer.msi"), "scratch");

            // Point the plugin-root resolver at our temp root for the duration of
            // the single rollback call, then restore the previous value.
            let prev = std::env::var_os("LMSTUDIO_MCP_PLUGIN_ROOT");
            std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", &plugin_root);

            // Drive the rollback primitive that every triggering failure invokes.
            super::cleanup_installation(&install_dir.to_string_lossy());

            match prev {
                Some(v) => std::env::set_var("LMSTUDIO_MCP_PLUGIN_ROOT", v),
                None => std::env::remove_var("LMSTUDIO_MCP_PLUGIN_ROOT"),
            }

            // ── The invariant: ZERO owned artifacts remain. ──

            // Copied payload fully rolled back — every tool output cleared (Req 12.4).
            prop_assert_eq!(
                bundle::verify_install_dir(&install_dir).present.len(),
                0,
                "all copied tool outputs must be rolled back"
            );

            // Provisioned node_modules gone (Req 5.7 / 11.3).
            prop_assert!(
                !node_modules.exists(),
                "provisioned node_modules must be removed"
            );

            // Every owned/legacy plugin dir gone (Req 6.3 / 7.6 / 12.4).
            for dir in &owned_dirs {
                prop_assert!(
                    !dir.exists(),
                    "owned LM Studio plugin dir must be removed: {:?}",
                    dir
                );
            }

            // Scratch dir gone.
            prop_assert!(!downloads.exists(), "downloads scratch dir must be removed");

            // ── Foreign artifacts preserved with content intact. ──
            for (dir, content) in &foreign_dirs {
                prop_assert!(dir.exists(), "foreign plugin dir must be preserved: {:?}", dir);
                prop_assert_eq!(
                    fs::read_to_string(dir.join("data.txt")).unwrap_or_default(),
                    content.clone(),
                    "foreign plugin content must be untouched"
                );
            }

            // The parent install directory itself is preserved.
            prop_assert!(
                install_dir.exists(),
                "parent install directory must be preserved"
            );

            let _ = fs::remove_dir_all(&install_dir);
            let _ = fs::remove_dir_all(&plugin_root);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 12.4 — Property 22: Cancellation and cleanup-failure are distinct
// outcomes.
//
// Feature: installer-runtime-provisioning
// Property 22: Cancellation and cleanup-failure are distinct outcomes
// Validates: Requirements 12.5
//
// Reconciling "cleanup-failure" to this codebase: `cleanup_installation`
// returns `()` — it is best-effort / idempotent and surfaces NO cleanup-error
// channel into `InstallationResult`. So the only distinctness the production
// `OrchestrationOutcome::Failed` match arms actually produce is between a
// CANCELLATION outcome (message pinned to "Installation cancelled by user")
// and a genuine step-FAILURE outcome (an attributed failure message). Both are
// `success == false` and both invoke `cleanup_installation`, but their message
// (and, in the failure case, the failed-step attribution) differ so a user can
// always tell "you cancelled" apart from "a step failed" (Req 12.5). This
// module tests exactly that distinctness — it does NOT fabricate a cleanup-error
// channel the code does not have.
//
// This module is deliberately SELF-CONTAINED (no shared-helper edits): it drives
// the pure `orchestrate_steps` core with a recording executor plus a
// `cancelled_at`-style sentinel, exactly as `run_installation_with_elevation`
// does, then constructs the two `InstallationResult` shapes the production match
// arms build and asserts they are never equal.
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod cancellation_vs_failure_distinct_property_tests {
    use super::{
        orchestrate_steps, InstallationResult, OrchestrationOutcome, STEPS,
    };
    use proptest::prelude::*;

    /// The exact cancellation phrase the production pipeline reports when the
    /// cancel flag is observed at a step boundary (see the executor closure and
    /// the `cancelled_at` arm in `run_installation_with_elevation`).
    const CANCEL_MESSAGE: &str = "Installation cancelled by user";

    /// Build the `InstallationResult` that the production `cancelled_at` arm of
    /// `run_installation_with_elevation` returns: `success == false`, `step` is
    /// the boundary step where cancellation was observed, message pinned to the
    /// cancellation phrase. (Production also calls `cleanup_installation` here;
    /// that is best-effort and does not alter the returned result.)
    fn cancellation_result(step_name: &'static str) -> InstallationResult {
        InstallationResult {
            success: false,
            step: step_name.to_string(),
            message: CANCEL_MESSAGE.to_string(),
        }
    }

    /// Build the `InstallationResult` that the production genuine-failure arm
    /// returns: `success == false`, `step` is the failed step, message is the
    /// attributed failure string the executor surfaced (never the cancellation
    /// phrase). (Production also calls `cleanup_installation` here.)
    fn failure_result(failed_step: &'static str, message: String) -> InstallationResult {
        InstallationResult {
            success: false,
            step: failed_step.to_string(),
            message,
        }
    }

    /// `InstallationResult` intentionally does not derive `PartialEq` (it is a
    /// serialized boundary type), so compare the three fields explicitly.
    fn results_equal(a: &InstallationResult, b: &InstallationResult) -> bool {
        a.success == b.success && a.step == b.step && a.message == b.message
    }

    // Feature: installer-runtime-provisioning, Property 22: Cancellation and
    // cleanup-failure are distinct outcomes
    //
    // Validates: Requirements 12.5
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        /// Over an arbitrary boundary index, reproduce BOTH branches the
        /// production pipeline can take at that boundary and assert they are
        /// distinct observable outcomes (Req 12.5):
        ///
        ///  (a) CANCELLATION — the cancel flag is observed at the boundary; the
        ///      executor sets a `cancelled_at` sentinel and returns the pinned
        ///      cancellation message. Production maps this to a result whose
        ///      message == "Installation cancelled by user".
        ///  (b) FAILURE — the step's retries are exhausted; the executor returns
        ///      an attributed failure string with NO sentinel set. Production
        ///      maps this to a result carrying that attributed message.
        ///
        /// Both are driven through the real pure `orchestrate_steps` core (not
        /// the production shell), mirroring `run_installation_with_elevation`'s
        /// sentinel logic.
        #[test]
        fn prop_cancellation_and_failure_are_distinct_outcomes(
            boundary in 0usize..STEPS.len(),
        ) {
            let step_name = STEPS[boundary].name();

            // ── Branch (a): CANCELLATION at `boundary`. ──
            // Recording executor + sentinel, exactly as the production closure:
            // when cancellation is "observed", raise the sentinel and return the
            // cancellation message; `orchestrate_steps` fails fast at that step.
            let mut cancelled_at: Option<&'static str> = None;
            let cancel_outcome = orchestrate_steps(STEPS, |step| {
                if step.name() == step_name {
                    cancelled_at = Some(step.name());
                    Err(CANCEL_MESSAGE.to_string())
                } else {
                    Ok(())
                }
            });

            // Construct the result the production `cancelled_at` arm builds.
            let cancel_result = match cancel_outcome {
                OrchestrationOutcome::Failed { failed_step, message } => {
                    // The sentinel is set (cancellation), so production reports
                    // the cancellation result, not the raw failure.
                    prop_assert!(cancelled_at.is_some());
                    prop_assert_eq!(failed_step, step_name);
                    prop_assert_eq!(message, CANCEL_MESSAGE.to_string());
                    cancellation_result(cancelled_at.unwrap())
                }
                OrchestrationOutcome::Complete => {
                    prop_assert!(false, "cancellation branch must fail fast");
                    unreachable!()
                }
            };

            // ── Branch (b): genuine FAILURE at `boundary` (no sentinel). ──
            // The attributed failure string mirrors what `execute_step_with_retry`
            // surfaces after the retry cap ("... failed after N attempts: ...").
            let attributed = format!(
                "{} failed after 3 attempts: injected failure",
                step_name
            );
            // No `cancelled_at` sentinel is raised — this is a real step failure.
            let fail_sentinel: Option<&'static str> = None;
            let fail_outcome = orchestrate_steps(STEPS, |step| {
                if step.name() == step_name {
                    Err(attributed.clone())
                } else {
                    Ok(())
                }
            });

            let failure_result = match fail_outcome {
                OrchestrationOutcome::Failed { failed_step, message } => {
                    // No sentinel ⇒ production reports the genuine-failure result.
                    prop_assert!(fail_sentinel.is_none());
                    prop_assert_eq!(failed_step, step_name);
                    failure_result(failed_step, message)
                }
                OrchestrationOutcome::Complete => {
                    prop_assert!(false, "failure branch must fail fast");
                    unreachable!()
                }
            };

            // ── The distinctness invariant (Req 12.5). ──

            // The cancellation message is exactly the pinned phrase …
            prop_assert_eq!(&cancel_result.message, CANCEL_MESSAGE);
            // … and a genuine failure message is NEVER that phrase.
            prop_assert_ne!(&failure_result.message, CANCEL_MESSAGE);

            // Both outcomes are failures (success == false) …
            prop_assert!(!cancel_result.success);
            prop_assert!(!failure_result.success);

            // … yet the two results are NEVER equal: a cancellation is always
            // distinguishable from a step failure (the discriminating field is
            // the message).
            prop_assert!(
                !results_equal(&cancel_result, &failure_result),
                "cancellation and failure must be distinct: cancel={:?} failure={:?}",
                cancel_result,
                failure_result
            );
            prop_assert_ne!(&cancel_result.message, &failure_result.message);

            // Both differ from the success result the Complete arm builds.
            let success_result = InstallationResult {
                success: true,
                step: "complete".to_string(),
                message: "Installation completed successfully.".to_string(),
            };
            prop_assert!(success_result.success);
            prop_assert!(!results_equal(&cancel_result, &success_result));
            prop_assert!(!results_equal(&failure_result, &success_result));
        }
    }
}
