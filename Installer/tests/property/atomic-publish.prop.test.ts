/**
 * Feature: windows-installer-setup-exe, Property 12: Atomic publish pairing
 *
 * For all release-publish outcomes on an `installer-v*` tag, the setup.exe is
 * present in the outcome IFF its checksum file is present — no outcome ever
 * contains exactly one of the two.
 *
 * The invariant lives in the "Verify atomic exe+checksum pair" guard step of
 * `.github/workflows/installer-release.yml`: it counts the downloaded `*.exe`
 * and `*.sha256` artifacts and aborts (publishing neither) unless BOTH counts
 * are non-zero. `scripts/atomic-publish.ts` models that decision as a pure
 * function so it can be property-tested directly, and the final test below ties
 * the pure model back to the real workflow guard on disk.
 *
 * Validates: Requirements 10.6
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import fc from "fast-check";

import { publishOutcome, shouldPublish } from "../../scripts/atomic-publish";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * A non-negative artifact count covering the meaningful cases: 0 (missing),
 * 1 (the expected single artifact), and "many" (duplicate/matrix uploads).
 * A modest max keeps the space small while still exercising >1.
 */
const countArb = fc.nat({ max: 8 });

/** Repo root, resolved from this test file's location (Installer/tests/property). */
const repoRoot = resolve(__dirname, "..", "..", "..");
const WORKFLOW_PATH = resolve(repoRoot, ".github", "workflows", "installer-release.yml");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Feature: windows-installer-setup-exe, Property 12: Atomic publish pairing", () => {
  /**
   * Validates: Requirements 10.6
   */

  it("the published outcome never contains exactly one of {exe, checksum} (exe published <=> checksum published)", () => {
    fc.assert(
      fc.property(countArb, countArb, (exeCount, shaCount) => {
        const outcome = publishOutcome(exeCount, shaCount);
        // Property 12: both-or-neither. exe present IFF checksum present.
        expect(outcome.exe).toBe(outcome.sha256);
      }),
      { numRuns: 200 },
    );
  });

  it("publish proceeds IFF both counts are > 0", () => {
    fc.assert(
      fc.property(countArb, countArb, (exeCount, shaCount) => {
        const bothPresent = exeCount > 0 && shaCount > 0;
        expect(shouldPublish(exeCount, shaCount)).toBe(bothPresent);
        // And the outcome reflects that decision as a matched pair.
        const outcome = publishOutcome(exeCount, shaCount);
        expect(outcome.exe).toBe(bothPresent);
        expect(outcome.sha256).toBe(bothPresent);
      }),
      { numRuns: 200 },
    );
  });

  it("an asymmetric artifact set (exactly one side present) always publishes neither", () => {
    // Build asymmetric pairs directly: one side is 0, the other is >= 1.
    const asymmetricArb = fc.oneof(
      // exe present, checksum missing.
      fc.tuple(fc.integer({ min: 1, max: 8 }), fc.constant(0)),
      // checksum present, exe missing.
      fc.tuple(fc.constant(0), fc.integer({ min: 1, max: 8 })),
    );
    fc.assert(
      fc.property(asymmetricArb, ([exeCount, shaCount]) => {
        const outcome = publishOutcome(exeCount, shaCount);
        expect(shouldPublish(exeCount, shaCount)).toBe(false);
        expect(outcome).toEqual({ exe: false, sha256: false });
      }),
      { numRuns: 200 },
    );
  });

  it("a fully-present pair (both sides >= 1) always publishes both", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        (exeCount, shaCount) => {
          const outcome = publishOutcome(exeCount, shaCount);
          expect(shouldPublish(exeCount, shaCount)).toBe(true);
          expect(outcome).toEqual({ exe: true, sha256: true });
        },
      ),
      { numRuns: 200 },
    );
  });

  it("the real workflow guard on disk enforces the same atomic pairing the model asserts", () => {
    // Tie the pure model to the actual CI guard so the two cannot drift apart.
    const workflow = readFileSync(WORKFLOW_PATH, "utf8");

    // Both uploads must fail the job when their file is missing, so a partial
    // pair can never reach the publish step.
    const ifNoFilesFoundErrorCount = (workflow.match(/if-no-files-found:\s*error/g) ?? []).length;
    expect(ifNoFilesFoundErrorCount).toBeGreaterThanOrEqual(2);

    // The publish job must carry the explicit atomic-pair guard step.
    expect(workflow).toMatch(/Verify atomic exe\+checksum pair/);

    // And that guard must abort when either count is zero — the exact decision
    // shouldPublish() models (proceed IFF exe > 0 AND sha256 > 0).
    expect(workflow).toMatch(
      /EXE_COUNT.*-eq 0.*\|\|.*SHA_COUNT.*-eq 0|\$\{EXE_COUNT\}.*-eq 0.*\|\|.*\$\{SHA_COUNT\}.*-eq 0/s,
    );
  });
});
