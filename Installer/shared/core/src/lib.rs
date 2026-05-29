//! Shared installer core for LLM Toolkit.
//!
//! Platform-agnostic install orchestration, Node.js runtime resolution,
//! payload download/extraction, LM Studio sync, license handling, and
//! diagnostic reporting. Re-exported from each platform's Tauri binary.

pub mod diagnostics;
pub mod error;
pub mod github_issue;
pub mod license;
pub mod lmstudio;
pub mod paths;
pub mod payload;
pub mod phases;
pub mod runtime;
pub mod tools;

pub use error::{InstallError, InstallErrorKind, Phase};
pub use phases::{InstallOptions, InstallProgress, ProgressEvent};

/// Repo coordinate used when building the prefilled GitHub issue URL.
pub const ISSUE_REPO_OWNER: &str = "shawnapakbin";
pub const ISSUE_REPO_NAME: &str = "llm-toolkit-by-shawna";

/// Installer release version. Updated per release; baked into diagnostic reports.
pub const INSTALLER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Pinned Node.js LTS version downloaded if the host lacks a usable runtime.
pub const PINNED_NODE_VERSION: &str = "20.17.0";
