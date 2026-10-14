/**
 * Payload-staging build step for the LLM Toolkit installer.
 *
 * Feature: windows-installer-setup-exe (Requirements 3.2, 3.3)
 * Feature: installer-runtime-provisioning (Requirements 2.1, 2.2, 2.3, 2.4, 2.6, 2.7)
 *
 * Runs BEFORE `tauri build`. Its job:
 *
 *   1. (optionally) build all 16 MCP tools' `dist/` via the repo-root
 *      `npm run build` (skipped with `--no-build` / `STAGE_PAYLOAD_NO_BUILD=1`
 *      so CI can build once and stage separately);
 *   2. inspect each of the nine canonical `dist` roots on disk;
 *   3. run the pure completeness planner (`planPayloadStaging`) — if ANY tool's
 *      `dist` root is absent or EMPTY, ABORT with a non-zero exit and print each
 *      missing tool BY NAME (Req 3.3), producing no staged payload;
 *   4. otherwise stage each tool's `dist` tree into the Tauri resource
 *      directory that `tauri.conf.json` `bundle.resources` embeds into the NSIS
 *      installer;
 *   5. assert the staged tree is a Lean_Payload (installer-runtime-provisioning
 *      Req 2): exactly the nine canonical server dirs at top level (naming any
 *      unexpected entry, Req 2.1/2.7), no `node_modules` path segment at any
 *      depth (Req 2.2/2.3), and a combined size ≤ 500 MB (Req 2.6).
 *
 * STAGING DIRECTORY (coordinate with task 4.2):
 *   Payload is staged under `Installer/src-tauri/payload/<serverName>/`.
 *   Task 4.2 must point `tauri.conf.json` `bundle.resources` at `payload/*`
 *   (paths in `bundle.resources` are resolved relative to `src-tauri/`), so the
 *   nine `dist` trees embed into the NSIS installer.
 *
 * Run with: `npm run stage:payload` (i.e. `tsx scripts/stage-payload.ts`).
 * Flags:
 *   --no-build   skip the root `npm run build` and only stage existing dist/.
 *   --dry-run    plan and report, but do not copy or run the build.
 */

import { execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

import {
  generateProductionManifest,
  locateOrPackSharedTarballs,
} from "./generate-production-manifest.ts";
import { normalizeSharedTarball } from "./normalize-shared-tarball.ts";
import {
  CANONICAL_TOOL_PAYLOADS,
  CLOSURE_PACKAGE_NAMES,
  canonicalPayloads,
  type DistPresence,
  isStagingComplete,
  planPayloadStaging,
  SANCTIONED_PAYLOAD_ROOT_FILES,
  SHARED_TARBALL_SPECS,
  scanPayloadForSecrets,
  sharedTarballFileName,
  stagingBlockers,
  stagingDestDirName,
} from "./payload-manifest.ts";

export type { SecretFinding } from "./payload-manifest.ts";
// Re-export the pure staging secret guard (Concern 2, task 3.5) so callers and
// tests can resolve it directly from `scripts/stage-payload`.
export { scanPayloadForSecrets } from "./payload-manifest.ts";

/**
 * Resolve the path to the invoked entry script.
 *
 * This module is authored to run BOTH as a real ESM CLI (`tsx
 * scripts/stage-payload.ts`) AND to be `require`-d under jest's CommonJS
 * transform (so a test can reach the exported secret guard). We deliberately
 * AVOID `import.meta` — under the CommonJS transform the literal `import.meta`
 * makes the whole module fail to load ("Cannot use 'import.meta' outside a
 * module"). Instead we anchor path resolution on `process.argv[1]`, the path of
 * the invoked script, which is available in both modes.
 */
function invokedScriptPath(): string {
  return process.argv[1] ? resolve(process.argv[1]) : "";
}

/** True iff this file is the invoked entry script (run as CLI, not imported). */
function runningAsMain(): boolean {
  const invoked = invokedScriptPath();
  if (!invoked) {
    return false;
  }
  const base = invoked.replace(/\\/g, "/").split("/").pop() ?? "";
  return base === "stage-payload.ts" || base === "stage-payload.js";
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
 * The staging root that Tauri embeds. `tauri.conf.json` `bundle.resources`
 * (task 4.2) points at `payload/*` relative to `src-tauri/`, so this is where
 * the nine dist trees are collected. Resolved lazily so importing this module
 * under a CommonJS test transform (where `import.meta` is unavailable) does not
 * evaluate `import.meta` at load time.
 */
export function stagingRoot(): string {
  return resolve(installerRootOf(), "src-tauri", "payload");
}

/**
 * Determine whether a `dist` root directory exists and is non-empty.
 *
 * "Non-empty" (Req 3.3) means the directory contains at least one entry. A
 * regular (non-directory) file at that path counts as absent — a `dist` root is
 * expected to be a directory tree.
 */
export function observeDistPresence(
  repoRootDir: string,
  serverName: string,
  distRoot: string,
): DistPresence {
  const abs = resolve(repoRootDir, distRoot);
  if (!existsSync(abs)) {
    return { serverName, exists: false, nonEmpty: false };
  }
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return { serverName, exists: false, nonEmpty: false };
  }
  let entryCount = 0;
  try {
    entryCount = readdirSync(abs).length;
  } catch {
    entryCount = 0;
  }
  return { serverName, exists: true, nonEmpty: entryCount > 0 };
}

/**
 * Observe on-disk presence for the nine canonical tool `dist` trees.
 *
 * The Lean_Payload (installer-runtime-provisioning Req 2) ships only the nine
 * plugin `dist` trees — there is no bundled `node_modules` and nothing else to
 * observe — so completeness is decided solely by the nine.
 */
export function observeAllPresence(repoRootDir: string): DistPresence[] {
  return canonicalPayloads().map((t) => observeDistPresence(repoRootDir, t.serverName, t.distRoot));
}

/**
 * The two workspace-internal `@shared/*` packages the Option B fix provisions
 * via local `file:` tarballs (bugfix: mcp-shared-module-resolution-fix, design
 * → Fix → Changes Required step 1; Req 2.1, 2.2).
 *
 * Each descriptor names the package, its repo-root-relative package directory
 * (the `npm pack` target in task 3.2), and its compiled `dist` root which MUST
 * exist and be non-empty before the pack step runs. The `dist` roots are
 * produced by the root `build:shared` script
 * (`npm run -w shared build && npm run -w shared/config build`), which
 * `stage-payload`'s `npm run build` invokes unless `--no-build`.
 *
 *   - `@shared/types`  → `shared/`        main `dist/types.js`
 *   - `@shared/config` → `shared/config/` main `dist/index.js`
 */
export interface SharedPackagePayload {
  /** The published-style package name, e.g. `@shared/types`. */
  packageName: string;
  /** Repo-root-relative package directory (the `npm pack` target), e.g. `shared`. */
  packageDir: string;
  /** Repo-root-relative compiled `dist` root that must exist before packing. */
  distRoot: string;
}

/**
 * The canonical two `@shared/*` packages, in a stable order. Mirrors the
 * `build:shared` graph (`shared` then `shared/config`).
 */
export const SHARED_PACKAGE_PAYLOADS: readonly SharedPackagePayload[] = [
  { packageName: "@shared/types", packageDir: "shared", distRoot: "shared/dist" },
  { packageName: "@shared/config", packageDir: "shared/config", distRoot: "shared/config/dist" },
] as const;

/**
 * The five workspace-internal `llm-toolkit-*` packages the generalized Option B
 * fix provisions via local `file:` tarballs (bugfix:
 * mcp-shared-module-resolution-fix, follow-up 5.4.4; design → Follow-up Design →
 * Fix → Changes Required step 1; Req 5.1, 5.2).
 *
 * These are the same class of unpublished, workspace-internal packages as the
 * two `@shared/*` entries above — the shipped servers require them by bare name
 * (incl. deep `/dist/*` subpaths) but they are dropped by the generator and
 * never materialized in the installed layout. Each descriptor reuses the
 * {@link SharedPackagePayload} shape: the published-style package name, its
 * repo-root-relative package directory (the `npm pack` target in task 8.2), and
 * its compiled `dist` root which MUST exist and be non-empty before the pack
 * step runs. Every package's `main` is `dist/index.js`, so each `dist` root is
 * `<packageDir>/dist`.
 *
 * The `dist` roots are produced by the workspace build graph the root
 * `npm run build` drives, which `stage-payload` invokes unless `--no-build`.
 *
 *   - `llm-toolkit-ask-user`        → `AskUser/`          main `dist/index.js`
 *   - `llm-toolkit-calculator`      → `Calculator/`       main `dist/index.js`
 *   - `llm-toolkit-clock`           → `Clock/`            main `dist/index.js`
 *   - `llm-toolkit-document-scraper`→ `DocumentScraper/`  main `dist/index.js`
 *   - `llm-toolkit-observability`   → `Observability/`    main `dist/index.js`
 */
export const LLM_TOOLKIT_PACKAGE_PAYLOADS: readonly SharedPackagePayload[] = [
  { packageName: "llm-toolkit-ask-user", packageDir: "AskUser", distRoot: "AskUser/dist" },
  { packageName: "llm-toolkit-calculator", packageDir: "Calculator", distRoot: "Calculator/dist" },
  { packageName: "llm-toolkit-clock", packageDir: "Clock", distRoot: "Clock/dist" },
  {
    packageName: "llm-toolkit-document-scraper",
    packageDir: "DocumentScraper",
    distRoot: "DocumentScraper/dist",
  },
  {
    packageName: "llm-toolkit-observability",
    packageDir: "Observability",
    distRoot: "Observability/dist",
  },
] as const;

/**
 * A single missing-shared-dist blocker, named for the pre-pack abort report.
 */
export interface SharedDistBlocker {
  /** The `@shared/*` package whose compiled `dist` root is absent or empty. */
  packageName: string;
  /** Repo-root-relative `dist` root that was expected but not found/non-empty. */
  distRoot: string;
}

/**
 * Observe which `@shared/*` packages lack a built, non-empty `dist` tree.
 *
 * Pure w.r.t. its argument (reads the filesystem under `repoRootDir`, returns
 * blockers rather than exiting) so a test can drive it directly, mirroring the
 * nine-tool completeness planner (`planPayloadStaging`). Each `@shared/*`
 * `dist` root is checked with the SAME `observeDistPresence` rule the tool dist
 * trees use: it must exist as a directory and contain at least one entry.
 *
 * The pack step (task 3.2) depends on these dists existing — if either is
 * absent/empty this returns a non-empty list and the caller MUST abort loudly,
 * naming each missing package, before any `npm pack` runs.
 *
 * @returns the (possibly empty) list of blockers; empty == both dists ready.
 */
export function observeSharedDistBlockers(repoRootDir: string): SharedDistBlocker[] {
  return observePackageDistBlockers(repoRootDir, SHARED_PACKAGE_PAYLOADS);
}

/**
 * Observe which `llm-toolkit-*` packages lack a built, non-empty `dist` tree
 * (follow-up 5.4.4; Req 5.1, 5.2). The generalized twin of
 * {@link observeSharedDistBlockers}: same pure, filesystem-reading, blocker-
 * returning contract, driven by {@link LLM_TOOLKIT_PACKAGE_PAYLOADS}.
 *
 * The pack step (task 8.2) depends on all five `dist` trees existing — if any
 * is absent/empty this returns a non-empty list and the caller MUST abort
 * loudly, naming each missing package, before any `npm pack` runs.
 *
 * @returns the (possibly empty) list of blockers; empty == all five dists ready.
 */
export function observeLlmToolkitDistBlockers(repoRootDir: string): SharedDistBlocker[] {
  return observePackageDistBlockers(repoRootDir, LLM_TOOLKIT_PACKAGE_PAYLOADS);
}

/**
 * Shared pure core for the workspace-internal pre-pack dist guards: for each
 * package descriptor, apply the SAME `observeDistPresence` rule the nine tool
 * dist trees use (must exist as a directory and contain at least one entry) and
 * collect a blocker — in input order — for every package whose compiled `dist`
 * root is absent or empty.
 */
function observePackageDistBlockers(
  repoRootDir: string,
  packages: readonly SharedPackagePayload[],
): SharedDistBlocker[] {
  const blockers: SharedDistBlocker[] = [];
  for (const pkg of packages) {
    const presence = observeDistPresence(repoRootDir, pkg.packageName, pkg.distRoot);
    if (!presence.exists || !presence.nonEmpty) {
      blockers.push({ packageName: pkg.packageName, distRoot: pkg.distRoot });
    }
  }
  return blockers;
}

/**
 * Guard the pack step on both `@shared/*` `dist` trees existing (design → Fix →
 * Changes Required step 1; Req 2.1, 2.2). ABORTS (non-zero exit) and NAMES each
 * `@shared/*` package whose compiled `dist` root is absent or empty, mirroring
 * the nine-tool dist-completeness abort in `main`. Produces no tarball and
 * stages nothing when a dist is missing.
 *
 * Call this AFTER the (optional) build and BEFORE packing `@shared/*` into
 * tarballs (task 3.2). On success it is silent except for a one-line OK log.
 */
export function assertSharedDistsPresentOrExit(repoRootDir: string): void {
  const blockers = observeSharedDistBlockers(repoRootDir);
  if (blockers.length === 0) {
    console.log(
      `[stage-payload] Both @shared/* dist trees present and non-empty (${SHARED_PACKAGE_PAYLOADS.map((p) => p.packageName).join(", ")}).`,
    );
    return;
  }
  console.error(
    `[stage-payload] ABORT — ${blockers.length} @shared/* package(s) have no built dist tree to pack:`,
  );
  for (const b of blockers) {
    console.error(`[stage-payload]   - ${b.packageName}  (${b.distRoot})`);
  }
  console.error(
    "[stage-payload] Build the shared packages first (root `build:shared`: `npm run -w shared build && npm run -w shared/config build`) so each dist/ exists and is non-empty before packing. No tarball was produced.",
  );
  process.exit(1);
}

/**
 * Guard the pack step on all five `llm-toolkit-*` `dist` trees existing
 * (follow-up 5.4.4; design → Follow-up Design → Fix → Changes Required step 1;
 * Req 5.1, 5.2). The generalized twin of {@link assertSharedDistsPresentOrExit}:
 * ABORTS (non-zero exit) and NAMES each `llm-toolkit-*` package whose compiled
 * `dist` root is absent or empty, mirroring the nine-tool dist-completeness
 * abort in `main` and the 5.4.3 `@shared/*` build gate. Produces no tarball and
 * stages nothing when a dist is missing.
 *
 * Call this AFTER the (optional) build and BEFORE packing the five
 * `llm-toolkit-*` packages into tarballs (task 8.2). On success it is silent
 * except for a one-line OK log.
 */
export function assertLlmToolkitDistsPresentOrExit(repoRootDir: string): void {
  const blockers = observeLlmToolkitDistBlockers(repoRootDir);
  if (blockers.length === 0) {
    console.log(
      `[stage-payload] All ${LLM_TOOLKIT_PACKAGE_PAYLOADS.length} llm-toolkit-* dist trees present and non-empty (${LLM_TOOLKIT_PACKAGE_PAYLOADS.map((p) => p.packageName).join(", ")}).`,
    );
    return;
  }
  console.error(
    `[stage-payload] ABORT — ${blockers.length} llm-toolkit-* package(s) have no built dist tree to pack:`,
  );
  for (const b of blockers) {
    console.error(`[stage-payload]   - ${b.packageName}  (${b.distRoot})`);
  }
  console.error(
    "[stage-payload] Build the workspace packages first (root `npm run build`) so each llm-toolkit-* dist/ exists and is non-empty before packing. No tarball was produced.",
  );
  process.exit(1);
}

/**
 * Read the repo root `package.json` `version` — the single source of truth the
 * `@shared/*` tarball filenames are DERIVED from (never hardcoded), so the
 * staged names follow the repo-wide version bump (5.4.2 → 5.4.3) with no drift.
 * The pack step (`stageSharedTarballs`) and the sanctioned-file set in
 * `payload-manifest.ts` read the SAME root version, so they cannot disagree.
 */
export function resolveRootVersion(repoRootDir: string): string {
  const rootPkg = resolve(repoRootDir, "package.json");
  const parsed = JSON.parse(readFileSync(rootPkg, "utf8")) as { version?: string };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(
      `[stage-payload] root package.json at ${rootPkg} has no usable "version" to derive the @shared/* tarball names from`,
    );
  }
  return parsed.version;
}

