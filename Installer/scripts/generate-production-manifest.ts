/**
 * Build-time generator for the flat production npm manifest + lockfile
 * (Option B2) for the LLM Toolkit installer.
 *
 * Bugfix: runtimes-npm-install-nonzero-exit — task 3.3 (Part B / B2)
 * Requirements: 2.1, 2.2, 2.5
 *
 * WHY THIS EXISTS
 * ---------------
 * The installer's Runtimes step runs `npm install --omit=dev` in `install_dir`
 * to materialize the tools' production `node_modules` (including
 * `@modelcontextprotocol/sdk`). Today that fails deterministically because no
 * resolvable manifest is staged into `install_dir` (root cause H1), and any
 * manifest derived straight from the monorepo would (a) carry the root
 * `"prepare": "husky"` lifecycle script (H2) and an `engines` range that can
 * trigger `EBADENGINE` (H5), and (b) reference workspace-internal `file:`/`*`
 * dependencies (`@shared/types`, `llm-toolkit-observability`,
 * `llm-toolkit-calculator`, …) that never resolve from an end-user registry.
 *
 * This generator produces a single FLAT production `package.json` that lists
 * ONLY registry-published runtime dependencies (the union of the nine tools'
 * `dependencies`), with every `file:`/`*` workspace specifier resolved to a
 * published version or dropped-and-hoisted. It emits NO `scripts` block and
 * OMITS `engines`, so no dev-only lifecycle script can run and no engine-strict
 * abort can occur. It then resolves that flat manifest in an isolated temp dir
 * to pin a deterministic `package-lock.json` (exact versions + integrity).
 *
 * SCOPE (task 3.3 only)
 * ---------------------
 * This module ONLY produces the generator and its output artifacts. Staging the
 * artifacts into the payload (task 3.4), the manifest-sync verify check (3.7),
 * native-dep handling (3.6), and the `NpmInstallOmitDev` invocation change (3.5)
 * are SEPARATE dependent tasks and are intentionally not done here. It NEVER
 * generates or copies a `node_modules` tree. The core is exposed as reusable
 * pure functions plus a thin CLI entry so a later verify command (task 3.7) can
 * re-run generation into a temp location and diff the committed output.
 *
 * Run with: `npm run generate:runtime-manifest`
 *   (i.e. `tsx scripts/generate-production-manifest.ts`).
 * Flags:
 *   --out <dir>      write artifacts into <dir> (default:
 *                    Installer/src-tauri/payload/runtime-manifest).
 *   --no-lockfile    emit only package.json; skip the temp-dir lockfile resolve
 *                    (useful for a fast, offline manifest-only check).
 *   --dry-run        compute and print the flat manifest, but write nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

// ─── Path anchoring (jest-CommonJS-safe, mirrors stage-payload.ts) ───────────
//
// This module is authored to run BOTH as a real ESM CLI
// (`tsx scripts/generate-production-manifest.ts`) AND to be imported under
// jest's CommonJS transform by the task-3.8 unit tests. We deliberately AVOID
// `import.meta` (which fails to load under the CommonJS transform) and anchor
// path resolution on `process.argv[1]`, the invoked script path, available in
// both modes.

/** Absolute path to the invoked entry script, or "" when unavailable. */
function invokedScriptPath(): string {
  return process.argv[1] ? resolve(process.argv[1]) : "";
}

/** True iff this file is the invoked entry script (run as CLI, not imported). */
function runningAsMain(): boolean {
  const invoked = invokedScriptPath();
  if (!invoked) {
    return false;
  }
  const base = invoked.replaceAll("\\", "/").split("/").pop() ?? "";
  return base === "generate-production-manifest.ts" || base === "generate-production-manifest.js";
}

/** The `Installer/scripts/` directory this file lives in, anchored on argv[1]. */
function scriptDirOf(): string {
  const invoked = invokedScriptPath();
  return invoked ? dirname(invoked) : resolve(".");
}

/** The `Installer/` root: one level up from `Installer/scripts/`. */
function installerRootOf(): string {
  return resolve(scriptDirOf(), "..");
}

