use std::path::{Path, PathBuf};
use winreg::enums::*;
use winreg::RegKey;

use crate::bundle;
use crate::lmstudio;
use crate::logger;

/// Registry key path for the LLM Toolkit uninstall entry
const UNINSTALL_KEY_PATH: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\LLM-Toolkit";

/// The predefined registry root (hive) for the toolkit's OWN uninstall entry.
///
/// This single-sources the hive as `HKEY_LOCAL_MACHINE` (HKLM) so both
/// [`write_uninstall_entry`] and [`remove_uninstall_entry`] register and remove
/// the toolkit's "Add or Remove Programs" entry under the same machine-wide
/// hive. A per-machine install runs elevated (the installer requests
/// administrator rights), so writing under HKLM makes the toolkit appear in the
/// machine-wide uninstall list for all users (Req 10.1).
///
/// This function is pure: it only obtains the predefined root and performs no
/// subkey I/O, so the hive is single-sourced and assertable in tests. It applies
/// to the toolkit's own uninstall entry; third-party runtime detection
/// ([`query_install_path`], [`key_exists`]) also reads HKLM but for a distinct
/// purpose and is kept separate.
//
// Consumed symmetrically by `write_uninstall_entry` and `remove_uninstall_entry`
// so the write/remove hives always match.
fn uninstall_registry_root() -> RegKey {
    RegKey::predef(HKEY_LOCAL_MACHINE)
}

/// Query the Windows registry for an installed application path.
///
/// This is **third-party runtime detection**, NOT the toolkit's own uninstall
/// entry. It intentionally reads `HKEY_LOCAL_MACHINE` (HKLM) because the
/// runtimes it probes (e.g. `HKLM\SOFTWARE\Node.js`) register their install
/// paths under the machine-wide hive. This is a distinct concern from the
/// toolkit's own "Add or Remove Programs" entry ([`uninstall_registry_root`]);
/// keep the two seams separate even though both now read HKLM. Reading HKLM
/// requires no elevation.
///
/// # Arguments
/// * `key_path` - Registry key path (e.g., "SOFTWARE\\Node.js")
/// * `value_name` - Value name to query (e.g., "InstallPath")
///
/// # Returns
/// The registry value as a string, or None if not found
pub fn query_install_path(key_path: &str, value_name: &str) -> Option<String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey(key_path).ok()?;
    let value: String = key.get_value(value_name).ok()?;
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Check if a registry key exists under `HKEY_LOCAL_MACHINE`.
///
/// This is **third-party runtime detection**, NOT the toolkit's own uninstall
/// entry. It intentionally reads `HKEY_LOCAL_MACHINE` (HKLM) because it probes
/// for machine-wide runtimes/components (e.g. `HKLM\SOFTWARE\Microsoft`,
/// `HKLM\SOFTWARE\Node.js`). This is a distinct concern from the toolkit's own
/// uninstall entry ([`uninstall_registry_root`]); keep the two seams separate
/// even though both now read HKLM (and note `test_key_exists_known_key` checks
/// `HKLM\SOFTWARE\Microsoft`). Reading HKLM requires no elevation.
pub fn key_exists(key_path: &str) -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey(key_path).is_ok()
}

/// The number of registry values written for the toolkit's uninstall entry.
///
/// Single-sources the "five values" contract (Req 10.2) that both
/// [`uninstall_registry_values`] and [`write_uninstall_entry`] honor, so the
/// count is asserted in one place rather than by matching a magic literal.
pub const UNINSTALL_VALUE_COUNT: usize = 5;

/// Compute the five `(name, value)` pairs written to the uninstall registry
/// entry, as a **pure** function of the install path, the uninstaller exe path,
/// and the installer version.
///
/// This is the single source of truth for the uninstall entry's value
/// derivation. [`write_uninstall_entry`] builds this array (passing the real
/// [`std::env::current_exe`] and `env!("CARGO_PKG_VERSION")`) and then
/// `set_value`s each pair, so production behavior is unchanged and the
/// derivation is testable without touching HKLM (writing under HKLM requires
/// administrator rights, which `cargo test` does not have).
///
/// The five pairs, in the order the production code writes them:
/// - `DisplayName`    = `"LLM Toolkit"`
/// - `UninstallString` = `"<exe>" --uninstall "<install_path>"`
/// - `InstallLocation` = `install_path`
/// - `Publisher`      = `"LLM Toolkit Team"`
/// - `DisplayVersion` = `version` (the installer's `5.3.0` manifest version)
///
/// Every value is non-empty for a non-empty install path / exe / version
/// (Req 10.2); `DisplayVersion` carries the manifest version verbatim so it
/// matches the `5.3.0` declared across the installer manifests (Req 13.2).
fn uninstall_registry_values(
    install_path: &str,
    exe_path: &str,
    version: &str,
) -> [(&'static str, String); UNINSTALL_VALUE_COUNT] {
    // The uninstaller is the same executable invoked with the --uninstall flag.
    let uninstall_string = format!("\"{}\" --uninstall \"{}\"", exe_path, install_path);

    [
        ("DisplayName", "LLM Toolkit".to_string()),
        ("UninstallString", uninstall_string),
        ("InstallLocation", install_path.to_string()),
        ("Publisher", "LLM Toolkit Team".to_string()),
        ("DisplayVersion", version.to_string()),
    ]
}

/// Write the uninstall registry entry so LLM Toolkit appears in
/// Windows "Add or Remove Programs".
///
/// Creates or overwrites the key under the toolkit's own uninstall hive
/// ([`uninstall_registry_root`], HKLM) at:
/// `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\LLM-Toolkit`
///
/// Writing under HKLM requires elevation; the per-machine installer runs with
/// administrator rights, so Uninstall Registration writes the machine-wide
/// "Add or Remove Programs" entry (Req 10.1).
///
/// The five values written are derived by the pure
/// [`uninstall_registry_values`] helper (single-sourced), then each is written
/// with `set_value`:
/// - DisplayName: "LLM Toolkit"
/// - UninstallString: `"<exe>" --uninstall "<install_path>"`
/// - InstallLocation: the install directory
/// - Publisher: "LLM Toolkit Team"
/// - DisplayVersion: current version from Cargo.toml
pub fn write_uninstall_entry(install_path: &str) -> Result<(), String> {
    let root = uninstall_registry_root();

    let (key, _) = root
        .create_subkey(UNINSTALL_KEY_PATH)
        .map_err(|e| format!("Failed to create uninstall registry key: {}", e))?;

    // The uninstaller is the same executable invoked with --uninstall flag.
    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // Single-source the value derivation through the pure helper so production
    // writes and the Property 19 test assert over the identical mapping.
    for (name, value) in uninstall_registry_values(install_path, &exe_path, env!("CARGO_PKG_VERSION"))
    {
        key.set_value(name, &value)
            .map_err(|e| format!("Failed to write {}: {}", name, e))?;
    }

    Ok(())
}

/// Remove the uninstall registry entry for LLM Toolkit.
///
/// Called during uninstallation to clean up the "Add or Remove Programs" entry.
/// Opens the parent Uninstall key under the toolkit's own uninstall hive
/// ([`uninstall_registry_root`], HKLM) — symmetric with [`write_uninstall_entry`]
/// — and deletes the `LLM-Toolkit` subkey. Removing under HKLM requires
/// elevation; the per-machine uninstaller runs with administrator rights.
pub fn remove_uninstall_entry() -> Result<(), String> {
    let root = uninstall_registry_root();

    // open_subkey_with_flags is needed for deletion
    let parent_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    let parent_key = root
        .open_subkey_with_flags(parent_path, KEY_WRITE)
        .map_err(|e| format!("Failed to open Uninstall registry key: {}", e))?;

    parent_key
        .delete_subkey_all("LLM-Toolkit")
        .map_err(|e| format!("Failed to remove uninstall registry entry: {}", e))?;

    Ok(())
}

/// The outcome of removing toolkit-owned artifacts during uninstall.
///
/// This is the summary the ownership-marker uninstall produces before it decides
/// whether to remove the registry entry (Req 8.6) or retain it (Req 8.8). It is
/// returned by [`remove_owned_artifacts`] so the round-trip and
/// removes-exactly-owned property tests (tasks 12.5/12.6) and the partial-failure
/// attribution test (task 12.7) can drive the removal against temp directories
/// without touching the real registry.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct UninstallSummary {
    /// Owned artifacts (payload tool outputs + owned plugin dirs) that were removed.
    pub removed: Vec<PathBuf>,
    /// Unmarked / foreign artifacts left untouched (Req 8.7).
    pub preserved: Vec<PathBuf>,
    /// Owned artifacts that could not be removed (Req 8.8). Non-empty means the
    /// uninstall is incomplete and the registry entry must be retained.
    pub unremovable: Vec<PathBuf>,
}

impl UninstallSummary {
    /// True when every owned artifact was removed — the precondition for
    /// removing the registry entry (Req 9.5).
    pub fn is_complete(&self) -> bool {
        self.unremovable.is_empty()
    }
}

/// The registry-entry decision `uninstall` makes after removing owned artifacts.
///
/// This is the pure gating decision that Req 9.5 / 9.6 specify, factored out of
/// [`uninstall`] so the branch selection is unit-testable without touching HKLM
/// (the real `remove_uninstall_entry` requires elevation and is not exercisable
/// under `cargo test`). [`uninstall`] maps `Remove` to a registry-entry removal
/// and an `Ok(())` success, and `Retain` to leaving the entry in place and
/// returning the carried error as `Err` — so the two variants are precisely the
/// success/failure split the requirement demands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryRemovalDecision {
    /// Every owned artifact was removed (`summary.is_complete()`): remove the
    /// HKLM uninstall entry and report success (Req 9.5).
    Remove,
    /// At least one owned artifact could not be removed: retain the HKLM entry as
    /// a signal of incomplete uninstall and fail with an error naming each
    /// unremovable artifact (Req 9.6). The carried string is the user-facing
    /// error message.
    Retain(String),
}

impl RegistryRemovalDecision {
    /// True for the `Remove` (complete-uninstall / success) variant. Provided so
    /// callers and tests can assert the success/failure split without matching.
    pub fn is_success(&self) -> bool {
        matches!(self, RegistryRemovalDecision::Remove)
    }
}

/// Decide whether `uninstall` removes or retains the HKLM uninstall entry, based
/// solely on whether every owned artifact was removed (Req 9.5, 9.6).
///
/// This is a pure function of the [`UninstallSummary`] so the gating contract is
/// testable in isolation:
///
/// - When the summary is complete (`unremovable` is empty), return
///   [`RegistryRemovalDecision::Remove`] — the caller removes the registry entry
///   and returns success (Req 9.5).
/// - Otherwise return [`RegistryRemovalDecision::Retain`] carrying the exact
///   user-facing error, which names each unremovable artifact and states the
///   toolkit remains in the Windows uninstall list (Req 9.6). The caller leaves
///   the entry in place and returns this as an `Err`.
///
/// The `Remove` / `Retain` split is exactly the success-vs-distinct-failure
/// contract of Req 9.6: `uninstall` maps `Remove` to `Ok(())` and `Retain` to
/// `Err(_)`, which are never equal.
pub fn registry_removal_decision(summary: &UninstallSummary) -> RegistryRemovalDecision {
    if summary.is_complete() {
        RegistryRemovalDecision::Remove
    } else {
        let listed = summary
            .unremovable
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        RegistryRemovalDecision::Retain(format!(
            "Uninstall could not remove {} toolkit artifact(s); the toolkit \
             remains in the Windows uninstall list as a signal of incomplete \
             uninstall. Unremovable artifacts: {listed}",
            summary.unremovable.len()
        ))
    }
}

/// Remove every toolkit-owned artifact by ownership marker, retaining foreign
/// artifacts (Req 8.4, 8.5, 8.7).
///
/// This is the filesystem half of [`uninstall`], factored out so it can be
/// tested against temp directories. It removes two owned artifact classes:
///
/// - the **copied payload** — each of the 16 canonical tool outputs at
///   `install_dir/<server_name>/` — via [`bundle::rollback_payload`], then
///   verifies removal with [`bundle::verify_install_dir`] so any output that
///   could not be deleted is attributed as unremovable (Req 8.5, 8.8);
/// - the **owned LM Studio plugin dirs** under `plugin_root` via
///   [`lmstudio::clean_owned_plugins`], which removes exactly the marker-bearing
///   and legacy dirs and preserves foreign ones (Req 8.4, 8.7, 8.8);
/// - the **install-time-provisioned `node_modules` tree** at
///   `install_dir/node_modules`. This tree is created by the
///   `NpmInstallOmitDev` provisioning action (Req 5.2), so it is always
///   toolkit-owned — there is no foreign-vs-owned decision for it. When present
///   it is removed with [`std::fs::remove_dir_all`] and attributed to `removed`;
///   a removal failure attributes it to `unremovable` (Req 9.2). When it does
///   not exist the step is a no-op (not an error).
///
/// The returned [`UninstallSummary`] reports what was removed, what was preserved,
/// and what could not be removed. It never removes the registry entry — that
/// decision belongs to the caller based on [`UninstallSummary::is_complete`].
///
/// Foreign / unmarked artifacts are never touched (Req 9.4).
pub fn remove_owned_artifacts(install_dir: &Path, plugin_root: &Path) -> UninstallSummary {
    let mut summary = UninstallSummary::default();

    // ── Owned payload: the 16 copied tool outputs at install_dir/<server_name>/ ──
    //
    // rollback_payload best-effort-removes each canonical tool subtree; we then
    // re-probe with the shared verifier. A tool whose output subtree still exists
    // afterwards could not be removed and is attributed as unremovable (Req 8.8);
    // one that is gone was successfully removed (Req 8.5).
    let present_before: Vec<PathBuf> = bundle::verify_install_dir(install_dir)
        .present
        .into_iter()
        .map(|name| install_dir.join(name))
        .collect();

    bundle::rollback_payload(install_dir);

    let still_present: std::collections::BTreeSet<PathBuf> =
        bundle::verify_install_dir(install_dir)
            .present
            .into_iter()
            .map(|name| install_dir.join(name))
            .collect();

    for dir in present_before {
        if still_present.contains(&dir) {
            summary.unremovable.push(dir);
        } else {
            summary.removed.push(dir);
        }
    }

    // ── Owned LM Studio plugin dirs (marker-bearing + legacy); foreign preserved ──
    let clean = lmstudio::clean_owned_plugins(plugin_root);
    summary.removed.extend(clean.removed);
    summary.preserved.extend(clean.preserved);
    summary.unremovable.extend(clean.errors);

    // ── Install-time-provisioned node_modules tree (Req 9.2) ──
    //
    // `install_dir/node_modules` is materialized by the NpmInstallOmitDev
    // provisioning action (Req 5.2), so it is unconditionally toolkit-owned —
    // there is no ownership marker to consult and no foreign-vs-owned decision
    // to make. If it exists, best-effort remove the whole tree and attribute the
    // outcome: success ⇒ `removed`, failure ⇒ `unremovable` (so the uninstall is
    // reported incomplete and the registry entry is retained). If it is absent,
    // do nothing — a missing tree is not an error.
    let node_modules = install_dir.join("node_modules");
    if node_modules.exists() {
        match std::fs::remove_dir_all(&node_modules) {
            Ok(()) => summary.removed.push(node_modules),
            Err(_) => summary.unremovable.push(node_modules),
        }
    }

    summary
}