interface CliOptions {
  build: boolean;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const noBuild = argv.includes("--no-build") || process.env.STAGE_PAYLOAD_NO_BUILD === "1";
  const dryRun = argv.includes("--dry-run");
  return { build: !noBuild && !dryRun, dryRun };
}

function buildAllTools(): void {
  console.log("[stage-payload] Building all 16 tools via root `npm run build`…");
  execSync("npm run build", {
    cwd: repoRootOf(),
    stdio: "inherit",
  });
}

/**
 * Copy every staged tool's `dist` tree into a fresh staging root.
 *
 * The staging root is cleared first so a stale payload from a previous build
 * never leaks into the installer. Each tool is copied to
 * `payload/<serverName>/` (via the shared `stagingDestDirName` seam mirror) so
 * install-time verification can key off server name, and so the leading dir of
 * the copied tree matches the bridge-config seam `installedEntryRelpath`.
 *
 * Lean_Payload (installer-runtime-provisioning Req 2.4): ONLY the nine
 * `payload/<serverName>/` trees are staged — no `node_modules` sibling and no
 * other top-level content. The `assertLeanPayload` guard below enforces this.
 */
export function stagePayload(repoRootDir: string, stagingRoot: string): void {
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(stagingRoot, { recursive: true });

  for (const tool of CANONICAL_TOOL_PAYLOADS) {
    const src = resolve(repoRootDir, tool.distRoot);
    // Destination dir name comes from the shared seam mirror
    // (`stagingDestDirName`), which is the SAME leading dir the bridge-config
    // seam (`installedEntryRelpath`) uses — so the staged layout and the
    // generated `args[0]` cannot drift.
    const destDirName = stagingDestDirName(tool);
    const dest = resolve(stagingRoot, destDirName);
    cpSync(src, dest, { recursive: true });
    console.log(
      `[stage-payload]   staged ${tool.serverName}  (${tool.distRoot} -> payload/${destDirName})`,
    );
  }
}

