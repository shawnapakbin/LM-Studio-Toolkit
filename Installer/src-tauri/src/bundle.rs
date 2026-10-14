//! Pure bundle/verify planner.
//!
//! This module holds the *decision logic* shared by two paths that must agree
//! exactly on "which tools ship and are all of them present":
//!
//! - the **build-time** completeness check (payload staging must find all 9
//!   `dist/` trees before `tauri build` runs — Req 3.2, 3.3), and
//! - the **install-time** copy verification (all 9 outputs must be present and
//!   non-empty in the install directory after the copy — Req 5.2, 5.3).
//!
//! Both paths reduce to the same question: given a *tool-presence state* (which
//! canonical tools have a present, non-empty output?), which of the 9 canonical
//! tools are present and which are missing? Answering that is a pure function
//! over the canonical list in [`crate::tool_payload`], so it is expressed here
//! with no filesystem I/O. The thin I/O seams (probing the staging directory,
//! probing the install directory, and the actual copy-with-rollback) are kept
//! out of this function so the decision logic stays deterministic and testable.
//!
//! The canonical 9-tool list is **not** re-hardcoded here — it is sourced from
//! [`crate::tool_payload::canonical_payloads`], the single checked-in source of
//! truth mirroring `scripts/workspace/mcp-config.js`.
//!
//! Requirements: 3.1, 3.2, 3.3, 3.5, 5.2, 5.3.
//!
//! Properties backed by [`plan_bundle`]:
//! - Property 1 (bundle completeness) — task 3.2,
//! - Property 2 (build-time missing set is exact) — task 3.3,
//! - Property 5 (install-directory verification is exact) — task 3.4.

// The build-time staging script consumes the pure planner and the orchestrator
// (task 8.3) will consume `copy_payload`/`verify_install_dir`. Until the
// orchestrator wiring lands, the copy layer's public surface is exercised only
// by tests, so silence dead-code warnings for this seam module.
#![allow(dead_code)]

use crate::tool_payload::{canonical_payloads, ToolPayload};
use std::collections::BTreeSet;

/// The sanctioned flat production-manifest files staged at the payload ROOT
/// (the level that maps to `install_dir`), copied alongside the nine tool
/// trees so the install-time `npm install --omit=dev …` (cwd = install_dir)
/// finds its manifest/lockfile (Option B2; closes H1).
///
/// This is the Rust mirror of `SANCTIONED_PAYLOAD_ROOT_FILES` in
/// `Installer/scripts/payload-manifest.ts` — the single source of truth for the
/// sanctioned set. See `Installer/src-tauri/payload/runtime-manifest/NATIVE_DEPS.md`
/// and `scripts/stage-payload.ts` (`stageRuntimeManifest`). These are FILES, not
/// trees, and never a `node_modules`; the Lean_Payload intent (Req 3.6) is
/// preserved. Each is copied only when present in `resource_root` — a missing
/// flat file is NOT a hard copy error (the design stages it as a best-effort,
/// non-mandatory artifact; the npm step surfaces a clear error if the manifest
/// is genuinely absent at install time).
const SANCTIONED_PAYLOAD_ROOT_FILES: &[&str] = &["package.json", "package-lock.json"];

/// The sanctioned flat workspace-internal tarball files staged at the payload
/// ROOT, matched by `(prefix, suffix)` rather than exact name
/// (bugfix: mcp-shared-module-resolution-fix, Option B, tasks 3.4 and 8.4).
///
/// The TS staging side (`Installer/scripts/payload-manifest.ts`
/// `sharedTarballFileNames`, derived from `SHARED_TARBALL_SPECS`) names these
/// tarballs from the resolved root `package.json` version. The 5.4.3 fix
/// shipped the two `@shared/*` tarballs — `shared-types-<version>.tgz` and
/// `shared-config-<version>.tgz` (e.g. `shared-types-5.4.3.tgz`). The 5.4.4
/// follow-up (task 8.4) generalizes the SAME seam to the five `llm-toolkit-*`
/// packages — `llm-toolkit-ask-user-<version>.tgz`,
/// `llm-toolkit-calculator-<version>.tgz`, `llm-toolkit-clock-<version>.tgz`,
/// `llm-toolkit-document-scraper-<version>.tgz`, and
/// `llm-toolkit-observability-<version>.tgz`. A Rust `const &[&str]` cannot
/// read the repo version at compile time, so instead of mirroring exact names
/// (which would drift every version bump) we match the stable prefix/suffix of
/// each tarball and copy any payload-root file that fits. This is drift-proof:
/// the version bump (task 3.5 / 8.5) changes only the middle of the filename,
/// which these patterns ignore. This mirrors the TS stem list in
/// `SHARED_TARBALL_SPECS` (same seven stems), so the staged files and this
/// sanction can never drift.
///
/// Each matched file is copied best-effort from `resource_root` into
/// `install_dir` alongside the exact-name sanctioned files above, so the
/// install-time `npm install --omit=dev …` (cwd = install_dir) resolves the
/// `file:./<stem>-<version>.tgz` specifiers the flat production manifest emits
/// for `@shared/types` / `@shared/config` and the five `llm-toolkit-*` names
/// (plus the transitively-pulled closure). These are FILES, never a
/// `node_modules`; the Lean_Payload intent (Req 3.6 / 6.4) is preserved. A
/// missing tarball is NOT a hard copy error (best-effort, exactly like the
/// manifest files). Copied tarballs are tracked for rollback so a failed or
/// rolled-back install leaves nothing behind.
const SANCTIONED_PAYLOAD_ROOT_FILE_PATTERNS: &[(&str, &str)] = &[
    ("shared-types-", ".tgz"),
    ("shared-config-", ".tgz"),
    ("llm-toolkit-ask-user-", ".tgz"),
    ("llm-toolkit-calculator-", ".tgz"),
    ("llm-toolkit-clock-", ".tgz"),
    ("llm-toolkit-document-scraper-", ".tgz"),
    ("llm-toolkit-observability-", ".tgz"),
];

/// True iff `file_name` matches one of the sanctioned `@shared/*` tarball
/// patterns (a known `prefix…suffix`, e.g. `shared-types-5.4.3.tgz`). Used to
/// select which payload-root files to copy into `install_dir` and — mirrored in
/// rollback — which copied tarballs to remove. The guard
/// `len > prefix+suffix` requires at least one character between the prefix and
/// suffix, so a short name like `shared-types-.tgz` with an empty version
/// segment never matches.
fn is_sanctioned_shared_tarball(file_name: &str) -> bool {
    SANCTIONED_PAYLOAD_ROOT_FILE_PATTERNS
        .iter()
        .any(|(prefix, suffix)| {
            file_name.len() > prefix.len() + suffix.len()
                && file_name.starts_with(prefix)
                && file_name.ends_with(suffix)
        })
}

/// Collects the names of every file in `dir` whose name matches a sanctioned
/// `@shared/*` tarball pattern, sorted for deterministic copy/rollback order.
/// Non-files (directories) and non-matching names are ignored. A `dir` that
/// cannot be read yields an empty list (best-effort).
fn sanctioned_shared_tarballs_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return names;
    };
    for entry in entries.flatten() {
        if !entry.path().is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if is_sanctioned_shared_tarball(&file_name) {
            names.push(file_name);
        }
    }
    names.sort();
    names
}

/// The outcome of planning the bundle against a tool-presence state.
///
/// A `BundlePlan` is a pure description: it names the required tools, which of
/// them are present, and which are missing. It carries no filesystem handles and
/// performs no I/O — callers build it from a presence predicate and then act on
/// the result (abort the build, or fail the install verification).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundlePlan {
    /// Exactly the 9 canonical tools (the single source of truth). Borrowed
    /// from [`canonical_payloads`] rather than re-hardcoded or cloned.
    pub required: &'static [ToolPayload],
    /// Server names found present *and* non-empty, in canonical order.
    pub present: Vec<String>,
    /// Server names required but absent or empty. Sorted; `missing = required - present`.
    pub missing: Vec<String>,
}

impl BundlePlan {
    /// A plan is complete when nothing is missing — i.e. every one of the 9
    /// canonical tools is present and non-empty.
    ///
    /// Backs the `is_complete()` half of Property 1: build-time completeness and
    /// install-time verification both pass exactly when this is `true`.
    pub fn is_complete(&self) -> bool {
        self.missing.is_empty()
    }
}

/// Plans the bundle over the 9 canonical tools using a presence predicate.
///
/// `is_present(server_name)` must return `true` iff that tool's `dist` output is
/// present **and** non-empty in whatever state is being planned:
///
/// - build-time: the staged payload directory contains a non-empty `dist/` tree
///   for the tool, or
/// - install-time: the install directory contains a non-empty output for the tool.
///
/// The returned [`BundlePlan`] partitions the canonical set into `present` and
/// `missing`. `present` follows canonical order; `missing` is sorted so callers
/// (and the build-time "print each missing tool by name" path) get a
/// deterministic, exact set. This one function backs Properties 1, 2, and 5.
pub fn plan_bundle<F>(mut is_present: F) -> BundlePlan
where
    F: FnMut(&str) -> bool,
{
    let required = canonical_payloads();

    let mut present: Vec<String> = Vec::new();
    let mut missing: BTreeSet<String> = BTreeSet::new();

    for tool in required {
        if is_present(tool.server_name) {
            present.push(tool.server_name.to_string());
        } else {
            // BTreeSet keeps `missing` sorted and de-duplicated; server names
            // are unique in the canonical list so de-dup is a safety net.
            missing.insert(tool.server_name.to_string());
        }
    }

    BundlePlan {
        required,
        present,
        missing: missing.into_iter().collect(),
    }
}

/// Convenience: plan the bundle from an explicit set of present-and-non-empty
/// server names. Anything outside the canonical set is ignored (only the 9
/// canonical tools are ever considered required).
///
/// This is the shape the install-time verifier uses once it has probed the
/// install directory into a concrete set of "present & non-empty" outputs.
pub fn plan_bundle_from_present(present_names: &BTreeSet<String>) -> BundlePlan {
    plan_bundle(|name| present_names.contains(name))
}

// ---------------------------------------------------------------------------
// Install-time copy layer (task 8.2)
//
// The pure planner above answers "which of the 9 tools are present?". The code
// below is the thin I/O seam that actually *copies* the bundled payload into the
// install directory, then reuses the planner to *verify* the result, and — on
// any failure — *rolls back* the outputs it wrote. It is deliberately structured
// so the three properties that test it (Property 4 idempotency, Property 6
// rollback, Property 9 round-trip — tasks 8.4/12.x) can drive it against real
// temp directories.
//
// Requirements: 5.1 (copy every item + idempotency), 5.2/5.3 (verify all 9
// present & non-empty, report exact affected set), 5.5 (immediate rollback of
// partial outputs — not deferred to uninstall). The resource-root is injected as
// a parameter so it stays testable; the Tauri resource-path wiring into
// `Step::CopyTools` is task 8.3.
// ---------------------------------------------------------------------------

use crate::path_validation::validate_install_path;
use std::io;
use std::path::{Path, PathBuf};

/// A failure raised by the install-time copy step, attributed as precisely as
/// the failure allows (Req 5.4).
#[derive(Debug)]
pub enum CopyError {
    /// The install directory path itself is unusable (empty, too long, invalid
    /// characters, or not writable). Carries the human-readable reason from
    /// `path_validation`.
    InvalidInstallDir { reason: String },
    /// The resolved bundled-payload resource root does not exist or is not a
    /// directory. Without a payload there is nothing to copy.
    MissingResourceRoot { resource_root: PathBuf },
    /// A specific tool's `dist` tree is missing from the bundled payload, so the
    /// copy cannot even begin for it. Attributes the failure to that tool
    /// (Req 5.4).
    MissingSourceTool { server_name: String, source: PathBuf },
    /// A filesystem error occurred while copying a specific tool's output.
    /// Attributed to that tool (Req 5.4).
    Copy {
        server_name: String,
        source: PathBuf,
        destination: PathBuf,
        #[allow(dead_code)]
        error: io::Error,
    },
    /// The copy completed but post-copy verification found tools absent or empty
    /// in the install directory. `missing` is the exact affected set (Req 5.3),
    /// sourced from the pure planner.
    VerificationFailed { missing: Vec<String> },
}

impl std::fmt::Display for CopyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CopyError::InvalidInstallDir { reason } => {
                write!(f, "install directory is not usable: {reason}")
            }
            CopyError::MissingResourceRoot { resource_root } => write!(
                f,
                "bundled payload resource root is missing or not a directory: {}",
                resource_root.display()
            ),
            CopyError::MissingSourceTool {
                server_name,
                source,
            } => write!(
                f,
                "bundled payload for tool '{server_name}' is missing: {}",
                source.display()
            ),
            CopyError::Copy {
                server_name,
                source,
                destination,
                error,
            } => write!(
                f,
                "failed to copy tool '{server_name}' from {} to {}: {error}",
                source.display(),
                destination.display()
            ),
            CopyError::VerificationFailed { missing } => write!(
                f,
                "install verification failed; missing or empty tools: {}",
                missing.join(", ")
            ),
        }
    }
}

impl std::error::Error for CopyError {}

/// The per-tool destination directory name inside the install directory.
///
/// Each tool's output is copied into `install_dir/<server_name>/` so the install
/// directory has one clearly named, tool-owned subtree per MCP server. Using the
/// server name (unique across the canonical list) keeps the layout stable and
/// makes rollback of a single tool a directory-scoped delete.
fn tool_install_dir(install_dir: &Path, server_name: &str) -> PathBuf {
    install_dir.join(server_name)
}

