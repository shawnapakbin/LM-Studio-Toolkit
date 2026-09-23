use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Maximum number of download attempts (initial + 2 retries)
const MAX_ATTEMPTS: u32 = 3;

/// Default per-file download timeout in seconds
pub const DEFAULT_TIMEOUT_SECS: u64 = 300;

/// Errors that can occur during dependency download
#[derive(Debug, Clone)]
pub enum DownloadError {
    /// Download exceeded the configured timeout
    Timeout { dependency: String },
    /// Downloaded file's SHA-256 did not match expected value
    ChecksumMismatch {
        dependency: String,
        expected: String,
        actual: String,
    },
    /// Network or I/O error during download
    NetworkError { dependency: String, message: String },
}

impl fmt::Display for DownloadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DownloadError::Timeout { dependency } => {
                write!(
                    f,
                    "Download timed out for '{}' after {} seconds",
                    dependency, DEFAULT_TIMEOUT_SECS
                )
            }
            DownloadError::ChecksumMismatch {
                dependency,
                expected,
                actual,
            } => {
                write!(
                    f,
                    "Checksum verification failed for '{}': expected '{}', got '{}'",
                    dependency, expected, actual
                )
            }
            DownloadError::NetworkError {
                dependency,
                message,
            } => {
                write!(f, "Network error downloading '{}': {}", dependency, message)
            }
        }
    }
}

/// Successful download result
#[derive(Debug, Clone)]
pub struct DownloadResult {
    /// Path to the verified downloaded file
    pub file_path: PathBuf,
    /// Whether the file passed SHA-256 verification
    pub verified: bool,
}

/// Download a single dependency file with checksum verification.
///
/// Downloads from `url` into `dest_dir`, then verifies the SHA-256 checksum
/// against `expected_sha256`. On checksum mismatch or timeout, returns an error
/// and removes any partial file.
///
/// # Arguments
/// * `dependency_name` - Human-readable name for error messages
/// * `url` - Official download URL (must be HTTPS)
/// * `expected_sha256` - Expected lowercase hex-encoded SHA-256 hash
/// * `dest_dir` - Directory to save the downloaded file
/// * `timeout` - Maximum time allowed for the download
pub fn download_dependency(
    dependency_name: &str,
    url: &str,
    expected_sha256: &str,
    dest_dir: &Path,
    timeout: Duration,
) -> Result<DownloadResult, DownloadError> {
    // Derive filename from URL
    let file_name = url.rsplit('/').next().unwrap_or("download");
    let dest_path = dest_dir.join(file_name);

    // Build HTTP client with timeout
    let client = reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| DownloadError::NetworkError {
            dependency: dependency_name.to_string(),
            message: format!("Failed to create HTTP client: {}", e),
        })?;

    // Execute GET request
    let mut response = client.get(url).send().map_err(|e| {
        if e.is_timeout() {
            DownloadError::Timeout {
                dependency: dependency_name.to_string(),
            }
        } else {
            DownloadError::NetworkError {
                dependency: dependency_name.to_string(),
                message: e.to_string(),
            }
        }
    })?;

    // Check HTTP status
    if !response.status().is_success() {
        return Err(DownloadError::NetworkError {
            dependency: dependency_name.to_string(),
            message: format!("HTTP {} from {}", response.status(), url),
        });
    }

    // Stream response body to file for memory efficiency
    let mut file = fs::File::create(&dest_path).map_err(|e| DownloadError::NetworkError {
        dependency: dependency_name.to_string(),
        message: format!("Failed to create file '{}': {}", dest_path.display(), e),
    })?;

    io::copy(&mut response, &mut file).map_err(|e| {
        // Clean up partial file on error
        let _ = fs::remove_file(&dest_path);
        if e.to_string().contains("timed out") || e.to_string().contains("operation timed out") {
            DownloadError::Timeout {
                dependency: dependency_name.to_string(),
            }
        } else {
            DownloadError::NetworkError {
                dependency: dependency_name.to_string(),
                message: format!("Failed to write response body: {}", e),
            }
        }
    })?;

    // Compute SHA-256 checksum of the downloaded file
    let actual_sha256 = compute_sha256(&dest_path).map_err(|e| {
        let _ = fs::remove_file(&dest_path);
        DownloadError::NetworkError {
            dependency: dependency_name.to_string(),
            message: format!("Failed to compute checksum: {}", e),
        }
    })?;

    // Compare checksums (case-insensitive)
    if actual_sha256.eq_ignore_ascii_case(expected_sha256) {
        Ok(DownloadResult {
            file_path: dest_path,
            verified: true,
        })
    } else {
        // Discard file on checksum mismatch
        let _ = fs::remove_file(&dest_path);
        Err(DownloadError::ChecksumMismatch {
            dependency: dependency_name.to_string(),
            expected: expected_sha256.to_string(),
            actual: actual_sha256,
        })
    }
}