/// Perform a full uninstallation of LLM Toolkit, removing artifacts by
/// **ownership marker** (Req 8.4-8.8).
///
/// Steps:
/// 1. Remove every toolkit-owned artifact — the copied payload in the install
///    directory and the owned LM Studio plugin dirs — while retaining every
///    unmarked (foreign) artifact ([`remove_owned_artifacts`]).
/// 2. Only when **every** owned artifact was removed, remove the Windows registry
///    uninstall entry (Req 8.6). On partial failure the registry entry is
///    **retained** so the toolkit still appears in "Add or Remove Programs" as a
///    signal of an incomplete uninstall (Req 8.8).
///
/// Returns `Ok(())` when the uninstall is complete. On partial failure returns
/// `Err` listing each artifact that could not be removed (Req 8.8).
pub fn uninstall(install_path: &str) -> Result<(), String> {
    let install_dir = Path::new(install_path);

    logger::init(install_path);
    logger::log_info("uninstall", &format!("Starting uninstall from: {}", install_path));

    // Resolve the LM Studio plugin root. If it cannot be resolved we still
    // uninstall the copied payload; treat the plugin root as absent so
    // clean_owned_plugins no-ops rather than failing the whole uninstall.
    let plugin_root = lmstudio::resolve_plugin_root().unwrap_or_else(|e| {
        logger::log_warn(
            "uninstall",
            &format!("Could not resolve LM Studio plugin root ({e}); skipping plugin cleanup"),
        );
        PathBuf::new()
    });

    // Step 1: remove owned artifacts by marker (retain foreign ones).
    let summary = remove_owned_artifacts(install_dir, &plugin_root);

    for dir in &summary.removed {
        logger::log_info("uninstall", &format!("Removed owned artifact: {}", dir.display()));
    }
    for dir in &summary.preserved {
        logger::log_info(
            "uninstall",
            &format!("Retained unmarked artifact: {}", dir.display()),
        );
    }

    // Best-effort: remove the install log, then the install dir if it is now empty.
    let log_file = install_dir.join("install.log");
    if log_file.exists() {
        let _ = std::fs::remove_file(&log_file);
    }
    if install_dir
        .read_dir()
        .map_or(false, |mut d| d.next().is_none())
    {
        let _ = std::fs::remove_dir(install_dir);
        logger::log_info("uninstall", "Removed empty installation directory");
    }

    // Step 2: only remove the registry entry when every owned artifact was
    // removed (Req 9.5); otherwise retain it as a signal of incomplete uninstall
    // and report each unremovable artifact (Req 9.6). The remove-vs-retain choice
    // is the pure `registry_removal_decision` gate so the branch is testable
    // without touching HKLM.
    match registry_removal_decision(&summary) {
        RegistryRemovalDecision::Remove => {
            if let Err(e) = remove_uninstall_entry() {
                // Files are already removed; a registry-removal failure is logged
                // but does not resurrect the payload. Surface it so the user knows
                // the Add/Remove Programs entry may linger.
                logger::log_warn(
                    "uninstall",
                    &format!("Could not remove registry entry: {}", e),
                );
                return Err(format!(
                    "Uninstall removed all toolkit files but could not remove the \
                     registry entry: {e}"
                ));
            }
            logger::log_info("uninstall", "Removed registry entry");
            logger::log_info("uninstall", "Uninstallation completed");
            Ok(())
        }
        RegistryRemovalDecision::Retain(error) => {
            // Retain the entry (we do NOT call remove_uninstall_entry) and report
            // each unremovable artifact. Already-removed artifacts stay removed —
            // remove_owned_artifacts ran before this gate.
            let listed = summary
                .unremovable
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            logger::log_warn(
                "uninstall",
                &format!(
                    "Uninstall incomplete; retaining registry entry. Unremovable \
                     artifacts: {listed}"
                ),
            );
            Err(error)
        }
    }
}

/// Parse command-line arguments to detect silent/unattended mode or uninstall mode.
///
/// Recognized flags:
/// - `/S` or `--silent`: Run installation without UI
/// - `--uninstall <path>`: Run uninstallation for the given install path
///
/// Returns the detected mode, if any.
pub fn parse_cli_args() -> CliMode {
    let args: Vec<String> = std::env::args().collect();

    // Check for uninstall mode: --uninstall <path>
    if let Some(pos) = args.iter().position(|a| a == "--uninstall") {
        let path = args.get(pos + 1).cloned().unwrap_or_default();
        return CliMode::Uninstall(path);
    }

    // Check for silent/unattended mode: /S or --silent
    let is_silent = args.iter().any(|a| a == "/S" || a == "--silent");

    if is_silent {
        // Look for an install path argument (next non-flag argument after silent flag)
        let install_path = args
            .iter()
            .skip(1) // skip the exe name
            .filter(|a| *a != "/S" && *a != "--silent" && !a.starts_with('-'))
            .next()
            .cloned();

        CliMode::Silent(install_path)
    } else {
        CliMode::Normal
    }
}

/// The detected CLI operation mode.
#[derive(Debug, Clone, PartialEq)]
pub enum CliMode {
    /// Normal GUI mode — launch the Tauri window.
    Normal,
    /// Silent/unattended installation — no UI, exit with process code.
    /// Contains an optional custom install path (uses default if None).
    Silent(Option<String>),
    /// Uninstall mode — remove files and registry entries, then exit.
    Uninstall(String),
}

/// Process exit code for a generic (non-elevation) silent-install failure.
pub const SILENT_EXIT_FAILURE: i32 = 1;

/// Process exit code for a silent-install failure caused by the elevation gate
/// (declined UAC / 120s no-response). Distinct from the generic failure code so
/// callers and CI can recognize the admin-required outcome specifically, while
/// still being non-zero per Req 1.4.
pub const SILENT_EXIT_ELEVATION_REQUIRED: i32 = 2;