/**
 * Stage the build-time-generated flat production `package.json` +
 * `package-lock.json` into the payload ROOT (Option B2, task 3.4).
 *
 * Bugfix: runtimes-npm-install-nonzero-exit — Requirements 2.1, 3.6.
 *
 * WHY THE PAYLOAD ROOT (not a subdir):
 *   The Runtimes step runs `npm install --omit=dev --ignore-scripts …` with
 *   `cwd = install_dir`, and npm resolves its manifest in the current
 *   directory. The payload root is the level that maps to `install_dir`
 *   (`tauri.conf.json` `bundle.resources` bundles `payload/` beside the exe,
 *   and the copy step lands each tool's tree under `install_dir/<serverName>/`
 *   — so the payload root corresponds to `install_dir` itself). Staging the
 *   manifest at the payload root therefore places it at `install_dir/package.json`
 *   where npm's `cwd = install_dir` reads it. A `runtime-manifest/` subdir would
 *   land at `install_dir/runtime-manifest/` where npm would never read it.
 *
 * The generator (`generate-production-manifest.ts`, task 3.3) is the single
 * source of truth. Its default output dir is `payload/runtime-manifest/`, which
 * `stagePayload` clears with the rest of the payload; so we (re)generate into a
 * location OUTSIDE the freshly-cleared staging root, then copy the two flat
 * files to the payload root. This NEVER generates or copies a `node_modules`.
 */