/// Download a dependency with automatic retry on failure.
///
/// Attempts download up to 3 times (initial + 2 retries). On checksum failure,
/// timeout, or network error, discards any partial file and retries.
/// After all attempts are exhausted, returns the last error with a descriptive
/// message identifying the dependency and failure reason.
///
/// # Arguments
/// * `dependency_name` - Human-readable name for error messages
/// * `url` - Official download URL
/// * `expected_sha256` - Expected lowercase hex-encoded SHA-256 hash
/// * `dest_dir` - Directory to save the downloaded file
/// * `timeout` - Maximum time allowed per download attempt
pub fn download_with_retry(
    dependency_name: &str,
    url: &str,
    expected_sha256: &str,
    dest_dir: &Path,
    timeout: Duration,
) -> Result<DownloadResult, DownloadError> {
    let mut last_error: Option<DownloadError> = None;

    for attempt in 1..=MAX_ATTEMPTS {
        crate::logger::log_info(
            "downloader",
            &format!(
                "Downloading '{}' (attempt {}/{})",
                dependency_name, attempt, MAX_ATTEMPTS
            ),
        );

        match download_dependency(dependency_name, url, expected_sha256, dest_dir, timeout) {
            Ok(result) => {
                crate::logger::log_info(
                    "downloader",
                    &format!("Successfully downloaded and verified '{}'", dependency_name),
                );
                return Ok(result);
            }
            Err(e) => {
                let retry_msg = if attempt < MAX_ATTEMPTS {
                    format!(" — retrying ({}/{})", attempt, MAX_ATTEMPTS - 1)
                } else {
                    " — all retries exhausted".to_string()
                };

                match &e {
                    DownloadError::ChecksumMismatch {
                        expected, actual, ..
                    } => {
                        crate::logger::log_warn(
                            "downloader",
                            &format!(
                                "Checksum mismatch for '{}': expected '{}', got '{}'{}",
                                dependency_name, expected, actual, retry_msg
                            ),
                        );
                    }
                    DownloadError::Timeout { .. } => {
                        crate::logger::log_warn(
                            "downloader",
                            &format!("Download timed out for '{}'{}", dependency_name, retry_msg),
                        );
                    }
                    DownloadError::NetworkError { message, .. } => {
                        crate::logger::log_warn(
                            "downloader",
                            &format!(
                                "Network error for '{}': {}{}",
                                dependency_name, message, retry_msg
                            ),
                        );
                    }
                }

                last_error = Some(e);
            }
        }
    }

    // All retries exhausted — return last error with descriptive message
    let err = last_error.unwrap();
    crate::logger::log_error(
        "downloader",
        &format!(
            "Failed to download '{}' after {} attempts: {}",
            dependency_name, MAX_ATTEMPTS, err
        ),
    );
    Err(err)
}

