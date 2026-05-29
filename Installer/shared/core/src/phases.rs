use crate::diagnostics;
use crate::error::{InstallError, InstallErrorKind, Phase};
use crate::license::LicenseAcceptance;
use crate::lmstudio;
use crate::paths::{InstallPaths, InstallScope};
use crate::runtime::{self, ResolvedNode};
use crate::tools;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallOptions {
    pub scope: InstallScope,
    pub install_root: PathBuf,
    pub install_playwright_browsers: bool,
    pub sync_lm_studio: bool,
    pub create_start_menu_shortcut: bool,
    pub license: LicenseAcceptance,
    /// Override for the toolkit payload URL (development / staging).
    #[serde(default)]
    pub payload_url_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub phase: Phase,
    pub step: u32,
    pub total: u32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ProgressEvent {
    Progress(InstallProgress),
    Log { level: String, line: String },
    PhaseDone { phase: Phase },
    Error { error: InstallError },
    Done { paths: InstallPaths },
}

const TOTAL_PHASES: u32 = 8;

/// Cancellation token shared with the orchestrator. The renderer can flip
/// `cancelled` via the `cancel_install` Tauri command.
#[derive(Default, Clone)]
pub struct CancelToken(Arc<Mutex<bool>>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }
    pub async fn cancel(&self) {
        *self.0.lock().await = true;
    }
    pub async fn is_cancelled(&self) -> bool {
        *self.0.lock().await
    }
}

/// Orchestrate all install phases. Emits events through `tx`. Returns the
/// resolved install paths on success.
pub async fn run_install(
    opts: InstallOptions,
    tx: mpsc::UnboundedSender<ProgressEvent>,
    cancel: CancelToken,
) -> Result<InstallPaths, InstallError> {
    let paths = crate::paths::resolve(opts.scope);

    // Phase: License (server-side re-check).
    emit_phase(&tx, Phase::License, 1);
    crate::license::validate(&opts.license)?;

    // Phase: Runtime
    emit_phase(&tx, Phase::Runtime, 2);
    check_cancel(&cancel).await?;
    let node = resolve_node(&opts).await?;
    log_line(&tx, "info", format!("Using node {} ({:?})", node.version, node.source));

    // Phase: Payload download + extract
    emit_phase(&tx, Phase::PayloadDownload, 3);
    check_cancel(&cancel).await?;
    crate::payload::fetch_and_extract(&opts.install_root).await?;
    log_line(&tx, "info", "Payload extracted.");

    // Phase: Env defaults
    emit_phase(&tx, Phase::EnvWrite, 4);
    check_cancel(&cancel).await?;
    write_default_env(&opts.install_root)?;

    // Phase: npm install + optional playwright
    emit_phase(&tx, Phase::NpmInstall, 5);
    check_cancel(&cancel).await?;
    run_npm(&node, &opts.install_root, &["install", "--no-audit", "--no-fund"], &tx).await?;
    if opts.install_playwright_browsers {
        run_npm(
            &node,
            &opts.install_root,
            &["run", "-w", "WebBrowser", "postinstall"],
            &tx,
        )
        .await
        .ok(); // Non-fatal: postinstall may not exist.
    }

    // Phase: build
    emit_phase(&tx, Phase::Build, 6);
    check_cancel(&cancel).await?;
    run_npm(&node, &opts.install_root, &["run", "build"], &tx).await?;

    // Phase: verify
    emit_phase(&tx, Phase::Verify, 7);
    check_cancel(&cancel).await?;
    let tools = tools::load_bundled().map_err(|e| InstallError::from_anyhow(Phase::Verify, InstallErrorKind::Internal, e))?;
    verify_tools(&opts.install_root, &tools)?;

    // Phase: LM Studio sync
    emit_phase(&tx, Phase::LmStudioSync, 8);
    check_cancel(&cancel).await?;
    if opts.sync_lm_studio {
        let res = lmstudio::sync(&opts.install_root, &tools, &node.path.to_string_lossy(), None)?;
        log_line(&tx, "info", res.message);
    } else {
        log_line(&tx, "info", "Skipped LM Studio sync (disabled in options).");
    }

    // Done.
    let _ = tx.send(ProgressEvent::Done { paths: paths.clone() });
    Ok(paths)
}

fn emit_phase(tx: &mpsc::UnboundedSender<ProgressEvent>, phase: Phase, step: u32) {
    let evt = ProgressEvent::Progress(InstallProgress {
        phase,
        step,
        total: TOTAL_PHASES,
        label: phase.label().to_string(),
    });
    let _ = tx.send(evt);
}

fn log_line(tx: &mpsc::UnboundedSender<ProgressEvent>, level: &str, line: impl Into<String>) {
    let line = line.into();
    diagnostics::record_log(format!("[{level}] {line}"));
    let _ = tx.send(ProgressEvent::Log {
        level: level.into(),
        line,
    });
}