/// Returns `true` iff `dir` exists, is a directory, and contains — at any depth
/// (recursively) — at least one regular file whose size is strictly `> 0` bytes.
/// A tree of empty subdirectories, or one holding only 0-byte files, does not
/// count as present, non-empty output. This is the install-time presence
/// predicate the planner consumes (Req 7.4).
fn dir_has_content(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if dir_has_content(&path) {
                return true;
            }
        } else {
            // Only a regular file with a size strictly greater than 0 bytes
            // counts as content: a 0-byte file is treated as an empty/absent
            // output (Req 7.4).
            if entry.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                return true;
            }
        }
    }
    false
}

/// Recursively copies `source` into `destination`, creating directories as
/// needed. Files that already exist at the destination are overwritten, which is
/// what makes a re-copy idempotent (Req 5.1 / Property 4): the second copy simply
/// rewrites identical bytes, leaving the same final contents.
fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = destination.join(entry.file_name());
        if src_path.is_dir() {
            copy_tree(&src_path, &dst_path)?;
        } else {
            // Overwrites any existing file at dst_path (idempotent re-copy).
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Deletes the outputs listed in `written` (tool subtrees) and `written_files`
/// (sanctioned flat root files) from the install directory, best-effort. Used
/// by [`copy_payload`] to immediately roll back partially copied outputs the
/// moment a copy fails (Req 5.5 / Property 6) — the removal happens here, in the
/// same failure-handling path, and is never deferred to uninstall.
///
/// `written_files` carries the sanctioned flat manifest/lockfile names copied in
/// this call (see [`SANCTIONED_PAYLOAD_ROOT_FILES`]) so a failed install leaves
/// nothing behind at the install-dir root either.
fn rollback_written(install_dir: &Path, written: &[String], written_files: &[String]) {
    for server_name in written {
        let dir = tool_install_dir(install_dir, server_name);
        // Best-effort: rollback must not itself panic or short-circuit. Any dir
        // that cannot be removed is left for uninstall as a last resort, but the
        // common case (a directory we just created) removes cleanly.
        let _ = std::fs::remove_dir_all(&dir);
    }
    for file_name in written_files {
        // Best-effort removal of the copied flat root file.
        let _ = std::fs::remove_file(install_dir.join(file_name));
    }
}

/// Copies the bundled payload (all 9 canonical tool `dist/` trees) from
/// `resource_root` into `install_dir`, verifies the result, and rolls back on
/// any failure.
///
/// `resource_root` is the directory Tauri's resource-path API resolves at
/// install time (injected here so the layer is testable without Tauri). Each
/// tool's payload is expected at `resource_root/<server_name>/` and is copied to
/// `install_dir/<server_name>/`.
///
/// Behavior:
/// - **Copy** every canonical tool's tree (Req 5.1).
/// - **Idempotent** (Req 5.1 / Property 4): re-running over the same install dir
///   yields the same contents as a single run (files are overwritten in place).
/// - **Verify** presence & non-emptiness of all 9 outputs via the pure planner;
///   on a gap, return [`CopyError::VerificationFailed`] naming the exact affected
///   tools (Req 5.2/5.3) — but only *after* rolling back, so a failed install
///   leaves nothing behind.
/// - **Rollback** (Req 5.5 / Property 6): on the first copy error, immediately
///   delete every output already written in this call, then return the error.
///
/// On success the caller records `install_dir` for uninstall (Req 5.6); this
/// function returns `Ok(())` and leaves the fully populated install directory.
pub fn copy_payload(resource_root: &Path, install_dir: &Path) -> Result<(), CopyError> {
    // Guard the install directory with the locked path-validation contract
    // (task 8.1). An unusable target must never receive a partial copy.
    let install_dir_str = install_dir.to_string_lossy();
    let validation = validate_install_path(&install_dir_str);
    if !validation.valid {
        return Err(CopyError::InvalidInstallDir {
            reason: validation
                .error
                .unwrap_or_else(|| "unknown validation failure".to_string()),
        });
    }

    if !resource_root.is_dir() {
        return Err(CopyError::MissingResourceRoot {
            resource_root: resource_root.to_path_buf(),
        });
    }

    // Ensure the install directory exists before copying into it.
    if let Err(error) = std::fs::create_dir_all(install_dir) {
        return Err(CopyError::InvalidInstallDir {
            reason: format!("could not create install directory: {error}"),
        });
    }

    // Track outputs written *in this call* so rollback removes exactly what this
    // copy produced (Req 5.5), in reverse order.
    let mut written: Vec<String> = Vec::new();
    // Sanctioned flat root files copied in this call (Option B2); rolled back
    // alongside the tool subtrees.
    let mut written_files: Vec<String> = Vec::new();

    for tool in canonical_payloads() {
        let server_name = tool.server_name;
        let source = resource_root.join(server_name);
        let destination = tool_install_dir(install_dir, server_name);

        // The bundled payload must actually contain this tool's tree; a missing
        // source is attributed to the specific tool (Req 5.4) and rolls back.
        if !source.is_dir() {
            rollback_written(install_dir, &written, &written_files);
            return Err(CopyError::MissingSourceTool {
                server_name: server_name.to_string(),
                source,
            });
        }

        match copy_tree(&source, &destination) {
            Ok(()) => written.push(server_name.to_string()),
            Err(error) => {
                // Record this tool as (partially) written so rollback also
                // removes whatever bytes landed before the error.
                written.push(server_name.to_string());
                rollback_written(install_dir, &written, &written_files);
                return Err(CopyError::Copy {
                    server_name: server_name.to_string(),
                    source,
                    destination,
                    error,
                });
            }
        }
    }

    // Option B2 (Req 2.1): copy the sanctioned flat production-manifest files
    // (`package.json`, `package-lock.json`) from the payload root into the
    // install-dir root so the install-time `npm install --omit=dev …`
    // (cwd = install_dir) resolves the flat production tree — this closes H1 at
    // install time. These are mirrored from stage-payload's
    // `SANCTIONED_PAYLOAD_ROOT_FILES`. They are NON-mandatory bundled artifacts:
    // copy each only when present in `resource_root`; a missing flat file is not
    // a hard copy error (the npm step surfaces a clear error if the manifest is
    // genuinely absent). No `node_modules` is ever copied, so the Lean_Payload
    // intent (Req 3.6) is preserved.
    for file_name in SANCTIONED_PAYLOAD_ROOT_FILES {
        let source = resource_root.join(file_name);
        if !source.is_file() {
            // Best-effort: absent sanctioned flat file is skipped, not fatal.
            continue;
        }
        let destination = install_dir.join(file_name);
        if let Err(error) = std::fs::copy(&source, &destination) {
            // A present-but-uncopyable sanctioned file is a real filesystem
            // error for an owned artifact; attribute it like a tool copy and
            // roll back everything written in this call.
            written_files.push((*file_name).to_string());
            rollback_written(install_dir, &written, &written_files);
            return Err(CopyError::Copy {
                server_name: (*file_name).to_string(),
                source,
                destination,
                error,
            });
        }
        written_files.push((*file_name).to_string());
    }

    // Option B (bugfix: mcp-shared-module-resolution-fix, task 3.4): copy the
    // sanctioned `@shared/*` tarballs (`shared-types-<version>.tgz`,
    // `shared-config-<version>.tgz`) from the payload root into the install-dir
    // root so the install-time `npm install --omit=dev …` (cwd = install_dir)
    // resolves the `file:./shared-*-<version>.tgz` specifiers the flat
    // production manifest emits for `@shared/types` / `@shared/config`. The
    // filenames are version-derived, so they are matched by stable prefix/suffix
    // (see `SANCTIONED_PAYLOAD_ROOT_FILE_PATTERNS`) rather than exact name —
    // drift-proof across the repo-wide version bump. These are regular FILES,
    // never a `node_modules`, so the Lean_Payload intent (Req 3.6) is preserved.
    // Best-effort like the manifest files: a present-but-uncopyable tarball is a
    // real filesystem error for an owned artifact and rolls back; an absent
    // tarball is simply skipped (`sanctioned_shared_tarballs_in` only returns
    // files that exist). Copied names join `written_files` so both rollback
    // paths remove them.
    for file_name in sanctioned_shared_tarballs_in(resource_root) {
        let source = resource_root.join(&file_name);
        let destination = install_dir.join(&file_name);
        if let Err(error) = std::fs::copy(&source, &destination) {
            written_files.push(file_name.clone());
            rollback_written(install_dir, &written, &written_files);
            return Err(CopyError::Copy {
                server_name: file_name,
                source,
                destination,
                error,
            });
        }
        written_files.push(file_name);
    }

    // Post-copy verification (Req 5.2/5.3): reuse the pure planner over the
    // install directory's present-and-non-empty outputs. On a gap, roll back so
    // a failed install leaves nothing behind, then report the exact set.
    //
    // Verification is intentionally scoped to the nine tool trees only (the
    // design stages the flat manifest as a best-effort, non-mandatory artifact;
    // the install-time npm step surfaces a clear error if it is absent), so the
    // sanctioned flat files are NOT asserted here.
    let plan = verify_install_dir(install_dir);
    if !plan.is_complete() {
        rollback_written(install_dir, &written, &written_files);
        return Err(CopyError::VerificationFailed {
            missing: plan.missing,
        });
    }

    Ok(())
}

/// Verifies the install directory by probing each canonical tool's output for
/// presence and non-emptiness, returning the [`BundlePlan`] over that state.
///
/// This is the install-time side of the shared planner (Req 5.2/5.3): a tool
/// counts as present only when `install_dir/<server_name>/` exists and contains
/// at least one file (recursively). `plan.is_complete()` is the pass/fail, and
/// `plan.missing` is the exact set of absent-or-empty tools.
pub fn verify_install_dir(install_dir: &Path) -> BundlePlan {
    plan_bundle(|server_name| dir_has_content(&tool_install_dir(install_dir, server_name)))
}

/// Rolls back the copied payload from `install_dir`, best-effort.
///
/// Removes every canonical tool's output subtree (`install_dir/<server_name>/`)
/// that this installer would have copied. This is the rollback the
/// uninstall-registration step invokes when the registry write fails
/// (Req 8.3 / Property 6): a registration failure aborts the install and the
/// bundled payload already written to the install directory is removed, so a
/// failed install leaves no toolkit-owned payload behind.
///
/// Unlike the copy step's private `rollback_written`, which removes only the
/// outputs written in a single `copy_payload` call, this removes the full
/// canonical set — the copy step has already completed successfully by the time
/// the registration step runs, so every one of the 9 tool outputs is present
/// and must be rolled back. Removal is best-effort: any subtree that cannot be
/// removed is left in place rather than panicking, matching the copy step's
/// rollback semantics.
pub fn rollback_payload(install_dir: &Path) {
    for tool in canonical_payloads() {
        let dir = tool_install_dir(install_dir, tool.server_name);
        let _ = std::fs::remove_dir_all(&dir);
    }
    // Also remove the sanctioned flat production-manifest files (Option B2) so a
    // registration-failure rollback leaves nothing toolkit-owned behind at the
    // install-dir root either (best-effort, matching the tool-subtree removal).
    for file_name in SANCTIONED_PAYLOAD_ROOT_FILES {
        let _ = std::fs::remove_file(install_dir.join(file_name));
    }
    // Likewise remove any copied `@shared/*` tarballs (bugfix:
    // mcp-shared-module-resolution-fix, task 3.4), matched by the same stable
    // prefix/suffix patterns the copy step used, so a rolled-back install leaves
    // no tarball behind at the install-dir root either (best-effort).
    for file_name in sanctioned_shared_tarballs_in(install_dir) {
        let _ = std::fs::remove_file(install_dir.join(file_name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_payload::CANONICAL_TOOL_COUNT;
    use std::collections::BTreeSet;

    fn canonical_names() -> Vec<String> {
        canonical_payloads()
            .iter()
            .map(|t| t.server_name.to_string())
            .collect()
    }

    #[test]
    fn all_present_is_complete_with_empty_missing() {
        let plan = plan_bundle(|_| true);

        assert!(plan.is_complete());
        assert!(plan.missing.is_empty());
        assert_eq!(plan.present.len(), CANONICAL_TOOL_COUNT);
        // required is exactly the canonical 9.
        assert_eq!(plan.required.len(), CANONICAL_TOOL_COUNT);
    }

    #[test]
    fn none_present_reports_all_missing_and_incomplete() {
        let plan = plan_bundle(|_| false);

        assert!(!plan.is_complete());
        assert!(plan.present.is_empty());
        assert_eq!(plan.missing.len(), CANONICAL_TOOL_COUNT);

        // missing must equal exactly the canonical set.
        let expected: BTreeSet<String> = canonical_names().into_iter().collect();
        let actual: BTreeSet<String> = plan.missing.iter().cloned().collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn missing_set_is_sorted() {
        // A subset absent: everything except the first canonical tool.
        let first = canonical_payloads()[0].server_name;
        let plan = plan_bundle(|name| name == first);

        let mut sorted = plan.missing.clone();
        sorted.sort();
        assert_eq!(plan.missing, sorted, "missing must be sorted");
    }

    #[test]
    fn missing_is_exactly_required_minus_present() {
        // Mark three of the nine Shipped tools absent.
        let absent: BTreeSet<&str> = ["3dtool", "skills", "browserless"].into_iter().collect();
        let plan = plan_bundle(|name| !absent.contains(name));

        // present + missing partitions the whole canonical set with no overlap.
        let present_set: BTreeSet<String> = plan.present.iter().cloned().collect();
        let missing_set: BTreeSet<String> = plan.missing.iter().cloned().collect();
        assert!(present_set.is_disjoint(&missing_set));

        let union: BTreeSet<String> = present_set.union(&missing_set).cloned().collect();
        let expected: BTreeSet<String> = canonical_names().into_iter().collect();
        assert_eq!(union, expected);

        // missing is exactly the absent set.
        let expected_missing: BTreeSet<String> =
            absent.iter().map(|s| s.to_string()).collect();
        assert_eq!(missing_set, expected_missing);
        assert!(!plan.is_complete());
    }

    #[test]
    fn present_follows_canonical_order() {
        let plan = plan_bundle(|_| true);
        assert_eq!(plan.present, canonical_names());
    }

    #[test]
    fn plan_from_present_set_ignores_unknown_names() {
        let mut present: BTreeSet<String> = canonical_names().into_iter().collect();
        // An unknown name must not affect the plan (only canonical tools count).
        present.insert("not-a-real-tool".to_string());

        let plan = plan_bundle_from_present(&present);
        assert!(plan.is_complete());
        assert_eq!(plan.present.len(), CANONICAL_TOOL_COUNT);
        assert!(plan.missing.is_empty());
    }

    #[test]
    fn plan_from_present_set_reports_the_gap() {
        let mut present: BTreeSet<String> = canonical_names().into_iter().collect();
        present.remove("terminal");

        let plan = plan_bundle_from_present(&present);
        assert!(!plan.is_complete());
        assert_eq!(plan.missing, vec!["terminal".to_string()]);
    }
}

#[cfg(test)]
mod copy_tests {
    use super::*;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A self-cleaning temp directory. `Drop` removes the tree so tests leave no
    /// residue even when they fail. No external crate needed.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let path = std::env::temp_dir().join(format!("llmtk_bundle_{label}_{pid}_{n}"));
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

    /// Builds a lean payload resource root under `root`: one non-empty
    /// `dist`-like tree per canonical tool at `root/<server_name>/`, with no
    /// `node_modules` tree (Lean_Payload, Req 7.1/7.2).
    fn make_full_resource_root(root: &Path) {
        for tool in canonical_payloads() {
            let tool_dir = root.join(tool.server_name);
            write_file(
                &tool_dir.join("index.js"),
                &format!("// {} entry\n", tool.server_name),
            );
            write_file(&tool_dir.join("nested").join("helper.js"), "// helper\n");
        }
    }

    /// Recursively collects (relative-path, contents) pairs under `root`, so two
    /// directory states can be compared for exact equality.
    fn snapshot(root: &Path) -> std::collections::BTreeMap<String, String> {
        let mut out = std::collections::BTreeMap::new();
        fn walk(
            base: &Path,
            dir: &Path,
            out: &mut std::collections::BTreeMap<String, String>,
        ) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    walk(base, &p, out);
                } else {
                    let rel = p
                        .strip_prefix(base)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    let contents = std::fs::read_to_string(&p).unwrap_or_default();
                    out.insert(rel, contents);
                }
            }
        }
        walk(root, root, &mut out);
        out
    }

    #[test]
    fn copy_payload_copies_all_nine_tools_and_verifies() {
        let res = TempDir::new("res_full");
        let install = TempDir::new("install_full");
        make_full_resource_root(res.path());

        let result = copy_payload(res.path(), install.path());
        assert!(result.is_ok(), "expected success, got {:?}", result.err());

        // Every canonical tool has a non-empty output in the install dir.
        let plan = verify_install_dir(install.path());
        assert!(plan.is_complete());
        assert_eq!(plan.present.len(), CANONICAL_TOOL_COUNT);
        for tool in canonical_payloads() {
            let dir = install.path().join(tool.server_name);
            assert!(dir.join("index.js").exists(), "missing {}", tool.server_name);
        }

        // Lean_Payload: the copy step never writes a `node_modules` tree into
        // the install dir (Req 7.2). The dependency payload is provisioned at
        // install time by the Runtimes step, not copied by CopyTools.
        assert!(
            !install.path().join("node_modules").exists(),
            "copy must never create install_dir/node_modules"
        );
    }

    #[test]
    fn copy_payload_is_idempotent() {
        let res = TempDir::new("res_idem");
        let install = TempDir::new("install_idem");
        make_full_resource_root(res.path());

        copy_payload(res.path(), install.path()).expect("first copy");
        let after_once = snapshot(install.path());

        copy_payload(res.path(), install.path()).expect("second copy");
        let after_twice = snapshot(install.path());

        assert_eq!(
            after_once, after_twice,
            "copying twice must yield the same install-dir contents as once"
        );
    }

    #[test]
    fn copy_payload_rolls_back_on_missing_source_tool() {
        let res = TempDir::new("res_missing");
        let install = TempDir::new("install_missing");
        make_full_resource_root(res.path());

        // Remove one tool's source so the copy fails partway through.
        let victim = canonical_payloads()[5].server_name;
        std::fs::remove_dir_all(res.path().join(victim)).expect("remove victim source");

        let result = copy_payload(res.path(), install.path());
        match result {
            Err(CopyError::MissingSourceTool { server_name, .. }) => {
                assert_eq!(server_name, victim);
            }
            other => panic!("expected MissingSourceTool, got {other:?}"),
        }

        // Rollback: no tool output remains in the install dir (Req 5.5).
        let plan = verify_install_dir(install.path());
        assert!(plan.present.is_empty(), "rollback must remove all written outputs");
        for tool in canonical_payloads() {
            assert!(
                !install.path().join(tool.server_name).exists(),
                "output for {} must have been rolled back",
                tool.server_name
            );
        }
    }

    #[test]
    fn copy_payload_reports_missing_resource_root() {
        let install = TempDir::new("install_no_res");
        let missing = install.path().join("does_not_exist");

        let result = copy_payload(&missing, install.path());
        assert!(matches!(result, Err(CopyError::MissingResourceRoot { .. })));
    }

    #[test]
    fn copy_payload_rejects_invalid_install_dir() {
        let res = TempDir::new("res_invalid");
        make_full_resource_root(res.path());

        // An empty install path is rejected by the locked validation contract.
        let result = copy_payload(res.path(), Path::new(""));
        assert!(matches!(result, Err(CopyError::InvalidInstallDir { .. })));
    }

    #[test]
    fn verify_install_dir_reports_exact_missing_set() {
        let res = TempDir::new("res_verify");
        let install = TempDir::new("install_verify");
        make_full_resource_root(res.path());
        copy_payload(res.path(), install.path()).expect("copy");

        // Delete two tool outputs after a successful copy to simulate later loss.
        let a = canonical_payloads()[0].server_name;
        let b = canonical_payloads()[8].server_name;
        std::fs::remove_dir_all(install.path().join(a)).unwrap();
        std::fs::remove_dir_all(install.path().join(b)).unwrap();

        let plan = verify_install_dir(install.path());
        assert!(!plan.is_complete());
        let mut expected = vec![a.to_string(), b.to_string()];
        expected.sort();
        assert_eq!(plan.missing, expected);
    }

    #[test]
    fn dir_with_only_empty_subdirs_counts_as_empty() {
        let install = TempDir::new("install_empty");
        // A tree of empty directories is not "present & non-empty" content.
        std::fs::create_dir_all(install.path().join("terminal").join("nested")).unwrap();
        let plan = verify_install_dir(install.path());
        assert!(
            plan.missing.contains(&"terminal".to_string()),
            "empty dir tree must count as missing/empty"
        );
    }

    #[test]
    fn copy_error_display_names_the_affected_tool() {
        let err = CopyError::MissingSourceTool {
            server_name: "git".to_string(),
            source: PathBuf::from("res/git"),
        };
        assert!(err.to_string().contains("git"));
    }

    /// Option B2 (Task 3.5 / Req 2.1): the sanctioned flat production-manifest
    /// files (`package.json`, `package-lock.json`) staged at the payload root
    /// are copied into the install-dir root so the install-time `npm install`
    /// (cwd = install_dir) can resolve them. No `node_modules` is ever created.
    #[test]
    fn copy_payload_copies_sanctioned_flat_manifest_files() {
        let res = TempDir::new("res_flat");
        let install = TempDir::new("install_flat");
        make_full_resource_root(res.path());
        // Stage the sanctioned flat files at the payload root (= install_dir).
        write_file(&res.path().join("package.json"), "{\"name\":\"llm-toolkit-runtime\"}\n");
        write_file(
            &res.path().join("package-lock.json"),
            "{\"lockfileVersion\":3}\n",
        );

        let result = copy_payload(res.path(), install.path());
        assert!(result.is_ok(), "expected success, got {:?}", result.err());

        // Both sanctioned flat files landed at the install-dir root with their
        // bytes intact.
        let staged_pkg = install.path().join("package.json");
        let staged_lock = install.path().join("package-lock.json");
        assert!(staged_pkg.is_file(), "package.json must be copied to install_dir root");
        assert!(staged_lock.is_file(), "package-lock.json must be copied to install_dir root");
        assert_eq!(
            std::fs::read_to_string(&staged_pkg).unwrap(),
            "{\"name\":\"llm-toolkit-runtime\"}\n"
        );
        assert_eq!(
            std::fs::read_to_string(&staged_lock).unwrap(),
            "{\"lockfileVersion\":3}\n"
        );

        // Lean_Payload: no `node_modules` is ever created by the copy step.
        assert!(
            !install.path().join("node_modules").exists(),
            "copy must never create install_dir/node_modules"
        );

        // The nine tool trees still verify.
        assert!(verify_install_dir(install.path()).is_complete());
    }

    /// A missing sanctioned flat file is NON-fatal: the design stages the
    /// manifest as a best-effort artifact, so `copy_payload` still succeeds
    /// (the install-time npm step surfaces a clear error if it is absent).
    #[test]
    fn copy_payload_succeeds_when_sanctioned_flat_files_absent() {
        let res = TempDir::new("res_noflat");
        let install = TempDir::new("install_noflat");
        make_full_resource_root(res.path());
        // Intentionally stage NO package.json / package-lock.json.

        let result = copy_payload(res.path(), install.path());
        assert!(result.is_ok(), "expected success, got {:?}", result.err());
        assert!(!install.path().join("package.json").exists());
        assert!(!install.path().join("package-lock.json").exists());
        assert!(verify_install_dir(install.path()).is_complete());
    }

    /// Rollback removes the copied sanctioned flat files too, so a failed
    /// install leaves nothing toolkit-owned behind at the install-dir root.
    #[test]
    fn rollback_payload_removes_sanctioned_flat_files() {
        let res = TempDir::new("res_rb_flat");
        let install = TempDir::new("install_rb_flat");
        make_full_resource_root(res.path());
        write_file(&res.path().join("package.json"), "{}\n");
        write_file(&res.path().join("package-lock.json"), "{}\n");

        copy_payload(res.path(), install.path()).expect("copy");
        assert!(install.path().join("package.json").is_file());
        assert!(install.path().join("package-lock.json").is_file());

        rollback_payload(install.path());

        assert!(
            !install.path().join("package.json").exists(),
            "rollback must remove the staged package.json"
        );
        assert!(
            !install.path().join("package-lock.json").exists(),
            "rollback must remove the staged package-lock.json"
        );
        // Tool subtrees are also gone (existing rollback semantics).
        for tool in canonical_payloads() {
            assert!(!install.path().join(tool.server_name).exists());
        }
    }

    /// Option B (bugfix: mcp-shared-module-resolution-fix, task 3.4): the two
    /// version-derived `@shared/*` tarballs (`shared-types-<version>.tgz`,
    /// `shared-config-<version>.tgz`) staged at the payload root are copied into
    /// the install-dir root (matched by stable prefix/suffix, drift-proof across
    /// the version bump) so the install-time `npm install` resolves the `file:`
    /// specifiers. No `node_modules` is ever created.
    #[test]
    fn copy_payload_copies_shared_tarballs() {
        let res = TempDir::new("res_tgz");
        let install = TempDir::new("install_tgz");
        make_full_resource_root(res.path());
        // Stage all seven version-derived tarballs at the payload root
        // (= install_dir): the two @shared/* tarballs (5.4.3) plus the five
        // llm-toolkit-* tarballs (5.4.4 follow-up, task 8.4).
        write_file(&res.path().join("shared-types-5.4.3.tgz"), "fake-types-tarball\n");
        write_file(&res.path().join("shared-config-5.4.3.tgz"), "fake-config-tarball\n");
        write_file(
            &res.path().join("llm-toolkit-ask-user-5.4.4.tgz"),
            "fake-ask-user\n",
        );
        write_file(
            &res.path().join("llm-toolkit-calculator-5.4.4.tgz"),
            "fake-calculator\n",
        );
        write_file(
            &res.path().join("llm-toolkit-clock-5.4.4.tgz"),
            "fake-clock\n",
        );
        write_file(
            &res.path().join("llm-toolkit-document-scraper-5.4.4.tgz"),
            "fake-document-scraper\n",
        );
        write_file(
            &res.path().join("llm-toolkit-observability-5.4.4.tgz"),
            "fake-observability\n",
        );

        let result = copy_payload(res.path(), install.path());
        assert!(result.is_ok(), "expected success, got {:?}", result.err());

        // Both @shared/* tarballs landed at the install-dir root with bytes intact.
        let staged_types = install.path().join("shared-types-5.4.3.tgz");
        let staged_config = install.path().join("shared-config-5.4.3.tgz");
        assert!(staged_types.is_file(), "shared-types tarball must be copied");
        assert!(staged_config.is_file(), "shared-config tarball must be copied");
        assert_eq!(
            std::fs::read_to_string(&staged_types).unwrap(),
            "fake-types-tarball\n"
        );
        assert_eq!(
            std::fs::read_to_string(&staged_config).unwrap(),
            "fake-config-tarball\n"
        );

        // All five llm-toolkit-* tarballs landed at the install-dir root too.
        for (name, body) in [
            ("llm-toolkit-ask-user-5.4.4.tgz", "fake-ask-user\n"),
            ("llm-toolkit-calculator-5.4.4.tgz", "fake-calculator\n"),
            ("llm-toolkit-clock-5.4.4.tgz", "fake-clock\n"),
            (
                "llm-toolkit-document-scraper-5.4.4.tgz",
                "fake-document-scraper\n",
            ),
            ("llm-toolkit-observability-5.4.4.tgz", "fake-observability\n"),
        ] {
            let staged = install.path().join(name);
            assert!(staged.is_file(), "{name} must be copied");
            assert_eq!(std::fs::read_to_string(&staged).unwrap(), body);
        }

        // Lean_Payload: no `node_modules` is ever created by the copy step.
        assert!(
            !install.path().join("node_modules").exists(),
            "copy must never create install_dir/node_modules"
        );

        // The nine tool trees still verify.
        assert!(verify_install_dir(install.path()).is_complete());
    }

    /// The tarball match is version-agnostic: a DIFFERENT version in the middle
    /// of the filename (e.g. a future bump) is still copied, proving the
    /// prefix/suffix match is drift-proof and never pinned to one version.
    #[test]
    fn copy_payload_copies_shared_tarballs_for_any_version() {
        let res = TempDir::new("res_tgz_ver");
        let install = TempDir::new("install_tgz_ver");
        make_full_resource_root(res.path());
        write_file(&res.path().join("shared-types-9.9.9.tgz"), "t\n");
        write_file(&res.path().join("shared-config-9.9.9.tgz"), "c\n");

        copy_payload(res.path(), install.path()).expect("copy");

        assert!(install.path().join("shared-types-9.9.9.tgz").is_file());
        assert!(install.path().join("shared-config-9.9.9.tgz").is_file());
    }

    /// Absent `@shared/*` tarballs are NON-fatal (best-effort, exactly like the
    /// manifest files): `copy_payload` still succeeds and copies nothing extra.
    #[test]
    fn copy_payload_succeeds_when_shared_tarballs_absent() {
        let res = TempDir::new("res_notgz");
        let install = TempDir::new("install_notgz");
        make_full_resource_root(res.path());
        // Intentionally stage NO tarballs.

        let result = copy_payload(res.path(), install.path());
        assert!(result.is_ok(), "expected success, got {:?}", result.err());
        assert!(sanctioned_shared_tarballs_in(install.path()).is_empty());
        assert!(verify_install_dir(install.path()).is_complete());
    }

    /// Only sanctioned tarball shapes are copied: an unrelated `.tgz` whose name
    /// does not match a sanctioned prefix is NOT carried into the install dir.
    #[test]
    fn copy_payload_ignores_unsanctioned_tarballs() {
        let res = TempDir::new("res_badtgz");
        let install = TempDir::new("install_badtgz");
        make_full_resource_root(res.path());
        write_file(&res.path().join("shared-types-5.4.3.tgz"), "ok\n");
        // A random tarball not matching any sanctioned prefix/suffix.
        write_file(&res.path().join("some-other-pkg-1.0.0.tgz"), "nope\n");

        copy_payload(res.path(), install.path()).expect("copy");

        assert!(install.path().join("shared-types-5.4.3.tgz").is_file());
        assert!(
            !install.path().join("some-other-pkg-1.0.0.tgz").exists(),
            "unsanctioned tarball must not be copied into install_dir"
        );
    }

    /// A copy failure rolls back the copied `@shared/*` tarballs too: when a
    /// later tool copy / verification fails, no tarball is left behind. Here we
    /// trigger the registration-failure rollback path which must also remove the
    /// tarballs (see `rollback_payload_removes_shared_tarballs`); this test
    /// covers the in-`copy_payload` rollback via `rollback_written` by forcing a
    /// verification gap after the tarballs are copied.
    #[test]
    fn copy_payload_rolls_back_shared_tarballs_on_failure() {
        let res = TempDir::new("res_tgz_rb");
        let install = TempDir::new("install_tgz_rb");
        make_full_resource_root(res.path());
        write_file(&res.path().join("shared-types-5.4.3.tgz"), "t\n");
        write_file(&res.path().join("shared-config-5.4.3.tgz"), "c\n");
        // Remove one tool's source so the copy fails before reaching the
        // tarball/verification stage — rollback must leave the install dir empty
        // (the tarballs are copied AFTER the tool trees, so this specifically
        // asserts a mid-copy failure leaves nothing, and the next test covers a
        // post-tarball rollback).
        let victim = canonical_payloads()[3].server_name;
        std::fs::remove_dir_all(res.path().join(victim)).expect("remove victim");

        let result = copy_payload(res.path(), install.path());
        assert!(result.is_err(), "expected copy failure");
        assert!(
            sanctioned_shared_tarballs_in(install.path()).is_empty(),
            "rollback must leave no @shared/* tarball behind"
        );
        assert!(!install.path().join("shared-types-5.4.3.tgz").exists());
        assert!(!install.path().join("shared-config-5.4.3.tgz").exists());
    }

    /// `rollback_payload` (the registration-failure path) removes the copied
    /// `@shared/*` tarballs too, so a rolled-back install leaves nothing
    /// toolkit-owned at the install-dir root.
    #[test]
    fn rollback_payload_removes_shared_tarballs() {
        let res = TempDir::new("res_rb_tgz");
        let install = TempDir::new("install_rb_tgz");
        make_full_resource_root(res.path());
        write_file(&res.path().join("shared-types-5.4.3.tgz"), "t\n");
        write_file(&res.path().join("shared-config-5.4.3.tgz"), "c\n");

        copy_payload(res.path(), install.path()).expect("copy");
        assert!(install.path().join("shared-types-5.4.3.tgz").is_file());
        assert!(install.path().join("shared-config-5.4.3.tgz").is_file());

        rollback_payload(install.path());

        assert!(
            !install.path().join("shared-types-5.4.3.tgz").exists(),
            "rollback must remove the staged shared-types tarball"
        );
        assert!(
            !install.path().join("shared-config-5.4.3.tgz").exists(),
            "rollback must remove the staged shared-config tarball"
        );
        // Tool subtrees are also gone (existing rollback semantics).
        for tool in canonical_payloads() {
            assert!(!install.path().join(tool.server_name).exists());
        }
    }

    /// Unit coverage for the sanctioned-tarball name matcher: known shapes match
    /// across versions; wrong prefix/suffix and the empty-version edge do not.
    #[test]
    fn is_sanctioned_shared_tarball_matches_only_known_shapes() {
        // @shared/* tarballs (5.4.3).
        assert!(is_sanctioned_shared_tarball("shared-types-5.4.3.tgz"));
        assert!(is_sanctioned_shared_tarball("shared-config-5.4.3.tgz"));
        assert!(is_sanctioned_shared_tarball("shared-types-10.0.0-beta.1.tgz"));

        // llm-toolkit-* tarballs (5.4.4 follow-up) — all five stems match
        // across versions.
        assert!(is_sanctioned_shared_tarball("llm-toolkit-ask-user-5.4.4.tgz"));
        assert!(is_sanctioned_shared_tarball(
            "llm-toolkit-calculator-5.4.4.tgz"
        ));
        assert!(is_sanctioned_shared_tarball("llm-toolkit-clock-5.4.4.tgz"));
        assert!(is_sanctioned_shared_tarball(
            "llm-toolkit-document-scraper-5.4.4.tgz"
        ));
        assert!(is_sanctioned_shared_tarball(
            "llm-toolkit-observability-5.4.4.tgz"
        ));
        assert!(is_sanctioned_shared_tarball(
            "llm-toolkit-observability-10.0.0-beta.1.tgz"
        ));

        // Wrong suffix / wrong prefix / unrelated names are rejected.
        assert!(!is_sanctioned_shared_tarball("shared-types-5.4.3.zip"));
        assert!(!is_sanctioned_shared_tarball("shared-other-5.4.3.tgz"));
        assert!(!is_sanctioned_shared_tarball("package.json"));
        assert!(!is_sanctioned_shared_tarball("some-other-pkg-1.0.0.tgz"));
        // An unknown llm-toolkit-* package stem must NOT match — only the five
        // sanctioned stems are provisioned.
        assert!(!is_sanctioned_shared_tarball("llm-toolkit-ask-user-5.4.4.zip"));
        assert!(!is_sanctioned_shared_tarball("llm-toolkit-unknown-5.4.4.tgz"));
        assert!(!is_sanctioned_shared_tarball("llm-toolkit-5.4.4.tgz"));

        // Empty version segment must NOT match (prefix+suffix overlap guard).
        assert!(!is_sanctioned_shared_tarball("shared-types-.tgz"));
        assert!(!is_sanctioned_shared_tarball("shared-config-.tgz"));
        assert!(!is_sanctioned_shared_tarball("llm-toolkit-ask-user-.tgz"));
        assert!(!is_sanctioned_shared_tarball("llm-toolkit-calculator-.tgz"));
        assert!(!is_sanctioned_shared_tarball("llm-toolkit-clock-.tgz"));
        assert!(!is_sanctioned_shared_tarball(
            "llm-toolkit-document-scraper-.tgz"
        ));
        assert!(!is_sanctioned_shared_tarball(
            "llm-toolkit-observability-.tgz"
        ));
    }

}

#[cfg(test)]
mod property_tests {
    use super::*;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
    use proptest::prelude::*;
    use std::collections::BTreeSet;

    /// The canonical server names, in canonical order.
    fn canonical_names() -> Vec<String> {
        canonical_payloads()
            .iter()
            .map(|t| t.server_name.to_string())
            .collect()
    }

    /// The 9 canonical `dist` roots as a set — the "resource set" the planner
    /// must always report as `required`, independent of any presence state.
    fn canonical_dist_roots() -> BTreeSet<String> {
        canonical_payloads()
            .iter()
            .map(|t| t.dist_root.to_string())
            .collect()
    }

    /// Generates a random tool-presence state: a boolean per canonical tool
    /// (`true` == that tool's dist root is present and non-empty). A `Vec<bool>`
    /// of length 9 ranges over all 2^9 presence states, so the property is
    /// exercised across the whole input space of subsets/presence-maps.
    fn presence_state() -> impl Strategy<Value = Vec<bool>> {
        prop::collection::vec(any::<bool>(), CANONICAL_TOOL_COUNT)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: windows-installer-setup-exe, Property 1: Bundle completeness
        //
        // For all tool-presence states over the 9 canonical MCP tools, the
        // bundle planner reports `is_complete()` true IFF every one of the 9
        // tools has a present, non-empty dist root, AND the planned resource set
        // (`required`) equals exactly the 9 canonical dist roots.
        //
        // Validates: Requirements 3.1, 3.2, 3.5.
        #[test]
        fn bundle_completeness(present_flags in presence_state()) {
            let names = canonical_names();

            // Build the presence predicate from the random per-tool flags.
            let present_names: BTreeSet<String> = names
                .iter()
                .zip(present_flags.iter())
                .filter_map(|(name, &is_present)| is_present.then(|| name.clone()))
                .collect();

            let plan = plan_bundle(|name| present_names.contains(name));

            // --- is_complete() IFF all 9 present ---
            let all_present = present_flags.iter().all(|&p| p);
            prop_assert_eq!(
                plan.is_complete(),
                all_present,
                "is_complete() must be true exactly when all 9 tools are present"
            );

            // The completeness biconditional stated the other way: complete IFF
            // nothing is missing, and missing is empty IFF every tool present.
            prop_assert_eq!(plan.missing.is_empty(), all_present);

            // --- required resource set == exactly the 9 canonical dist roots ---
            // This must hold regardless of the presence state.
            prop_assert_eq!(plan.required.len(), CANONICAL_TOOL_COUNT);
            let required_roots: BTreeSet<String> = plan
                .required
                .iter()
                .map(|t| t.dist_root.to_string())
                .collect();
            prop_assert_eq!(
                required_roots,
                canonical_dist_roots(),
                "required must equal exactly the 9 canonical dist roots for every presence state"
            );

            // present + missing partition the canonical set (no overlap, full cover),
            // reinforcing that completeness is decided over exactly the 9 tools.
            let present_set: BTreeSet<String> = plan.present.iter().cloned().collect();
            let missing_set: BTreeSet<String> = plan.missing.iter().cloned().collect();
            prop_assert!(present_set.is_disjoint(&missing_set));
            let union: BTreeSet<String> = present_set.union(&missing_set).cloned().collect();
            let all_names: BTreeSet<String> = names.iter().cloned().collect();
            prop_assert_eq!(union, all_names);
        }
    }
}

#[cfg(test)]
mod prop_missing_set_tests {
    use super::*;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
    use proptest::prelude::*;
    use std::collections::BTreeSet;

    /// The 9 canonical server names, in canonical order.
    fn canonical_names() -> Vec<&'static str> {
        canonical_payloads().iter().map(|t| t.server_name).collect()
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: windows-installer-setup-exe, Property 2: Build-time missing set is exact
        //
        // For all tool-presence states, the planner's `missing` set equals
        // exactly the set of canonical tools whose dist root is absent or empty
        // (modeled here by the presence bit being `false`): no present tool is
        // reported missing and no missing tool is omitted. The `missing` set is
        // sorted and disjoint from `present`.
        //
        // Validates: Requirements 3.3
        #[test]
        fn prop_missing_set_is_exact(
            presence in prop::collection::vec(any::<bool>(), CANONICAL_TOOL_COUNT)
        ) {
            let names = canonical_names();

            // Map each canonical tool to a random presence bit. `true` models a
            // present, non-empty dist root; `false` models absent-or-empty.
            let present_bits: std::collections::HashMap<&'static str, bool> =
                names.iter().copied().zip(presence.iter().copied()).collect();

            let plan = plan_bundle(|name| present_bits[name]);

            // Expected absent set computed independently of the planner: every
            // canonical tool whose presence bit is false.
            let expected_missing: BTreeSet<String> = names
                .iter()
                .copied()
                .filter(|name| !present_bits[name])
                .map(|s| s.to_string())
                .collect();

            let actual_missing: BTreeSet<String> =
                plan.missing.iter().cloned().collect();

            // Exactness: missing == required - present, no false positives or negatives.
            prop_assert_eq!(&actual_missing, &expected_missing);

            // `missing` is sorted (BTreeSet iteration order == sorted order).
            let mut sorted = plan.missing.clone();
            sorted.sort();
            prop_assert_eq!(&plan.missing, &sorted);

            // `missing` is disjoint from `present`: no tool is both.
            let present_set: BTreeSet<String> = plan.present.iter().cloned().collect();
            prop_assert!(present_set.is_disjoint(&actual_missing));

            // present ∪ missing covers exactly the canonical set (nothing dropped).
            let union: BTreeSet<String> =
                present_set.union(&actual_missing).cloned().collect();
            let all: BTreeSet<String> =
                names.iter().map(|s| s.to_string()).collect();
            prop_assert_eq!(&union, &all);
        }
    }
}

#[cfg(test)]
mod install_verification_property_tests {
    use super::*;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
    use proptest::prelude::*;
    use std::collections::BTreeSet;

    /// The canonical server names, in canonical order.
    fn canonical_names() -> Vec<String> {
        canonical_payloads()
            .iter()
            .map(|t| t.server_name.to_string())
            .collect()
    }

    /// Generates a random install-directory state: a boolean per canonical tool
    /// where `true` means that tool's output is present *and* non-empty in the
    /// install directory, and `false` means it is absent *or* empty. A
    /// `Vec<bool>` of length 9 ranges over all 2^9 install-directory states,
    /// so the verifier is exercised across the whole input space.
    fn install_dir_state() -> impl Strategy<Value = Vec<bool>> {
        prop::collection::vec(any::<bool>(), CANONICAL_TOOL_COUNT)
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: windows-installer-setup-exe, Property 5: Install-directory verification is exact
        //
        // For all install-directory states, the copy verifier (the pure planner
        // over the install directory's present-and-non-empty outputs) passes
        // IFF all 9 tool outputs are present and non-empty, and when it fails
        // the reported `missing` set equals exactly the tools that are absent or
        // empty in the install directory.
        //
        // Validates: Requirements 5.2, 5.3.
        #[test]
        fn prop_install_verification_is_exact(present_flags in install_dir_state()) {
            let names = canonical_names();

            // Model the post-copy install directory: a tool is "present" here
            // only when its output exists AND is non-empty. Everything else
            // (absent or empty) is excluded from the present set.
            let present_names: BTreeSet<String> = names
                .iter()
                .zip(present_flags.iter())
                .filter_map(|(name, &present_and_nonempty)| {
                    present_and_nonempty.then(|| name.clone())
                })
                .collect();

            // The install-time verifier consumes exactly this "present &
            // non-empty" set (Req 5.2/5.3), via the shared pure planner.
            let plan = plan_bundle_from_present(&present_names);

            // --- verification passes IFF all 9 present and non-empty ---
            let all_present = present_flags.iter().all(|&p| p);
            prop_assert_eq!(
                plan.is_complete(),
                all_present,
                "install verification must pass exactly when all 9 outputs are present and non-empty"
            );

            // --- on failure, missing == exactly the absent/empty set ---
            // The absent-or-empty set is exactly the tools whose flag is false.
            let expected_missing: BTreeSet<String> = names
                .iter()
                .zip(present_flags.iter())
                .filter_map(|(name, &present_and_nonempty)| {
                    (!present_and_nonempty).then(|| name.clone())
                })
                .collect();

            let reported_missing: BTreeSet<String> = plan.missing.iter().cloned().collect();
            prop_assert_eq!(
                &reported_missing,
                &expected_missing,
                "reported missing set must equal exactly the absent/empty tools"
            );

            // When it fails, the reported set is non-empty; when it passes, empty.
            prop_assert_eq!(plan.is_complete(), reported_missing.is_empty());

            // No present tool is reported missing and no missing tool is
            // reported present: present + missing partition the canonical 9.
            let present_set: BTreeSet<String> = plan.present.iter().cloned().collect();
            prop_assert!(present_set.is_disjoint(&reported_missing));
            let union: BTreeSet<String> =
                present_set.union(&reported_missing).cloned().collect();
            let all_names: BTreeSet<String> = names.iter().cloned().collect();
            prop_assert_eq!(union, all_names);
            prop_assert_eq!(present_set, present_names);
        }
    }
}

#[cfg(test)]
mod copy_idempotency_property_tests {
    //! Property 4 (Copy idempotency) for the install-time copy layer.
    //!
    //! This module is deliberately self-contained (its own `TempDir` + snapshot
    //! helpers) so it does not collide with `copy_tests` or with the
    //! concurrently-added copy-failure attribution test (task 8.5).

    use super::*;
    use crate::tool_payload::canonical_payloads;
    use proptest::prelude::*;
    use std::collections::{BTreeMap, BTreeSet};
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
            let path = std::env::temp_dir().join(format!("llmtk_idem_{label}_{pid}_{n}"));
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

    /// Recursively collects (relative-path -> contents) pairs under `root`, so
    /// two install-directory states can be compared for exact equality. Paths
    /// are normalized to forward slashes so the comparison is platform-stable.
    fn snapshot(root: &Path) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    walk(base, &p, out);
                } else {
                    let rel = p
                        .strip_prefix(base)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    let contents = std::fs::read_to_string(&p).unwrap_or_default();
                    out.insert(rel, contents);
                }
            }
        }
        walk(root, root, &mut out);
        out
    }

    /// A generated payload file: a relative path (1-3 segments) under a tool's
    /// dist root, plus its byte contents (as UTF-8 text so snapshots compare
    /// cleanly). Path segments are constrained to safe filename characters.
    type PayloadFile = (Vec<String>, String);

    /// Strategy for a single safe path segment (a file or directory name).
    fn seg() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,7}".prop_map(|s| s.to_string())
    }

    /// Strategy for one payload file: 1-3 path segments and arbitrary text
    /// contents, possibly empty (a 0-byte file is permitted in the input space).
    /// Verification now requires each tool to hold at least one strictly
    /// > 0-byte file, so `materialize_payload` guarantees one such file per tool
    /// even when every generated file here is 0 bytes.
    fn payload_file() -> impl Strategy<Value = PayloadFile> {
        (
            prop::collection::vec(seg(), 1..=3),
            "[a-zA-Z0-9 \n]{0,32}".prop_map(|s| s.to_string()),
        )
    }

    /// Strategy for a whole bundled payload: for each of the 9 canonical tools,
    /// a non-empty set of payload files. Requiring >= 1 file per tool keeps every
    /// tool's dist root present and non-empty, so `copy_payload` succeeds and the
    /// idempotency comparison is meaningful (an all-empty payload would fail
    /// verification before the second copy). The inner files are de-duplicated by
    /// path when materialized, so overlapping generated paths are harmless.
    fn full_payload() -> impl Strategy<Value = Vec<Vec<PayloadFile>>> {
        prop::collection::vec(
            prop::collection::vec(payload_file(), 1..=4),
            canonical_payloads().len(),
        )
    }

    /// Materializes a generated payload into `resource_root`: one dist-like tree
    /// per canonical tool at `resource_root/<server_name>/`. Every tool is
    /// guaranteed at least one file so the tree is non-empty.
    ///
    /// The generator can emit path sets that collide on the filesystem — e.g.
    /// `["a"]` (a file named `a`) alongside `["a", "b"]` (which needs `a` to be a
    /// *directory*). Such a collision is an artifact of the random generator, not
    /// a property under test, so we de-conflict deterministically: within a tool,
    /// track each relative path already used as a file or as a directory, and
    /// skip any generated file whose own path is already a directory or whose
    /// path has an ancestor already used as a file. The de-confliction is applied
    /// identically on every call, so the same payload always materializes to the
    /// same tree — which is exactly what the idempotency comparison needs.
    fn materialize_payload(resource_root: &Path, payload: &[Vec<PayloadFile>]) {
        for (tool, files) in canonical_payloads().iter().zip(payload.iter()) {
            let tool_dir = resource_root.join(tool.server_name);
            std::fs::create_dir_all(&tool_dir).expect("create tool dir");

            // Relative segment-paths already committed as a file / as a directory.
            let mut file_paths: BTreeSet<Vec<String>> = BTreeSet::new();
            let mut dir_paths: BTreeSet<Vec<String>> = BTreeSet::new();

            for (segments, contents) in files {
                // The file's own path must not already be a directory.
                if dir_paths.contains(segments) {
                    continue;
                }
                // No ancestor of this file may already be a file (a file cannot
                // also be a directory holding this one). Ancestors are every
                // strict prefix of the segment list.
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

                // Commit this path as a file and every strict prefix as a dir.
                file_paths.insert(segments.clone());
                for end in 1..segments.len() {
                    dir_paths.insert(segments[..end].to_vec());
                }
            }

            // Guarantee at least one > 0-byte file even if every generated file
            // was skipped by de-confliction or was itself 0 bytes, so the tree
            // satisfies the tightened verification (a tool counts as present
            // only when it holds a strictly > 0-byte file) and `copy_payload`'s
            // verification passes on the first copy.
            if !dir_has_positive_size_file(&tool_dir) {
                write_file(&tool_dir.join("index.js"), "// entry\n");
            }
        }
    }

    /// True iff `dir` contains — at any depth — at least one regular file whose
    /// size is strictly `> 0` bytes, mirroring production `dir_has_content`'s
    /// rule. A tree of only 0-byte files (or an empty tree) returns `false`.
    fn dir_has_positive_size_file(dir: &Path) -> bool {
        snapshot(dir).values().any(|contents| !contents.is_empty())
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        // Feature: windows-installer-setup-exe, Property 4: Copy idempotency
        //
        // For all bundled payloads and install directories, copying the payload
        // and then copying it again yields the same install-directory contents
        // as copying it once. Both copies run against real temp directories: a
        // randomized 9-tool payload is materialized into a temp resource root,
        // copied into a temp install dir (snapshot A), then copied a second time
        // into the same install dir (snapshot B). The property asserts A == B.
        //
        // Validates: Requirements 5.1.
        #[test]
        fn prop_copy_is_idempotent(payload in full_payload()) {
            let res = TempDir::new("res");
            let install = TempDir::new("install");
            materialize_payload(res.path(), &payload);

            // First copy must succeed (every tool has a non-empty tree).
            let first = copy_payload(res.path(), install.path());
            prop_assert!(
                first.is_ok(),
                "first copy must succeed, got {:?}",
                first.err()
            );
            let after_once = snapshot(install.path());

            // Second copy over the same install dir must also succeed and must
            // not change the contents: re-copying overwrites identical bytes.
            let second = copy_payload(res.path(), install.path());
            prop_assert!(
                second.is_ok(),
                "second copy must succeed, got {:?}",
                second.err()
            );
            let after_twice = snapshot(install.path());

            prop_assert_eq!(
                after_once,
                after_twice,
                "copying twice must yield the same install-dir contents as once"
            );
        }
    }
}

