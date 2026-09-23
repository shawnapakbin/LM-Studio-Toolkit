use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;

/// A structured log entry for installation events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

/// Internal state for the logger
struct LoggerState {
    entries: Vec<LogEntry>,
    install_dir: Option<PathBuf>,
}

/// Global logger state
static LOGGER_STATE: OnceLock<Mutex<LoggerState>> = OnceLock::new();

fn state() -> &'static Mutex<LoggerState> {
    LOGGER_STATE.get_or_init(|| {
        Mutex::new(LoggerState {
            entries: Vec::new(),
            install_dir: None,
        })
    })
}

/// Initialize the logger with the installation directory path.
/// This sets where `install.log` will be written.
pub fn init(install_dir: &str) {
    if let Ok(mut s) = state().lock() {
        let path = PathBuf::from(install_dir);
        // Ensure directory exists (best-effort)
        let _ = fs::create_dir_all(&path);
        s.install_dir = Some(path);
    }
}

/// Get the current ISO 8601 timestamp
fn now_iso8601() -> String {
    Utc::now().to_rfc3339()
}

/// Write a log entry to the install.log file on disk.
/// Fails silently to avoid crashing the installer if logging I/O fails.
fn write_to_file(entry: &LogEntry, install_dir: &PathBuf) {
    let log_path = install_dir.join("install.log");
    let line = format!(
        "[{}] [{}] [{}] {}{}\n",
        entry.timestamp,
        entry.level.to_uppercase(),
        entry.phase,
        entry.message,
        match &entry.details {
            Some(d) => format!(" | details: {}", d),
            None => String::new(),
        }
    );

    // Open in append mode, create if not exists. Silently ignore errors.
    let result = OpenOptions::new().create(true).append(true).open(&log_path);

    if let Ok(mut file) = result {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Record a log entry at the given level, storing it in memory and writing to disk.
fn record(level: &str, phase: &str, message: &str, details: Option<serde_json::Value>) {
    let entry = LogEntry {
        timestamp: now_iso8601(),
        level: level.to_string(),
        phase: phase.to_string(),
        message: message.to_string(),
        details,
    };

    if let Ok(mut s) = state().lock() {
        // Write to file if install_dir is configured
        if let Some(ref dir) = s.install_dir {
            write_to_file(&entry, dir);
        }
        // Always store in memory for retrieval via IPC
        s.entries.push(entry);
    }
}

// --- Public API ---

/// Log the start of an installation phase
pub fn log_phase_start(phase: &str) {
    record("info", phase, &format!("Phase started: {}", phase), None);
}

/// Log the successful completion of an installation phase
pub fn log_phase_complete(phase: &str) {
    record("info", phase, &format!("Phase completed: {}", phase), None);
}

/// Log a download event with the URL being fetched.
///
/// Part of the logging API retained for callers/future use; currently unused
/// in-crate now that the Runtimes step performs no downloads.
#[allow(dead_code)]
pub fn log_download(phase: &str, url: &str) {
    record(
        "info",
        phase,
        &format!("Downloading: {}", url),
        Some(serde_json::json!({ "url": url })),
    );
}

/// Log an error message
pub fn log_error(phase: &str, message: &str) {
    record("error", phase, message, None);
}

/// Log an error with additional structured detail context.
///
/// Part of the logging API retained for callers/future use; currently unused
/// in-crate.
#[allow(dead_code)]
pub fn log_error_with_details(phase: &str, message: &str, details: serde_json::Value) {
    record("error", phase, message, Some(details));
}

/// Log an info-level message (general purpose)
pub fn log_info(phase: &str, message: &str) {
    record("info", phase, message, None);
}

/// Log a warning-level message
pub fn log_warn(phase: &str, message: &str) {
    record("warn", phase, message, None);
}

/// Get all log entries as structured data.
///
/// Part of the logging API retained for callers/future use; currently unused
/// in-crate (the IPC command uses `get_entries`).
#[allow(dead_code)]
pub fn get_log_entries() -> Vec<LogEntry> {
    state()
        .lock()
        .map(|s| s.entries.clone())
        .unwrap_or_default()
}

/// Get all log entries as formatted strings (backward compatible with IPC command)
pub fn get_entries() -> Vec<String> {
    state()
        .lock()
        .map(|s| {
            s.entries
                .iter()
                .map(|e| {
                    format!(
                        "[{}] [{}] [{}] {}",
                        e.timestamp,
                        e.level.to_uppercase(),
                        e.phase,
                        e.message
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_entry_serialization() {
        let entry = LogEntry {
            timestamp: "2024-01-15T10:30:00+00:00".to_string(),
            level: "info".to_string(),
            phase: "dependency-download".to_string(),
            message: "Phase started: dependency-download".to_string(),
            details: None,
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"timestamp\""));
        assert!(json.contains("\"level\""));
        assert!(json.contains("\"phase\""));
        assert!(json.contains("\"message\""));
        // details should be omitted when None
        assert!(!json.contains("\"details\""));
    }

    #[test]
    fn test_log_entry_with_details() {
        let entry = LogEntry {
            timestamp: "2024-01-15T10:30:00+00:00".to_string(),
            level: "info".to_string(),
            phase: "dependency-download".to_string(),
            message: "Downloading: https://example.com/file.msi".to_string(),
            details: Some(serde_json::json!({ "url": "https://example.com/file.msi" })),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"details\""));
        assert!(json.contains("https://example.com/file.msi"));
    }

    #[test]
    fn test_now_iso8601_format() {
        let ts = now_iso8601();
        // ISO 8601 format should contain 'T' separator and timezone offset
        assert!(ts.contains('T'));
        assert!(ts.contains('+') || ts.contains('Z'));
    }
}