/** Repository root: two levels up from `Installer/scripts/`. */
function repoRootOf(): string {
  return resolve(installerRootOf(), "..");
}

/**
 * The default output directory for the generated artifacts:
 * `Installer/src-tauri/payload/runtime-manifest/`. Task 3.4 stages these flat
 * files into the payload; this generator only writes them here.
 */
export function defaultOutputDir(): string {
  return resolve(installerRootOf(), "src-tauri", "payload", "runtime-manifest");
}

// ─── Source-manifest enumeration ─────────────────────────────────────────────

/**
 * Repo-root-relative directories of the nine CANONICAL tool packages whose
 * production `dependencies` seed the flat manifest. Mirrors the nine server
 * names in `payload-manifest.ts` (`CANONICAL_TOOL_PAYLOADS`) — kept as source
 * package dirs here (not `dist` roots) because we read each tool's
 * `package.json`. `browserless` is a config-only wrapper with no runtime
 * dependencies but is listed for completeness/parity with the canonical nine.
 */
export const CANONICAL_TOOL_PACKAGE_DIRS: readonly string[] = [
  "Terminal",
  "WebBrowser",
  "mcp/common",
  "Browserless",
  "PythonShell",
  "Skills",
  "BlenderBridge",
  "3DTool",
  "LanSubAgent",
] as const;

/**
 * Workspace-internal (unpublished, `file:`/`*`) package dirs that the canonical
 * tools depend on. Each is READ so its own registry-published `dependencies`
 * can be hoisted into the flat manifest when the workspace package itself is
 * dropped (it is unpublished). `mcp/common` pulls in calculator/clock/ask-user/
 * document-scraper transitively, so those are enumerated here too.
 */
export const WORKSPACE_INTERNAL_PACKAGE_DIRS: readonly string[] = [
  "shared",
  "Observability",
  "Calculator",
  "Clock",
  "AskUser",
  "DocumentScraper",
] as const;

/** A parsed package.json, narrowed to the fields the generator consumes. */
export interface RawManifest {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  [k: string]: unknown;
}

/** Filesystem seam so the pure planner can be unit-tested without disk I/O. */
export interface ManifestReader {
  /** Read+parse a package.json at a repo-root-relative dir, or undefined if absent. */
  read(repoRelDir: string): RawManifest | undefined;
}

/** Default reader: reads `<repoRoot>/<dir>/package.json` from disk. */
export function defaultManifestReader(repoRoot: string): ManifestReader {
  return {
    read(repoRelDir: string): RawManifest | undefined {
      const p = resolve(repoRoot, repoRelDir, "package.json");
      if (!existsSync(p)) {
        return undefined;
      }
      return JSON.parse(readFileSync(p, "utf8")) as RawManifest;
    },
  };
}

// ─── Dependency classification ───────────────────────────────────────────────

/**
 * True iff a version specifier refers to a workspace-internal package that
 * cannot resolve from the public registry: `file:` links and the bare `*`
 * wildcard the monorepo uses for internal `workspace` deps. Also treats the
 * npm `workspace:` protocol as internal for safety.
 */
export function isWorkspaceInternalSpecifier(spec: string): boolean {
  const s = spec.trim();
  return s === "*" || s.startsWith("file:") || s.startsWith("workspace:") || s === "";
}

/**
 * True iff a dependency NAME is one of the repo's known unpublished
 * workspace-internal packages. Used as a defensive second gate so an internal
 * package pinned by an accidental concrete version is still dropped/hoisted
 * rather than leaking an unresolvable name to the end user.
 */
export function isWorkspaceInternalName(name: string): boolean {
  return name === "@shared/types" || name.startsWith("llm-toolkit-");
}

// ─── Semver-lite range selection ─────────────────────────────────────────────
//
// The tools pin caret ranges (`^1.30.1`). When two tools declare the same
// package we keep ONE compatible version: the range whose minimum version is
// highest. This is a deliberately small, dependency-free comparator — full
// semver resolution is deferred to npm when it builds the lockfile.