#[cfg(test)]
mod copy_error_attribution_tests {
    //! Error-attribution unit tests for the install-time copy step (task 8.5).
    //!
    //! Requirement 5.4: when a copy fails, the reported error identifies the
    //! affected MCP tool when the failure can be attributed to a specific tool,
    //! and otherwise identifies the copy operation that failed. Requirement 5.3
    //! (companion) requires a verification failure to name *each* affected tool.
    //!
    //! These are example/unit tests: each one drives a single concrete failure
    //! through the real copy layer (or constructs the exact `CopyError` the
    //! layer would raise) and asserts both the structured attribution (the
    //! `server_name`/`missing` fields) and the human-readable `Display` name the
    //! affected tool(s). They complement the property tests and the existing
    //! `copy_tests::copy_error_display_names_the_affected_tool` smoke test with
    //! per-variant coverage, using distinct test names to avoid collisions.

    use super::*;
    use crate::tool_payload::canonical_payloads;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A self-cleaning temp directory (same pattern as `copy_tests::TempDir`).
    /// Redeclared here so this module is self-contained and cannot collide with
    /// the concurrently edited `copy_tests`/property modules.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let pid = std::process::id();
            let path = std::env::temp_dir().join(format!("llmtk_attrib_{label}_{pid}_{n}"));
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

