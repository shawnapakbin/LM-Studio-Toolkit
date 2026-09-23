/**
 * TypeScript implementation of version parsing and comparison logic,
 * mirroring the Rust SemVer struct in Installer/src-tauri/src/dependency.rs.
 *
 * Used for property-based testing of the dependency detection correctness property.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a version string into a SemVer object.
 * Handles formats like "20.18.0", "v20.18.0", "2.47.0.windows.1"
 *
 * Mirrors Rust's SemVer::parse()
 */
export function parseSemVer(versionStr: string): SemVer | null {
  const trimmed = versionStr.trim().replace(/^v/, "");
  const parts = trimmed.split(".");

  if (parts.length < 3) {
    return null;
  }

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);

  // Patch may contain extra info (e.g. "0" from "2.47.0.windows.1"), just take leading digits
  const patchStr = parts[2];
  const patchMatch = patchStr.match(/^(\d+)/);
  if (!patchMatch) {
    return null;
  }
  const patch = parseInt(patchMatch[1], 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return null;
  }

  return { major, minor, patch };
}

/**
 * Extract a version string from command output.
 *
 * Handles:
 * - Node.js: "v20.18.0\n" -> "20.18.0"
 * - Git: "git version 2.47.0.windows.1\n" -> "2.47.0"
 *
 * Mirrors Rust's extract_version_from_output()
 */
export function extractVersionFromOutput(output: string): string | null {
  const trimmed = output.trim();
  const words = trimmed.split(/\s+/);

  for (const word of words) {
    const candidate = word.replace(/^v/, "");
    const ver = parseSemVer(candidate);
    if (ver !== null) {
      return `${ver.major}.${ver.minor}.${ver.patch}`;
    }
  }

  return null;
}

/**
 * Returns true if current >= minimum (semver comparison).
 *
 * Mirrors Rust's SemVer::satisfies_minimum()
 */
export function satisfiesMinimum(current: SemVer, minimum: SemVer): boolean {
  if (current.major !== minimum.major) {
    return current.major > minimum.major;
  }
  if (current.minor !== minimum.minor) {
    return current.minor > minimum.minor;
  }
  return current.patch >= minimum.patch;
}

/**
 * Classify a dependency as "present_sufficient" or "needs_download"
 * based on installed version and minimum requirement.
 *
 * Mirrors the logic in Rust's detect_dependency() function.
 */
export function classifyDependency(
  installedVersion: string | null,
  minimumVersion: string,
): "present_sufficient" | "needs_download" {
  if (installedVersion === null) {
    return "needs_download";
  }

  const current = parseSemVer(installedVersion);
  const minimum = parseSemVer(minimumVersion);

  if (current === null || minimum === null) {
    // Can't parse version, assume we need download
    return "needs_download";
  }

  return satisfiesMinimum(current, minimum) ? "present_sufficient" : "needs_download";
}
