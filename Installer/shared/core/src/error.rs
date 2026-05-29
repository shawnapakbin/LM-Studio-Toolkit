use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Welcome,
    License,
    Location,
    Options,
    Runtime,
    PayloadDownload,
    PayloadExtract,
    EnvWrite,
    NpmInstall,
    Build,
    Verify,
    LmStudioSync,
    Done,
}

impl Phase {
    pub fn label(self) -> &'static str {
        match self {
            Phase::Welcome => "Welcome",
            Phase::License => "License",
            Phase::Location => "Install location",
            Phase::Options => "Options",
            Phase::Runtime => "Resolve runtime",
            Phase::PayloadDownload => "Download payload",
            Phase::PayloadExtract => "Extract payload",
            Phase::EnvWrite => "Write environment",
            Phase::NpmInstall => "Install dependencies",
            Phase::Build => "Build toolkit",
            Phase::Verify => "Verify tools",
            Phase::LmStudioSync => "Sync LM Studio",
            Phase::Done => "Done",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InstallErrorKind {
    Network,
    Filesystem,
    Permission,
    Process,
    Verification,
    Cancelled,
    InvalidInput,
    Internal,
}

#[derive(Debug, Clone, Error, Serialize, Deserialize)]
#[error("{kind:?} during {phase:?}: {message}")]
pub struct InstallError {
    pub phase: Phase,
    pub kind: InstallErrorKind,
    pub message: String,
    pub recoverable: bool,
    #[serde(default)]
    pub cause_chain: Vec<String>,
}

impl InstallError {
    pub fn new(phase: Phase, kind: InstallErrorKind, message: impl Into<String>) -> Self {
        Self {
            phase,
            kind,
            message: message.into(),
            recoverable: true,
            cause_chain: Vec::new(),
        }
    }

    pub fn fatal(phase: Phase, kind: InstallErrorKind, message: impl Into<String>) -> Self {
        Self {
            phase,
            kind,
            message: message.into(),
            recoverable: false,
            cause_chain: Vec::new(),
        }
    }

    pub fn from_anyhow(phase: Phase, kind: InstallErrorKind, err: anyhow::Error) -> Self {
        let mut chain = Vec::new();
        for cause in err.chain().skip(1) {
            chain.push(cause.to_string());
        }
        Self {
            phase,
            kind,
            message: err.to_string(),
            recoverable: true,
            cause_chain: chain,
        }
    }
}

impl From<std::io::Error> for InstallError {
    fn from(err: std::io::Error) -> Self {
        InstallError {
            phase: Phase::Runtime,
            kind: InstallErrorKind::Filesystem,
            message: err.to_string(),
            recoverable: true,
            cause_chain: Vec::new(),
        }
    }
}