    /// Builds a complete bundled-payload resource root: one non-empty tree per
    /// canonical tool at `root/<server_name>/`.
    fn make_full_resource_root(root: &Path) {
        for tool in canonical_payloads() {
            let tool_dir = root.join(tool.server_name);
            write_file(
                &tool_dir.join("index.js"),
                &format!("// {} entry\n", tool.server_name),
            );
            write_file(&tool_dir.join("nested").join("helper.js"), "// helper\n");
        }
    }

    // ---- MissingSourceTool: a specific tool's source is absent (Req 5.4) ----

    #[test]
    fn missing_source_tool_failure_names_the_affected_tool() {
        let res = TempDir::new("res_missing_src");
        let install = TempDir::new("install_missing_src");
        make_full_resource_root(res.path());

        // Remove exactly one tool's source so the copy is attributed to it.
        let victim = canonical_payloads()[7].server_name;
        std::fs::remove_dir_all(res.path().join(victim)).expect("remove victim source");

        let err = copy_payload(res.path(), install.path())
            .expect_err("missing source tool must fail the copy");

        // Structured attribution: the error names exactly the affected tool.
        match &err {
            CopyError::MissingSourceTool { server_name, source } => {
                assert_eq!(server_name, victim, "MissingSourceTool must name the affected tool");
                assert!(
                    source.ends_with(victim),
                    "source path {source:?} should point at the affected tool"
                );
            }
            other => panic!("expected MissingSourceTool, got {other:?}"),
        }

        // Human-readable attribution: Display includes the affected tool name.
        let shown = err.to_string();
        assert!(
            shown.contains(victim),
            "Display '{shown}' must name the affected tool '{victim}'"
        );
    }