export function stageRuntimeManifest(installerRootDir: string, stagingRoot: string): void {
  // Generate into `<installerRoot>/src-tauri/runtime-manifest/` — a sibling of
  // the payload staging root, so `stagePayload`'s `rmSync(stagingRoot)` never
  // wipes the generator output we are about to copy from.
  const generateOutDir = resolve(installerRootDir, "src-tauri", "runtime-manifest");

  // Anchor the generator on an EXPLICIT repo root (the parent of `Installer/`)
  // rather than letting `generateProductionManifest` fall back to its
  // `process.argv[1]`-derived `repoRootOf()`. The argv[1] fallback is only
  // correct when this module is the invoked CLI; under a jest run (where
  // `argv[1]` is the test runner inside `node_modules`) it resolves to the
  // wrong tree and `locateOrPackSharedTarballs` would `npm pack` a nonexistent
  // `node_modules/shared` (ENOENT). Passing an explicit `repoRoot` is strictly
  // more correct than the fallback for every caller, CLI or test.
  const repoRootDir = resolve(installerRootDir, "..");
  const { packageJsonPath, packageLockPath } = generateProductionManifest({
    repoRoot: repoRootDir,
    outDir: generateOutDir,
    writeLockfile: true,
  });

  for (const [srcPath, fileName] of [
    [packageJsonPath, "package.json"],
    [packageLockPath, "package-lock.json"],
  ] as const) {
    if (!existsSync(srcPath)) {
      throw new Error(
        `[stage-payload] expected generated ${fileName} at ${srcPath}, but it was not produced`,
      );
    }
    const dest = resolve(stagingRoot, fileName);
    copyFileSync(srcPath, dest);
    console.log(`[stage-payload]   staged runtime ${fileName}  (-> payload/${fileName})`);
  }

  // Stage the closure `file:` tarballs beside the flat manifest at the payload
  // ROOT so the Runtimes step's `npm install --omit=dev` (cwd = install_dir)
  // can resolve the `file:./<stem>-<version>.tgz` specifiers the generated
  // manifest/lockfile declare (bugfix: mcp-shared-module-resolution-fix). The
  // tarballs are already staged beside the just-generated artifacts when a full
  // `stageSharedTarballs` run has placed them; otherwise `locateOrPackSharedTarballs`
  // packs them on demand. In BOTH cases the tarball is NORMALIZED — its nested
  // workspace-internal specifiers (`@shared/types: file:../shared`,
  // `llm-toolkit-observability: *`) rewritten to `*` so npm binds them to the
  // sibling top-level `file:` entries (task 8.3, option b). Without the tarballs
  // present at the payload root, the install resolves no `file:` target; without
  // the normalization, npm produces a damaged lockfile from the nested
  // relative-path specifiers. NEVER a `node_modules` — only sanctioned flat
  // tarball files, which `assertLeanPayload` accepts and the secret guard scans.
  const repoRootForTarballs = resolve(installerRootDir, "..");
  const version = resolveRootVersion(repoRootForTarballs);
  const { paths: tarballPaths, cleanup } = locateOrPackSharedTarballs(
    repoRootForTarballs,
    version,
    stagingRoot,
  );
  try {
    for (const src of tarballPaths) {
      const dest = resolve(stagingRoot, basename(src));
      if (resolve(src) !== dest) {
        copyFileSync(src, dest);
      }
      console.log(
        `[stage-payload]   staged runtime tarball ${basename(src)}  (-> payload/${basename(src)})`,
      );
    }
  } finally {
    cleanup();
  }
}

