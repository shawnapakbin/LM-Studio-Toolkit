/**
 * Property 14: Download Checksum Retry
 *
 * For any dependency download where the first N attempts (N ≤ 2) fail SHA-256
 * checksum verification, the Dependency_Downloader must discard each failed file
 * and retry. If all 3 attempts fail, it must abort with an error identifying the
 * failed dependency and expected checksum.
 *
 * Validates: Requirements 6.6, 6.7
 */
import fc from "fast-check";
import {
  type DownloadAttemptResult,
  MAX_ATTEMPTS,
  downloadWithRetry,
} from "../helpers/download-retry";

describe("Feature: v2-4-0-unified-config-installer, Property 14: Download Checksum Retry", () => {
  /**
   * Validates: Requirements 6.6, 6.7
   */

  // ─── Generators ──────────────────────────────────────────────────────────────

  /** Generate a valid dependency name (non-empty alphanumeric with dots/hyphens) */
  const arbDependencyName = fc
    .stringOf(fc.oneof(fc.char(), fc.constant("-"), fc.constant(".")), {
      minLength: 1,
      maxLength: 30,
    })
    .filter((s) => s.trim().length > 0);

  /** Generate a hex SHA-256 hash string (64 lowercase hex chars) */
  const arbSha256 = fc.hexaString({ minLength: 64, maxLength: 64 }).map((s) => s.toLowerCase());

  /** Generate a file path for successful downloads */
  const arbFilePath = fc
    .stringOf(fc.oneof(fc.char(), fc.constant("/"), fc.constant(".")), {
      minLength: 5,
      maxLength: 50,
    })
    .filter((s) => s.trim().length > 0);

  /** Generate a successful attempt result */
  const arbSuccessAttempt = arbFilePath.map(
    (path): DownloadAttemptResult => ({ type: "success", filePath: path }),
  );

  /** Generate a checksum mismatch attempt result */
  const arbChecksumMismatch = fc.tuple(arbSha256, arbSha256).map(
    ([expected, actual]): DownloadAttemptResult => ({
      type: "checksum_mismatch",
      expected,
      actual,
    }),
  );

  /** Generate any failure attempt (checksum mismatch, timeout, or network error) */
  const arbFailureAttempt: fc.Arbitrary<DownloadAttemptResult> = fc.oneof(
    arbChecksumMismatch,
    fc.constant<DownloadAttemptResult>({ type: "timeout" }),
    fc
      .string({ minLength: 1, maxLength: 50 })
      .map((msg): DownloadAttemptResult => ({ type: "network_error", message: msg })),
  );

  // ─── Property 14a ────────────────────────────────────────────────────────────

  it("14a: if the first attempt succeeds, only 1 attempt is made", () => {
    fc.assert(
      fc.property(
        arbDependencyName,
        arbSuccessAttempt,
        fc.array(arbFailureAttempt, { minLength: 0, maxLength: 2 }),
        (depName, successAttempt, trailingAttempts) => {
          const attempts: DownloadAttemptResult[] = [successAttempt, ...trailingAttempts];
          const result = downloadWithRetry(depName, attempts);

          expect(result.success).toBe(true);
          expect(result.attempts).toBe(1);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 14b ────────────────────────────────────────────────────────────

  it("14b: if attempt 1 fails with checksum mismatch but attempt 2 succeeds, result is success with 2 attempts", () => {
    fc.assert(
      fc.property(
        arbDependencyName,
        arbChecksumMismatch,
        arbSuccessAttempt,
        (depName, failAttempt, successAttempt) => {
          const attempts: DownloadAttemptResult[] = [failAttempt, successAttempt];
          const result = downloadWithRetry(depName, attempts);

          expect(result.success).toBe(true);
          expect(result.attempts).toBe(2);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 14c ────────────────────────────────────────────────────────────

  it("14c: if all 3 attempts fail with checksum mismatch, error identifies the dependency and expected checksum", () => {
    fc.assert(
      fc.property(
        arbDependencyName,
        fc.array(arbChecksumMismatch, { minLength: 3, maxLength: 3 }),
        (depName, failAttempts) => {
          const result = downloadWithRetry(depName, failAttempts);

          expect(result.success).toBe(false);
          expect(result.attempts).toBe(MAX_ATTEMPTS);
          expect(result.error).toBeDefined();
          expect(result.error!.dependency).toBe(depName);
          expect(result.error!.type).toBe("checksum_mismatch");
          // The error details should contain the expected checksum from the last attempt
          const lastAttempt = failAttempts[2] as {
            type: "checksum_mismatch";
            expected: string;
            actual: string;
          };
          expect(result.error!.details).toContain(lastAttempt.expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 14d ────────────────────────────────────────────────────────────

  it("14d: for any N (1-3) checksum failures followed by success, total attempts = N + 1 (capped at 3)", () => {
    fc.assert(
      fc.property(
        arbDependencyName,
        fc.integer({ min: 1, max: 2 }), // N failures before success (must leave room for success within 3 attempts)
        arbSha256,
        arbSha256,
        arbFilePath,
        (depName, numFailures, expectedHash, actualHash, filePath) => {
          // Build N checksum mismatch failures followed by a success
          const attempts: DownloadAttemptResult[] = [];
          for (let i = 0; i < numFailures; i++) {
            attempts.push({
              type: "checksum_mismatch",
              expected: expectedHash,
              actual: actualHash,
            });
          }
          attempts.push({ type: "success", filePath });

          const result = downloadWithRetry(depName, attempts);

          expect(result.success).toBe(true);
          expect(result.attempts).toBe(numFailures + 1);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("14d (exhausted): when all 3 attempts fail, total attempts equals MAX_ATTEMPTS", () => {
    fc.assert(
      fc.property(
        arbDependencyName,
        fc.array(arbFailureAttempt, { minLength: 3, maxLength: 3 }),
        (depName, failAttempts) => {
          const result = downloadWithRetry(depName, failAttempts);

          expect(result.success).toBe(false);
          expect(result.attempts).toBe(MAX_ATTEMPTS);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 14e ────────────────────────────────────────────────────────────

  it("14e: the error always contains the dependency name when all retries are exhausted", () => {
    fc.assert(
      fc.property(
        arbDependencyName,
        fc.array(arbFailureAttempt, { minLength: 3, maxLength: 3 }),
        (depName, failAttempts) => {
          const result = downloadWithRetry(depName, failAttempts);

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.dependency).toBe(depName);
        },
      ),
      { numRuns: 100 },
    );
  });
});