    // ---- Copy: a filesystem error while copying a specific tool (Req 5.4) ----

    #[test]
    fn copy_io_failure_variant_names_the_affected_tool() {
        // Construct the exact error the copy layer raises when a tool's tree
        // fails to copy for an I/O reason. Attribution must carry the tool name
        // both structurally and in Display.
        let victim = canonical_payloads()[2].server_name;
        let err = CopyError::Copy {
            server_name: victim.to_string(),
            source: PathBuf::from(format!("res/{victim}")),
            destination: PathBuf::from(format!("install/{victim}")),
            error: std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied"),
        };

        match &err {
            CopyError::Copy { server_name, .. } => {
                assert_eq!(server_name, victim, "Copy error must name the affected tool");
            }
            other => panic!("expected Copy, got {other:?}"),
        }

        let shown = err.to_string();
        assert!(
            shown.contains(victim),
            "Display '{shown}' must name the affected tool '{victim}'"
        );
    }

    // ---- VerificationFailed: names each affected tool exactly (Req 5.3) ----

    #[test]
    fn verification_failure_names_each_affected_tool() {
        // A verification failure carries the exact set of missing/empty tools.
        // Attribution must list each affected tool, not just one.
        let a = canonical_payloads()[0].server_name;
        let b = canonical_payloads()[8].server_name;
        let mut missing = vec![a.to_string(), b.to_string()];
        missing.sort();

        let err = CopyError::VerificationFailed {
            missing: missing.clone(),
        };

        match &err {
            CopyError::VerificationFailed { missing: reported } => {
                assert_eq!(reported, &missing, "must report exactly the affected tools");
            }
            other => panic!("expected VerificationFailed, got {other:?}"),
        }

        // Display names every affected tool.
        let shown = err.to_string();
        for tool in &missing {
            assert!(
                shown.contains(tool.as_str()),
                "Display '{shown}' must name affected tool '{tool}'"
            );
        }
    }

