/**
 * Pure Tauri crate/CLI major-currency core for the dependency-refresh (Phase E).
 *
 * Feature: dependency-refresh-node24 (Requirement 5.2)
 *
 * This module contains ONLY pure, I/O-free functions. It decides, for a declared
 * `@tauri-apps/cli` version and a declared `tauri` Rust crate version, whether
 * their resolved MAJOR versions match — the invariant Req 5.2 requires
 * (`Installer/src-tauri/Cargo.toml`'s `tauri` crate major must equal the
 * `@tauri-apps/cli` major).
 *
 * The file-reading wrapper (reading `@tauri-apps/cli` from a `package.json` and
 * the `tauri` crate version from `Cargo.toml`) lives in
 * `check-crate-currency.ts`, mirroring the
 * `check-node-24-core.ts` / `check-node-24.ts` split already used in
 * `scripts/workspace/node-compliance/`.
 *
 * Keeping the core pure means:
 *   - the scanning CLI (`check-crate-currency.ts`) reuses the exact match
 *     decision, and
 *   - the Property 8 `fast-check` test (task 5.4) can import
 *     `checkCrateMatchesCli` and property-test it over generated
 *     `(cliVersion, crateVersion)` pairs without touching the filesystem.
 *
 * Match contract (design.md "Property 8", Req 5.2):
 *   The check PASSES iff `resolvedMajor(cli) === resolvedMajor(crate)` (both
 *   parse to the same numeric major). Otherwise it FLAGS the pair, surfacing
 *   both raw versions and their resolved majors. An unparseable version can
 *   never equal another value's major, so it always flags.
 */

/**
 * Parse the major version implied by a raw version reference.
 *
 * Handles the common forms found in `package.json` ranges and `Cargo.toml`
 * version requirements:
 *   - a bare major: `"2"`
 *   - a partial / full version: `"2.1"`, `"2.1.3"`
 *   - a caret / tilde range: `"^2.8.0"`, `"~2.1"`
 *   - a `v`-prefixed version: `"v2.1.0"`
 *   - a comparator range: `">=2.0.0 <3"`, `">2.0.0"` — the LEADING (lower-bound)
 *     comparator's major is returned, which is the resolved major the check
 *     compares.
 *
 * Returns `null` when no leading numeric major can be extracted (e.g. `""`,
 * `"latest"`, `"*"`).
 */
export function parseMajor(rawVersion: string): number | null {
  const trimmed = rawVersion.trim();
  if (trimmed.length === 0) return null;

  // First numeric token in the string, optionally `v`-prefixed and optionally
  // preceded by a range operator (>=, >, <=, <, ^, ~, =). This yields the
  // leading version's major, which is what the resolved-major field records.
  const match = /(?:^|[\s><=^~])v?(\d+)/i.exec(trimmed);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * The result of a crate/CLI major-currency check.
 *
 * `ok` is `true` iff the two resolved majors are equal (and both parse). When
 * `ok` is `false` the pair is flagged: both raw versions and their resolved
 * majors (`null` when unparseable) are carried so the caller can report exactly
 * which side is off, mirroring the `{ filePath, offendingValue }` reporting
 * style used by the Node-compliance check.
 */
export interface CrateMatchResult {
  /** `true` iff `cliMajor === crateMajor` and both are non-null. */
  ok: boolean;
  /** The raw `@tauri-apps/cli` version as declared (e.g. `"^2.8.0"`). */
  cliVersion: string;
  /** The raw `tauri` crate version as declared (e.g. `"2"`). */
  crateVersion: string;
  /** Parsed CLI major; `null` when unparseable. */
  cliMajor: number | null;
  /** Parsed crate major; `null` when unparseable. */
  crateMajor: number | null;
}

/**
 * Decide whether a declared `@tauri-apps/cli` version and a declared `tauri`
 * crate version share the same resolved MAJOR (Req 5.2, Property 8).
 *
 * Pure and I/O-free. The result PASSES (`ok: true`) if and only if both
 * versions parse to a numeric major AND those majors are equal; otherwise the
 * pair is flagged (`ok: false`) with both raw versions and their resolved
 * majors included for reporting.
 */
export function checkCrateMatchesCli(cliVersion: string, crateVersion: string): CrateMatchResult {
  const cliMajor = parseMajor(cliVersion);
  const crateMajor = parseMajor(crateVersion);
  const ok = cliMajor !== null && crateMajor !== null && cliMajor === crateMajor;
  return { ok, cliVersion, crateVersion, cliMajor, crateMajor };
}