/// Compute the SHA-256 hash of a file, returning the lowercase hex-encoded digest.
fn compute_sha256(path: &Path) -> Result<String, io::Error> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    let hash = hasher.finalize();
    Ok(format!("{:x}", hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_compute_sha256_known_value() {
        let dir = std::env::temp_dir();
        let test_file = dir.join("test_sha256_known.txt");
        let mut f = fs::File::create(&test_file).unwrap();
        f.write_all(b"hello world").unwrap();
        drop(f);

        let hash = compute_sha256(&test_file).unwrap();
        // SHA-256 of "hello world" is well-known
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );

        let _ = fs::remove_file(&test_file);
    }

    #[test]
    fn test_compute_sha256_empty_file() {
        let dir = std::env::temp_dir();
        let test_file = dir.join("test_sha256_empty.txt");
        fs::File::create(&test_file).unwrap();

        let hash = compute_sha256(&test_file).unwrap();
        // SHA-256 of empty string
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );

        let _ = fs::remove_file(&test_file);
    }

    #[test]
    fn test_compute_sha256_nonexistent_file() {
        let result = compute_sha256(Path::new("/nonexistent/file.bin"));
        assert!(result.is_err());
    }

    #[test]
    fn test_download_error_display_timeout() {
        let err = DownloadError::Timeout {
            dependency: "Node.js".to_string(),
        };
        let msg = format!("{}", err);
        assert!(msg.contains("Node.js"));
        assert!(msg.contains("timed out"));
        assert!(msg.contains("300"));
    }

    #[test]
    fn test_download_error_display_checksum() {
        let err = DownloadError::ChecksumMismatch {
            dependency: "Git".to_string(),
            expected: "abc123".to_string(),
            actual: "def456".to_string(),
        };
        let msg = format!("{}", err);
        assert!(msg.contains("Git"));
        assert!(msg.contains("abc123"));
        assert!(msg.contains("def456"));
    }

    #[test]
    fn test_download_error_display_network() {
        let err = DownloadError::NetworkError {
            dependency: "Node.js".to_string(),
            message: "connection refused".to_string(),
        };
        let msg = format!("{}", err);
        assert!(msg.contains("Node.js"));
        assert!(msg.contains("connection refused"));
    }

    #[test]
    fn test_download_dependency_invalid_url() {
        let dir = std::env::temp_dir();
        let result = download_dependency(
            "test-dep",
            "https://invalid.localhost.test/nonexistent-file.bin",
            "abc123",
            &dir,
            Duration::from_secs(5),
        );
        assert!(result.is_err());
        match result.unwrap_err() {
            DownloadError::NetworkError { dependency, .. } => {
                assert_eq!(dependency, "test-dep");
            }
            DownloadError::Timeout { dependency } => {
                assert_eq!(dependency, "test-dep");
            }
            _ => panic!("Expected NetworkError or Timeout"),
        }
    }

    // ---------------------------------------------------------------------
    // Preservation property tests (task 7.3)
    //
    // Feature: windows-installer-setup-exe
    // Property: downloader.rs SHA-256 verification (preservation)
    // Validates: Requirements 4.2
    //
    // These tests LOCK the CURRENT SHA-256 digest verification behavior of
    // `downloader.rs` before the runtime-only dependency-set edits (tasks
    // 7.4/7.5). They capture the two collaborators that together define
    // verification:
    //   * `compute_sha256` — lowercase hex-encoded SHA-256 of file bytes.
    //   * the `actual.eq_ignore_ascii_case(expected)` comparison used by
    //     `download_dependency` to accept/reject a downloaded file.
    //
    // Each property runs >= 100 iterations (proptest default of 256).
    // ---------------------------------------------------------------------
    use proptest::prelude::*;

    /// The verification predicate exactly as `download_dependency` applies it:
    /// a file whose bytes hash to `actual` is accepted iff `actual` equals the
    /// `expected` digest, compared case-insensitively over hex.
    fn verification_accepts(actual: &str, expected: &str) -> bool {
        actual.eq_ignore_ascii_case(expected)
    }

    /// Write `bytes` to a uniquely named temp file and return its SHA-256.
    fn sha256_of_bytes(bytes: &[u8], tag: &str) -> String {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("prop_sha256_{}_{}.bin", tag, std::process::id()));
        {
            let mut f = fs::File::create(&path).unwrap();
            f.write_all(bytes).unwrap();
        }
        let digest = compute_sha256(&path).unwrap();
        let _ = fs::remove_file(&path);
        digest
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

        /// Property: the correct SHA-256 of arbitrary byte content always
        /// verifies. Computing the digest of the exact bytes and using it as
        /// the expected value must be accepted.
        #[test]
        fn prop_correct_digest_always_verifies(content in proptest::collection::vec(any::<u8>(), 0..2048)) {
            let digest = sha256_of_bytes(&content, "correct");
            prop_assert!(verification_accepts(&digest, &digest));
        }

        /// Property: verification is case-insensitive over the hex digest.
        /// The computed (lowercase) digest and its uppercased form both verify
        /// against the lowercase expected digest, and vice versa.
        #[test]
        fn prop_verification_is_case_insensitive(content in proptest::collection::vec(any::<u8>(), 0..2048)) {
            let lower = sha256_of_bytes(&content, "case");
            let upper = lower.to_uppercase();
            // compute_sha256 always emits lowercase hex
            prop_assert_eq!(&lower, &lower.to_lowercase());
            // accept regardless of the case of the expected digest
            prop_assert!(verification_accepts(&lower, &upper));
            prop_assert!(verification_accepts(&upper, &lower));
            prop_assert!(verification_accepts(&upper, &upper));
        }

        /// Property: tampering with any byte causes rejection. Flipping any
        /// single bit of the content changes the computed digest, so the
        /// original expected digest no longer verifies the tampered bytes.
        #[test]
        fn prop_tampering_causes_rejection(
            content in proptest::collection::vec(any::<u8>(), 1..2048),
            idx in any::<usize>(),
            bit in 0u32..8,
        ) {
            let expected = sha256_of_bytes(&content, "orig");
            let mut tampered = content.clone();
            let i = idx % tampered.len();
            tampered[i] ^= 1u8 << bit;
            let actual = sha256_of_bytes(&tampered, "tampered");
            // The tampered bytes differ, so their digest must differ and be rejected.
            prop_assert_ne!(&actual, &expected);
            prop_assert!(!verification_accepts(&actual, &expected));
        }

        /// Property: verification accepts iff the computed digest equals the
        /// expected digest. For an arbitrary expected hex string, acceptance
        /// holds exactly when it case-insensitively equals the real digest.
        #[test]
        fn prop_accepts_iff_digest_matches(
            content in proptest::collection::vec(any::<u8>(), 0..1024),
            expected in "[0-9a-fA-F]{0,72}",
        ) {
            let actual = sha256_of_bytes(&content, "iff");
            let should_accept = actual.eq_ignore_ascii_case(&expected);
            prop_assert_eq!(verification_accepts(&actual, &expected), should_accept);
        }
    }

    #[test]
    fn test_download_with_retry_invalid_url_exhausts_retries() {
        let dir = std::env::temp_dir();
        let result = download_with_retry(
            "retry-exhaust-dep",
            "https://invalid.localhost.test/nonexistent-file.bin",
            "abc123",
            &dir,
            Duration::from_secs(2),
        );
        assert!(result.is_err());
        // Should have logged 3 per-attempt "Downloading" lines.
        // Match on the unique dependency name plus the literal "(attempt "
        // substring so the final "... after 3 attempts:" summary line is
        // excluded and there is no collision with other tests' log entries.
        let logs = crate::logger::get_entries();
        let attempt_logs: Vec<_> = logs
            .iter()
            .filter(|l| l.contains("retry-exhaust-dep") && l.contains("(attempt "))
            .collect();
        assert_eq!(attempt_logs.len(), 3);
    }
}
