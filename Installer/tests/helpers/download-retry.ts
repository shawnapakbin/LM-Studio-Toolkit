/**
 * TypeScript simulation of the Rust download retry logic from
 * Installer/src-tauri/src/downloader.rs
 *
 * This helper models the same retry behavior (MAX_ATTEMPTS = 3) so that
 * property tests can verify the retry orchestration invariants without
 * needing actual network calls.
 */

/** Maximum number of download attempts (initial + 2 retries) */
export const MAX_ATTEMPTS = 3;

/** Default per-file download timeout in seconds */
export const DEFAULT_TIMEOUT_SECS = 300;

/** Possible outcomes for a single download attempt */
export type DownloadAttemptResult =
  | { type: "success"; filePath: string }
  | { type: "checksum_mismatch"; expected: string; actual: string }
  | { type: "timeout" }
  | { type: "network_error"; message: string };

/** Result of the retry-orchestrated download */
export interface DownloadWithRetryResult {
  success: boolean;
  attempts: number;
  error?: { type: string; dependency: string; details: string };
}

/**
 * Simulates the download_with_retry function from downloader.rs.
 *
 * Iterates through pre-determined attempt results (up to MAX_ATTEMPTS).
 * Returns success on the first successful attempt, or an error after
 * all attempts are exhausted.
 *
 * @param dependencyName - Human-readable name for error messages
 * @param attemptResults - Pre-determined results for each attempt (array length may exceed MAX_ATTEMPTS; extras are ignored)
 */
export function downloadWithRetry(
  dependencyName: string,
  attemptResults: DownloadAttemptResult[],
): DownloadWithRetryResult {
  let lastError: { type: string; dependency: string; details: string } | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = attemptResults[attempt];

    // If we run out of pre-determined results, treat as network error
    if (!result) {
      lastError = {
        type: "network_error",
        dependency: dependencyName,
        details: "No attempt result provided",
      };
      continue;
    }

    if (result.type === "success") {
      return {
        success: true,
        attempts: attempt + 1,
      };
    }

    // Failed attempt — record error and continue to next retry
    switch (result.type) {
      case "checksum_mismatch":
        lastError = {
          type: "checksum_mismatch",
          dependency: dependencyName,
          details: `Checksum verification failed for '${dependencyName}': expected '${result.expected}', got '${result.actual}'`,
        };
        break;
      case "timeout":
        lastError = {
          type: "timeout",
          dependency: dependencyName,
          details: `Download timed out for '${dependencyName}' after ${DEFAULT_TIMEOUT_SECS} seconds`,
        };
        break;
      case "network_error":
        lastError = {
          type: "network_error",
          dependency: dependencyName,
          details: result.message,
        };
        break;
    }
  }

  // All retries exhausted
  return {
    success: false,
    attempts: MAX_ATTEMPTS,
    error: lastError,
  };
}
