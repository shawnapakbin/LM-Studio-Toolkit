/**
 * Pure repo-wide version-sync + consistency core for the dependency-refresh
 * (Phase I).
 *
 * Feature: dependency-refresh-node24 (Requirements 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9)
 *
 * This module contains ONLY pure, I/O-free functions over file *contents*
 * (strings). It knows how to
 *   - extract a version string from each kind of target file,
 *   - write a target version into each kind of file byte-identically, and
 *   - decide, for a snapshot of already-extracted versions, whether every file
 *     agrees on a byte-identical target and, if not, which files diverge.
 *
 * The filesystem / process-exit wrapper (reading the target from the root
 * `package.json`, reading + writing each target file, printing, exiting) lives
 * in `sync-repo-version.ts`, mirroring the
 * `check-node-24-core.ts` / `check-node-24.ts`,
 * `shared-consistency-core.ts` / `check-shared-consistency.ts`, and
 * `crate-currency-core.ts` / `check-crate-currency.ts` splits already used in
 * `scripts/workspace/`.
 *
 * Keeping the core pure means:
 *   - the `sync` / `check` CLI reuses the exact same extraction + decision
 *     logic, and
 *   - the Property 4 `fast-check` test (task 9.2) can import these functions and
 *     property-test repo-wide sync (consistency, idempotence, mismatch
 *     reporting) over generated versions + file snapshots without touching the
 *     filesystem.
 *
 * Design contract (design.md "Repo version sync", Req 9.8 / 9.9):
 *   The single source of truth for the target version is the root
 *   `package.json` `version` field. `sync` writes that target byte-identically
 *   into: the root `package.json`, EVERY workspace `package.json`,
 *   `Installer/src-tauri/Cargo.toml`, `Installer/src-tauri/tauri.conf.json`, and
 *   `README.md`; running `sync` twice is a no-op (idempotent). `check` passes
 *   iff every target file reports the byte-identical target version, and on
 *   failure names exactly each file whose version differs.
 */

/**
 * A stable identifier for one version-carrying file, mirroring design.md's
 * `VersionFileId`.
 *
 *   - `"root/package.json"`               — the single source of truth.
 *   - `"workspace:<dir>/package.json"`    — one per workspace directory.
 *   - `"Installer/src-tauri/Cargo.toml"`  — the installer crate `[package]`.
 *   - `"Installer/src-tauri/tauri.conf.json"` — the Tauri config.
 *   - `"README.md"`                       — the repo README `**Version**:` line.
 */
export type VersionFileId =
  | "root/package.json"
  | `workspace:${string}/package.json`
  | "Installer/src-tauri/Cargo.toml"
  | "Installer/src-tauri/tauri.conf.json"
  | "README.md";

/** The kind of file a `VersionFileId` refers to — selects the parser/writer. */
export type VersionFileKind = "json" | "cargo" | "readme";

/**
 * A snapshot of the version each target file currently reports, keyed by its
 * `VersionFileId`. Mirrors design.md's `VersionSnapshot.files`.
 */
export type VersionSnapshot = Record<string, string>;

/**
 * The result of a repo-wide consistency check (design.md `SyncResult`).
 *
 * `mismatched` lists exactly the files whose version differs from `target`,
 * sorted for stable reporting; `ok` is `mismatched.length === 0`.
 */
export interface SyncResult {
  ok: boolean;
  /** The target version the snapshot was checked against. */
  target: string;
  /** Files whose reported version !== target (empty on success). */
  mismatched: VersionFileId[];
}

/** Classify a `VersionFileId` into the parser/writer it needs. */
export function fileKind(id: VersionFileId): VersionFileKind {
  if (id === "Installer/src-tauri/Cargo.toml") return "cargo";
  if (id === "README.md") return "readme";
  // root/package.json, workspace:*/package.json, tauri.conf.json are all JSON.
  return "json";
}

/**
 * Validate that a version string is a strict `MAJOR.MINOR.PATCH` triple of
 * non-negative integers (no `v` prefix, no pre-release/build metadata).
 *
 * This is the byte-shape the Repo_Version must take across every file (Req 9.8);
 * the bump-decision's fuller semver-precedence check lives in task 9.3.
 */
export function isVersionTriple(version: string): boolean {
  if (typeof version !== "string") return false;
  return /^\d+\.\d+\.\d+$/.test(version.trim());
}

// ── Extraction ──────────────────────────────────────────────────────────────

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
  // Match the `version = "x.y.z"` line within the [package] section only, so a
  // dependency's `version = "..."` elsewhere in the file is never picked up.
  const packageSection = /\[package\][\s\S]*?(?=\n\[|$)/.exec(source);
  const scope = packageSection ? packageSection[0] : source;
  const match = /^\s*version\s*=\s*"([^"]+)"/m.exec(scope);
  if (match === null) {
    throw new Error("Cargo.toml [package] has no `version` field");
  }
  return match[1];
}

