use crate::error::{InstallError, InstallErrorKind, Phase};
use crate::PINNED_NODE_VERSION;
use anyhow::Context;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeSource {
    System,
    Downloaded,
}

#[derive(Debug, Clone)]
pub struct ResolvedNode {
    pub path: PathBuf,
    pub source: NodeSource,
    pub version: String,
}

/// Detect a usable `node` on PATH. Returns `None` if the version is below 20.
pub fn detect_system_node() -> Option<ResolvedNode> {
    let exe = which("node")?;
    let output = Command::new(&exe).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let numeric = version.trim_start_matches('v');
    let major: u32 = numeric.split('.').next()?.parse().ok()?;
    if major < 20 {
        return None;
    }
    Some(ResolvedNode {
        path: exe,
        source: NodeSource::System,
        version,
    })
}

fn which(cmd: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let exe_name = if cfg!(target_os = "windows") {
        format!("{cmd}.exe")
    } else {
        cmd.to_string()
    };
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(&exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Cache directory inside the install root where downloaded Node lives.
pub fn portable_node_dir(install_root: &Path) -> PathBuf {
    install_root.join(".runtime").join(format!("node-v{PINNED_NODE_VERSION}"))
}

/// Returns the path the portable node binary should have once extracted.
pub fn portable_node_bin(install_root: &Path) -> PathBuf {
    let dir = portable_node_dir(install_root);
    if cfg!(target_os = "windows") {
        dir.join(format!("node-v{PINNED_NODE_VERSION}-win-x64")).join("node.exe")
    } else if cfg!(target_os = "macos") {
        dir.join(format!("node-v{PINNED_NODE_VERSION}-darwin-x64"))
            .join("bin")
            .join("node")
    } else {
        dir.join(format!("node-v{PINNED_NODE_VERSION}-linux-x64"))
            .join("bin")
            .join("node")
    }
}

fn archive_name() -> String {
    if cfg!(target_os = "windows") {
        format!("node-v{PINNED_NODE_VERSION}-win-x64.zip")
    } else if cfg!(target_os = "macos") {
        format!("node-v{PINNED_NODE_VERSION}-darwin-x64.tar.gz")
    } else {
        format!("node-v{PINNED_NODE_VERSION}-linux-x64.tar.xz")
    }
}

fn download_url() -> String {
    format!(
        "https://nodejs.org/dist/v{ver}/{name}",
        ver = PINNED_NODE_VERSION,
        name = archive_name()
    )
}

fn shasums_url() -> String {
    format!("https://nodejs.org/dist/v{PINNED_NODE_VERSION}/SHASUMS256.txt")
}

/// Download + verify + extract pinned Node into the install root.
/// Idempotent: returns the existing binary if already present.
pub async fn ensure_portable_node(install_root: &Path) -> Result<ResolvedNode, InstallError> {
    let bin = portable_node_bin(install_root);
    if bin.is_file() {
        return Ok(ResolvedNode {
            path: bin,
            source: NodeSource::Downloaded,
            version: format!("v{PINNED_NODE_VERSION}"),
        });
    }
    download_and_extract(install_root)
        .await
        .map_err(|e| InstallError::from_anyhow(Phase::Runtime, InstallErrorKind::Network, e))?;
    let bin = portable_node_bin(install_root);
    if !bin.is_file() {
        return Err(InstallError::fatal(
            Phase::Runtime,
            InstallErrorKind::Filesystem,
            format!("Extraction succeeded but node binary missing at {}", bin.display()),
        ));
    }
    Ok(ResolvedNode {
        path: bin,
        source: NodeSource::Downloaded,
        version: format!("v{PINNED_NODE_VERSION}"),
    })
}

async fn download_and_extract(install_root: &Path) -> anyhow::Result<()> {
    let dir = portable_node_dir(install_root);
    std::fs::create_dir_all(&dir).context("create runtime dir")?;
    let archive_name = archive_name();
    let archive_path = dir.join(&archive_name);

    let client = reqwest::Client::builder()
        .user_agent(concat!("llm-toolkit-installer/", env!("CARGO_PKG_VERSION")))
        .build()?;

    // Fetch SHASUMS256 first so we can verify after download.
    let sums = client
        .get(shasums_url())
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let expected_sha = sums
        .lines()
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            let sha = parts.next()?;
            let file = parts.next()?;
            if file == archive_name {
                Some(sha.to_string())
            } else {
                None
            }
        })
        .context("archive not found in SHASUMS256.txt")?;

    // Stream-download archive.
    let mut resp = client.get(download_url()).send().await?.error_for_status()?;
    let mut file = tokio::fs::File::create(&archive_path).await?;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);

    // Verify checksum.
    let bytes = std::fs::read(&archive_path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(&expected_sha) {
        anyhow::bail!("Node archive checksum mismatch: expected {expected_sha}, got {actual}");
    }

    // Extract.
    extract_archive(&archive_path, &dir)?;
    let _ = std::fs::remove_file(&archive_path);
    Ok(())
}

#[cfg(target_os = "windows")]
fn extract_archive(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file)?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let out_path = dest.join(entry.mangled_name());
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out)?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn extract_archive(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    let file = std::fs::File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    tar.unpack(dest)?;
    Ok(())
}