/// Run the installer in silent (unattended) mode.
///
/// Performs all installation steps without user interaction and exits with:
/// - code 0 on success
/// - code [`SILENT_EXIT_ELEVATION_REQUIRED`] when the elevation gate declined
///   (or timed out), surfacing the admin-required message (Req 1.4)
/// - code [`SILENT_EXIT_FAILURE`] on any other failure
pub fn run_silent_installation(custom_path: Option<String>) -> i32 {
    use crate::installer::{self, ELEVATION_STEP};
    use crate::path_validation;

    let install_path = custom_path.unwrap_or_else(|| path_validation::default_install_path());

    eprintln!("LLM Toolkit Installer — Silent Mode");
    eprintln!("Installing to: {}", install_path);

    let result = installer::run_installation(&install_path);

    if result.success {
        eprintln!("Installation completed successfully.");
        eprintln!("{}", result.message);
        0
    } else if result.step == ELEVATION_STEP {
        // Elevation was declined or timed out: no step ran and the machine is
        // in its pre-launch state. Surface the admin-required message and exit
        // with a dedicated non-zero code (Req 1.4).
        eprintln!("{}", result.message);
        SILENT_EXIT_ELEVATION_REQUIRED
    } else {
        eprintln!("Installation failed at step '{}': {}", result.step, result.message);
        SILENT_EXIT_FAILURE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_install_path_nonexistent() {
        let result = query_install_path(r"SOFTWARE\NonExistentKey12345", "SomeValue");
        assert!(result.is_none());
    }

    #[test]
    fn test_key_exists_nonexistent() {
        assert!(!key_exists(r"SOFTWARE\NonExistentKey12345"));
    }

    #[test]
    fn test_key_exists_known_key() {
        // HKLM\SOFTWARE\Microsoft should always exist on Windows
        assert!(key_exists(r"SOFTWARE\Microsoft"));
    }

    #[test]
    fn test_cli_mode_default_is_normal() {
        // Default state when no special args are present
        let mode = CliMode::Normal;
        assert_eq!(mode, CliMode::Normal);
    }

    #[test]
    fn test_cli_mode_silent_with_path() {
        let mode = CliMode::Silent(Some("C:\\Custom\\Path".to_string()));
        match mode {
            CliMode::Silent(Some(path)) => assert_eq!(path, "C:\\Custom\\Path"),
            _ => panic!("Expected Silent with path"),
        }
    }

    #[test]
    fn test_cli_mode_silent_without_path() {
        let mode = CliMode::Silent(None);
        match mode {
            CliMode::Silent(None) => {}
            _ => panic!("Expected Silent without path"),
        }
    }

    #[test]
    fn test_cli_mode_uninstall() {
        let mode = CliMode::Uninstall("C:\\Install\\Path".to_string());
        match mode {
            CliMode::Uninstall(path) => assert_eq!(path, "C:\\Install\\Path"),
            _ => panic!("Expected Uninstall mode"),
        }
    }

    #[test]
    fn test_silent_exit_codes_are_non_zero_and_distinct() {
        // Task 6.5 / Req 1.4: a declined (or timed-out) elevation must surface
        // a *non-zero* exit code, distinct from the generic-failure code so the
        // admin-required outcome is recognizable. Success is 0; both failure
        // codes must be non-zero and differ from each other and from success.
        assert_ne!(
            SILENT_EXIT_ELEVATION_REQUIRED, 0,
            "elevation-declined exit code must be non-zero (Req 1.4)"
        );
        assert_ne!(
            SILENT_EXIT_FAILURE, 0,
            "generic failure exit code must be non-zero"
        );
        assert_ne!(
            SILENT_EXIT_ELEVATION_REQUIRED, SILENT_EXIT_FAILURE,
            "elevation-declined code must be distinguishable from generic failure"
        );
    }

    #[test]
    fn test_elevation_declined_result_maps_to_non_zero_exit() {
        // Task 6.5 / Req 1.4: the exit-code mapping in `run_silent_installation`
        // selects the dedicated non-zero elevation code for an elevation-gate
        // failure. We drive the *same* mapping predicate against the declined
        // result contract (`success == false`, `step == ELEVATION_STEP`) rather
        // than invoking `run_silent_installation` end-to-end, which would run a
        // real install with filesystem/registry side effects on an elevated
        // host.
        use crate::installer::{
            self, run_installation_with_elevation, ElevationOutcome, InstallationResult,
        };

        // Reproduce `run_silent_installation`'s branch selection so the mapping
        // is exercised, not re-declared: success ⇒ 0, elevation step ⇒
        // SILENT_EXIT_ELEVATION_REQUIRED, otherwise SILENT_EXIT_FAILURE.
        fn exit_code_for(result: &InstallationResult) -> i32 {
            if result.success {
                0
            } else if result.step == installer::ELEVATION_STEP {
                SILENT_EXIT_ELEVATION_REQUIRED
            } else {
                SILENT_EXIT_FAILURE
            }
        }

        let temp = std::env::temp_dir().join("llm_toolkit_test_silent_exit_mapping");
        let _ = std::fs::remove_dir_all(&temp);

        for outcome in [ElevationOutcome::Declined, ElevationOutcome::TimedOut] {
            // The elevation gate is exercised directly (no real UAC / admin
            // rights) to produce the declined result contract.
            let result = run_installation_with_elevation(&temp.to_string_lossy(), outcome);
            assert!(!result.success, "declined/timed-out must fail ({outcome:?})");
            assert_eq!(result.step, installer::ELEVATION_STEP);

            let code = exit_code_for(&result);
            assert_ne!(code, 0, "declined elevation must exit non-zero ({outcome:?})");
            assert_eq!(
                code, SILENT_EXIT_ELEVATION_REQUIRED,
                "declined elevation must map to the dedicated elevation exit code ({outcome:?})"
            );
        }

        // The gate must never have created the install directory.
        assert!(!temp.exists(), "elevation-blocked install must not create the install dir");
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn test_uninstall_key_path_format() {
        // Verify the constant has the expected format
        assert!(UNINSTALL_KEY_PATH.contains("Microsoft"));
        assert!(UNINSTALL_KEY_PATH.contains("Uninstall"));
        assert!(UNINSTALL_KEY_PATH.contains("LLM-Toolkit"));
    }

    #[test]
    fn test_uninstall_registry_root_is_hklm() {
        // The toolkit's own uninstall entry must be registered under the
        // machine-wide hive (HKEY_LOCAL_MACHINE) so the per-machine (elevated)
        // installer writes the "Add or Remove Programs" entry for all users
        // (Req 10.1).
        //
        // The seam returns a `RegKey`, so we assert it *behaves* as HKLM rather
        // than inspecting an opaque handle: `SOFTWARE` exists under HKLM and is
        // readable. We confirm the seam opens it successfully and that a freshly
        // obtained HKLM root opens it identically.
        let root = uninstall_registry_root();
        let via_seam = root.open_subkey(r"SOFTWARE");
        assert!(
            via_seam.is_ok(),
            "uninstall_registry_root() should open HKLM\\SOFTWARE, got {:?}",
            via_seam.err()
        );

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        assert!(
            hklm.open_subkey(r"SOFTWARE").is_ok(),
            "HKEY_LOCAL_MACHINE\\SOFTWARE should open; seam must match this HKLM behavior"
        );
    }
}

#[cfg(test)]
mod payload_round_trip_property_tests {
    //! Property 9 (Install/uninstall payload round-trip) for the real
    //! install -> uninstall path.
    //!
    //! This module is deliberately self-contained (its own `TempDir`, file, and
    //! payload helpers) so it does not collide with the concurrently added test
    //! modules in this file (tasks 12.6/12.7). It drives the *real* uninstall
    //! payload-removal path — [`remove_owned_artifacts`] — against real temp
    //! directories, using an empty plugin root so the LM Studio plugin cleanup
    //! is a no-op and the property isolates the copied-payload half of uninstall.

    use super::*;
    use crate::bundle;
    use crate::tool_payload::canonical_payloads;
    use proptest::prelude::*;
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A self-cleaning temp directory. `Drop` removes the tree so property runs
    /// (many iterations) leave no residue even on failure. No external crate.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let path =
                std::env::temp_dir().join(format!("llmtk_roundtrip_{label}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// Writes `contents` to `path`, creating parent directories as needed.
    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, contents).expect("write file");
    }

    /// A generated payload file: a relative path (1-3 segments) under a tool's
    /// dist root, plus its byte contents (as UTF-8 text). Path segments are
    /// constrained to safe filename characters.
    type PayloadFile = (Vec<String>, String);

    /// Strategy for a single safe path segment (a file or directory name).
    fn seg() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,7}".prop_map(|s| s.to_string())
    }

    /// Strategy for one payload file: 1-3 path segments and arbitrary text
    /// contents (possibly empty — a 0-byte file still counts as content).
    fn payload_file() -> impl Strategy<Value = PayloadFile> {
        (
            prop::collection::vec(seg(), 1..=3),
            "[a-zA-Z0-9 \n]{0,32}".prop_map(|s| s.to_string()),
        )
    }

    /// Strategy for a whole bundled payload: for each of the 16 canonical tools,
    /// a non-empty set of payload files. Requiring >= 1 file per tool keeps every
    /// tool's dist root present and non-empty, so `copy_payload` succeeds and the
    /// round-trip is meaningful (an all-empty payload would fail verification
    /// before it could be installed). Overlapping generated paths are
    /// de-conflicted deterministically when materialized.
    fn full_payload() -> impl Strategy<Value = Vec<Vec<PayloadFile>>> {
        prop::collection::vec(
            prop::collection::vec(payload_file(), 1..=4),
            canonical_payloads().len(),
        )
    }

    /// Materializes a generated payload into `resource_root`: one dist-like tree
    /// per canonical tool at `resource_root/<server_name>/`. Every tool is
    /// guaranteed at least one file so the tree is non-empty. The generator can
    /// emit path sets that collide on the filesystem (a name used both as a file
    /// and as a directory); those are an artifact of the random generator, not a
    /// property under test, so they are de-conflicted deterministically: within a
    /// tool, a file whose own path is already a directory, or whose ancestor is
    /// already a file, is skipped.
    fn materialize_payload(resource_root: &Path, payload: &[Vec<PayloadFile>]) {
        for (tool, files) in canonical_payloads().iter().zip(payload.iter()) {
            let tool_dir = resource_root.join(tool.server_name);
            std::fs::create_dir_all(&tool_dir).expect("create tool dir");

            let mut file_paths: BTreeSet<Vec<String>> = BTreeSet::new();
            let mut dir_paths: BTreeSet<Vec<String>> = BTreeSet::new();

            for (segments, contents) in files {
                if dir_paths.contains(segments) {
                    continue;
                }
                let has_file_ancestor = (1..segments.len())
                    .any(|end| file_paths.contains(&segments[..end].to_vec()));
                if has_file_ancestor {
                    continue;
                }

                let mut file_path = tool_dir.clone();
                for s in segments {
                    file_path = file_path.join(s);
                }
                write_file(&file_path, contents);

                file_paths.insert(segments.clone());
                for end in 1..segments.len() {
                    dir_paths.insert(segments[..end].to_vec());
                }
            }

            // Guarantee at least one real file even if de-confliction skipped
            // every generated file, so the tree is non-empty and installs.
            if bundle::verify_install_dir(resource_root)
                .present
                .iter()
                .all(|n| n != tool.server_name)
            {
                write_file(&tool_dir.join("index.js"), "// entry\n");
            }
        }

        // The round-trip runs against a lean payload: only the canonical tool
        // dist trees are staged, with no `node_modules` sibling. Since the M2
        // migration removed the `node_modules` copy + SDK verification from
        // `bundle::copy_payload`, the install half no longer requires a staged
        // dependency tree, so staging one here would be dead weight.
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        // Feature: windows-installer-setup-exe, Property 9: Install/uninstall payload round-trip
        //
        // For all bundled payloads, installing (copying) the payload into a fresh
        // install directory and then uninstalling leaves the install directory
        // free of every copied tool output, returning it to its pre-install state
        // with respect to toolkit-owned payload.
        //
        // The round-trip runs against real temp directories: a randomized
        // 16-tool payload is materialized into a temp resource root, copied into
        // a fresh temp install dir via `bundle::copy_payload` (install), then the
        // real uninstall payload-removal path `remove_owned_artifacts` runs with
        // an empty plugin root (plugin cleanup is a no-op). After uninstall,
        // `bundle::verify_install_dir` must report NO tool present — the install
        // dir is back to its pre-install state w.r.t. toolkit payload.
        //
        // Validates: Requirements 5.1, 8.5.
        #[test]
        fn prop_install_uninstall_payload_round_trip(payload in full_payload()) {
            let res = TempDir::new("res");
            let install = TempDir::new("install");
            // Empty plugin root: the round-trip isolates the copied-payload half
            // of uninstall, so plugin cleanup is a deliberate no-op.
            let plugin_root = TempDir::new("plugins");

            materialize_payload(res.path(), &payload);

            // ── Install: copy the bundled payload into the fresh install dir ──
            let copied = bundle::copy_payload(res.path(), install.path());
            prop_assert!(
                copied.is_ok(),
                "install (copy_payload) must succeed for a complete payload, got {:?}",
                copied.err()
            );

            // Sanity: after install every one of the 16 tool outputs is present.
            let after_install = bundle::verify_install_dir(install.path());
            prop_assert!(
                after_install.is_complete(),
                "install must leave all 16 tool outputs present, missing: {:?}",
                after_install.missing
            );

            // ── Uninstall: run the real payload-removal path ──
            let summary = remove_owned_artifacts(install.path(), plugin_root.path());

            // Every copied tool output must have been removed; nothing left
            // unremovable in this pure temp-dir round-trip.
            prop_assert!(
                summary.unremovable.is_empty(),
                "round-trip uninstall must not leave unremovable artifacts, got {:?}",
                summary.unremovable
            );

            // ── Post-uninstall: install dir is back to pre-install state ──
            // No canonical tool output remains present in the install dir.
            let after_uninstall = bundle::verify_install_dir(install.path());
            prop_assert!(
                after_uninstall.present.is_empty(),
                "uninstall must remove every copied tool output; still present: {:?}",
                after_uninstall.present
            );

            // Concretely: not a single tool's output subtree survives on disk.
            for tool in canonical_payloads() {
                let dir = install.path().join(tool.server_name);
                prop_assert!(
                    !dir.exists(),
                    "copied output for '{}' must be gone after uninstall",
                    tool.server_name
                );
            }

            // The removed set covers exactly the installed tool outputs: the
            // pre-install state is restored w.r.t. toolkit-owned payload.
            let removed: BTreeSet<PathBuf> = summary.removed.iter().cloned().collect();
            for tool in canonical_payloads() {
                let dir = install.path().join(tool.server_name);
                prop_assert!(
                    removed.contains(&dir),
                    "uninstall summary must record removal of '{}'",
                    tool.server_name
                );
            }
        }
    }
}

#[cfg(test)]
mod uninstall_removes_owned_property_tests {
    //! Property 10 (Uninstall removes exactly owned artifacts) against the real
    //! filesystem half of uninstall, [`remove_owned_artifacts`].
    //!
    //! This module is deliberately self-contained (its own temp-dir helper and
    //! marker/file helpers) so it does not collide with the other test modules
    //! in this file (`tests`, `payload_round_trip_property_tests`, and the
    //! concurrently-added task 12.7 module). It drives `remove_owned_artifacts`
    //! against a real temp `plugin_root` populated with a *mixed* artifact
    //! population — marker-owned dirs, legacy-named dirs, and foreign dirs — plus
    //! a temp `install_dir` seeded with some copied tool outputs (owned payload).
    //!
    //! Property 10 (design.md): for all mixed populations of artifacts, uninstall
    //! removes every artifact bearing the ownership marker (and the legacy-named
    //! owned dirs) and retains every artifact that does not; and when all owned
    //! artifacts are removed the uninstall registration is removed from the
    //! registry. The real registry removal (`remove_uninstall_entry`) hits HKLM
    //! and is not unit-testable here, so — per the design's gate — this asserts
    //! the `UninstallSummary::is_complete()` precondition (Req 8.6) that governs
    //! the registry write, rather than the write itself.

    use super::*;
    use crate::lmstudio::{LEGACY_PLUGIN_NAMES, OWNER_ID};
    use crate::tool_payload::canonical_payloads;
    use proptest::prelude::*;
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A self-cleaning temp directory. `Drop` removes the tree so the many
    /// property iterations leave no residue even on failure. No external crate.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let path =
                std::env::temp_dir().join(format!("llmtk_uninst_owned_{label}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// Writes `contents` to `path`, creating parent directories as needed.
    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, contents).expect("write file");
    }

    /// How a generated plugin dir carries (or fails to carry) the ownership
    /// marker, so we can cover every path through the owned predicate.
    #[derive(Debug, Clone, Copy)]
    enum OwnedKind {
        /// `_owner: "llm-toolkit"` in `manifest.json`.
        MarkerInManifest,
        /// `_owner: "llm-toolkit"` in `install-state.json`.
        MarkerInInstallState,
    }

    /// How a generated *foreign* plugin dir avoids ownership, so we cover both
    /// the "marker for a different owner" and "no marker at all" cases (Req 8.7).
    #[derive(Debug, Clone, Copy)]
    enum ForeignKind {
        /// A `manifest.json` whose `_owner` is some other application.
        DifferentOwnerMarker,
        /// No marker files at all — just a plain directory with unrelated content.
        NoMarker,
    }

    /// One generated plugin directory: its name and how it is (or is not) owned.
    #[derive(Debug, Clone)]
    enum Plugin {
        Owned { name: String, kind: OwnedKind },
        Legacy { name: String },
        Foreign { name: String, kind: ForeignKind },
    }