/**
 * Pack both `@shared/*` packages into versioned tarballs and stage them as
 * sanctioned flat files at the payload ROOT (Option B, task 3.2;
 * bugfix: mcp-shared-module-resolution-fix; Req 2.1, 2.2, 3.2, 3.4).
 *
 * WHY THE PAYLOAD ROOT (not a subdir):
 *   The payload root maps to `install_dir`, and the generator (task 3.3) emits
 *   `"@shared/types": "file:./shared-types-<v>.tgz"` /
 *   `"@shared/config": "file:./shared-config-<v>.tgz"` relative to that root. The
 *   Runtimes step runs `npm install --omit=dev …` with `cwd = install_dir`, so
 *   the tarballs must sit beside the flat `package.json` for npm to resolve the
 *   `file:` specifiers and materialize `install_dir/node_modules/@shared/*`.
 *
 * WHY A SIBLING TEMP DIR (mirrors `stageRuntimeManifest`):
 *   `npm pack --pack-destination` writes each `.tgz` into
 *   `<installerRoot>/src-tauri/shared-tarballs/` — a SIBLING of the payload
 *   staging root — so `stagePayload`'s `rmSync(stagingRoot)` never wipes a
 *   tarball we are about to copy from. We then copy the two tarballs to the
 *   payload root with VERSION-DERIVED names (`sharedTarballFileName`), so the
 *   staged names track the root version with no hardcoded drift.
 *
 * `npm pack` names its output from the package's own `name`+`version`
 * (e.g. `shared-types-5.4.3.tgz` for the `shared-types` package); we locate the
 * freshly-produced tarball in the pack-destination dir rather than guessing the
 * exact npm filename, then copy it to the canonical sanctioned name. This NEVER
 * stages a `node_modules` — only the two sanctioned flat tarball files.
 *
 * Call AFTER `assertSharedDistsPresentOrExit` (the loud pre-pack dist guard) so
 * both `@shared/*` `dist` trees are known to exist before packing.
 *
 * @returns the staged tarball filenames (version-derived), in spec order.
 */
export function stageSharedTarballs(
  installerRootDir: string,
  repoRootDir: string,
  stagingRoot: string,
): string[] {
  const version = resolveRootVersion(repoRootDir);

  // A sibling of the payload staging root, so `rmSync(stagingRoot)` can never
  // wipe the tarballs we are about to copy from (mirrors stageRuntimeManifest's
  // sibling `runtime-manifest/` dir).
  const packDestDir = resolve(installerRootDir, "src-tauri", "shared-tarballs");
  rmSync(packDestDir, { recursive: true, force: true });
  mkdirSync(packDestDir, { recursive: true });

  const stagedNames: string[] = [];

  for (const spec of SHARED_TARBALL_SPECS) {
    const packageDir = resolve(repoRootDir, spec.packageDir);

    // Record the dir contents before packing so we can identify the new .tgz
    // regardless of the exact name npm derives from the package name+version.
    const before = new Set(existsSync(packDestDir) ? readdirSync(packDestDir) : []);

    // `npm pack <packageDir> --pack-destination <dir>` builds the tarball from
    // the package's own manifest (its prebuilt `dist/` is already present) and
    // writes it into the sibling temp dir. `--ignore-scripts` keeps packing
    // side-effect-free (no prepack/postpack hooks run).
    execSync(
      `npm pack "${packageDir}" --pack-destination "${packDestDir}" --ignore-scripts --silent`,
      { cwd: repoRootDir, stdio: ["ignore", "pipe", "inherit"] },
    );

    const produced = readdirSync(packDestDir).filter(
      (name) => name.endsWith(".tgz") && !before.has(name),
    );
    if (produced.length !== 1) {
      throw new Error(
        `[stage-payload] expected exactly one new tarball from \`npm pack ${spec.packageDir}\`, found ${produced.length}: [${produced.join(", ")}]`,
      );
    }

    // Copy to the canonical, VERSION-DERIVED sanctioned name at the payload root.
    const stagedName = sharedTarballFileName(spec.stem, version);
    const src = resolve(packDestDir, produced[0]);
    const dest = resolve(stagingRoot, stagedName);
    copyFileSync(src, dest);

    // Normalize the staged tarball's `package.json` so its NESTED
    // workspace-internal specifiers (`@shared/types: file:../shared`,
    // `llm-toolkit-observability: *`) bind to the sibling TOP-LEVEL `file:`
    // tarballs at install time (bugfix: mcp-shared-module-resolution-fix,
    // task 8.3, option b). Without this, `npm install` in `install_dir` tries
    // to resolve `file:../shared` as a relative path that does not exist in the
    // install layout, producing a damaged lockfile. The `dist/` and every other
    // shipped file stay byte-identical; only the manifest's specifiers change.
    normalizeSharedTarball(
      (p) => readFileSync(p),
      (p, data) => writeFileSync(p, data),
      dest,
      CLOSURE_PACKAGE_NAMES,
    );

    stagedNames.push(stagedName);
    console.log(
      `[stage-payload]   staged shared tarball ${produced[0]}  (-> payload/${stagedName}, nested specifiers normalized)`,
    );
  }

  return stagedNames;
}

/** A single lean-payload violation, named for the abort report. */
export interface LeanPayloadViolation {
  /** The class of violation: an unexpected top-level entry, a `node_modules`
   * path segment anywhere in the tree, or the combined-size budget. */
  kind: "unexpected-top-level" | "node-modules" | "oversize";
  /** A human-readable detail: the offending path, or the observed size. */
  detail: string;
}

/** 500 MB combined-size budget for the staged payload (Req 2.6), in bytes. */
export const MAX_STAGED_PAYLOAD_BYTES = 500 * 1024 * 1024;

/**
 * Recursively sum the byte size of every regular file under `dir`, while
 * collecting any path segment equal to `node_modules` as a violation
 * (installer-runtime-provisioning Req 2.2/2.3). Directories are walked; symlinks
 * and other non-regular entries contribute zero bytes.
 */