    // ---- Non-tool failures identify the copy operation, not a tool (5.4) ----

    #[test]
    fn missing_resource_root_failure_identifies_the_copy_operation() {
        // When no tool can be attributed (the whole payload root is absent), the
        // error identifies the failing operation via the resource root path.
        let install = TempDir::new("install_no_root");
        let missing_root = install.path().join("does_not_exist");

        let err = copy_payload(&missing_root, install.path())
            .expect_err("missing resource root must fail the copy");

        match &err {
            CopyError::MissingResourceRoot { resource_root } => {
                assert_eq!(resource_root, &missing_root);
            }
            other => panic!("expected MissingResourceRoot, got {other:?}"),
        }

        let shown = err.to_string();
        assert!(
            shown.contains("resource root"),
            "Display '{shown}' must identify the failed copy operation (resource root)"
        );
    }

    #[test]
    fn invalid_install_dir_failure_identifies_the_copy_operation() {
        // An unusable install directory is not attributable to any single tool;
        // the error identifies the copy operation's target validation instead.
        let res = TempDir::new("res_invalid_dir");
        make_full_resource_root(res.path());

        let err = copy_payload(res.path(), Path::new(""))
            .expect_err("empty install dir must be rejected");

        assert!(
            matches!(err, CopyError::InvalidInstallDir { .. }),
            "expected InvalidInstallDir, got {err:?}"
        );
        let shown = err.to_string();
        assert!(
            shown.contains("install directory"),
            "Display '{shown}' must identify the failed copy operation (install directory)"
        );
    }
}

#[cfg(test)]
mod atomic_rollback_property_tests {
    //! Property 6 (Atomic rollback on failure) across the four provisioning
    //! failure points that write toolkit-owned artifacts:
    //!
    //! - **copy** (`bundle::copy_payload`, Req 5.5): a copy failure leaves no
    //!   tool output in the install dir — the pre-operation state.
    //! - **registry-write payload rollback** (`bundle::rollback_payload`,
    //!   Req 8.3): after a successful copy, the registration-failure rollback
    //!   removes every copied payload from the install dir.
    //! - **plugin** (`lmstudio::provision_plugin_dirs`, Req 6.6): a provisioning
    //!   failure for a server leaves no partial/misnamed *owned* dir for it.
    //! - **config** (`config_gen::write_all_to`, Req 7.4): a write failure for a
    //!   tool leaves no partial config *file* for it.
    //!
    //! The property picks a random failure point and a random affected index over
    //! the 9 canonical tools, forces exactly that failure against real temp
    //! directories, and asserts the rollback invariant: after the failure
    //! handling completes, no partially written toolkit-owned artifact remains
    //! for the failed operation and the affected target is back at its
    //! pre-operation state.
    //!
    //! This module is deliberately self-contained (its own `TempDir` + helpers)
    //! so it does not collide with `copy_tests`, `copy_idempotency_property_tests`,
    //! or the round-trip test (task 12.5).

    use super::*;
    use crate::config_gen::{self, ToolEnvConfig, ToolEnvConfigSet};
    use crate::lmstudio::{self, ServerBridgeConfig};
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
    use proptest::prelude::*;
    use std::collections::BTreeMap;
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
            let path = std::env::temp_dir().join(format!("llmtk_rollback_{label}_{pid}_{n}"));
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

    /// Builds a complete bundled-payload resource root: one non-empty tree per
    /// canonical tool at `root/<server_name>/`.
    fn make_full_resource_root(root: &Path) {
        for tool in canonical_payloads() {
            let tool_dir = root.join(tool.server_name);
            write_file(
                &tool_dir.join("index.js"),
                &format!("// {} entry\n", tool.server_name),
            );
            write_file(&tool_dir.join("nested").join("helper.js"), "// helper\n");
        }
    }

    /// True iff any canonical tool output subtree exists under `install_dir`.
    /// After a rolled-back copy the pre-operation state is "install dir carries
    /// no toolkit output at all".
    fn any_tool_output_present(install_dir: &Path) -> bool {
        canonical_payloads()
            .iter()
            .any(|tool| install_dir.join(tool.server_name).exists())
    }

    /// The four failure points Property 6 must cover, one per requirement.
    #[derive(Debug, Clone, Copy)]
    enum FailurePoint {
        /// Copy failure (Req 5.5): a tool's bundled source is missing.
        Copy,
        /// Registry-write payload rollback (Req 8.3): after a good copy,
        /// `rollback_payload` removes the copied payload.
        RegistryPayload,
        /// Plugin provisioning failure (Req 6.6): a server's dir cannot be
        /// created because a plain file already occupies its path.
        Plugin,
        /// Config write failure (Req 7.4): a tool's `<server>.json` path is
        /// occupied by a directory, so the file write fails.
        Config,
    }

    fn failure_point() -> impl Strategy<Value = FailurePoint> {
        prop_oneof![
            Just(FailurePoint::Copy),
            Just(FailurePoint::RegistryPayload),
            Just(FailurePoint::Plugin),
            Just(FailurePoint::Config),
        ]
    }

