/**
 * Pure atomic-publish decision logic for the LLM Toolkit installer release.
 *
 * Feature: windows-installer-setup-exe
 *
 * This module models — as a pure function — the decision made by the
 * "Verify atomic exe+checksum pair" guard step in
 * `.github/workflows/installer-release.yml` (task 14.3). The guard counts the
 * downloaded `*.exe` and `*.sha256` artifacts and aborts the release (publishing
 * neither) unless BOTH counts are non-zero.
 *
 * Keeping the decision here lets the Property 12 test (Atomic publish pairing)
 * drive the exact rule that the CI guard enforces, so the pure model and the
 * real workflow stay in lock-step.
 *
 * Design contract (Property 12 / Requirement 10.6):
 *   For all release-publish outcomes on an `installer-v*` tag, the setup.exe is
 *   present in the outcome IFF its checksum file is present — no outcome ever
 *   contains exactly one of the two. Concretely, publish PROCEEDS iff there is
 *   at least one `.exe` AND at least one `.sha256`; otherwise it aborts and
 *   publishes neither.
 */

/** The published outcome of a release attempt: exe and checksum, always paired. */
export interface PublishOutcome {
  /** True iff the setup.exe is included in the published release. */
  exe: boolean;
  /** True iff the .sha256 checksum is included in the published release. */
  sha256: boolean;
}

/**
 * Mirror of the CI guard's decision: publish proceeds iff at least one setup.exe
 * AND at least one checksum were found among the downloaded artifacts.
 *
 * @param exeCount   number of `*.exe` artifacts found (non-negative)
 * @param shaCount   number of `*.sha256` artifacts found (non-negative)
 * @returns true iff the release should be published (both present), false if it
 *          must abort (publishing neither).
 */
export function shouldPublish(exeCount: number, shaCount: number): boolean {
  return exeCount > 0 && shaCount > 0;
}

/**
 * Compute what the published release contains after applying the atomic guard.
 *
 * The guard is all-or-nothing: when it proceeds, both the exe and its checksum
 * are published; when it aborts, neither is. This function therefore always
 * returns a both-or-neither outcome — it can never return exactly one of the
 * two, which is the essence of Property 12.
 *
 * @param exeCount   number of `*.exe` artifacts found (non-negative)
 * @param shaCount   number of `*.sha256` artifacts found (non-negative)
 * @returns the paired publish outcome ({exe, sha256} both true, or both false).
 */
export function publishOutcome(exeCount: number, shaCount: number): PublishOutcome {
  const publish = shouldPublish(exeCount, shaCount);
  return { exe: publish, sha256: publish };
}