/** Extract the leading `major.minor.patch` from a range, defaulting missing parts to 0. */
function minVersionOf(range: string): [number, number, number] {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!m) {
    return [0, 0, 0];
  }
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Compare two ranges by their minimum version; returns a>b => positive. */
function compareRanges(a: string, b: string): number {
  const [aMa, aMi, aPa] = minVersionOf(a);
  const [bMa, bMi, bPa] = minVersionOf(b);
  if (aMa !== bMa) return aMa - bMa;
  if (aMi !== bMi) return aMi - bMi;
  return aPa - bPa;
}

/**
 * Pick the single compatible range to keep for a package seen with two ranges.
 * Keeps the higher minimum version so all declared consumers are satisfiable
 * (caret ranges are forward-compatible within a major). Ties keep the incumbent.
 */
export function pickCompatibleRange(existing: string, incoming: string): string {
  return compareRanges(incoming, existing) > 0 ? incoming : existing;
}

// ─── The pure generator core ─────────────────────────────────────────────────

/** How a workspace-internal dependency was handled, for the report. */
export interface WorkspaceResolution {
  /** The workspace-internal dependency name (e.g. `@shared/types`). */
  name: string;
  /** The original specifier seen in a tool manifest (`file:../shared`, `*`). */
  specifier: string;
  /** `"dropped-hoisted"` — unpublished: dropped, its registry deps hoisted. */
  action: "dropped-hoisted";
  /** Registry-published transitive deps hoisted into the flat list from it. */
  hoisted: string[];
}

/** The fully-computed flat production manifest plus an explanatory report. */
export interface GeneratedManifest {
  /** The flat `package.json` object ready to serialize. */
  manifest: {
    name: string;
    version: string;
    private: true;
    dependencies: Record<string, string>;
    overrides?: Record<string, string>;
  };
  /** Sorted list of the registry-published runtime deps included. */
  includedDependencies: string[];
  /** How each workspace-internal `file:`/`*` dep was resolved/dropped. */
  workspaceResolutions: WorkspaceResolution[];
  /** Names of source manifests that were missing on disk (for diagnostics). */
  missingManifests: string[];
}

/** Options for {@link computeFlatManifest}. */
export interface ComputeOptions {
  /** Manifest name for the flat production package. */
  name?: string;
  /** Manifest version (defaults to the repo root version). */
  version?: string;
  /** The root `overrides` block to carry through (e.g. the `zod` pin). */
  overrides?: Record<string, string>;
}

/**
 * Compute the flat production manifest from the source tool + workspace
 * manifests. PURE with respect to its `reader` seam — no process/network I/O.
 *
 * Algorithm:
 *   1. Union every canonical tool's `dependencies`.
 *   2. For each dep: if it is registry-published, keep it (dedup to one
 *      compatible range); if it is a workspace-internal `file:`/`*` dep, DROP it
 *      and HOIST its own registry-published `dependencies` (read from the
 *      workspace package's manifest) into the union — recursively, so
 *      `mcp/common` → calculator → (mathjs, @babel/runtime) all surface.
 *   3. Emit no `scripts`, omit `engines`, mark `private: true`.
 */