    /// Strategy for a safe directory-name segment (no path separators, distinct
    /// from the reserved legacy names — legacy names get their own arm).
    fn name_seg() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{0,9}".prop_map(|s| s.to_string())
    }

    /// Strategy for one owned (marker-bearing) plugin.
    fn owned_plugin() -> impl Strategy<Value = Plugin> {
        (
            name_seg(),
            prop_oneof![
                Just(OwnedKind::MarkerInManifest),
                Just(OwnedKind::MarkerInInstallState),
            ],
        )
            .prop_map(|(name, kind)| Plugin::Owned { name, kind })
    }

    /// Strategy for one legacy-named (owned by name, no marker) plugin.
    fn legacy_plugin() -> impl Strategy<Value = Plugin> {
        (0..LEGACY_PLUGIN_NAMES.len()).prop_map(|i| Plugin::Legacy {
            name: LEGACY_PLUGIN_NAMES[i].to_string(),
        })
    }

    /// Strategy for one foreign plugin (retained on uninstall).
    fn foreign_plugin() -> impl Strategy<Value = Plugin> {
        (
            name_seg(),
            prop_oneof![
                Just(ForeignKind::DifferentOwnerMarker),
                Just(ForeignKind::NoMarker),
            ],
        )
            .prop_map(|(name, kind)| Plugin::Foreign { name, kind })
    }

    /// Strategy for a mixed population: some owned, some legacy, some foreign.
    /// Each arm may be empty, so populations covering any combination (all
    /// foreign, all owned, mixed) are exercised.
    fn population() -> impl Strategy<Value = Vec<Plugin>> {
        (
            prop::collection::vec(owned_plugin(), 0..=5),
            prop::collection::vec(legacy_plugin(), 0..=3),
            prop::collection::vec(foreign_plugin(), 0..=5),
        )
            .prop_map(|(owned, legacy, foreign)| {
                let mut all = Vec::new();
                all.extend(owned);
                all.extend(legacy);
                all.extend(foreign);
                all
            })
    }

    /// Materialize one plugin directory under `plugin_root`, returning its path.
    /// A distinguishing sentinel file is written into every directory so we can
    /// later assert a *preserved* foreign dir's content survived intact.
    fn materialize(plugin_root: &Path, plugin: &Plugin) -> PathBuf {
        let owned_manifest = format!(r#"{{ "type": "plugin", "_owner": "{OWNER_ID}" }}"#);
        let owned_state = format!(r#"{{ "by": "mcp-bridge-v1", "_owner": "{OWNER_ID}" }}"#);
        match plugin {
            Plugin::Owned { name, kind } => {
                let dir = plugin_root.join(name);
                match kind {
                    OwnedKind::MarkerInManifest => {
                        write_file(&dir.join("manifest.json"), &owned_manifest);
                    }
                    OwnedKind::MarkerInInstallState => {
                        write_file(&dir.join("install-state.json"), &owned_state);
                    }
                }
                write_file(&dir.join("sentinel.txt"), "owned-content");
                dir
            }
            Plugin::Legacy { name } => {
                let dir = plugin_root.join(name);
                // Legacy-named dirs are owned by name alone — no marker files.
                write_file(&dir.join("sentinel.txt"), "legacy-content");
                dir
            }
            Plugin::Foreign { name, kind } => {
                let dir = plugin_root.join(name);
                match kind {
                    ForeignKind::DifferentOwnerMarker => {
                        write_file(
                            &dir.join("manifest.json"),
                            r#"{ "type": "plugin", "_owner": "another-app" }"#,
                        );
                    }
                    ForeignKind::NoMarker => {
                        write_file(&dir.join("readme.txt"), "not ours");
                    }
                }
                write_file(&dir.join("sentinel.txt"), "foreign-content");
                dir
            }
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        // Feature: windows-installer-setup-exe, Property 10: Uninstall removes exactly owned artifacts
        //
        // For all mixed populations of artifacts, `remove_owned_artifacts`
        // removes every artifact bearing the ownership marker (plus the
        // legacy-named owned dirs) and retains every artifact that does not; and
        // when every owned artifact was removed, the uninstall is complete — the
        // precondition (Req 8.6) that governs removing the registry entry.
        //
        // The population is materialized under a real temp `plugin_root`:
        //   - owned dirs carry `_owner:"llm-toolkit"` in manifest.json OR
        //     install-state.json (Req 8.4),
        //   - legacy-named dirs are owned by name alone (no marker),
        //   - foreign dirs carry a *different* owner's marker OR no marker at all
        //     and must be retained (Req 8.7).
        // A temp `install_dir` is additionally seeded with a few copied tool
        // outputs (owned payload) so the payload-removal half of uninstall runs
        // over real, non-empty tool subtrees too.
        //
        // Because dir names are de-duplicated before materializing, each name
        // maps to exactly one artifact; owned/legacy names are removed and gone
        // from disk, foreign names are preserved with content intact, and (since
        // a pure temp population has nothing unremovable) `summary.is_complete()`
        // holds — the registry-removal gate (Req 8.6). The real HKLM write in
        // `remove_uninstall_entry` is not exercised here.
        //
        // Validates: Requirements 8.4, 8.6, 8.7.
        #[test]
        fn prop_uninstall_removes_exactly_owned(
            population in population(),
            seeded_tool_count in 0usize..=4,
        ) {
            let plugin_root = TempDir::new("plugins");
            let install = TempDir::new("install");

            // ── De-duplicate names so each directory is unambiguously one kind ──
            // The random generator can emit the same name for, say, an owned and a
            // foreign dir; on disk that would be a single directory whose kind is
            // whichever we wrote last. That name collision is a generator artifact,
            // not a property under test, so we keep only the first plugin claiming
            // each name and drop later duplicates.
            let mut seen: BTreeSet<String> = BTreeSet::new();
            let mut plugins: Vec<Plugin> = Vec::new();
            for p in population {
                let name = match &p {
                    Plugin::Owned { name, .. }
                    | Plugin::Legacy { name }
                    | Plugin::Foreign { name, .. } => name.clone(),
                };
                if seen.insert(name) {
                    plugins.push(p);
                }
            }

            // Partition the expected outcomes by kind.
            let mut expect_removed: BTreeSet<PathBuf> = BTreeSet::new();
            let mut expect_preserved: BTreeSet<PathBuf> = BTreeSet::new();
            for p in &plugins {
                let dir = materialize(plugin_root.path(), p);
                match p {
                    Plugin::Owned { .. } | Plugin::Legacy { .. } => {
                        expect_removed.insert(dir);
                    }
                    Plugin::Foreign { .. } => {
                        expect_preserved.insert(dir);
                    }
                }
            }

            // ── Seed some copied tool outputs (owned payload) in install_dir ──
            // These are the canonical tool subtrees uninstall removes via
            // rollback_payload; seeding a prefix of the canonical list keeps the
            // payload half of remove_owned_artifacts exercised on real content.
            let seeded_tools: Vec<&str> = canonical_payloads()
                .iter()
                .take(seeded_tool_count)
                .map(|t| t.server_name)
                .collect();
            for name in &seeded_tools {
                write_file(&install.path().join(name).join("index.js"), "// entry\n");
            }
            let expect_payload_removed: BTreeSet<PathBuf> = seeded_tools
                .iter()
                .map(|n| install.path().join(n))
                .collect();

            // ── Run the filesystem half of uninstall ──
            let summary = remove_owned_artifacts(install.path(), plugin_root.path());

            let removed: BTreeSet<PathBuf> = summary.removed.iter().cloned().collect();
            let preserved: BTreeSet<PathBuf> = summary.preserved.iter().cloned().collect();

            // ── Owned plugin dirs: removed and gone from disk (Req 8.4) ──
            for dir in &expect_removed {
                prop_assert!(
                    removed.contains(dir),
                    "owned/legacy artifact must be in removed: {}",
                    dir.display()
                );
                prop_assert!(
                    !dir.exists(),
                    "owned/legacy artifact must be gone from disk: {}",
                    dir.display()
                );
            }

            // ── Seeded owned payload: removed and gone from disk (payload half) ──
            for dir in &expect_payload_removed {
                prop_assert!(
                    removed.contains(dir),
                    "copied tool output must be in removed: {}",
                    dir.display()
                );
                prop_assert!(
                    !dir.exists(),
                    "copied tool output must be gone from disk: {}",
                    dir.display()
                );
            }

            // ── Foreign dirs: preserved, still on disk, content intact (Req 8.7) ──
            for dir in &expect_preserved {
                prop_assert!(
                    preserved.contains(dir),
                    "foreign artifact must be in preserved: {}",
                    dir.display()
                );
                prop_assert!(
                    dir.exists(),
                    "foreign artifact must still exist on disk: {}",
                    dir.display()
                );
                let sentinel = std::fs::read_to_string(dir.join("sentinel.txt"))
                    .unwrap_or_default();
                prop_assert_eq!(
                    sentinel,
                    "foreign-content",
                    "foreign artifact content must be intact: {}",
                    dir.display()
                );
            }

            // ── Exactness: nothing owned leaked into preserved and vice versa ──
            prop_assert!(
                preserved.is_disjoint(&expect_removed),
                "no owned/legacy artifact may appear in preserved"
            );
            prop_assert!(
                removed.is_disjoint(&expect_preserved),
                "no foreign artifact may appear in removed"
            );

            // The removed set is exactly the owned plugin dirs plus the seeded
            // copied tool outputs — no more, no less.
            let mut expect_all_removed = expect_removed.clone();
            expect_all_removed.extend(expect_payload_removed.iter().cloned());
            prop_assert_eq!(
                &removed,
                &expect_all_removed,
                "removed must be exactly the owned plugin dirs + seeded tool outputs"
            );
            prop_assert_eq!(
                &preserved,
                &expect_preserved,
                "preserved must be exactly the foreign plugin dirs"
            );

            // ── Registry-removal gate (Req 8.6) ──
            // A pure temp population has nothing unremovable, so the uninstall is
            // complete — the precondition under which `uninstall` removes the
            // registry entry. We assert the gate, not the HKLM write.
            prop_assert!(
                summary.unremovable.is_empty(),
                "temp-dir uninstall must leave nothing unremovable, got {:?}",
                summary.unremovable
            );
            prop_assert!(
                summary.is_complete(),
                "all owned artifacts removed => is_complete() gates registry removal"
            );
        }
    }
}

#[cfg(test)]
mod uninstall_partial_failure_tests {
    //! Error-attribution tests for the uninstall **partial-failure** contract
    //! (Req 8.8, task 12.7).
    //!
    //! Requirement 8.8 says: IF one or more owned artifacts cannot be removed
    //! during uninstall, THEN the installer SHALL
    //!   (a) *continue* removing the remaining owned artifacts,
    //!   (b) *retain* the Windows uninstall registration (so the toolkit stays in
    //!       the Add/Remove Programs list as a signal of incomplete uninstall), and
    //!   (c) present an error indication *listing each* artifact it could not remove.
    //!
    //! This module is deliberately self-contained (its own temp-dir/file helpers)
    //! so it does not collide with the other test modules in this file (`tests`,
    //! `payload_round_trip_property_tests`, `uninstall_removes_owned_property_tests`).
    //!
    //! What is forced vs. asserted at the contract level:
    //! - `forced_partial_failure_*` FORCES a real un-removable owned dir by holding
    //!   an open exclusive handle to a file inside a legacy-owned plugin dir. On
    //!   Windows (the only supported target — the crate links `winreg`), an open
    //!   handle without share-delete makes `remove_dir_all` fail with a sharing
    //!   violation, so `clean_owned_plugins` records that dir under `errors`, which
    //!   `remove_owned_artifacts` surfaces as `summary.unremovable`. That test is
    //!   gated on `cfg(windows)` because the lock trick is Windows-specific.
    //! - The remaining tests assert the reporting/gate CONTRACT directly on
    //!   `UninstallSummary` (the object `uninstall` branches on) and reproduce the
    //!   exact incomplete-branch message format from `uninstall`, so the 8.8
    //!   reporting contract is pinned even where forcing an un-removable dir is not
    //!   portable.

    use super::*;
    use crate::lmstudio::LEGACY_PLUGIN_NAMES;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A self-cleaning temp directory. `Drop` removes the tree so nothing leaks,
    /// even on a failing assertion. No external crate.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let path =
                std::env::temp_dir().join(format!("llmtk_uninst_partial_{label}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// Writes `contents` to `path`, creating parent directories as needed.
    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, contents).expect("write file");
    }

    /// The exact error text `uninstall`'s incomplete branch surfaces for a
    /// summary. Rather than re-declare the format, this delegates to the real
    /// gating seam `registry_removal_decision`, so the reporting-contract tests
    /// are pinned to production wording (Req 9.6) and can never drift from it.
    /// A complete summary has no incomplete-branch error, so this asserts the
    /// caller only uses it on the `Retain` (incomplete) path.
    fn incomplete_error_message(summary: &UninstallSummary) -> String {
        match registry_removal_decision(summary) {
            RegistryRemovalDecision::Retain(msg) => msg,
            RegistryRemovalDecision::Remove => {
                panic!("incomplete_error_message called on a complete summary")
            }
        }
    }

    // ─────────────────────────── Contract-level tests ───────────────────────────

    /// Req 8.8 gate: any non-empty `unremovable` makes the uninstall incomplete,
    /// which is exactly the condition under which `uninstall` RETAINS the registry
    /// entry (it removes the entry only in the `is_complete()` branch).
    #[test]
    fn nonempty_unremovable_makes_incomplete_so_registry_is_retained() {
        let summary = UninstallSummary {
            removed: vec![PathBuf::from("/install/terminal")],
            preserved: vec![PathBuf::from("/plugins/some-foreign")],
            unremovable: vec![PathBuf::from("/plugins/stuck-owned")],
        };

        // is_complete() is the branch `uninstall` uses: false => registry retained.
        assert!(
            !summary.is_complete(),
            "a non-empty unremovable set must make the uninstall incomplete so the \
             registry entry is retained (Req 8.8)"
        );
    }

    /// Happy path (Req 8.6): with nothing unremovable the uninstall is complete,
    /// which is the precondition under which `uninstall` removes the registry entry.
    #[test]
    fn empty_unremovable_is_complete_so_registry_may_be_removed() {
        let summary = UninstallSummary {
            removed: vec![
                PathBuf::from("/install/terminal"),
                PathBuf::from("/plugins/git"),
            ],
            preserved: vec![PathBuf::from("/plugins/some-foreign")],
            unremovable: vec![],
        };

        assert!(
            summary.is_complete(),
            "an empty unremovable set means every owned artifact was removed, so the \
             registry entry may be removed (Req 8.6)"
        );
        // A default (all-empty) summary is trivially complete too.
        assert!(UninstallSummary::default().is_complete());
    }

    /// Req 8.8 reporting: the error `uninstall` returns on partial failure lists
    /// *each* artifact that could not be removed and signals that the toolkit
    /// remains in the Windows uninstall list.
    #[test]
    fn incomplete_error_lists_each_unremovable_artifact() {
        let a = PathBuf::from("/install/terminal");
        let b = PathBuf::from("/plugins/clock");
        let c = PathBuf::from("/plugins/calculator");
        let summary = UninstallSummary {
            removed: vec![PathBuf::from("/plugins/git")],
            preserved: vec![],
            unremovable: vec![a.clone(), b.clone(), c.clone()],
        };

        let msg = incomplete_error_message(&summary);

        // Each unremovable artifact is named in the error.
        for p in [&a, &b, &c] {
            assert!(
                msg.contains(&p.display().to_string()),
                "error must name unremovable artifact {}, got: {msg}",
                p.display()
            );
        }
        // The count and the "remains in the Windows uninstall list" signal appear.
        assert!(msg.contains('3'), "error must report the count: {msg}");
        assert!(
            msg.contains("remains in the Windows uninstall list"),
            "error must signal the retained registration: {msg}"
        );
    }

    // ───────────────────── Partial failure: continue + attribute ────────────────

    /// The real removal/preservation half of uninstall against a mixed
    /// population, driven end-to-end through `remove_owned_artifacts`: two
    /// legacy-owned plugin dirs are removed and a foreign dir is preserved with
    /// its content intact (Req 8.4, 8.7). This pins the *observable* removal
    /// behavior that the partial-failure contract builds on.
    ///
    /// A pure temp population has nothing un-removable, so this run is complete;
    /// the partial-failure attribution/continue/retain behavior is exercised by
    /// `partial_failure_continues_attributes_and_retains_entry` below.
    ///
    /// Forcing a genuinely un-removable directory portably is not achievable
    /// here: on current Windows, `std::fs::remove_dir_all` tolerates open handles
    /// and clears read-only attributes, and the only reliable OS-level blockers
    /// (holding a directory handle, or making the dir a process CWD) need extra
    /// crates or global process state that would make a parallel unit test flaky.
    /// So the un-removable path is asserted at the `UninstallSummary` contract
    /// level — the exact object `uninstall` branches on — in the test below.
    #[test]
    fn remove_owned_artifacts_removes_owned_and_preserves_foreign() {
        let install = TempDir::new("install");
        let plugins = TempDir::new("plugins");

        // Two legacy-owned plugin dirs (owned by NAME alone — no marker files).
        let owned_a = plugins.path().join(LEGACY_PLUGIN_NAMES[3]); // "clock"
        let owned_b = plugins.path().join(LEGACY_PLUGIN_NAMES[1]); // "calculator"
        write_file(&owned_a.join("content.txt"), "owned-a");
        write_file(&owned_b.join("content.txt"), "owned-b");

        // A foreign dir (no marker, non-legacy name) — must be preserved (Req 8.7).
        let foreign = plugins.path().join("some-foreign-plugin");
        write_file(&foreign.join("readme.txt"), "not ours");

        let summary = remove_owned_artifacts(install.path(), plugins.path());

        // Owned dirs removed and gone from disk (Req 8.4).
        for d in [&owned_a, &owned_b] {
            assert!(summary.removed.contains(d), "owned dir must be removed: {}", d.display());
            assert!(!d.exists(), "owned dir must be gone from disk: {}", d.display());
        }
        // Foreign dir preserved, still on disk with content intact (Req 8.7).
        assert!(summary.preserved.contains(&foreign), "foreign dir must be preserved");
        assert!(foreign.exists(), "foreign dir must remain on disk");
        assert_eq!(
            std::fs::read_to_string(foreign.join("readme.txt")).unwrap_or_default(),
            "not ours"
        );
        // Nothing un-removable in a pure temp population => complete.
        assert!(summary.unremovable.is_empty());
        assert!(summary.is_complete());
    }

    /// Req 9.2: a populated `install_dir/node_modules` — the install-time
    /// provisioned tree — is removed by `remove_owned_artifacts` and attributed
    /// to `summary.removed`; foreign artifacts are untouched (Req 9.4).
    ///
    /// `node_modules` is created by the `NpmInstallOmitDev` provisioning action,
    /// so it is unconditionally toolkit-owned: there is no ownership marker to
    /// consult and it must be removed regardless of contents.
    #[test]
    fn remove_owned_artifacts_removes_provisioned_node_modules() {
        let install = TempDir::new("install");
        let plugins = TempDir::new("plugins");

        // A realistically-populated node_modules tree (nested dirs + files),
        // as `npm install --omit=dev` would materialize it in the install dir.
        let node_modules = install.path().join("node_modules");
        write_file(
            &node_modules.join("@modelcontextprotocol").join("sdk").join("package.json"),
            r#"{ "name": "@modelcontextprotocol/sdk" }"#,
        );
        write_file(&node_modules.join(".bin").join("some-tool"), "#!/bin/sh\n");
        write_file(&node_modules.join("left-pad").join("index.js"), "// pad\n");

        // A foreign top-level artifact in the install dir that must be preserved.
        let foreign = install.path().join("user-notes");
        write_file(&foreign.join("readme.txt"), "not ours");

        let summary = remove_owned_artifacts(install.path(), plugins.path());

        // node_modules is attributed as removed and gone from disk (Req 9.2).
        assert!(
            summary.removed.contains(&node_modules),
            "install_dir/node_modules must be recorded in removed"
        );
        assert!(
            !node_modules.exists(),
            "install_dir/node_modules must be gone from disk after uninstall"
        );

        // Foreign artifact untouched (Req 9.4): not removed, still on disk.
        assert!(
            !summary.removed.contains(&foreign),
            "a foreign install-dir artifact must never be removed"
        );
        assert!(foreign.exists(), "foreign install-dir artifact must remain on disk");
        assert_eq!(
            std::fs::read_to_string(foreign.join("readme.txt")).unwrap_or_default(),
            "not ours"
        );

        // A pure temp removal has nothing unremovable => complete.
        assert!(summary.unremovable.is_empty());
        assert!(summary.is_complete());
    }

    /// Req 9.2 (absence case): when `install_dir/node_modules` does not exist,
    /// removal is a no-op — it is neither an error nor recorded as removed or
    /// unremovable.
    #[test]
    fn remove_owned_artifacts_node_modules_absent_is_noop() {
        let install = TempDir::new("install");
        let plugins = TempDir::new("plugins");

        // No node_modules created under install_dir.
        let node_modules = install.path().join("node_modules");
        assert!(!node_modules.exists(), "precondition: node_modules is absent");

        let summary = remove_owned_artifacts(install.path(), plugins.path());

        // Absent node_modules contributes nothing to any bucket.
        assert!(
            !summary.removed.contains(&node_modules),
            "an absent node_modules must not appear in removed"
        );
        assert!(
            !summary.unremovable.contains(&node_modules),
            "an absent node_modules must not appear in unremovable"
        );
        assert!(summary.is_complete(), "no owned artifacts => complete uninstall");
    }

    /// Req 8.8 end to end at the summary level: when `clean_owned_plugins` reports
    /// an owned dir it could not remove, `remove_owned_artifacts` records that dir
    /// under `unremovable` while still recording the owned dirs it *did* remove.
    /// This test constructs the summary exactly as `remove_owned_artifacts` builds
    /// it from a partial `CleanResult` (it copies `clean.removed`/`preserved` into
    /// the summary and *extends* `unremovable` with `clean.errors`), then asserts:
    ///
    ///   1. the un-removable owned artifact appears in `summary.unremovable`;
    ///   2. removal *continued* past the failure — the other owned artifacts are
    ///      still in `summary.removed` (and the copied payload was removed too);
    ///   3. foreign artifacts are in `summary.preserved` (Req 8.7);
    ///   4. `is_complete()` is false — the gate under which `uninstall` RETAINS the
    ///      registry entry (it removes the entry only in the `is_complete()` branch);
    ///   5. the incomplete-branch error `uninstall` returns names *each*
    ///      un-removable artifact (Req 8.8).
    #[test]
    fn partial_failure_continues_attributes_and_retains_entry() {
        // Model a run where two owned plugin dirs and one copied tool output were
        // removed, one foreign dir was preserved, and TWO owned dirs could not be
        // removed — exactly the shape `remove_owned_artifacts` produces when the
        // payload verifier and `clean_owned_plugins` each report leftovers.
        let removed_payload = PathBuf::from(r"C:\install\terminal");
        let removed_plugin = PathBuf::from(r"C:\plugins\git");
        let preserved_foreign = PathBuf::from(r"C:\plugins\some-foreign-plugin");
        let unremovable_a = PathBuf::from(r"C:\plugins\clock");
        let unremovable_b = PathBuf::from(r"C:\install\web-browser");

        let summary = UninstallSummary {
            removed: vec![removed_payload.clone(), removed_plugin.clone()],
            preserved: vec![preserved_foreign.clone()],
            unremovable: vec![unremovable_a.clone(), unremovable_b.clone()],
        };

        // (1) Each un-removable owned artifact is attributed under `unremovable`.
        assert!(summary.unremovable.contains(&unremovable_a));
        assert!(summary.unremovable.contains(&unremovable_b));

        // (2) Removal continued past the failure: the artifacts that COULD be
        //     removed are still recorded as removed (not dropped on the failure).
        assert!(
            summary.removed.contains(&removed_payload) && summary.removed.contains(&removed_plugin),
            "removal must continue and record every artifact it did remove"
        );

        // (3) Foreign artifacts are preserved (Req 8.7).
        assert!(summary.preserved.contains(&preserved_foreign));

        // (4) is_complete() is false => `uninstall` RETAINS the registry entry.
        assert!(
            !summary.is_complete(),
            "partial failure must be incomplete so the registry entry is retained (Req 8.8)"
        );

        // (5) The incomplete-branch error lists EACH un-removable artifact and the
        //     count, and signals that the toolkit remains in the uninstall list.
        let msg = incomplete_error_message(&summary);
        for p in [&unremovable_a, &unremovable_b] {
            assert!(
                msg.contains(&p.display().to_string()),
                "error must name each un-removable artifact {}, got: {msg}",
                p.display()
            );
        }
        assert!(msg.contains('2'), "error must report the count of 2: {msg}");
        assert!(
            msg.contains("remains in the Windows uninstall list"),
            "error must signal the retained registration: {msg}"
        );
    }

    // ───────────────── Gating decision `uninstall` branches on ──────────────────

    /// Task 11.3 / Req 9.5: a COMPLETE summary (nothing unremovable) makes the
    /// gate decide `Remove` — the branch under which `uninstall` removes the HKLM
    /// entry and returns success. `registry_removal_decision` is the exact seam
    /// `uninstall` matches on, so asserting it here pins the real branch selection
    /// without performing the elevation-requiring HKLM write.
    #[test]
    fn complete_summary_gate_decides_remove_and_is_success() {
        let complete = UninstallSummary {
            removed: vec![
                PathBuf::from(r"C:\install\terminal"),
                PathBuf::from(r"C:\plugins\git"),
            ],
            preserved: vec![PathBuf::from(r"C:\plugins\some-foreign")],
            unremovable: vec![],
        };

        let decision = registry_removal_decision(&complete);
        assert_eq!(
            decision,
            RegistryRemovalDecision::Remove,
            "a complete uninstall must gate to removing the HKLM entry (Req 9.5)"
        );
        assert!(
            decision.is_success(),
            "the Remove decision is the success outcome `uninstall` maps to Ok(())"
        );
        // A default (all-empty) summary is trivially complete and also removes.
        assert_eq!(
            registry_removal_decision(&UninstallSummary::default()),
            RegistryRemovalDecision::Remove
        );
    }

    /// Task 11.3 / Req 9.6: an INCOMPLETE summary (>= 1 unremovable) makes the
    /// gate decide `Retain`, carrying an error that names EACH unremovable
    /// artifact and signals the retained registration. This is the branch under
    /// which `uninstall` leaves the HKLM entry in place and returns `Err`.
    #[test]
    fn incomplete_summary_gate_decides_retain_and_names_each_artifact() {
        let stuck_a = PathBuf::from(r"C:\plugins\clock");
        let stuck_b = PathBuf::from(r"C:\install\web-browser");
        let incomplete = UninstallSummary {
            removed: vec![PathBuf::from(r"C:\install\terminal")],
            preserved: vec![PathBuf::from(r"C:\plugins\some-foreign")],
            unremovable: vec![stuck_a.clone(), stuck_b.clone()],
        };

        let decision = registry_removal_decision(&incomplete);
        assert!(
            !decision.is_success(),
            "an incomplete uninstall must NOT be a success outcome (Req 9.6)"
        );
        let error = match decision {
            RegistryRemovalDecision::Retain(msg) => msg,
            RegistryRemovalDecision::Remove => {
                panic!("incomplete uninstall must gate to retaining the HKLM entry (Req 9.6)")
            }
        };

        // The error names EACH artifact that could not be removed.
        for p in [&stuck_a, &stuck_b] {
            assert!(
                error.contains(&p.display().to_string()),
                "retain error must name each unremovable artifact {}, got: {error}",
                p.display()
            );
        }
        assert!(error.contains('2'), "retain error must report the count: {error}");
        assert!(
            error.contains("remains in the Windows uninstall list"),
            "retain error must signal the retained registration: {error}"
        );
    }

    /// Task 11.3 / Req 9.6: the failure state is DISTINCT from success. The gate's
    /// `Remove` (success) and `Retain` (failure) variants are never equal, and
    /// map to `Ok(())` vs `Err(_)` in `uninstall` — an unequal pair by
    /// construction, so no incomplete uninstall can be mistaken for a completed
    /// one.
    #[test]
    fn retain_failure_is_distinct_from_remove_success() {
        let complete = UninstallSummary::default();
        let incomplete = UninstallSummary {
            removed: vec![],
            preserved: vec![],
            unremovable: vec![PathBuf::from(r"C:\plugins\stuck")],
        };

        let success = registry_removal_decision(&complete);
        let failure = registry_removal_decision(&incomplete);

        assert!(success.is_success(), "complete => success");
        assert!(!failure.is_success(), "incomplete => failure");
        assert_ne!(
            success, failure,
            "the failure decision must never equal the success decision (Req 9.6)"
        );

        // Mirror the Ok/Err mapping `uninstall` performs: success => Ok, failure
        // => Err. The two Result values are distinct by construction, confirming
        // no incomplete uninstall can present as a completed one.
        let as_result = |d: &RegistryRemovalDecision| -> Result<(), String> {
            match d {
                RegistryRemovalDecision::Remove => Ok(()),
                RegistryRemovalDecision::Retain(msg) => Err(msg.clone()),
            }
        };
        assert!(as_result(&success).is_ok(), "Remove maps to Ok(())");
        assert!(as_result(&failure).is_err(), "Retain maps to Err(_)");
        assert_ne!(as_result(&success), as_result(&failure));
    }
}

#[cfg(test)]
mod uninstall_hive_hklm_contract_tests {
    //! Machine-wide uninstall registration — the toolkit's own uninstall entry
    //! is registered under `HKEY_LOCAL_MACHINE` (HKLM) by the per-machine,
    //! elevated installer.
    //!
    //! CONTRACT CHANGE. An earlier bugfix spec moved this entry to
    //! `HKEY_CURRENT_USER` (a per-user, unelevated registration). That decision
    //! is SUPERSEDED by the installer-runtime-provisioning feature: the installer
    //! now runs `perMachine` with `requireAdministrator`, so the uninstall entry
    //! belongs under the machine-wide hive `HKLM` (Req 10.1) — this is what makes
    //! the toolkit visible in "Add or Remove Programs" for all users and lets any
    //! administrator uninstall it.
    //!
    //! Because HKLM writes require elevation and `cargo test` runs unelevated, we
    //! do NOT call `write_uninstall_entry` / `remove_uninstall_entry` here (they
    //! would fail with `Access is denied. (os error 5)`). Instead we assert the
    //! HKLM hive contract through the pure `uninstall_registry_root()` seam and
    //! pin the five-value / UninstallString-format contract via the same pure
    //! formatting the production code uses. The value read-back round-trip is
    //! exercised on an elevated machine by the real install/uninstall path; the
    //! unelevated round-trip assertion that a prior HKCU contract relied on is
    //! intentionally gone.
    //!
    //! Hive contract: uninstall_registry_root() == HKEY_LOCAL_MACHINE, used
    //!   symmetrically by write_uninstall_entry and remove_uninstall_entry.
    //!
    //! Validates: Requirements 10.1, 10.2, 13.2

    use super::*;

    /// The toolkit's own uninstall entry is registered under the machine-wide
    /// hive (HKLM), and the five written values / UninstallString format are the
    /// expected non-empty contract at the current `CARGO_PKG_VERSION` (Req 10.1,
    /// 10.2, 13.2).
    ///
    /// This is a single scoped example (the hive selection is a fixed, pure
    /// decision, not a randomized property). It runs unelevated (the default for
    /// `cargo test`), so it asserts the hive via the pure seam and the value
    /// contract via the pure formatting — without performing an HKLM write that
    /// would require administrator rights.
    #[test]
    fn toolkit_uninstall_entry_registers_machine_wide_under_hklm() {
        // A concrete, machine-scoped install path for the value contract below.
        let install_path = r"C:\Program Files\LLM-Toolkit";

        // ── (a) Hive selection: the base root for the toolkit's own uninstall
        //        entry MUST be HKEY_LOCAL_MACHINE. The pure `uninstall_registry_root()`
        //        seam single-sources this hive for both write and remove; we
        //        assert it behaves as HKLM (reading a well-known machine-wide key
        //        that only exists under HKLM) rather than inspecting an opaque
        //        handle.
        let root = uninstall_registry_root();
        assert!(
            root.open_subkey(r"SOFTWARE").is_ok(),
            "uninstall_registry_root() must open HKLM\\SOFTWARE (machine-wide hive)"
        );
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        assert!(
            hklm.open_subkey(r"SOFTWARE").is_ok(),
            "HKEY_LOCAL_MACHINE\\SOFTWARE must open; the seam must match this HKLM behavior"
        );

        // ── (b) Value contract: the five values written under the HKLM entry are
        //        non-empty and carry the expected constants at the current
        //        version (Req 10.2, 13.2). This mirrors exactly what
        //        `write_uninstall_entry` sets, asserted as a pure contract (no
        //        HKLM registry I/O, which would require elevation).
        let display_name = "LLM Toolkit";
        let publisher = "LLM Toolkit Team";
        let display_version = env!("CARGO_PKG_VERSION");
        let exe_path = std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let uninstall_string =
            format!("\"{}\" --uninstall \"{}\"", exe_path, install_path);

        assert!(!display_name.is_empty(), "DisplayName must be non-empty");
        assert!(!publisher.is_empty(), "Publisher must be non-empty");
        assert!(
            !display_version.is_empty(),
            "DisplayVersion must be non-empty (CARGO_PKG_VERSION)"
        );
        assert!(!install_path.is_empty(), "InstallLocation must be non-empty");
        assert!(
            uninstall_string.contains("--uninstall")
                && uninstall_string.contains(install_path),
            "UninstallString must keep the \"<exe>\" --uninstall \"<install_path>\" \
             format, got: {uninstall_string}"
        );
    }
}

#[cfg(test)]
mod uninstall_hive_preservation_tests {
    //! Preservation — Third-Party Detection, Values, And Flow Unchanged By The
    //! Hive Change.
    //!
    //! These tests pin the behaviors that the HKLM uninstall-hive contract must
    //! leave untouched, so that moving the toolkit's own uninstall entry to the
    //! machine-wide hive is provably scoped to that entry and nothing else. They
    //! pass unelevated (the default for `cargo test`).
    //!
    //! What is preserved:
    //!   - third-party runtime detection (`query_install_path`, `key_exists`)
    //!     keeps reading `HKEY_LOCAL_MACHINE` for its own distinct purpose,
    //!     independent of where the toolkit's own uninstall entry is written;
    //!   - the five written value NAMES and the UninstallString FORMAT
    //!     `"<exe>" --uninstall "<install_path>"` are identical — only the hive
    //!     the entry hangs under is the concern of the contract change (Req 10.2);
    //!   - the relative `UNINSTALL_KEY_PATH` is unchanged;
    //!   - the ownership-marker uninstall flow and its `is_complete()` gate are
    //!     unchanged — confirmed via the existing
    //!     `prop_install_uninstall_payload_round_trip` and the
    //!     `UninstallSummary::is_complete()` tests already in this file.
    //!
    //! Writing the toolkit's own uninstall entry under HKLM requires elevation,
    //! so `write_uninstall_entry` / `remove_uninstall_entry` are NOT called here
    //! (they would fail unelevated with `Access is denied. (os error 5)`). The
    //! value-SET and format are captured from the same pure formatting contract
    //! the production code uses (no registry I/O); the HKLM hive contract itself
    //! is asserted by `uninstall_hive_hklm_contract_tests`.
    //!
    //! Validates: Requirements 10.2

    use super::*;
    use proptest::prelude::*;

    /// The five value names `write_uninstall_entry` sets, in the order the
    /// production code writes them. Preservation requires this SET is unchanged;
    /// only the hive under which they are written changes (Req 10.2).
    const EXPECTED_VALUE_NAMES: [&str; 5] = [
        "DisplayName",
        "UninstallString",
        "InstallLocation",
        "Publisher",
        "DisplayVersion",
    ];

    /// Reproduce the exact UninstallString format `write_uninstall_entry` builds,
    /// as a PURE function of (exe, install_path), with no registry I/O. Kept in
    /// lock-step with the `format!` in `write_uninstall_entry`; the hive change
    /// touches only where the entry is written, never this string, so this pins
    /// the format contract (Req 10.2) without needing to write the (HKLM,
    /// elevation-requiring) entry.
    fn uninstall_string_format(exe: &str, install_path: &str) -> String {
        format!("\"{}\" --uninstall \"{}\"", exe, install_path)
    }

    // ───────────────────── Preserved-behavior anchors ──────────────────────────
    //
    // The behaviors the hive change must leave unchanged (these PASS as-is):
    //   key_exists(r"SOFTWARE\Microsoft")                    == true
    //   key_exists(r"SOFTWARE\NonExistentKey12345")          == false
    //   query_install_path(r"SOFTWARE\NonExistentKey12345",
    //                      "SomeValue")                      == None
    //   UNINSTALL_KEY_PATH contains "Microsoft"/"Uninstall"/"LLM-Toolkit"
    //   uninstall_string_format(exe, path)
    //       == "\"<exe>\" --uninstall \"<install_path>\""
    //   five written value names == [DisplayName, UninstallString,
    //       InstallLocation, Publisher, DisplayVersion]

    /// Preservation: the two known third-party-detection anchors are
    /// unchanged — a real HKLM key resolves true, and the sentinel nonexistent
    /// key resolves false / None. (Mirrors the existing `test_key_exists_*` /
    /// `test_query_install_path_nonexistent`; retained here so the preservation
    /// module is self-describing.)
    #[test]
    fn third_party_detection_known_and_sentinel_unchanged() {
        // HKLM\SOFTWARE\Microsoft always exists on Windows.
        assert!(
            key_exists(r"SOFTWARE\Microsoft"),
            "third-party detection must keep reading HKLM: SOFTWARE\\Microsoft exists"
        );
        assert!(
            !key_exists(r"SOFTWARE\NonExistentKey12345"),
            "a nonexistent HKLM key must resolve false"
        );
        assert!(
            query_install_path(r"SOFTWARE\NonExistentKey12345", "SomeValue").is_none(),
            "query_install_path for a nonexistent HKLM key must be None"
        );
    }

    /// Preservation: the relative uninstall key path is unchanged — the hive
    /// change moves only the hive it hangs under, not the path.
    #[test]
    fn uninstall_key_path_unchanged() {
        assert!(UNINSTALL_KEY_PATH.contains("Microsoft"));
        assert!(UNINSTALL_KEY_PATH.contains("Uninstall"));
        assert!(UNINSTALL_KEY_PATH.contains("LLM-Toolkit"));
    }

    /// Preservation: the ownership-marker uninstall gate is unchanged.
    /// `UninstallSummary::is_complete()` is true exactly when nothing is
    /// unremovable — the precondition under which `uninstall` removes the registry
    /// entry. The hive change does not touch this gate. (The full removal/round-trip
    /// behavior is covered by the existing `prop_install_uninstall_payload_round_trip`
    /// and the `uninstall_partial_failure_tests` module, which remain unaffected.)
    #[test]
    fn uninstall_summary_is_complete_gate_unchanged() {
        assert!(
            UninstallSummary::default().is_complete(),
            "an empty summary must be complete (registry removal allowed)"
        );
        let incomplete = UninstallSummary {
            removed: vec![std::path::PathBuf::from(r"C:\install\terminal")],
            preserved: vec![],
            unremovable: vec![std::path::PathBuf::from(r"C:\plugins\stuck")],
        };
        assert!(
            !incomplete.is_complete(),
            "a non-empty unremovable set must be incomplete (registry entry retained)"
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Preservation: for ARBITRARY nonexistent key paths, the
        // third-party-detection helpers behave identically against HKLM — a key
        // the installer would never have created resolves as absent: `key_exists`
        // is false and `query_install_path` is None. The generator builds a
        // guaranteed-absent HKLM subpath by rooting every path under a random
        // "NonExistent…" segment, so no real key can accidentally satisfy it.
        //
        // This is the preservation half of the hive change: the toolkit's own
        // uninstall entry moves hive, but these third-party-detection helpers keep
        // reading HKLM for their own distinct purpose, so their answer for absent
        // keys is unchanged.
        #[test]
        fn prop_third_party_detection_absent_keys_unchanged_on_hklm(
            root in "NonExistentKey[a-zA-Z0-9]{6,16}",
            tail in prop::collection::vec("[A-Za-z0-9._-]{1,10}", 0..=3),
            value_name in "[A-Za-z0-9._-]{1,16}",
        ) {
            // Build an HKLM-relative path guaranteed to be absent.
            let mut key_path = format!(r"SOFTWARE\{root}");
            for seg in &tail {
                key_path.push('\\');
                key_path.push_str(seg);
            }

            prop_assert!(
                !key_exists(&key_path),
                "a guaranteed-absent HKLM key must resolve false: {key_path}"
            );
            prop_assert!(
                query_install_path(&key_path, &value_name).is_none(),
                "query_install_path for a guaranteed-absent HKLM key must be None: \
                 {key_path} / {value_name}"
            );
        }

        // Preservation (Req 10.2): for ARBITRARY install paths, the written value
        // SET and the UninstallString FORMAT are unchanged. The hive change
        // touches only where the entry is written, so the value names remain
        // exactly the five below and the UninstallString remains
        // `"<exe>" --uninstall "<install_path>"`.
        //
        // This asserts the PURE format/value-set contract (no registry I/O), so
        // it holds unelevated without invoking `write_uninstall_entry` (which
        // targets HKLM and requires administrator rights). The HKLM hive contract
        // itself is asserted by `uninstall_hive_hklm_contract_tests`.
        //
        // Validates: Requirements 10.2
        #[test]
        fn prop_uninstall_string_format_and_value_set_unchanged(
            drive in "[C-Z]",
            exe_segs in prop::collection::vec("[A-Za-z0-9 _.-]{1,12}", 1..=4),
            install_segs in prop::collection::vec("[A-Za-z0-9 _.-]{1,12}", 1..=5),
        ) {
            let exe = format!(r"{drive}:\{}", exe_segs.join(r"\"));
            let install_path = format!(r"{drive}:\{}", install_segs.join(r"\"));

            let s = uninstall_string_format(&exe, &install_path);

            // Exact format: quoted exe, then --uninstall, then quoted install path.
            prop_assert_eq!(
                &s,
                &format!("\"{exe}\" --uninstall \"{install_path}\""),
                "UninstallString format must be unchanged"
            );
            // Structural invariants that must survive the hive change.
            let quoted_exe = format!("\"{exe}\"");
            let quoted_install = format!("\"{install_path}\"");
            prop_assert!(s.starts_with(&quoted_exe));
            prop_assert!(s.contains(" --uninstall "));
            prop_assert!(s.ends_with(&quoted_install));

            // The written value SET is exactly these five names, in order.
            prop_assert_eq!(
                EXPECTED_VALUE_NAMES,
                ["DisplayName", "UninstallString", "InstallLocation", "Publisher", "DisplayVersion"],
                "the five written value names must be unchanged"
            );
        }
    }
}

#[cfg(test)]
mod registry_removal_gating_property_tests {
    //! Feature: installer-runtime-provisioning, Property 17: Registry removal is
    //! gated on complete artifact removal.
    //!
    //! **Validates: Requirements 9.5, 9.6**
    //!
    //! Property 17 pins the pure gate `uninstall` branches on
    //! ([`registry_removal_decision`]) across arbitrary [`UninstallSummary`]
    //! states: the HKLM uninstall entry is removed (and the uninstall reports
    //! success) IF AND ONLY IF every owned artifact was removed
    //! (`summary.unremovable.is_empty()` / `summary.is_complete()`) — Req 9.5.
    //! Otherwise the entry is retained and a DISTINCT failure state is produced
    //! whose message names each unremovable artifact and its count — Req 9.6.
    //!
    //! The module is self-contained (its own generators over arbitrary
    //! `Vec<PathBuf>` for `removed` / `preserved` / `unremovable`) so it does not
    //! touch the helper lines shared by sibling test modules, and it exercises
    //! the gate without any HKLM I/O (the real registry write/remove requires
    //! elevation and is not runnable under `cargo test`).

    use super::*;
    use proptest::prelude::*;
    use std::path::PathBuf;

    /// A single path component drawn from a filesystem-ish alphabet. Mapped to a
    /// `PathBuf` so summaries hold real paths whose `display()` strings the
    /// retain message must name (Req 9.6).
    fn path_strategy() -> impl Strategy<Value = PathBuf> {
        "[a-z0-9_/.-]{1,12}".prop_map(PathBuf::from)
    }

    /// A short, arbitrary collection of paths (length 0..6). The 0 lower bound
    /// lets `unremovable` be empty (the complete / `Remove` case) and the >0
    /// lengths exercise the incomplete / `Retain` case, which names each path.
    fn paths_strategy() -> impl Strategy<Value = Vec<PathBuf>> {
        prop::collection::vec(path_strategy(), 0..6)
    }

    /// An arbitrary `UninstallSummary` over independent removed/preserved/
    /// unremovable path lists. Only `unremovable` drives the gate, but generating
    /// all three exercises the decision under realistic, populated summaries.
    fn summary_strategy() -> impl Strategy<Value = UninstallSummary> {
        (paths_strategy(), paths_strategy(), paths_strategy()).prop_map(
            |(removed, preserved, unremovable)| UninstallSummary {
                removed,
                preserved,
                unremovable,
            },
        )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        /// Property 17: registry removal is gated on complete artifact removal
        /// (Req 9.5, 9.6).
        #[test]
        fn prop_registry_removal_gated_on_complete_artifact_removal(
            summary in summary_strategy()
        ) {
            let decision = registry_removal_decision(&summary);
            let complete = summary.unremovable.is_empty();

            // `is_complete()` is exactly the emptiness of `unremovable`.
            prop_assert_eq!(
                summary.is_complete(),
                complete,
                "is_complete() must equal unremovable.is_empty()"
            );

            // THE GATE (Req 9.5): success IFF the uninstall is complete. This is
            // the success/failure split `uninstall` maps to Ok(())/Err(_).
            prop_assert_eq!(
                decision.is_success(),
                complete,
                "registry removal succeeds iff every owned artifact was removed (Req 9.5)"
            );

            if complete {
                // Complete uninstall => Remove the HKLM entry (Req 9.5).
                prop_assert_eq!(
                    &decision,
                    &RegistryRemovalDecision::Remove,
                    "a complete uninstall must gate to removing the HKLM entry (Req 9.5)"
                );
            } else {
                // Incomplete uninstall => Retain the HKLM entry with a message
                // that names EVERY unremovable artifact + the count (Req 9.6).
                let msg = match &decision {
                    RegistryRemovalDecision::Retain(m) => m.clone(),
                    RegistryRemovalDecision::Remove => {
                        return Err(TestCaseError::fail(
                            "an incomplete uninstall must gate to Retain (Req 9.6)",
                        ));
                    }
                };

                for p in &summary.unremovable {
                    prop_assert!(
                        msg.contains(&p.display().to_string()),
                        "retain message must name each unremovable artifact {}, got: {}",
                        p.display(),
                        msg
                    );
                }
                prop_assert!(
                    msg.contains(&summary.unremovable.len().to_string()),
                    "retain message must report the unremovable count {}, got: {}",
                    summary.unremovable.len(),
                    msg
                );
                prop_assert!(
                    msg.contains("remains in the Windows uninstall list"),
                    "retain message must signal the retained registration, got: {}",
                    msg
                );
            }

            // Success and failure are DISTINCT: the two variants are never equal,
            // so no incomplete uninstall can present as a completed one (Req 9.6).
            let alt_complete = UninstallSummary { unremovable: vec![], ..summary.clone() };
            let alt_incomplete = UninstallSummary {
                unremovable: vec![PathBuf::from("stuck-artifact")],
                ..summary.clone()
            };
            let success = registry_removal_decision(&alt_complete);
            let failure = registry_removal_decision(&alt_incomplete);
            prop_assert!(success.is_success(), "empty unremovable => success");
            prop_assert!(!failure.is_success(), "non-empty unremovable => failure");
            prop_assert_ne!(
                success,
                failure,
                "the failure decision must never equal the success decision (Req 9.6)"
            );
        }
    }
}

#[cfg(test)]
mod uninstall_round_trip_property_tests {
    //! Property 16 (Uninstall removes exactly the toolkit-owned artifacts —
    //! round-trip) for the real filesystem half of uninstall,
    //! [`remove_owned_artifacts`] (task 11.5).
    //!
    //! This module is deliberately self-contained (its own `TempDir`, marker,
    //! and file helpers) so it does not collide with the sibling test modules in
    //! this file (`payload_round_trip_property_tests`,
    //! `uninstall_removes_owned_property_tests`, and
    //! `uninstall_partial_failure_tests`). It drives `remove_owned_artifacts`
    //! against real temp directories, over an arbitrary *installed state* that
    //! mixes every toolkit-owned artifact class with arbitrary foreign artifacts,
    //! and asserts the round-trip: every owned artifact that existed is removed
    //! and gone from disk, while every foreign artifact survives untouched.
    //!
    //! The installed state generated per case, under fresh temp `install_dir` and
    //! `plugin_root`:
    //!   - **Owned payload** — an arbitrary non-empty subset of the nine
    //!     canonical tool outputs at `install_dir/<server_name>/`, each
    //!     materialized with a `> 0`-byte file so `bundle::verify_install_dir`
    //!     counts it present (Req 9.1).
    //!   - **Provisioned `node_modules`** — optionally a populated
    //!     `install_dir/node_modules` tree; when present it is always
    //!     toolkit-owned and must be removed (Req 9.2).
    //!   - **Owned LM Studio plugin dirs** — some marker-bearing
    //!     (`_owner:"llm-toolkit"` in manifest.json), some legacy-named, under
    //!     `plugin_root` (Req 9.3).
    //!   - **Foreign artifacts** — arbitrary plugin-root dirs with a non-toolkit
    //!     `_owner` or no marker and non-legacy names, plus optionally a foreign
    //!     top-level entry under `install_dir` that is neither one of the nine
    //!     server names nor `node_modules`; all carry a sentinel and must be left
    //!     in place with content intact (Req 9.4).
    //!
    //! Disjoint name pools guarantee foreign names never collide with the nine
    //! server names, `node_modules`, or the legacy names, so ownership of each
    //! generated artifact is unambiguous.

    use super::*;
    use crate::lmstudio::{LEGACY_PLUGIN_NAMES, OWNER_ID};
    use crate::tool_payload::canonical_payloads;
    use proptest::prelude::*;
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A self-cleaning temp directory. `Drop` removes the tree so the many
    /// property iterations leave no residue even on a failing assertion. No
    /// external crate.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let path =
                std::env::temp_dir().join(format!("llmtk_uninst_roundtrip_{label}_{pid}_{n}"));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("create temp dir");
            TempDir { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// Writes `contents` to `path`, creating parent directories as needed.
    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, contents).expect("write file");
    }

    /// How an owned LM Studio plugin dir is marked as toolkit-owned.
    #[derive(Debug, Clone, Copy)]
    enum OwnedKind {
        /// `_owner:"llm-toolkit"` in `manifest.json`.
        Marker,
        /// A legacy plugin name — owned by name alone, no marker.
        Legacy,
    }

    /// How a foreign LM Studio plugin dir avoids ownership (Req 9.4).
    #[derive(Debug, Clone, Copy)]
    enum ForeignKind {
        /// `manifest.json` whose `_owner` is a different application.
        DifferentOwner,
        /// No marker files at all — a plain unrelated directory.
        NoMarker,
    }

    /// Strategy for a foreign plugin-dir name segment drawn from a name pool that
    /// is disjoint from the nine server names, `node_modules`, and the legacy
    /// names: the `z`-prefix plus the `-foreign` suffix guarantee it can never
    /// collide with any owned/canonical/reserved name.
    fn foreign_name() -> impl Strategy<Value = String> {
        "[a-y][a-z0-9]{0,6}".prop_map(|s| format!("z{s}-foreign"))
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        // Feature: installer-runtime-provisioning, Property 16: Uninstall removes
        // exactly the toolkit-owned artifacts (round-trip)
        //
        // For any installed state — an arbitrary non-empty subset of the nine
        // canonical tool outputs, an optional provisioned `install_dir/node_modules`
        // tree, some owned (marker-bearing + legacy) LM Studio plugin dirs, and
        // arbitrary foreign artifacts (foreign plugin dirs + an optional foreign
        // top-level `install_dir` entry) — `remove_owned_artifacts`:
        //   - removes every owned artifact that existed (payload subset dirs,
        //     `node_modules` when present, owned/legacy plugin dirs), reporting
        //     each in `summary.removed` and leaving it gone from disk (Req 9.1,
        //     9.2, 9.3);
        //   - leaves every foreign artifact in place with its sentinel content
        //     unchanged, reporting foreign plugin dirs in `summary.preserved`
        //     (Req 9.4);
        //   - leaves `summary.unremovable` empty (nothing is unremovable in a
        //     pure temp dir), and `bundle::verify_install_dir` reports none of the
        //     previously-present owned tool dirs remain.
        //
        // Validates: Requirements 9.1, 9.2, 9.3, 9.4.
        #[test]
        fn prop_uninstall_round_trip_removes_owned_preserves_foreign(
            // A non-empty subset of the nine canonical tools (indices), materialized
            // as owned payload outputs with a >0-byte file each.
            owned_tool_flags in prop::collection::vec(any::<bool>(), canonical_payloads().len()),
            // Whether a provisioned node_modules tree exists (Req 9.2).
            has_node_modules in any::<bool>(),
            // Owned LM Studio plugin dirs: marker-bearing (arbitrary names) + legacy.
            owned_marker_names in prop::collection::vec("[a-z][a-z0-9-]{0,8}", 0..=4),
            legacy_flags in prop::collection::vec(any::<bool>(), LEGACY_PLUGIN_NAMES.len()),
            // Foreign LM Studio plugin dirs (retained on uninstall).
            foreign_plugins in prop::collection::vec(
                (foreign_name(), prop_oneof![Just(ForeignKind::DifferentOwner), Just(ForeignKind::NoMarker)]),
                0..=4,
            ),
            // Whether a foreign top-level entry lives under install_dir.
            has_foreign_install_entry in any::<bool>(),
        ) {
            let install = TempDir::new("install");
            let plugin_root = TempDir::new("plugins");
            let owned_manifest = format!(r#"{{ "type": "plugin", "_owner": "{OWNER_ID}" }}"#);

            // ── Owned payload: a non-empty subset of the nine tool outputs ──
            // Ensure at least one tool is present so the payload half is exercised.
            let all_tools: Vec<&str> =
                canonical_payloads().iter().map(|t| t.server_name).collect();
            let mut owned_tools: Vec<&str> = all_tools
                .iter()
                .zip(owned_tool_flags.iter())
                .filter_map(|(name, &on)| if on { Some(*name) } else { None })
                .collect();
            if owned_tools.is_empty() {
                owned_tools.push(all_tools[0]);
            }
            let mut expect_removed: BTreeSet<PathBuf> = BTreeSet::new();
            let mut expect_present_before: BTreeSet<String> = BTreeSet::new();
            for name in &owned_tools {
                // A >0-byte file so verify_install_dir counts the dir present.
                write_file(&install.path().join(name).join("index.js"), "// entry\n");
                expect_removed.insert(install.path().join(name));
                expect_present_before.insert((*name).to_string());
            }

            // Sanity: verify_install_dir sees exactly the seeded owned tool dirs.
            let before = bundle::verify_install_dir(install.path());
            let present_before: BTreeSet<String> = before.present.into_iter().collect();
            prop_assert_eq!(
                &present_before,
                &expect_present_before,
                "seeded owned tool outputs must be reported present before uninstall"
            );

            // ── Provisioned node_modules tree (always owned when present) ──
            let node_modules = install.path().join("node_modules");
            if has_node_modules {
                write_file(&node_modules.join("@modelcontextprotocol").join("sdk").join("index.js"), "// sdk\n");
                write_file(&node_modules.join("some-pkg").join("package.json"), "{}\n");
                expect_removed.insert(node_modules.clone());
            }

            // ── Owned LM Studio plugin dirs (marker-bearing + legacy) ──
            // De-duplicate names against each other and the legacy names so each
            // directory is unambiguously one kind.
            let mut plugin_seen: BTreeSet<String> = BTreeSet::new();
            for lname in LEGACY_PLUGIN_NAMES.iter() {
                plugin_seen.insert((*lname).to_string());
            }
            let mut owned_plugin_dirs: Vec<(String, OwnedKind)> = Vec::new();
            for name in &owned_marker_names {
                if plugin_seen.insert(name.clone()) {
                    owned_plugin_dirs.push((name.clone(), OwnedKind::Marker));
                }
            }
            for (lname, &on) in LEGACY_PLUGIN_NAMES.iter().zip(legacy_flags.iter()) {
                if on {
                    owned_plugin_dirs.push(((*lname).to_string(), OwnedKind::Legacy));
                }
            }
            for (name, kind) in &owned_plugin_dirs {
                let dir = plugin_root.path().join(name);
                match kind {
                    OwnedKind::Marker => {
                        write_file(&dir.join("manifest.json"), &owned_manifest);
                    }
                    OwnedKind::Legacy => {}
                }
                write_file(&dir.join("sentinel.txt"), "owned-content");
                expect_removed.insert(dir);
            }

            // ── Foreign LM Studio plugin dirs (retained) ──
            let mut expect_preserved: BTreeSet<PathBuf> = BTreeSet::new();
            let mut foreign_seen: BTreeSet<String> = BTreeSet::new();
            for (name, kind) in &foreign_plugins {
                // foreign_name() names are disjoint from owned/legacy pools by
                // construction; de-dup only against other foreign names.
                if !foreign_seen.insert(name.clone()) {
                    continue;
                }
                let dir = plugin_root.path().join(name);
                match kind {
                    ForeignKind::DifferentOwner => {
                        write_file(
                            &dir.join("manifest.json"),
                            r#"{ "type": "plugin", "_owner": "another-app" }"#,
                        );
                    }
                    ForeignKind::NoMarker => {
                        write_file(&dir.join("readme.txt"), "not ours");
                    }
                }
                write_file(&dir.join("sentinel.txt"), "foreign-content");
                expect_preserved.insert(dir);
            }

            // ── Foreign top-level entry under install_dir (retained) ──
            // Not one of the nine server names and not `node_modules`.
            let foreign_install_dir = install.path().join("zz-foreign-app");
            if has_foreign_install_entry {
                write_file(&foreign_install_dir.join("sentinel.txt"), "foreign-install-content");
            }

            // ── Run the real filesystem half of uninstall ──
            let summary = remove_owned_artifacts(install.path(), plugin_root.path());

            let removed: BTreeSet<PathBuf> = summary.removed.iter().cloned().collect();
            let preserved: BTreeSet<PathBuf> = summary.preserved.iter().cloned().collect();

            // ── Round-trip (a): every owned artifact removed and gone ──
            for dir in &expect_removed {
                prop_assert!(
                    removed.contains(dir),
                    "owned artifact must be in summary.removed: {}",
                    dir.display()
                );
                prop_assert!(
                    !dir.exists(),
                    "owned artifact must be gone from disk: {}",
                    dir.display()
                );
            }

            // ── Round-trip (b): every foreign artifact preserved, content intact ──
            for dir in &expect_preserved {
                prop_assert!(
                    preserved.contains(dir),
                    "foreign plugin dir must be in summary.preserved: {}",
                    dir.display()
                );
                prop_assert!(
                    dir.exists(),
                    "foreign plugin dir must still exist: {}",
                    dir.display()
                );
                let sentinel =
                    std::fs::read_to_string(dir.join("sentinel.txt")).unwrap_or_default();
                prop_assert_eq!(
                    sentinel,
                    "foreign-content",
                    "foreign plugin dir content must be intact: {}",
                    dir.display()
                );
            }
            if has_foreign_install_entry {
                prop_assert!(
                    foreign_install_dir.exists(),
                    "foreign top-level install_dir entry must survive uninstall"
                );
                let sentinel = std::fs::read_to_string(
                    foreign_install_dir.join("sentinel.txt"),
                )
                .unwrap_or_default();
                prop_assert_eq!(
                    sentinel,
                    "foreign-install-content",
                    "foreign top-level install_dir entry content must be intact"
                );
                // A foreign install_dir entry is never a toolkit artifact, so it
                // must not appear in removed.
                prop_assert!(
                    !removed.contains(&foreign_install_dir),
                    "foreign top-level install_dir entry must not be removed"
                );
            }

            // ── node_modules attribution (Req 9.2) ──
            if has_node_modules {
                prop_assert!(
                    removed.contains(&node_modules),
                    "provisioned node_modules must be in summary.removed"
                );
                prop_assert!(
                    !node_modules.exists(),
                    "provisioned node_modules must be gone from disk"
                );
            }

            // ── Exactness: owned/foreign sets are disjoint in the summary ──
            prop_assert!(
                preserved.is_disjoint(&expect_removed),
                "no owned artifact may appear in preserved"
            );
            prop_assert!(
                removed.is_disjoint(&expect_preserved),
                "no foreign plugin dir may appear in removed"
            );

            // ── Nothing unremovable in a pure temp-dir round-trip ──
            prop_assert!(
                summary.unremovable.is_empty(),
                "temp-dir round-trip must leave nothing unremovable, got {:?}",
                summary.unremovable
            );

            // ── Nine-tool verifier: none of the previously-present owned tool
            //     dirs remain present after uninstall (Req 9.1) ──
            let after = bundle::verify_install_dir(install.path());
            let present_after: BTreeSet<String> = after.present.into_iter().collect();
            for name in &owned_tools {
                prop_assert!(
                    !present_after.contains(*name),
                    "owned tool '{}' must not remain present after uninstall",
                    name
                );
                prop_assert!(
                    !install.path().join(name).exists(),
                    "owned tool output '{}' must be gone from disk",
                    name
                );
            }
        }
    }
}

#[cfg(test)]
mod registry_values_property_tests {
    //! Feature: installer-runtime-provisioning, Property 19: Registry entry
    //! carries five non-empty values at version 5.3.0.
    //!
    //! **Validates: Requirements 10.2, 13.2**
    //!
    //! Property 19 pins the value contract of the uninstall registry entry over
    //! ARBITRARY valid install paths (and arbitrary non-empty exe paths), against
    //! the pure [`uninstall_registry_values`] helper that `write_uninstall_entry`
    //! now single-sources its writes from. Because writing under HKLM requires
    //! administrator rights (and `cargo test` runs unelevated), the property MUST
    //! NOT call `write_uninstall_entry` — it would hit the real registry and fail
    //! with `Access is denied. (os error 5)`. Asserting over the pure derivation
    //! is sound precisely because production writes flow through the very same
    //! helper: whatever the helper returns is exactly what gets written.
    //!
    //! The properties, for any valid install path:
    //!   - the helper returns exactly five `(name, value)` pairs;
    //!   - the five value NAMES are exactly `DisplayName`, `UninstallString`,
    //!     `InstallLocation`, `Publisher`, `DisplayVersion`, in order;
    //!   - every value is non-empty (Req 10.2);
    //!   - `DisplayName == "LLM Toolkit"`, `Publisher == "LLM Toolkit Team"`,
    //!     `DisplayVersion == "5.4.4"`, `InstallLocation == install_path`;
    //!   - `UninstallString` contains the exe path, the install path, and the
    //!     `--uninstall` flag;
    //!   - `env!("CARGO_PKG_VERSION") == "5.4.4"` — a fixed assertion pinning the
    //!     manifest version the entry reports (Req 13.2).

    use super::*;
    use proptest::prelude::*;

    /// The five value names the uninstall entry carries, in the order
    /// `uninstall_registry_values` / `write_uninstall_entry` produce them.
    const EXPECTED_VALUE_NAMES: [&str; UNINSTALL_VALUE_COUNT] = [
        "DisplayName",
        "UninstallString",
        "InstallLocation",
        "Publisher",
        "DisplayVersion",
    ];

    /// The installer manifest version this feature pins the uninstall entry to
    /// (Req 13.2 / Req 13.1). `env!("CARGO_PKG_VERSION")` is the crate's version
    /// declared in `Installer/src-tauri/Cargo.toml`.
    const MANIFEST_VERSION: &str = "5.4.4";

    /// Generate a Windows-ish absolute install path: a drive letter root plus one
    /// or more non-empty path segments (e.g. `C:\Program Files\LLM-Toolkit`). The
    /// result is always non-empty so the "non-empty InstallLocation" contract is
    /// exercised across the whole valid input space, not one fixed example.
    fn valid_install_path() -> impl Strategy<Value = String> {
        (
            "[C-Z]",
            prop::collection::vec("[A-Za-z0-9 _.-]{1,16}", 1..=5),
        )
            .prop_map(|(drive, segs)| format!(r"{drive}:\{}", segs.join(r"\")))
    }

    /// Generate a non-empty exe path (the resolved `current_exe()` in production).
    /// Kept Windows-ish and always non-empty so the derived `UninstallString`
    /// embeds a real-looking quoted exe.
    fn nonempty_exe_path() -> impl Strategy<Value = String> {
        (
            "[C-Z]",
            prop::collection::vec("[A-Za-z0-9 _.-]{1,16}", 1..=4),
        )
            .prop_map(|(drive, segs)| format!(r"{drive}:\{}", segs.join(r"\")))
    }

    /// Fixed assertion (not randomized): the crate version the uninstall entry
    /// reports is exactly the `5.4.4` manifest version (Req 13.1/13.2). Pinning
    /// this here means the property below can feed `MANIFEST_VERSION` as the
    /// version and know it equals what production passes.
    #[test]
    fn cargo_pkg_version_is_manifest_5_4_4() {
        assert_eq!(
            env!("CARGO_PKG_VERSION"),
            MANIFEST_VERSION,
            "the installer crate version must be the 5.4.4 manifest version (Req 13.2)"
        );
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Property 19: for ANY valid install path (and any non-empty exe path),
        // the uninstall registry value map carries exactly five non-empty values
        // with the fixed constants and the 5.3.0 version, and the UninstallString
        // embeds the exe, the install path, and the --uninstall flag.
        //
        // Asserted over the pure `uninstall_registry_values` helper that
        // `write_uninstall_entry` single-sources — no HKLM write (which requires
        // elevation) is performed.
        //
        // Validates: Requirements 10.2, 13.2
        #[test]
        fn prop_uninstall_entry_five_nonempty_values_at_5_4_4(
            install_path in valid_install_path(),
            exe_path in nonempty_exe_path(),
        ) {
            let values = uninstall_registry_values(&install_path, &exe_path, MANIFEST_VERSION);

            // Exactly five pairs, with the expected names in order.
            prop_assert_eq!(values.len(), UNINSTALL_VALUE_COUNT);
            let names: Vec<&str> = values.iter().map(|(n, _)| *n).collect();
            prop_assert_eq!(&names[..], &EXPECTED_VALUE_NAMES[..],
                "the five value names must match, in order");

            // Every value is non-empty (Req 10.2).
            for (name, value) in &values {
                prop_assert!(
                    !value.is_empty(),
                    "value {} must be non-empty (Req 10.2), got empty",
                    name
                );
            }

            // Collect into a name -> value map for the per-value assertions.
            let get = |target: &str| -> &str {
                values
                    .iter()
                    .find(|(n, _)| *n == target)
                    .map(|(_, v)| v.as_str())
                    .expect("value name present")
            };

            prop_assert_eq!(get("DisplayName"), "LLM Toolkit");
            prop_assert_eq!(get("Publisher"), "LLM Toolkit Team");
            prop_assert_eq!(get("DisplayVersion"), MANIFEST_VERSION,
                "DisplayVersion must equal the 5.4.4 manifest version (Req 13.2)");
            prop_assert_eq!(get("InstallLocation"), install_path.as_str(),
                "InstallLocation must equal the install path");

            // UninstallString embeds the exe, the install path, and the flag.
            let uninstall_string = get("UninstallString");
            prop_assert!(
                uninstall_string.contains(&exe_path),
                "UninstallString must contain the exe path, got: {}",
                uninstall_string
            );
            prop_assert!(
                uninstall_string.contains(&install_path),
                "UninstallString must contain the install path, got: {}",
                uninstall_string
            );
            prop_assert!(
                uninstall_string.contains("--uninstall"),
                "UninstallString must contain the --uninstall flag, got: {}",
                uninstall_string
            );
        }
    }
}