/**
 * The README states the repo version on a line of the form
 * `**Version**: <x.y.z>` (optionally followed by trailing spaces, which the
 * repo uses as a Markdown hard line-break). This regex captures the version
 * token and is reused by both the extractor and the writer so writes stay
 * byte-identical and idempotent.
 */
const README_VERSION_RE = /(\*\*Version\*\*:\s*)(\d+\.\d+\.\d+)/;

/** Extract the version reported by the README `**Version**:` line. */
export function extractReadmeVersion(source: string): string {
  const match = README_VERSION_RE.exec(source);
  if (match === null) {
    throw new Error("README.md has no `**Version**: <x.y.z>` line");
  }
  return match[2];
}

/** Extract the reported version from a file's contents, per its kind. */
export function extractVersion(kind: VersionFileKind, source: string): string {
  switch (kind) {
    case "json":
      return extractJsonVersion(source);
    case "cargo":
      return extractCargoVersion(source);
    case "readme":
      return extractReadmeVersion(source);
  }
}

// ── Writing (byte-identical, idempotent) ─────────────────────────────────────

/**
 * Write `target` into a JSON manifest's `version` field, preserving the file's
 * existing 2-space indentation and trailing newline (matching how the repo's
 * JSON manifests are formatted) so re-serialisation stays byte-stable.
 *
 * Idempotent: if the manifest already reports `target`, the returned string is
 * byte-identical to the input.
 */
export function setJsonVersion(source: string, target: string): string {
  const parsed = JSON.parse(source) as Record<string, unknown>;
  parsed.version = target;
  const hadTrailingNewline = source.endsWith("\n");
  const serialised = `${JSON.stringify(parsed, null, 2)}${hadTrailingNewline ? "\n" : ""}`;
  return serialised;
}

/**
 * Write `target` into the `[package] version = "..."` field of a Cargo.toml,
 * touching ONLY that one line (a targeted substitution rather than a TOML
 * re-serialise) so every other byte — dependency versions, comments, layout —
 * is preserved. Idempotent when the crate already reports `target`.
 */
export function setCargoVersion(source: string, target: string): string {
  const packageSectionMatch = /\[package\][\s\S]*?(?=\n\[|$)/.exec(source);
  if (packageSectionMatch === null) {
    throw new Error("Cargo.toml has no [package] section");
  }
  const section = packageSectionMatch[0];
  const versionLineRe = /^(\s*version\s*=\s*")([^"]+)(")/m;
  if (!versionLineRe.test(section)) {
    throw new Error("Cargo.toml [package] has no `version` field");
  }
  const newSection = section.replace(versionLineRe, `$1${target}$3`);
  return (
    source.slice(0, packageSectionMatch.index) +
    newSection +
    source.slice(packageSectionMatch.index + section.length)
  );
}

/**
 * Write `target` into the README `**Version**:` line, touching only the version
 * token and leaving the label, surrounding text, and any trailing hard-break
 * spaces intact. Idempotent when the README already reports `target`.
 */
export function setReadmeVersion(source: string, target: string): string {
  if (!README_VERSION_RE.test(source)) {
    throw new Error("README.md has no `**Version**: <x.y.z>` line");
  }
  return source.replace(README_VERSION_RE, `$1${target}`);
}

/** Write `target` into a file's contents, per its kind (byte-identical, idempotent). */
export function setVersion(kind: VersionFileKind, source: string, target: string): string {
  switch (kind) {
    case "json":
      return setJsonVersion(source, target);
    case "cargo":
      return setCargoVersion(source, target);
    case "readme":
      return setReadmeVersion(source, target);
  }
}

// ── Decisions ─────────────────────────────────────────────────────────────

/**
 * Decide, for a snapshot of already-extracted versions, which files diverge
 * from the `target` (Req 9.8 / 9.9). Pure and I/O-free.
 *
 * A file is mismatched IFF its recorded version string is not byte-identical to
 * `target`. `mismatched` lists exactly those files (sorted for stable output),
 * and `ok` is true iff none diverge. This is the pure decision the Property 4
 * test drives directly.
 */
export function checkRepoVersions(target: string, snapshot: VersionSnapshot): SyncResult {
  const mismatched = (Object.keys(snapshot) as VersionFileId[])
    .filter((id) => snapshot[id] !== target)
    .sort((a, b) => a.localeCompare(b));
  return { ok: mismatched.length === 0, target, mismatched };
}

/**
 * Apply `target` to a map of `VersionFileId -> file contents`, returning a new
 * map of updated contents. Each file is rewritten with `setVersion` for its
 * kind, so the result is byte-identical to the input for any file that already
 * reports `target` — running `applyRepoSync` twice is therefore a no-op
 * (idempotence, Req 9.8). Pure and I/O-free.
 *
 * This is the pure sync the Property 4 test drives directly.
 */
export function applyRepoSync(
  target: string,
  contents: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(contents) as VersionFileId[]) {
    out[id] = setVersion(fileKind(id), contents[id], target);
  }
  return out;
}
