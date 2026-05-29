use crate::error::{InstallError, InstallErrorKind, Phase};
use crate::INSTALLER_VERSION;
use anyhow::Context;
use std::path::{Path, PathBuf};

/// Source of the toolkit payload. Defaults to the GitHub release asset
/// matching the installer version; overridable via `LLM_TOOLKIT_PAYLOAD_URL`
/// for development / staging builds.
pub fn payload_url() -> String {
    if let Ok(custom) = std::env::var("LLM_TOOLKIT_PAYLOAD_URL") {
        return custom;
    }
    format!(
        "https://github.com/{owner}/{repo}/archive/refs/tags/v{ver}.tar.gz",
        owner = crate::ISSUE_REPO_OWNER,
        repo = crate::ISSUE_REPO_NAME,
        ver = INSTALLER_VERSION
    )
}

/// Download the toolkit source tarball and extract it under `install_root`.
/// On success the install root contains the workspace files (package.json,
/// `Terminal/`, `WebBrowser/`, ...).
pub async fn fetch_and_extract(install_root: &Path) -> Result<PathBuf, InstallError> {
    inner(install_root)
        .await
        .map_err(|e| InstallError::from_anyhow(Phase::PayloadDownload, InstallErrorKind::Network, e))
}

async fn inner(install_root: &Path) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(install_root).context("create install root")?;
    let cache_dir = install_root.join(".cache");
    std::fs::create_dir_all(&cache_dir).context("create cache dir")?;
    let archive_path = cache_dir.join("toolkit-payload.tar.gz");

    let client = reqwest::Client::builder()
        .user_agent(concat!("llm-toolkit-installer/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?;
    let mut resp = client
        .get(payload_url())
        .send()
        .await?
        .error_for_status()
        .context("payload download")?;
    let mut file = tokio::fs::File::create(&archive_path).await?;
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = resp.chunk().await? {
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);

    extract_tarball(&archive_path, install_root)?;
    let _ = std::fs::remove_file(&archive_path);
    Ok(install_root.to_path_buf())
}

fn extract_tarball(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    let file = std::fs::File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    // GitHub tarballs have a leading top-level dir like `llm-toolkit-by-shawna-<ver>/`.
    // Strip it.
    for entry in tar.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        let mut components = path.components();
        components.next(); // skip top-level dir
        let rest: PathBuf = components.collect();
        if rest.as_os_str().is_empty() {
            continue;
        }
        // Skip noisy paths.
        let rest_str = rest.to_string_lossy();
        if rest_str.contains("/node_modules/")
            || rest_str.starts_with("node_modules/")
            || rest_str.contains("/.git/")
            || rest_str.starts_with(".git/")
            || rest_str.contains("/dist/")
            || rest_str.contains("/release/")
            || rest_str.contains("/coverage/")
        {
            continue;
        }
        let out_path = dest.join(&rest);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            entry.unpack(&out_path)?;
        }
    }
    Ok(())
}
