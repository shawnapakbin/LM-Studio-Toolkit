use crate::error::{InstallError, InstallErrorKind, Phase};
use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const RING_CAPACITY: usize = 2000;

static LOG_RING: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::with_capacity(RING_CAPACITY)));

pub fn record_log(line: impl Into<String>) {
    let line = line.into();
    let mut guard = LOG_RING.lock().expect("log ring poisoned");
    if guard.len() >= RING_CAPACITY {
        guard.remove(0);
    }
    guard.push(line);
}

pub fn snapshot_logs() -> Vec<String> {
    LOG_RING.lock().map(|g| g.clone()).unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticReport {
    pub installer_version: String,
    pub generated_at: String,
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub install_scope: Option<String>,
    pub install_root: Option<PathBuf>,
    pub current_phase: Option<Phase>,
    pub error: Option<InstallError>,
    pub env_redacted: Vec<(String, String)>,
    pub logs: Vec<String>,
}

static SECRET_KEY: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(key|secret|token|password|passwd|auth|credential|bearer)").unwrap());

const REDACTED: &str = "[REDACTED]";

fn redact_env() -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (k, v) in std::env::vars() {
        let value = if SECRET_KEY.is_match(&k) {
            REDACTED.to_string()
        } else {
            // Truncate noisy/long values defensively.
            if v.len() > 500 {
                format!("{}…", &v[..500])
            } else {
                v
            }
        };
        out.push((k, value));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

pub fn build_report(
    error: Option<InstallError>,
    current_phase: Option<Phase>,
    install_scope: Option<&str>,
    install_root: Option<&Path>,
) -> DiagnosticReport {
    DiagnosticReport {
        installer_version: crate::INSTALLER_VERSION.to_string(),
        generated_at: Utc::now().to_rfc3339(),
        os: std::env::consts::OS.to_string(),
        os_version: os_version_string(),
        arch: std::env::consts::ARCH.to_string(),
        install_scope: install_scope.map(str::to_string),
        install_root: install_root.map(Path::to_path_buf),
        current_phase,
        error,
        env_redacted: redact_env(),
        logs: snapshot_logs(),
    }
}

#[cfg(target_os = "windows")]
fn os_version_string() -> String {
    std::env::var("OS").unwrap_or_else(|_| "Windows".into())
}

#[cfg(not(target_os = "windows"))]
fn os_version_string() -> String {
    std::env::consts::OS.to_string()
}

/// Persist the report to disk. Returns the file path written.
pub fn save_report(dir: &Path, report: &DiagnosticReport) -> Result<PathBuf, InstallError> {
    std::fs::create_dir_all(dir).map_err(|e| InstallError {
        phase: Phase::Done,
        kind: InstallErrorKind::Filesystem,
        message: format!("Could not create diagnostics dir: {e}"),
        recoverable: true,
        cause_chain: vec![],
    })?;
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let path = dir.join(format!("report-{stamp}.json"));
    let json = serde_json::to_string_pretty(report).map_err(|e| InstallError {
        phase: Phase::Done,
        kind: InstallErrorKind::Internal,
        message: format!("Could not serialize report: {e}"),
        recoverable: false,
        cause_chain: vec![],
    })?;
    std::fs::write(&path, json).map_err(|e| InstallError {
        phase: Phase::Done,
        kind: InstallErrorKind::Filesystem,
        message: format!("Could not write report: {e}"),
        recoverable: true,
        cause_chain: vec![],
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_redacted() {
        std::env::set_var("LLM_TEST_API_KEY", "supersecret123");
        std::env::set_var("LLM_TEST_PLAIN", "ok");
        let report = build_report(None, None, None, None);
        let key_entry = report
            .env_redacted
            .iter()
            .find(|(k, _)| k == "LLM_TEST_API_KEY")
            .expect("key present");
        assert_eq!(key_entry.1, REDACTED);
        let plain_entry = report
            .env_redacted
            .iter()
            .find(|(k, _)| k == "LLM_TEST_PLAIN")
            .expect("plain present");
        assert_eq!(plain_entry.1, "ok");
        std::env::remove_var("LLM_TEST_API_KEY");
        std::env::remove_var("LLM_TEST_PLAIN");
    }

    #[test]
    fn log_ring_caps_at_capacity() {
        for i in 0..(RING_CAPACITY + 50) {
            record_log(format!("line {i}"));
        }
        let snap = snapshot_logs();
        assert!(snap.len() <= RING_CAPACITY);
    }
}