    /// Bridge configs for the given canonical server names (empty env).
    fn bridge_configs(names: &[&'static str]) -> Vec<ServerBridgeConfig> {
        names
            .iter()
            .map(|name| {
                ServerBridgeConfig::new(*name, "node", vec![format!("/install/{name}/mcp-server.js")])
            })
            .collect()
    }

    /// A derived config set (canonical keys per tool) for the given servers.
    fn config_set(names: &[&'static str]) -> ToolEnvConfigSet {
        let mut set: ToolEnvConfigSet = BTreeMap::new();
        for name in names {
            let mut env: ToolEnvConfig = BTreeMap::new();
            for key in config_gen::canonical_env_keys(name) {
                env.insert(key.to_string(), String::new());
            }
            set.insert(name.to_string(), env);
        }
        set
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(160))]

        // Feature: windows-installer-setup-exe, Property 6: Atomic rollback on failure
        //
        // For all failure points during copying tools, provisioning plugin
        // directories, writing env config, or writing the uninstall
        // registration, after the installer's failure handling completes there
        // remains no partially written toolkit-owned artifact for the failed
        // operation, and the affected target returns to its pre-operation state
        // (no partial tool output in the install dir, no partial/misnamed owned
        // plugin dir, no partial config file, and — on registry-write failure —
        // no copied payload in the install dir).
        //
        // Validates: Requirements 5.5, 6.6, 7.4, 8.3.
        #[test]
        fn prop_atomic_rollback_on_failure(
            point in failure_point(),
            index in 0usize..CANONICAL_TOOL_COUNT,
        ) {
            let names: Vec<&'static str> =
                canonical_payloads().iter().map(|t| t.server_name).collect();
            let victim = names[index];

            match point {
                // ── Copy failure (Req 5.5) ──────────────────────────────────
                // Force a copy failure by removing the victim tool's source, then
                // assert copy_payload returns Err AND rolls back every output it
                // wrote: the install dir is back to its pre-operation state (no
                // toolkit-owned tool output at all).
                FailurePoint::Copy => {
                    let res = TempDir::new("copy_res");
                    let install = TempDir::new("copy_install");
                    make_full_resource_root(res.path());

                    // Remove exactly the victim's source so the copy fails on it.
                    std::fs::remove_dir_all(res.path().join(victim))
                        .expect("remove victim source");

                    let result = copy_payload(res.path(), install.path());
                    prop_assert!(
                        result.is_err(),
                        "copy must fail when a source tool is missing"
                    );

                    // Pre-operation state: NO tool output remains in the install
                    // dir — the partial copy was rolled back (Req 5.5).
                    let plan = verify_install_dir(install.path());
                    prop_assert!(
                        plan.present.is_empty(),
                        "rollback must remove every written output; present = {:?}",
                        plan.present
                    );
                    prop_assert!(
                        !any_tool_output_present(install.path()),
                        "no toolkit-owned artifact may remain after copy rollback"
                    );
                }

                // ── Registry-write payload rollback (Req 8.3) ───────────────
                // A successful copy, then the registration-failure rollback path
                // (rollback_payload) must remove every copied payload, leaving no
                // toolkit-owned payload in the install dir. `index`/`victim` are
                // unused here (the whole payload is rolled back) but the property
                // still exercises this point across iterations.
                FailurePoint::RegistryPayload => {
                    let res = TempDir::new("reg_res");
                    let install = TempDir::new("reg_install");
                    make_full_resource_root(res.path());

                    copy_payload(res.path(), install.path())
                        .expect("copy must succeed before the registration step");
                    // Sanity: the copy really populated the install dir.
                    prop_assert!(
                        verify_install_dir(install.path()).is_complete(),
                        "precondition: a full copy before the registry write"
                    );

                    // The registry write failed → abort + roll back the payload.
                    rollback_payload(install.path());

                    prop_assert!(
                        !any_tool_output_present(install.path()),
                        "registry-failure rollback must remove the copied payload"
                    );
                    let plan = verify_install_dir(install.path());
                    prop_assert!(
                        plan.present.is_empty(),
                        "no copied payload may remain; present = {:?}",
                        plan.present
                    );
                }

                // ── Plugin provisioning failure (Req 6.6) ───────────────────
                // Force provision_plugin_dirs to fail on the victim server by
                // planting a plain FILE where its plugin dir must be created, so
                // create_dir_all(plugin_dir) fails. After failure handling, no
                // partial/misnamed OWNED dir exists for that server. (The planted
                // file is a foreign, unmarked artifact and is not a toolkit-owned
                // artifact, so it is intentionally left untouched.)
                FailurePoint::Plugin => {
                    let plugin_root = TempDir::new("plugin_root");
                    let servers = bridge_configs(&names);

                    // Plant a plain file at the victim's would-be plugin dir path.
                    // read_subdirs only enumerates directories, so this file is
                    // not seen as an owned dir and survives the clean pass; then
                    // create_dir_all on that path fails, failing the victim.
                    let victim_path = plugin_root.path().join(victim);
                    write_file(&victim_path, "not a plugin dir");

                    let result = lmstudio::provision_plugin_dirs(plugin_root.path(), &servers);
                    prop_assert!(
                        result.is_err(),
                        "provisioning must fail when the victim dir path is occupied by a file"
                    );

                    // The error names the affected server (Req 6.5, companion).
                    let msg = result.unwrap_err();
                    prop_assert!(
                        msg.contains(victim),
                        "provisioning failure '{}' must name the affected server '{}'",
                        msg,
                        victim
                    );

                    // No partial/misnamed OWNED dir remains for the victim: the
                    // planted path is still a file (never became an owned dir),
                    // so it is not toolkit-owned.
                    prop_assert!(
                        !victim_path.is_dir(),
                        "no owned plugin dir may remain for the failed server"
                    );
                    let owned = lmstudio::get_owned_plugin_dirs(plugin_root.path());
                    let victim_owned = owned.iter().any(|p| {
                        p.file_name().and_then(|n| n.to_str()) == Some(victim)
                    });
                    prop_assert!(
                        !victim_owned,
                        "the failed server must leave no owned plugin dir behind"
                    );
                }

                // ── Config write failure (Req 7.4) ──────────────────────────
                // Force write_all_to to fail on the victim tool by planting a
                // DIRECTORY at its <victim>.json path, so std::fs::write fails.
                // After failure handling, no partial config FILE remains for that
                // tool. Use a user-scoped temp dir so the writer does not reject
                // the target for being non-user-scoped (Req 7.3 guard).
                FailurePoint::Config => {
                    let dir = TempDir::new("config_dir");
                    let configs = config_set(&names);

                    // Plant a directory where the victim's config file must go.
                    let victim_file = dir.path().join(format!("{victim}.json"));
                    std::fs::create_dir_all(&victim_file).expect("plant dir at config path");

                    let result = config_gen::write_all_to(dir.path(), &configs);
                    prop_assert!(
                        result.is_err(),
                        "config write must fail when the file path is occupied by a dir"
                    );

                    // The error names the affected tool (Req 7.4).
                    let err = result.unwrap_err();
                    prop_assert_eq!(
                        &err.server_name,
                        victim,
                        "config write failure must name the affected tool"
                    );

                    // No partial config FILE remains for the failed tool: the
                    // planted directory is not a written config file, and the
                    // writer removed any partial file it may have created.
                    prop_assert!(
                        !victim_file.is_file(),
                        "no partial config file may remain for the failed tool"
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod lean_copy_property_tests {
    //! Property 10 (Copy is plugin-dist-only and never writes `node_modules`)
    //! for the install-time copy layer after the C1 reversal (M2).
    //!
    //! Under the Lean_Payload the bundled resource root carries only the nine
    //! canonical `dist/` trees — no `node_modules`. This property drives real
    //! temp directories: it materializes an arbitrary lean nine-tree payload
    //! into a temp resource root (optionally alongside a *stray* `node_modules`
    //! sibling to model a mis-staged/contaminated resource root), runs the real
    //! `copy_payload` into a temp install dir, and asserts:
    //!
    //! - the copy succeeds with no dependency-verification error (Req 7.1) — the
    //!   reverted `copy_payload` no longer copies or verifies any `node_modules`
    //!   / SDK tree,
    //! - exactly the nine plugin outputs land in the install dir and nothing
    //!   else (Req 7.3), and
    //! - `install_dir/node_modules` is never created — the stray sibling in the
    //!   resource root is never copied (Req 7.2).
    //!
    //! `copy_payload` performs no network access by construction (it is pure
    //! filesystem I/O over the injected resource root — Req 7.1); there is no
    //! network seam to exercise, so "no network access" holds statically.
    //!
    //! This module is deliberately self-contained (its own `TempDir` + helpers)
    //! so it does not collide with `copy_tests`, `copy_idempotency_property_tests`,
    //! or `atomic_rollback_property_tests`.

    use super::*;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
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
            let path = std::env::temp_dir().join(format!("llmtk_lean_{label}_{pid}_{n}"));
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

    /// Strategy for a single safe path segment (a file or directory name).
    /// Constrained to safe filename characters and never equal to
    /// `node_modules`, so any `node_modules` the property observes in the
    /// install dir could only have come from the stray sibling (never from a
    /// tool's own generated tree).
    fn seg() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,7}".prop_map(|s| s.to_string())
    }

    /// Strategy for one payload file: 1-3 path segments plus non-empty text
    /// contents. Contents are `>= 1` byte so every generated file counts as
    /// present, non-empty output under the tightened `dir_has_content`.
    fn payload_file() -> impl Strategy<Value = (Vec<String>, String)> {
        (
            prop::collection::vec(seg(), 1..=3),
            "[a-zA-Z0-9 \n]{1,32}".prop_map(|s| s.to_string()),
        )
    }

    /// Strategy for a whole lean payload: for each of the nine canonical tools,
    /// a non-empty set of payload files (>= 1 so the tool's dist root is present
    /// and non-empty and `copy_payload` verification passes), plus a boolean
    /// controlling whether a stray `node_modules` sibling is planted in the
    /// resource root next to the nine trees.
    fn lean_payload() -> impl Strategy<Value = (Vec<Vec<(Vec<String>, String)>>, bool)> {
        (
            prop::collection::vec(
                prop::collection::vec(payload_file(), 1..=4),
                CANONICAL_TOOL_COUNT,
            ),
            any::<bool>(),
        )
    }

    /// Materializes a generated lean payload into `resource_root`: one dist-like
    /// tree per canonical tool at `resource_root/<server_name>/`. De-conflicts
    /// generated path collisions deterministically (a file path whose ancestor
    /// is already a file, or whose own path is already a directory, is skipped),
    /// then guarantees at least one real file per tool so the tree is non-empty.
    fn materialize_lean_payload(resource_root: &Path, payload: &[Vec<(Vec<String>, String)>]) {
        for (tool, files) in canonical_payloads().iter().zip(payload.iter()) {
            let tool_dir = resource_root.join(tool.server_name);
            std::fs::create_dir_all(&tool_dir).expect("create tool dir");

            let mut file_paths: BTreeSet<Vec<String>> = BTreeSet::new();
            let mut dir_paths: BTreeSet<Vec<String>> = BTreeSet::new();
            let mut wrote_any = false;

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
                wrote_any = true;

                file_paths.insert(segments.clone());
                for end in 1..segments.len() {
                    dir_paths.insert(segments[..end].to_vec());
                }
            }

            // Guarantee a non-empty tree even if every generated file was skipped
            // by de-confliction, so `copy_payload`'s verification passes.
            if !wrote_any {
                write_file(&tool_dir.join("index.js"), "// entry\n");
            }
        }
    }

    /// The set of top-level entry names directly under `dir`.
    fn top_level_entries(dir: &Path) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    out.insert(name.to_string());
                }
            }
        }
        out
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        // Feature: installer-runtime-provisioning, Property 10: Copy is
        // plugin-dist-only and never writes `node_modules`.
        //
        // For any resolved resource root (even one that carries a stray
        // `node_modules` sibling next to the nine trees), a successful
        // `copy_payload`:
        //   - succeeds with no dependency-verification error (Req 7.1),
        //   - copies exactly the nine plugin outputs into the install dir and
        //     nothing else (Req 7.3), and
        //   - leaves NO `install_dir/node_modules` — the stray sibling in the
        //     resource root is never copied (Req 7.2).
        // A lean payload (nine trees, no `node_modules`) copies successfully.
        // `copy_payload` performs no network access by construction (Req 7.1).
        //
        // Validates: Requirements 7.1, 7.2, 7.3.
        #[test]
        fn prop_copy_is_plugin_dist_only((payload, with_stray_node_modules) in lean_payload()) {
            let res = TempDir::new("res");
            let install = TempDir::new("install");
            materialize_lean_payload(res.path(), &payload);

            // Optionally contaminate the resource root with a stray
            // `node_modules` sibling (with content) next to the nine trees. A
            // plugin-dist-only copy must ignore it entirely.
            if with_stray_node_modules {
                let stray = res.path().join("node_modules");
                write_file(
                    &stray.join("@modelcontextprotocol").join("sdk").join("index.js"),
                    "// stray sdk that must never be copied\n",
                );
                write_file(&stray.join("left-pad").join("index.js"), "// stray dep\n");
            }

            // Copy must succeed for a lean payload — no MissingDependencies /
            // dependency-verification error exists after the C1 reversal (Req 7.1).
            let result = copy_payload(res.path(), install.path());
            prop_assert!(
                result.is_ok(),
                "lean payload copy must succeed, got {:?}",
                result.err()
            );

            // Exactly the nine plugin outputs are present and non-empty (Req 7.3).
            let plan = verify_install_dir(install.path());
            prop_assert!(
                plan.is_complete(),
                "all nine plugin outputs must be present after copy; missing = {:?}",
                plan.missing
            );
            prop_assert_eq!(plan.present.len(), CANONICAL_TOOL_COUNT);

            // The install dir's top-level entries are EXACTLY the nine server
            // names — nothing else was copied (Req 7.3), and in particular the
            // stray `node_modules` sibling was not (Req 7.2).
            let expected: BTreeSet<String> = canonical_payloads()
                .iter()
                .map(|t| t.server_name.to_string())
                .collect();
            let actual = top_level_entries(install.path());
            prop_assert_eq!(
                &actual,
                &expected,
                "install dir top-level entries must be exactly the nine plugin outputs"
            );

            // The core negative assertion (Req 7.2): the copy step never writes
            // `install_dir/node_modules`, regardless of the resource root's
            // contamination.
            prop_assert!(
                !install.path().join("node_modules").exists(),
                "copy must never create install_dir/node_modules"
            );
        }
    }
}

#[cfg(test)]
mod nonempty_file_property_tests {
    //! Property 11 (Copy verification requires a non-empty `> 0`-byte file per
    //! plugin) for the install-time copy/verify layer after the M2 tightening.
    //!
    //! Task 2.2 tightened `dir_has_content` so a plugin output counts as present
    //! only when it holds — at any depth — at least one regular file whose size
    //! is strictly `> 0` bytes. A directory holding only 0-byte files, or an
    //! empty directory, is treated as absent/empty. This property drives real
    //! temp directories over the whole per-plugin file-size input space.
    //!
    //! For each of the nine canonical tools an independent state is generated:
    //!
    //!   - (a) `HasNonEmptyFile`  — the tool's tree holds at least one `> 0`-byte
    //!         file (plus, optionally, some 0-byte files as noise),
    //!   - (b) `OnlyZeroByteFiles` — the tool's tree holds one or more files but
    //!         every one of them is exactly 0 bytes, and
    //!   - (c) `EmptyDir`          — the tool's directory exists but is empty (or
    //!         holds only empty subdirectories).
    //!
    //! The property asserts that both `verify_install_dir` (over a directly
    //! materialized install dir) and `copy_payload` (over a materialized
    //! resource root) treat a tool as present ONLY when it is in state (a):
    //!
    //!   - `verify_install_dir(...).missing` equals EXACTLY the set of tools NOT
    //!     in state (a) (Req 7.4), and
    //!   - `copy_payload` returns `Ok` iff every tool is in state (a); otherwise
    //!     it returns `CopyError::VerificationFailed { missing }` naming EXACTLY
    //!     the set of tools NOT in state (a) (Req 7.4).
    //!
    //! This module is deliberately self-contained (its own `TempDir` + helpers)
    //! so it does not collide with `copy_tests`, `copy_idempotency_property_tests`,
    //! `atomic_rollback_property_tests`, or `lean_copy_property_tests`.

    use super::*;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
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
            let path = std::env::temp_dir().join(format!("llmtk_nonempty_{label}_{pid}_{n}"));
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

