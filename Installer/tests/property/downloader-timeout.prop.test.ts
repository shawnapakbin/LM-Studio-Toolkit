/**
 * Property 15: Download Timeout Retry
 *
 * For any dependency download where the first N attempts (N ≤ 2) exceed the
 * 300-second timeout, the Dependency_Downloader must retry up to 2 additional
 * times. If all 3 attempts timeout, it must abort with an error indicating a
 * timeout for the affected dependency.
 *
 * Validates: Requirements 6.8
 */
import fc from "fast-check";
import { type DownloadAttemptResult, downloadWithRetry } from "../helpers/download-retry";

describe("Feature: v2-4-0-unified-config-installer, Property 15: Download Timeout Retry", () => {
  /**
   * Property 15a: If all 3 attempts timeout, error indicates timeout for the dependency.
   */
  it("15a: all 3 timeout attempts produce a timeout error identifying the dependency", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (dependencyName) => {
        const attempts: DownloadAttemptResult[] = [
          { type: "timeout" },
          { type: "timeout" },
          { type: "timeout" },
        ];

        const result = downloadWithRetry(dependencyName, attempts);

        expect(result.success).toBe(false);
        expect(result.attempts).toBe(3);
        expect(result.error).toBeDefined();
        expect(result.error!.type).toBe("timeout");
        expect(result.error!.dependency).toBe(dependencyName);
        expect(result.error!.details).toContain(dependencyName);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15b: If attempt 1 times out but attempt 2 succeeds, result is
   * success with 2 attempts.
   */
  it("15b: timeout on attempt 1 followed by success on attempt 2 yields success with 2 attempts", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (dependencyName, filePath) => {
          const attempts: DownloadAttemptResult[] = [
            { type: "timeout" },
            { type: "success", filePath },
          ];

          const result = downloadWithRetry(dependencyName, attempts);

          expect(result.success).toBe(true);
          expect(result.attempts).toBe(2);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15c: For any mix of timeout and checksum failures across 3
   * attempts (all failing), the error identifies the dependency name.
   */
  it("15c: mixed timeout/checksum failures across 3 attempts always identify the dependency", () => {
    const failureArb: fc.Arbitrary<DownloadAttemptResult> = fc.oneof(
      fc.constant({ type: "timeout" } as DownloadAttemptResult),
      fc.record({
        type: fc.constant("checksum_mismatch" as const),
        expected: fc.hexaString({ minLength: 64, maxLength: 64 }),
        actual: fc.hexaString({ minLength: 64, maxLength: 64 }),
      }),
    );

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.tuple(failureArb, failureArb, failureArb),
        (dependencyName, [a1, a2, a3]) => {
          const attempts: DownloadAttemptResult[] = [a1, a2, a3];

          const result = downloadWithRetry(dependencyName, attempts);

          expect(result.success).toBe(false);
          expect(result.attempts).toBe(3);
          expect(result.error).toBeDefined();
          expect(result.error!.dependency).toBe(dependencyName);
          expect(result.error!.details).toContain(dependencyName);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15d: The total number of attempts never exceeds 3 (MAX_ATTEMPTS).
   */
  it("15d: total attempts never exceed MAX_ATTEMPTS (3)", () => {
    const attemptArb: fc.Arbitrary<DownloadAttemptResult> = fc.oneof(
      fc.record({
        type: fc.constant("success" as const),
        filePath: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      fc.constant({ type: "timeout" } as DownloadAttemptResult),
      fc.record({
        type: fc.constant("checksum_mismatch" as const),
        expected: fc.hexaString({ minLength: 64, maxLength: 64 }),
        actual: fc.hexaString({ minLength: 64, maxLength: 64 }),
      }),
      fc.record({
        type: fc.constant("network_error" as const),
        message: fc.string({ minLength: 1, maxLength: 80 }),
      }),
    );

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.array(attemptArb, { minLength: 1, maxLength: 5 }),
        (dependencyName, attempts) => {
          const result = downloadWithRetry(dependencyName, attempts);

          expect(result.attempts).toBeGreaterThanOrEqual(1);
          expect(result.attempts).toBeLessThanOrEqual(3);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15e: If any attempt succeeds (regardless of prior timeouts),
   * overall result is success.
   */
  it("15e: success on any attempt (after prior timeouts) yields overall success", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 0, max: 2 }),
        (dependencyName, filePath, successIndex) => {
          // Build attempts: timeouts before the success index, then success
          const attempts: DownloadAttemptResult[] = [];
          for (let i = 0; i < successIndex; i++) {
            attempts.push({ type: "timeout" });
          }
          attempts.push({ type: "success", filePath });

          const result = downloadWithRetry(dependencyName, attempts);

          expect(result.success).toBe(true);
          expect(result.attempts).toBe(successIndex + 1);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