function walkTree(dir: string, violations: LeanPayloadViolation[]): number {
  let total = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const full = resolve(dir, name);
    if (name === "node_modules") {
      violations.push({ kind: "node-modules", detail: full });
    }
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      total += walkTree(full, violations);
    } else if (st.isFile()) {
      total += st.size;
    }
  }
  return total;
}

/**
 * Assert the freshly staged tree is a Lean_Payload
 * (installer-runtime-provisioning Req 2). Pure w.r.t. its arguments (reads the
 * filesystem under `stagingRoot`, returns violations rather than exiting) so a
 * test can drive it directly:
 *
 *   - Req 2.1/2.7: the set of top-level entries equals EXACTLY the nine
 *     canonical server names PLUS the sanctioned flat runtime-manifest files
 *     (`package.json`, `package-lock.json` — task 3.4). Any other entry (e.g. a
 *     stray `node_modules`) is a violation naming it. The sanctioned files are
 *     accepted ONLY as regular files — a `package.json` DIRECTORY, or any other
 *     directory tree at the top level, is still an unexpected-top-level
 *     violation, so no tree (and never a `node_modules`) can slip in under a
 *     sanctioned name.
 *   - Req 2.2/2.3: no path segment equals `node_modules` anywhere in the tree.
 *   - Req 2.6: the combined size of all staged files is ≤ 500 MB.
 *
 * @returns the (possibly empty) list of violations; empty == a lean payload.
 */