export function computeFlatManifest(
  reader: ManifestReader,
  opts: ComputeOptions = {},
): GeneratedManifest {
  const included = new Map<string, string>();
  const workspaceResolutions = new Map<string, WorkspaceResolution>();
  const missingManifests: string[] = [];

  // Cache workspace-internal manifests so a package referenced by several tools
  // is only read + hoisted once, and to guard against cycles.
  const visitedInternal = new Set<string>();

  /** Add/dedup a registry-published dependency into the included map. */
  const addRegistryDep = (name: string, spec: string): void => {
    const prior = included.get(name);
    included.set(name, prior === undefined ? spec : pickCompatibleRange(prior, spec));
  };

  /**
   * Resolve a workspace-internal package by NAME: find its dir, read its
   * manifest, and fold its own dependencies in (registry deps hoisted; nested
   * internal deps recursed). Records the resolution for the report.
   */
  const resolveInternalByName = (name: string, specifier: string): void => {
    if (visitedInternal.has(name)) {
      return;
    }
    visitedInternal.add(name);

    const dir = workspaceDirForName(name);
    const hoisted: string[] = [];
    if (dir !== undefined) {
      const m = reader.read(dir);
      if (m === undefined) {
        missingManifests.push(dir);
      } else {
        for (const [depName, depSpec] of Object.entries(m.dependencies ?? {})) {
          if (isWorkspaceInternalSpecifier(depSpec) || isWorkspaceInternalName(depName)) {
            resolveInternalByName(depName, depSpec);
          } else {
            addRegistryDep(depName, depSpec);
            hoisted.push(depName);
          }
        }
      }
    }

    workspaceResolutions.set(name, {
      name,
      specifier,
      action: "dropped-hoisted",
      hoisted: hoisted.sort((a, b) => a.localeCompare(b)),
    });
  };

  // 1 + 2: walk every canonical tool's dependencies.
  for (const toolDir of CANONICAL_TOOL_PACKAGE_DIRS) {
    const m = reader.read(toolDir);
    if (m === undefined) {
      missingManifests.push(toolDir);
      continue;
    }
    for (const [depName, depSpec] of Object.entries(m.dependencies ?? {})) {
      if (isWorkspaceInternalSpecifier(depSpec) || isWorkspaceInternalName(depName)) {
        resolveInternalByName(depName, depSpec);
      } else {
        addRegistryDep(depName, depSpec);
      }
    }
  }

  const dependencies: Record<string, string> = {};
  const sortedKeys = [...included.keys()].toSorted((a, b) => a.localeCompare(b));
  for (const key of sortedKeys) {
    dependencies[key] = included.get(key) as string;
  }

  const manifest: GeneratedManifest["manifest"] = {
    name: opts.name ?? "llm-toolkit-runtime",
    version: opts.version ?? "0.0.0",
    private: true,
    dependencies,
  };
  const overrides = normalizeOverrides(opts.overrides ?? {}, dependencies);
  if (Object.keys(overrides).length > 0) {
    manifest.overrides = overrides;
  }

  return {
    manifest,
    includedDependencies: Object.keys(dependencies),
    workspaceResolutions: [...workspaceResolutions.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    missingManifests,
  };
}

/**
 * Normalize a root `overrides` block for the FLAT manifest so it cannot trip
 * npm's `EOVERRIDE` guard.
 *
 * npm forbids an override for a package you also directly depend on unless the
 * override and the direct dependency share the exact same spec; the sanctioned
 * escape is to express the override as a reference to the direct dependency by
 * prefixing the package name with `$`. In the monorepo the `zod` override never
 * conflicts because zod is a direct dep only in child workspaces, but in this
 * flat manifest `zod` is BOTH a direct dependency and an override target, so a
 * literal `"zod": "3.25.76"` override collides with the `^3.25.76` direct dep.
 *
 * For every override whose key is also a direct dependency, we (1) pin the
 * direct dependency to the override's concrete version so the intended single
 * version is locked, and (2) rewrite the override value to the `$<name>`
 * self-reference form so transitive copies are forced to that same pinned
 * version. Overrides that do not target a direct dependency are passed through
 * unchanged. This preserves the override's real intent (one trusted version of
 * `zod` across the whole tree) while satisfying npm's rule.
 *
 * MUTATES `dependencies` in place to apply the concrete pin.
 */
export function normalizeOverrides(
  rootOverrides: Record<string, string>,
  dependencies: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const overrideKeys = Object.keys(rootOverrides).toSorted((a, b) => a.localeCompare(b));
  for (const key of overrideKeys) {
    const overrideSpec = rootOverrides[key];
    if (Object.hasOwn(dependencies, key)) {
      // Pin the direct dep to the concrete override version, then reference it.
      dependencies[key] = overrideSpec;
      out[key] = `$${key}`;
    } else {
      out[key] = overrideSpec;
    }
  }
  return out;
}

/**
 * Map a workspace-internal package NAME to its repo-root-relative dir so its
 * manifest can be read for hoisting. Returns undefined for `@shared/types`
 * (its only dep is itself → nothing to hoist) handled via the table, and for
 * unknown names (nothing to hoist).
 */
function workspaceDirForName(name: string): string | undefined {
  const table: Record<string, string> = {
    "@shared/types": "shared",
    "llm-toolkit-observability": "Observability",
    "llm-toolkit-calculator": "Calculator",
    "llm-toolkit-clock": "Clock",
    "llm-toolkit-ask-user": "AskUser",
    "llm-toolkit-document-scraper": "DocumentScraper",
  };
  return table[name];
}

// ─── Serialization ───────────────────────────────────────────────────────────

/**
 * Serialize the flat manifest deterministically (2-space indent + trailing
 * newline) so the task-3.7 byte-identical drift check is stable across runs.
 */
export function serializeManifest(gen: GeneratedManifest): string {
  return `${JSON.stringify(gen.manifest, null, 2)}\n`;
}

// ─── Lockfile production (impure: temp dir + npm) ────────────────────────────

/**
 * Resolve the flat manifest in an ISOLATED temp dir to pin exact versions and
 * integrity hashes, returning the `package-lock.json` text. No `node_modules`
 * is created: we run `npm install --package-lock-only`. `--ignore-scripts`,
 * `--no-audit`, and `--no-fund` mirror the eventual install-time invocation
 * (task 3.5) so the lockfile is resolved under the same constraints.
 *
 * Impure by necessity (spawns npm, touches a temp dir); kept out of
 * {@link computeFlatManifest} so the planner stays unit-testable.
 */
export function resolveLockfile(manifestText: string): string {
  const workDir = mkdtempSync(resolve(tmpdir(), "llm-toolkit-runtime-manifest-"));
  try {
    writeFileSync(resolve(workDir, "package.json"), manifestText, "utf8");
    execFileSync(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" },
    );
    const lockPath = resolve(workDir, "package-lock.json");
    if (!existsSync(lockPath)) {
      throw new Error("npm did not produce a package-lock.json in the temp resolve dir");
    }
    return readFileSync(lockPath, "utf8");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/** Options for {@link generateProductionManifest}. */
export interface GenerateOptions {
  /** Repo root (defaults to two levels up from `Installer/scripts/`). */
  repoRoot?: string;
  /** Output dir for the artifacts (defaults to {@link defaultOutputDir}). */
  outDir?: string;
  /** When false, only the manifest is written (no lockfile resolve). */
  writeLockfile?: boolean;
  /** When true, compute + report but write nothing to disk. */
  dryRun?: boolean;
}

/** The result of a full generation run, for CLI reporting + programmatic use. */
export interface GenerateResult {
  gen: GeneratedManifest;
  manifestText: string;
  lockfileText?: string;
  outDir: string;
  packageJsonPath: string;
  packageLockPath: string;
  wrote: boolean;
}

/**
 * The single reusable entry point: read the source manifests, compute the flat
 * production manifest, optionally resolve the lockfile, and (unless dry-run)
 * write both artifacts to `outDir`. A later verify command (task 3.7) can call
 * this with a temp `outDir` and diff the committed output for drift.
 */
export function generateProductionManifest(opts: GenerateOptions = {}): GenerateResult {
  const repoRoot = opts.repoRoot ?? repoRootOf();
  const outDir = opts.outDir ?? defaultOutputDir();
  const writeLockfile = opts.writeLockfile ?? true;

  // Carry the root version + the `overrides` (zod pin) through so the flat
  // manifest resolves to the same zod the monorepo pins.
  const rootManifest = defaultManifestReader(repoRoot).read(".");
  const rootVersion = rootManifest?.version ?? "0.0.0";
  const rootOverrides = (rootManifest?.overrides as Record<string, string> | undefined) ?? {};

  const gen = computeFlatManifest(defaultManifestReader(repoRoot), {
    name: "llm-toolkit-runtime",
    version: rootVersion,
    overrides: rootOverrides,
  });

  const manifestText = serializeManifest(gen);
  const packageJsonPath = resolve(outDir, "package.json");
  const packageLockPath = resolve(outDir, "package-lock.json");

  let lockfileText: string | undefined;
  if (writeLockfile && !opts.dryRun) {
    lockfileText = resolveLockfile(manifestText);
  }

  if (!opts.dryRun) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(packageJsonPath, manifestText, "utf8");
    if (lockfileText !== undefined) {
      writeFileSync(packageLockPath, lockfileText, "utf8");
    }
  }

  return {
    gen,
    manifestText,
    lockfileText,
    outDir,
    packageJsonPath,
    packageLockPath,
    wrote: !opts.dryRun,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliOptions {
  outDir?: string;
  writeLockfile: boolean;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let outDir: string | undefined;
  const outIdx = argv.indexOf("--out");
  if (outIdx !== -1 && argv[outIdx + 1]) {
    outDir = resolve(argv[outIdx + 1] as string);
  }
  return {
    outDir,
    writeLockfile: !argv.includes("--no-lockfile"),
    dryRun: argv.includes("--dry-run"),
  };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  const result = generateProductionManifest({
    outDir: opts.outDir,
    writeLockfile: opts.writeLockfile,
    dryRun: opts.dryRun,
  });

  const { gen } = result;

  console.log("[generate-runtime-manifest] Flat production manifest:");
  console.log(
    `[generate-runtime-manifest]   ${gen.includedDependencies.length} registry-published runtime dep(s):`,
  );
  for (const [name, spec] of Object.entries(result.gen.manifest.dependencies)) {
    console.log(`[generate-runtime-manifest]     - ${name}@${spec}`);
  }

  console.log("[generate-runtime-manifest]   workspace-internal deps resolved:");
  for (const r of gen.workspaceResolutions) {
    const hoist =
      r.hoisted.length > 0 ? ` -> hoisted [${r.hoisted.join(", ")}]` : " -> (nothing to hoist)";
    console.log(
      `[generate-runtime-manifest]     - ${r.name} (${r.specifier}): ${r.action}${hoist}`,
    );
  }

  if (gen.missingManifests.length > 0) {
    console.warn(
      `[generate-runtime-manifest]   WARNING missing source manifest(s): ${gen.missingManifests.join(", ")}`,
    );
  }

  if (opts.dryRun) {
    console.log("[generate-runtime-manifest] --dry-run: no files written. Manifest would be:");
    console.log(result.manifestText);
    process.exit(0);
  }

  console.log(`[generate-runtime-manifest] Wrote ${result.packageJsonPath}`);
  if (result.lockfileText !== undefined) {
    console.log(`[generate-runtime-manifest] Wrote ${result.packageLockPath}`);
  } else {
    console.log("[generate-runtime-manifest] Skipped lockfile (--no-lockfile).");
  }

  const problems = productionSafetyProblems(result.gen);
  if (problems.length > 0) {
    console.error("[generate-runtime-manifest] ABORT — emitted manifest is not production-safe:");
    for (const p of problems) {
      console.error(`[generate-runtime-manifest]   - ${p}`);
    }
    process.exit(1);
  }

  console.log("[generate-runtime-manifest] OK — flat production manifest + lockfile generated.");
  process.exit(0);
}

/**
 * Assert the emitted manifest is production-safe: it must carry no `scripts`
 * block, no `engines` field, no unresolvable `file:`/`*` specifier, and no
 * workspace-internal dependency name. Returns a (possibly empty) list of
 * problems; empty == safe. Exposed so the task-3.7 verify check can reuse it.
 */
export function productionSafetyProblems(gen: GeneratedManifest): string[] {
  const emitted = gen.manifest as Record<string, unknown>;
  const problems: string[] = [];
  if ("scripts" in emitted) {
    problems.push("manifest carries a `scripts` block");
  }
  if ("engines" in emitted) {
    problems.push("manifest carries an `engines` field");
  }
  for (const [name, spec] of Object.entries(gen.manifest.dependencies)) {
    if (isWorkspaceInternalSpecifier(spec)) {
      problems.push(`dependency ${name} has an unresolvable specifier ${spec}`);
    }
    if (isWorkspaceInternalName(name)) {
      problems.push(`dependency ${name} is a workspace-internal package`);
    }
  }
  return problems;
}

// Only run when invoked directly (not when imported by tests). Under the jest
// CommonJS transform the invoked script is jest, so `runningAsMain()` is false.
if (runningAsMain()) {
  main();
}
