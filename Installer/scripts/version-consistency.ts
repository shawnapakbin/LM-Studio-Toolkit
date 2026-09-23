/**
 * Pure version-consistency logic for the LLM Toolkit installer.
 *
 * Feature: windows-installer-setup-exe
 *
 * This module contains ONLY pure functions over version strings so that the
 * Property 13 test (Version consistency and scheme) can drive it directly and
 * the CI wrapper (`check-version-consistency.ts`) can reuse the exact same
 * decision logic that runs in tests.
 *
 * Design contract (Property 13 / Requirements 11.1, 11.2, 11.5):
 *   The check passes iff
 *     (a) the versions of all three manifests are equal, AND
 *     (b) each version follows the `major.minor.patch` scheme with the
 *         `major` (first) segment equal to `5` — the installer version tracks
 *         the app's version line (currently 5.x) since the installer ships as
 *         part of the app.
 *   On failure it names exactly the manifests whose version differs.
 */

/** The stable identifiers for the three installer manifests. */
export type ManifestId = "package.json" | "tauri.conf.json" | "Cargo.toml";

export const MANIFEST_IDS: readonly ManifestId[] = [
  "package.json",
  "tauri.conf.json",
  "Cargo.toml",
] as const;

/**
 * The required `major` segment for the installer version.
 *
 * The installer ships as part of the app and tracks the app's version line, so
 * this equals the app's current major version (5.x).
 */
export const REQUIRED_RELEASE_SEGMENT = 5;

/** A single manifest's version input to the consistency check. */
export type ManifestVersions = Record<ManifestId, string>;

/** Result of the version-consistency check. */
export interface VersionConsistencyResult {
  /** True iff all three versions are equal AND each follows the `5.minor.patch` scheme. */
  ok: boolean;
  /**
   * Exactly the manifests whose version differs from the agreed installer
   * version, plus any manifest whose version violates the `major.minor.patch`
   * scheme. Sorted in canonical `MANIFEST_IDS` order. Empty iff `ok`.
   */
  mismatchedManifests: ManifestId[];
  /** Human-readable explanation, suitable for CI error output. */
  reason: string;
}

/** Extract the `version` field from a JSON manifest (package.json / tauri.conf.json). */
export function extractJsonVersion(source: string): string {
  const parsed = JSON.parse(source) as { version?: unknown };
  if (typeof parsed.version !== "string") {
    throw new Error("manifest has no string `version` field");
  }
  return parsed.version;
}

/** Extract the `[package] version = "..."` field from a Cargo.toml manifest. */
export function extractCargoVersion(source: string): string {
  // Match the `version = "x.y.z"` line within the [package] section only.
  const packageSection = /\[package\][\s\S]*?(?=\n\[|$)/.exec(source);
  const scope = packageSection ? packageSection[0] : source;
  const match = /^\s*version\s*=\s*"([^"]+)"/m.exec(scope);
  if (match === null) {
    throw new Error("Cargo.toml [package] has no `version` field");
  }
  return match[1];
}

/**
 * Validate that a version string follows the `major.minor.patch` scheme on the
 * app's `5.x` line: exactly three dot-separated non-negative integer segments
 * with the `major` segment equal to `5`.
 *
 * No `v` prefix, no pre-release/build metadata, and no extra segments are
 * accepted — the installer version is a strict `5.minor.patch` triple.
 */
export function isValidScheme(version: string): boolean {
  if (typeof version !== "string") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (match === null) return false;
  const release = Number(match[1]);
  return release === REQUIRED_RELEASE_SEGMENT;
}

/**
 * Determine which manifests "differ" on the equality dimension.
 *
 * A manifest differs iff its version is not the version shared by a strict
 * majority (2 of 3) of the manifests:
 *   - all three equal        -> none differ
 *   - exactly one different  -> that one differs
 *   - all three distinct     -> all three differ (no majority to agree on)
 */
function equalityMismatches(versions: ManifestVersions): ManifestId[] {
  const counts = new Map<string, number>();
  for (const id of MANIFEST_IDS) {
    counts.set(versions[id], (counts.get(versions[id]) ?? 0) + 1);
  }

  // The agreed version is the one held by a strict majority (>= 2 of 3).
  let majority: string | undefined;
  for (const [value, count] of counts) {
    if (count >= 2) {
      majority = value;
      break;
    }
  }

  if (majority === undefined) {
    // No two agree -> every manifest differs.
    return [...MANIFEST_IDS];
  }
  return MANIFEST_IDS.filter((id) => versions[id] !== majority);
}

/**
 * Compare the version strings from the three installer manifests and validate
 * the `5.minor.patch` scheme.
 *
 * @param versions the version string extracted from each manifest
 * @returns whether the versions are consistent, and if not, exactly which
 *          manifests differ (by equality) or violate the scheme.
 */
export function checkVersionConsistency(versions: ManifestVersions): VersionConsistencyResult {
  const schemeViolations = MANIFEST_IDS.filter((id) => !isValidScheme(versions[id]));
  const equalityDiffs = equalityMismatches(versions);

  // Union of equality-differing and scheme-violating manifests, in canonical order.
  const mismatchedSet = new Set<ManifestId>([...equalityDiffs, ...schemeViolations]);
  const mismatchedManifests = MANIFEST_IDS.filter((id) => mismatchedSet.has(id));

  const ok = mismatchedManifests.length === 0;

  let reason: string;
  if (ok) {
    reason = `All installer manifests agree on version ${versions["package.json"]} (scheme 5.minor.patch).`;
  } else {
    const parts: string[] = [];
    if (equalityDiffs.length > 0) {
      const detail = MANIFEST_IDS.map((id) => `${id}=${versions[id]}`).join(", ");
      parts.push(`installer version differs across manifests (${detail})`);
    }
    if (schemeViolations.length > 0) {
      const detail = schemeViolations.map((id) => `${id}=${versions[id]}`).join(", ");
      parts.push(`version does not follow the 5.minor.patch scheme (major must be 5): ${detail}`);
    }
    reason = `Version consistency check failed: ${parts.join("; ")}. Differing manifests: ${mismatchedManifests.join(", ")}.`;
  }

  return { ok, mismatchedManifests, reason };
}