export function assertLeanPayload(stagingRootDir: string): LeanPayloadViolation[] {
  const violations: LeanPayloadViolation[] = [];

  // The nine canonical tool dirs plus the sanctioned flat runtime-manifest
  // files are the only permitted top-level entries (Req 3.6 intent unchanged:
  // the sanctioned entries are FILES, not trees, and never a `node_modules`).
  const expectedDirs = new Set(CANONICAL_TOOL_PAYLOADS.map((t) => stagingDestDirName(t)));
  const sanctionedFiles = new Set<string>(SANCTIONED_PAYLOAD_ROOT_FILES);

  let topLevel: string[] = [];
  try {
    topLevel = readdirSync(stagingRootDir);
  } catch {
    topLevel = [];
  }
  for (const entry of topLevel) {
    // A sanctioned flat file is permitted ONLY when it is a regular file. If a
    // directory shares a sanctioned name (e.g. a `package.json/` tree), it is
    // NOT sanctioned and falls through to the unexpected-top-level check — so a
    // tree can never masquerade as an allowed flat file.
    if (sanctionedFiles.has(entry)) {
      let isRegularFile = false;
      try {
        isRegularFile = statSync(resolve(stagingRootDir, entry)).isFile();
      } catch {
        isRegularFile = false;
      }
      if (isRegularFile) {
        continue;
      }
    }
    if (!expectedDirs.has(entry)) {
      violations.push({
        kind: "unexpected-top-level",
        detail: resolve(stagingRootDir, entry),
      });
    }
  }

  // Recursively walk for `node_modules` at any depth AND sum the combined size.
  const totalBytes = walkTree(stagingRootDir, violations);
  if (totalBytes > MAX_STAGED_PAYLOAD_BYTES) {
    violations.push({
      kind: "oversize",
      detail: `${totalBytes} bytes (limit ${MAX_STAGED_PAYLOAD_BYTES} bytes / 500 MB)`,
    });
  }

  return violations;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.build) {
    buildAllTools();
  } else {
    console.log(
      "[stage-payload] Skipping tool build (--no-build/--dry-run); staging existing dist/ trees.",
    );
  }

  const repoRoot = repoRootOf();
  const stagingRootDir = stagingRoot();

  // Pre-pack guard (bugfix: mcp-shared-module-resolution-fix, design → Fix →
  // Changes Required step 1; Req 2.1, 2.2): the Option B tarball pack step
  // (task 3.2) depends on both `@shared/*` `dist` trees existing. Fail loudly —
  // naming each missing package — before anything is staged, mirroring the
  // nine-tool dist-completeness abort below. The root `npm run build`
  // (`build:shared`) above produces these unless `--no-build`/`--dry-run`.
  assertSharedDistsPresentOrExit(repoRoot);

  // Pre-pack guard (follow-up 5.4.4): the generalized Option B tarball pack step
  // (task 8.2) additionally depends on all five `llm-toolkit-*` `dist` trees
  // existing. Fail loudly — naming each missing package — before anything is
  // staged, mirroring the `@shared/*` gate above and the nine-tool
  // dist-completeness abort below. The root `npm run build` above produces these
  // unless `--no-build`/`--dry-run`.
  assertLlmToolkitDistsPresentOrExit(repoRoot);

  const presence = observeAllPresence(repoRoot);
  const plan = planPayloadStaging(presence);

  if (!isStagingComplete(plan)) {
    // The build must abort and NAME every required staging entry that is
    // absent/empty — the nine tool dist trees (Req 3.3). `stagingBlockers`
    // returns exactly that set.
    const blockers = stagingBlockers(plan);
    console.error(
      `[stage-payload] ABORT — ${blockers.length} required tool dist tree(s) are missing or empty:`,
    );
    for (const name of blockers) {
      const tool = CANONICAL_TOOL_PAYLOADS.find((t) => t.serverName === name);
      console.error(`[stage-payload]   - ${name}  (${tool?.distRoot ?? "?"})`);
    }
    console.error(
      "[stage-payload] Build the tools first (root `npm run build`) so every dist/ exists and is non-empty. No payload was staged.",
    );
    process.exit(1);
  }

  console.log(`[stage-payload] All ${plan.present.length} tool dist trees present and non-empty.`);

  if (opts.dryRun) {
    console.log("[stage-payload] --dry-run: not staging. Would stage into:");
    console.log(`[stage-payload]   ${stagingRootDir}`);
    process.exit(0);
  }

  stagePayload(repoRoot, stagingRootDir);

  // Stage the flat production manifest + lockfile into the payload ROOT so they
  // land at `install_dir` where the Runtimes step's `npm install --omit=dev`
  // runs (Option B2, task 3.4). NEVER a `node_modules` — only the two
  // sanctioned flat files. The `assertLeanPayload` guard below still rejects any
  // `node_modules` at any depth and any other unexpected top-level entry.
  stageRuntimeManifest(installerRootOf(), stagingRootDir);

  // Pack both `@shared/*` packages into versioned tarballs and stage them as
  // sanctioned flat files at the payload root (bugfix:
  // mcp-shared-module-resolution-fix, Option B, task 3.2; Req 2.1, 2.2). The
  // tarball names are VERSION-DERIVED from the root package.json so they follow
  // the repo-wide version bump with no drift, and the generator's `file:`
  // specifiers (task 3.3) reference these exact staged names. NEVER a
  // `node_modules` — only the two sanctioned flat tarball files; the
  // `assertLeanPayload` guard below still rejects any `node_modules` at any
  // depth and any unexpected top-level entry.
  stageSharedTarballs(installerRootOf(), repoRoot, stagingRootDir);

  // Lean_Payload guard (installer-runtime-provisioning Req 2.1, 2.2, 2.3, 2.6,
  // 2.7): the staged tree must be exactly the nine canonical server dirs, carry
  // no `node_modules` at any depth, and total ≤ 500 MB. ABORT (non-zero) naming
  // each violation — this catches a stray `node_modules` re-introduction or any
  // other unexpected top-level content — mirroring the completeness-abort above.
  const leanViolations = assertLeanPayload(stagingRootDir);
  if (leanViolations.length > 0) {
    console.error(
      `[stage-payload] ABORT — the staged payload is not lean; ${leanViolations.length} violation(s):`,
    );
    for (const v of leanViolations) {
      if (v.kind === "unexpected-top-level") {
        console.error(
          `[stage-payload]   - unexpected top-level entry: ${basename(v.detail)}  (${v.detail}); only the nine canonical server dirs may be staged`,
        );
      } else if (v.kind === "node-modules") {
        console.error(
          `[stage-payload]   - node_modules present at: ${v.detail}; the Lean_Payload must contain no node_modules at any depth`,
        );
      } else {
        console.error(`[stage-payload]   - staged payload exceeds the size budget: ${v.detail}`);
      }
    }
    console.error(
      "[stage-payload] Restage a lean payload (only the nine plugin dist/ trees, no node_modules) under the size budget. The staged payload has been left in place for inspection.",
    );
    process.exit(1);
  }

  // Concern 2 (task 3.5): enforce "no secret embedded" as a build invariant.
  // Scan the freshly staged payload and ABORT (non-zero) if any non-empty,
  // non-placeholder secret-bearing value is present, naming each offending
  // file — mirroring the completeness-abort pattern above.
  const findings = scanPayloadForSecrets(stagingRootDir);
  if (findings.length > 0) {
    console.error(
      `[stage-payload] ABORT — ${findings.length} secret-bearing value(s) found in the staged payload; no payload may ship with an embedded secret:`,
    );
    for (const finding of findings) {
      console.error(`[stage-payload]   - ${finding.file}  (key: ${finding.key})`);
    }
    console.error(
      "[stage-payload] Remove the secret from source/config so it is sourced from user config / .env at install time only, then rebuild. The staged payload has been left in place for inspection.",
    );
    process.exit(1);
  }

  console.log(
    `[stage-payload] OK — staged ${plan.present.length} tool dist trees into ${stagingRootDir} (lean payload, no embedded secrets)`,
  );
  process.exit(0);
}

// Only run when invoked directly (not when imported by tests). When required
// under the CommonJS test transform the invoked script is jest, not this file,
// so `runningAsMain()` is false and nothing executes on import.
if (runningAsMain()) {
  main();
}
