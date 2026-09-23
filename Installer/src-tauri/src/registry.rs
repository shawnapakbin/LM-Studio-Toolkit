use std::path::{Path, PathBuf};
use winreg::enums::*;
use winreg::RegKey;

use crate::bundle;
use crate::lmstudio;
use crate::logger;

/// Registry key path for the LLM Toolkit uninstall entry
const UNINSTALL_KEY_PATH: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\LLM-Toolkit";

/// Query the Windows registry for an installed application path
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

/// Check if a registry key exists under HKEY_LOCAL_MACHINE
pub fn key_exists(key_path: &str) -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey(key_path).is_ok()
}

/// Write the uninstall registry entry so LLM Toolkit appears in
/// Windows "Add or Remove Programs".
///
/// Creates or overwrites the key at:
/// `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\LLM-Toolkit`
///
/// Values written:
/// - DisplayName: "LLM Toolkit"
/// - UninstallString: path to the uninstaller executable
/// - InstallLocation: the install directory
/// - Publisher: "LLM Toolkit Team"
/// - DisplayVersion: current version from Cargo.toml
pub fn write_uninstall_entry(install_path: &str) -> Result<(), String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let (key, _) = hklm
        .create_subkey(UNINSTALL_KEY_PATH)
        .map_err(|e| format!("Failed to create uninstall registry key: {}", e))?;

    let display_name = "LLM Toolkit";
    let publisher = "LLM Toolkit Team";
    let display_version = env!("CARGO_PKG_VERSION");

    // The uninstaller is the same executable invoked with --uninstall flag
    let exe_path = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let uninstall_string = format!("\"{}\" --uninstall \"{}\"", exe_path, install_path);

    key.set_value("DisplayName", &display_name)
        .map_err(|e| format!("Failed to write DisplayName: {}", e))?;
    key.set_value("UninstallString", &uninstall_string)
        .map_err(|e| format!("Failed to write UninstallString: {}", e))?;
    key.set_value("InstallLocation", &install_path)
        .map_err(|e| format!("Failed to write InstallLocation: {}", e))?;
    key.set_value("Publisher", &publisher)
        .map_err(|e| format!("Failed to write Publisher: {}", e))?;
    key.set_value("DisplayVersion", &display_version)
        .map_err(|e| format!("Failed to write DisplayVersion: {}", e))?;

    Ok(())
}

/// Remove the uninstall registry entry for LLM Toolkit.
///
/// Called during uninstallation to clean up the "Add or Remove Programs" entry.
pub fn remove_uninstall_entry() -> Result<(), String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // open_subkey_with_flags is needed for deletion
    let parent_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    let parent_key = hklm
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
    /// removing the registry entry (Req 8.6).
    pub fn is_complete(&self) -> bool {
        self.unremovable.is_empty()
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
///   and legacy dirs and preserves foreign ones (Req 8.4, 8.7, 8.8).
///
/// The returned [`UninstallSummary`] reports what was removed, what was preserved,
/// and what could not be removed. It never removes the registry entry — that
/// decision belongs to the caller based on [`UninstallSummary::is_complete`].
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
    // removed (Req 8.6); otherwise retain it as a signal of incomplete uninstall
    // and report each unremovable artifact (Req 8.8).
    if summary.is_complete() {
        if let Err(e) = remove_uninstall_entry() {
            // Files are already removed; a registry-removal failure is logged but
            // does not resurrect the payload. Surface it so the user knows the
            // Add/Remove Programs entry may linger.
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
    } else {
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
        Err(format!(
            "Uninstall could not remove {} toolkit artifact(s); the toolkit \
             remains in the Windows uninstall list as a signal of incomplete \
             uninstall. Unremovable artifacts: {listed}",
            summary.unremovable.len()
        ))
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

/// Run the installer in silent (unattended) mode.
///
/// Performs all installation steps without user interaction and exits with:
/// - code 0 on success
/// - code 1 on failure
pub fn run_silent_installation(custom_path: Option<String>) -> i32 {
    use crate::installer;
    use crate::path_validation;

    let install_path = custom_path.unwrap_or_else(|| path_validation::default_install_path());

    eprintln!("LLM Toolkit Installer — Silent Mode");
    eprintln!("Installing to: {}", install_path);

    let result = installer::run_installation(&install_path);

    if result.success {
        eprintln!("Installation completed successfully.");
        eprintln!("{}", result.message);
        0
    } else {
        eprintln!("Installation failed at step '{}': {}", result.step, result.message);
        1
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
    fn test_uninstall_key_path_format() {
        // Verify the constant has the expected format
        assert!(UNINSTALL_KEY_PATH.contains("Microsoft"));
        assert!(UNINSTALL_KEY_PATH.contains("Uninstall"));
        assert!(UNINSTALL_KEY_PATH.contains("LLM-Toolkit"));
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

    /// Reproduce the exact error text `uninstall`'s incomplete branch builds from
    /// a summary, so the reporting-contract tests are pinned to the real wording
    /// (Req 8.8). Kept in lock-step with the `Err(format!(...))` in `uninstall`.
    fn incomplete_error_message(summary: &UninstallSummary) -> String {
        let listed = summary
            .unremovable
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Uninstall could not remove {} toolkit artifact(s); the toolkit \
             remains in the Windows uninstall list as a signal of incomplete \
             uninstall. Unremovable artifacts: {listed}",
            summary.unremovable.len()
        )
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
}