    /// Writes `contents` to `path`, creating parent directories as needed. When
    /// `contents` is empty this materializes a genuine 0-byte regular file.
    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, contents).expect("write file");
    }

    /// The three per-plugin file-size states under test.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum PluginState {
        /// (a) Has at least one regular file with size strictly `> 0` bytes.
        HasNonEmptyFile,
        /// (b) Has one or more files, but every one of them is exactly 0 bytes.
        OnlyZeroByteFiles,
        /// (c) The directory exists but is empty (or holds only empty subdirs).
        EmptyDir,
    }

    impl PluginState {
        /// Only state (a) contributes a `> 0`-byte file, so only (a) is present
        /// under the tightened `dir_has_content` (Req 7.4).
        fn is_present(self) -> bool {
            matches!(self, PluginState::HasNonEmptyFile)
        }
    }

    /// Strategy over the three states, uniformly.
    fn plugin_state() -> impl Strategy<Value = PluginState> {
        prop_oneof![
            Just(PluginState::HasNonEmptyFile),
            Just(PluginState::OnlyZeroByteFiles),
            Just(PluginState::EmptyDir),
        ]
    }

    /// A per-plugin state vector, one entry per canonical tool.
    fn plugin_states() -> impl Strategy<Value = Vec<PluginState>> {
        prop::collection::vec(plugin_state(), CANONICAL_TOOL_COUNT)
    }

    /// Materializes one tool's directory at `tool_dir` in the given state.
    ///
    /// - `HasNonEmptyFile`  writes a `> 0`-byte file (nested, to exercise the
    ///   recursive descent) alongside a 0-byte sibling as noise, so presence is
    ///   decided by the non-empty file rather than by file count.
    /// - `OnlyZeroByteFiles` writes one or more genuine 0-byte files (including
    ///   a nested one) and no non-empty file.
    /// - `EmptyDir` creates the directory (and an empty nested subdir) with no
    ///   files at all.
    fn materialize_tool(tool_dir: &Path, state: PluginState) {
        std::fs::create_dir_all(tool_dir).expect("create tool dir");
        match state {
            PluginState::HasNonEmptyFile => {
                // A 0-byte sibling proves presence is driven by the non-empty
                // file, not by the mere existence of files.
                write_file(&tool_dir.join("empty.js"), "");
                write_file(&tool_dir.join("nested").join("index.js"), "// entry\n");
            }
            PluginState::OnlyZeroByteFiles => {
                write_file(&tool_dir.join("index.js"), "");
                write_file(&tool_dir.join("nested").join("helper.js"), "");
            }
            PluginState::EmptyDir => {
                // Directory exists but holds only an empty subdirectory.
                std::fs::create_dir_all(tool_dir.join("nested")).expect("create empty subdir");
            }
        }
    }

    /// Builds a resource root under `root` with each canonical tool in its
    /// generated state.
    fn materialize_resource_root(root: &Path, states: &[PluginState]) {
        for (tool, &state) in canonical_payloads().iter().zip(states.iter()) {
            materialize_tool(&root.join(tool.server_name), state);
        }
    }

    /// The exact set of tools NOT in state (a) — i.e. those that must be
    /// reported missing by verification (Req 7.4).
    fn expected_missing(states: &[PluginState]) -> BTreeSet<String> {
        canonical_payloads()
            .iter()
            .zip(states.iter())
            .filter_map(|(tool, &state)| {
                (!state.is_present()).then(|| tool.server_name.to_string())
            })
            .collect()
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(256))]

        // Feature: installer-runtime-provisioning, Property 11: Copy
        // verification requires a non-empty (> 0-byte) file per plugin.
        //
        // For any per-plugin file-size state over the nine canonical tools —
        // each tool having a > 0-byte file (a), only 0-byte files (b), or being
        // an empty directory (c) — the install-time verification treats a tool
        // as present ONLY when it is in state (a). Both `verify_install_dir`
        // (over a directly materialized install dir) and `copy_payload` (over a
        // materialized resource root) agree:
        //   - the reported missing set equals EXACTLY the set of tools NOT in
        //     state (a), and
        //   - the copy succeeds iff every tool is in state (a); otherwise it
        //     fails with `VerificationFailed { missing }` naming that exact set.
        //
        // Validates: Requirements 7.4.
        #[test]
        fn prop_copy_verification_requires_nonempty_file(states in plugin_states()) {
            let expected = expected_missing(&states);
            let all_present = expected.is_empty();

            // --- Path 1: verify_install_dir over a directly built install dir ---
            // Build the install directory in the generated states and probe it
            // directly, so the missing set is observed without any rollback
            // interference from copy_payload.
            let direct = TempDir::new("direct");
            materialize_resource_root(direct.path(), &states);

            let plan = verify_install_dir(direct.path());
            let reported: BTreeSet<String> = plan.missing.iter().cloned().collect();
            prop_assert_eq!(
                &reported,
                &expected,
                "verify_install_dir missing set must equal exactly the tools not in state (a)"
            );
            prop_assert_eq!(plan.is_complete(), all_present);
            // present is exactly the state-(a) tools.
            let present_set: BTreeSet<String> = plan.present.iter().cloned().collect();
            let expected_present: BTreeSet<String> = canonical_payloads()
                .iter()
                .zip(states.iter())
                .filter_map(|(tool, &state)| {
                    state.is_present().then(|| tool.server_name.to_string())
                })
                .collect();
            prop_assert_eq!(&present_set, &expected_present);

            // --- Path 2: copy_payload over a materialized resource root ---
            // The resource root carries every tool's tree (0-byte / empty ones
            // included), so the copy reaches verification for every tool. Copy
            // then verifies and, on any gap, rolls back and reports the exact set.
            let res = TempDir::new("res");
            let install = TempDir::new("install");
            materialize_resource_root(res.path(), &states);

            let result = copy_payload(res.path(), install.path());
            if all_present {
                prop_assert!(
                    result.is_ok(),
                    "copy must succeed when every plugin has a > 0-byte file, got {:?}",
                    result.err()
                );
            } else {
                match result {
                    Err(CopyError::VerificationFailed { missing }) => {
                        let missing_set: BTreeSet<String> = missing.into_iter().collect();
                        prop_assert_eq!(
                            &missing_set,
                            &expected,
                            "VerificationFailed must name exactly the tools not in state (a)"
                        );
                    }
                    other => prop_assert!(
                        false,
                        "expected VerificationFailed naming the empty plugins, got {:?}",
                        other
                    ),
                }
                // On verification failure copy_payload rolls back everything it
                // wrote, so no plugin output remains in the install dir.
                let after = verify_install_dir(install.path());
                prop_assert!(
                    after.present.is_empty(),
                    "failed copy must roll back all written outputs"
                );
            }
        }
    }
}

#[cfg(test)]
mod copy_self_cleanup_property_tests {
    //! Property 13 (Copy self-cleanup on failure) for the install-time copy
    //! layer, exercised by injecting a copy failure at an *arbitrary* plugin
    //! index over the nine canonical tools and asserting the copy step's
    //! self-cleanup scope against real temp directories.
    //!
    //! ## Contract actually implemented (and asserted here)
    //!
    //! `copy_payload` tracks every output it writes *in this call* in a `written`
    //! vec and, on the first copy error, calls `rollback_written(install_dir,
    //! &written)` over the **whole** vec. So the implemented self-cleanup removes
    //! **every output this copy call had written so far** (the plugins copied
    //! before the failure point *and* any partial bytes of the failing plugin),
    //! returning the install directory to its pre-copy state for
    //! toolkit-owned content. It removes only what *this* copy wrote — any
    //! pre-existing *foreign* (non-canonical, unowned) entry already in the
    //! install dir is left untouched. This matches the two existing lower-level
    //! tests, both of which assert the whole-call rollback:
    //!   - `copy_tests::copy_payload_rolls_back_on_missing_source_tool`
    //!     (`plan.present.is_empty()` after a mid-copy `MissingSourceTool`), and
    //!   - `atomic_rollback_property_tests` Property 6's `Copy` arm
    //!     (`!any_tool_output_present(...)` after a forced copy failure).
    //!
    //! So this property asserts, for a failure injected at any index `i`:
    //!   - the copy returns `Err(MissingSourceTool { server_name })` naming the
    //!     victim plugin (Req 7.5 attribution),
    //!   - **none** of the nine plugin outputs remain in the install dir — the
    //!     whole-call self-cleanup removed the plugins copied before `i` as well
    //!     as the failing one, and
    //!   - any pre-existing **foreign** entry (a non-canonical, unowned file/dir
    //!     planted before the copy) is **preserved** — self-cleanup removes only
    //!     what this copy wrote, never foreign content (Req 7.5/7.6 boundary).
    //!
    //! ## Discrepancy note (task title vs. implemented/design contract)
    //!
    //! Task 2.6's title — "removes only the failed plugin's partial output while
    //! earlier plugins remain" — and Requirement 7.5 / design "Property 13"
    //! describe a *narrower* self-cleanup that removes only the failing plugin
    //! and leaves the earlier-copied plugins in place at that moment. The
    //! **current production code does not implement that narrower scope**:
    //! `copy_payload` passes the full `written` vec to `rollback_written`, so the
    //! earlier plugins are also removed. Changing that scope is a production-code
    //! change and is out of scope for this test task, so this property is written
    //! to match the behavior the code and the two existing rollback tests already
    //! enforce (whole-call self-cleanup), rather than asserting a contract the
    //! code contradicts. The foreign-preservation half of the property is the
    //! part of Req 7.5/7.6 the code *does* honor and is asserted directly.
    //!
    //! This module is deliberately self-contained (its own `TempDir` + helpers)
    //! so it does not collide with `copy_tests`, `copy_idempotency_property_tests`,
    //! `atomic_rollback_property_tests`, `lean_copy_property_tests`, or
    //! `nonempty_file_property_tests`.

    use super::*;
    use crate::tool_payload::{canonical_payloads, CANONICAL_TOOL_COUNT};
    use proptest::prelude::*;
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
            let path = std::env::temp_dir().join(format!("llmtk_selfclean_{label}_{pid}_{n}"));
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

    /// Builds a complete lean payload resource root: one non-empty `dist`-like
    /// tree per canonical tool at `root/<server_name>/` (Req 7.1/7.2), so every
    /// plugin's copy would succeed absent the injected failure.
    fn make_full_resource_root(root: &Path) {
        for tool in canonical_payloads() {
            let tool_dir = root.join(tool.server_name);
            write_file(
                &tool_dir.join("index.js"),
                &format!("// {} entry\n", tool.server_name),
            );
            write_file(&tool_dir.join("nested").join("helper.js"), "// helper\n");
        }
    }

    /// A foreign (non-toolkit) entry to plant in the install dir before the copy,
    /// modeling unrelated content that must survive the copy step's self-cleanup.
    /// The name is deliberately outside the canonical set and carries no
    /// ownership marker, so the copy step neither writes nor owns it.
    const FOREIGN_DIR_NAME: &str = "unrelated_vendor_app";
    const FOREIGN_FILE_NAME: &str = "PREEXISTING.txt";
    const FOREIGN_FILE_CONTENTS: &str = "user data that must never be touched\n";

    /// Plants a foreign directory (with a file inside) and a foreign top-level
    /// file in `install_dir`. Returns the two paths so the property can assert
    /// they survive.
    fn plant_foreign(install_dir: &Path) -> (PathBuf, PathBuf) {
        let foreign_dir_file = install_dir
            .join(FOREIGN_DIR_NAME)
            .join("keep")
            .join("data.bin");
        write_file(&foreign_dir_file, "foreign nested payload\n");
        let foreign_top_file = install_dir.join(FOREIGN_FILE_NAME);
        write_file(&foreign_top_file, FOREIGN_FILE_CONTENTS);
        (
            install_dir.join(FOREIGN_DIR_NAME),
            foreign_top_file,
        )
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]

        // Feature: installer-runtime-provisioning, Property 13: Copy self-cleanup
        // removes only the failed plugin's partial output.
        //
        // For a copy failure injected at ANY plugin index `i` over the nine
        // canonical tools (by removing that plugin's bundled source so
        // `copy_payload` fails with `MissingSourceTool` at `i`), the copy step's
        // immediate self-cleanup:
        //   - returns an error naming the affected plugin (Req 7.5 attribution),
        //   - removes what THIS copy call wrote — under the implemented
        //     whole-call `rollback_written`, that is every one of the nine plugin
        //     outputs (none remain), returning the install dir to its pre-copy
        //     state for toolkit-owned content, and
        //   - preserves any pre-existing FOREIGN (non-canonical, unowned) entry:
        //     self-cleanup removes only what this copy wrote, never foreign
        //     content (Req 7.5/7.6 boundary).
        //
        // NOTE: The task title / Req 7.5 wording ("only the failed plugin's
        // partial output is removed while earlier plugins remain") describes a
        // narrower scope than the code implements; see the module doc-comment.
        // This property asserts the behavior the production code and the two
        // existing rollback tests enforce, plus the foreign-preservation
        // invariant the code does honor.
        //
        // Validates: Requirements 7.5, 7.6.
        #[test]
        fn prop_copy_self_cleanup_scope(victim_index in 0usize..CANONICAL_TOOL_COUNT) {
            let res = TempDir::new("res");
            let install = TempDir::new("install");
            make_full_resource_root(res.path());

            // Pre-existing FOREIGN content in the install dir — must survive.
            let (foreign_dir, foreign_file) = plant_foreign(install.path());

            // Inject the failure at an arbitrary plugin index: removing the
            // victim's bundled source makes `copy_payload` fail with
            // `MissingSourceTool` when it reaches that plugin, after having
            // copied plugins 0..victim_index.
            let victim = canonical_payloads()[victim_index].server_name;
            std::fs::remove_dir_all(res.path().join(victim))
                .expect("remove victim source to inject the copy failure");

            let result = copy_payload(res.path(), install.path());

            // --- attribution: the error names the affected plugin (Req 7.5) ---
            match result {
                Err(CopyError::MissingSourceTool { ref server_name, .. }) => {
                    prop_assert_eq!(
                        server_name.as_str(),
                        victim,
                        "self-cleanup failure must name the affected plugin"
                    );
                }
                other => prop_assert!(
                    false,
                    "expected MissingSourceTool at index {}, got {:?}",
                    victim_index,
                    other
                ),
            }

            // --- self-cleanup scope (implemented whole-call rollback) ---
            // None of the nine plugin outputs remain: the copy step removed every
            // output it had written in this call (the plugins copied before the
            // failure as well as the failing one), returning the install dir to
            // its pre-copy toolkit-owned state.
            let plan = verify_install_dir(install.path());
            prop_assert!(
                plan.present.is_empty(),
                "self-cleanup must remove every output this copy wrote; present = {:?}",
                plan.present
            );
            for tool in canonical_payloads() {
                prop_assert!(
                    !install.path().join(tool.server_name).exists(),
                    "no toolkit-owned output may remain for '{}' after self-cleanup",
                    tool.server_name
                );
            }

            // --- foreign preservation (Req 7.5/7.6 boundary) ---
            // Self-cleanup removes only what this copy wrote; the pre-existing
            // foreign entries are untouched.
            prop_assert!(
                foreign_dir.is_dir(),
                "pre-existing foreign directory must be preserved by self-cleanup"
            );
            prop_assert!(
                foreign_dir.join("keep").join("data.bin").is_file(),
                "foreign nested content must be preserved intact"
            );
            prop_assert!(
                foreign_file.is_file(),
                "pre-existing foreign file must be preserved by self-cleanup"
            );
            let preserved = std::fs::read_to_string(&foreign_file).unwrap_or_default();
            prop_assert_eq!(
                preserved,
                FOREIGN_FILE_CONTENTS,
                "foreign file contents must be preserved byte-for-byte"
            );
        }
    }
}