async fn check_cancel(cancel: &CancelToken) -> Result<(), InstallError> {
    if cancel.is_cancelled().await {
        Err(InstallError::fatal(
            Phase::Done,
            InstallErrorKind::Cancelled,
            "Install cancelled by user.",
        ))
    } else {
        Ok(())
    }
}

async fn resolve_node(_opts: &InstallOptions) -> Result<ResolvedNode, InstallError> {
    if let Some(node) = runtime::detect_system_node() {
        return Ok(node);
    }
    runtime::ensure_portable_node(&_opts.install_root).await
}

fn write_default_env(install_root: &std::path::Path) -> Result<(), InstallError> {
    let env_path = install_root.join(".env");
    if env_path.exists() {
        return Ok(());
    }
    let defaults = "# LLM Toolkit environment defaults\n\
BROWSERLESS_API_KEY=\n\
TERMINAL_DEFAULT_TIMEOUT_MS=60000\n\
TERMINAL_MAX_TIMEOUT_MS=120000\n";
    std::fs::write(&env_path, defaults).map_err(|e| InstallError {
        phase: Phase::EnvWrite,
        kind: InstallErrorKind::Filesystem,
        message: e.to_string(),
        recoverable: true,
        cause_chain: vec![],
    })
}

fn verify_tools(install_root: &std::path::Path, tools: &[tools::ToolDescriptor]) -> Result<(), InstallError> {
    let mut missing = Vec::new();
    for t in tools {
        let script = install_root.join(&t.relative_script);
        if !script.is_file() {
            missing.push(t.display_name.clone());
        }
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(InstallError {
            phase: Phase::Verify,
            kind: InstallErrorKind::Verification,
            message: format!("Missing tool binaries after build: {}", missing.join(", ")),
            recoverable: true,
            cause_chain: vec![],
        })
    }
}

async fn run_npm(
    node: &ResolvedNode,
    cwd: &std::path::Path,
    args: &[&str],
    tx: &mpsc::UnboundedSender<ProgressEvent>,
) -> Result<(), InstallError> {
    // Find npm next to node. On Windows it's `npm.cmd` in the same dir.
    let npm_path = locate_npm(&node.path).ok_or_else(|| InstallError {
        phase: Phase::NpmInstall,
        kind: InstallErrorKind::Filesystem,
        message: "Could not locate npm next to node binary.".into(),
        recoverable: true,
        cause_chain: vec![],
    })?;
    log_line(tx, "info", format!("$ {} {}", npm_path.display(), args.join(" ")));

    let mut cmd = Command::new(&npm_path);
    cmd.args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| InstallError {
        phase: Phase::NpmInstall,
        kind: InstallErrorKind::Process,
        message: format!("Failed to spawn npm: {e}"),
        recoverable: true,
        cause_chain: vec![],
    })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let tx_out = tx.clone();
    let tx_err = tx.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(out) = stdout {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut reader = BufReader::new(out).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                diagnostics::record_log(line.clone());
                let _ = tx_out.send(ProgressEvent::Log {
                    level: "stdout".into(),
                    line,
                });
            }
        }
    });
    let stderr_task = tokio::spawn(async move {
        if let Some(err) = stderr {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut reader = BufReader::new(err).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                diagnostics::record_log(line.clone());
                let _ = tx_err.send(ProgressEvent::Log {
                    level: "stderr".into(),
                    line,
                });
            }
        }
    });

    let status = child.wait().await.map_err(|e| InstallError {
        phase: Phase::NpmInstall,
        kind: InstallErrorKind::Process,
        message: format!("Wait failed: {e}"),
        recoverable: true,
        cause_chain: vec![],
    })?;
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    if !status.success() {
        return Err(InstallError {
            phase: Phase::NpmInstall,
            kind: InstallErrorKind::Process,
            message: format!("npm {} exited with status {}", args.join(" "), status),
            recoverable: true,
            cause_chain: vec![],
        });
    }
    Ok(())
}

fn locate_npm(node_path: &std::path::Path) -> Option<PathBuf> {
    let parent = node_path.parent()?;
    let candidate = if cfg!(target_os = "windows") {
        parent.join("npm.cmd")
    } else {
        parent.join("npm")
    };
    if candidate.exists() {
        Some(candidate)
    } else {
        // Fallback: assume `npm` is on PATH.
        let name = if cfg!(target_os = "windows") { "npm.cmd" } else { "npm" };
        std::env::var_os("PATH").and_then(|p| {
            std::env::split_paths(&p)
                .map(|d| d.join(name))
                .find(|c| c.is_file())
        })
    }
}
