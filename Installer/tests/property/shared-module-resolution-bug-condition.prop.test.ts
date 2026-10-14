/**
 * Bugfix: mcp-shared-module-resolution-fix
 * Property 1 (Bug Condition — Installed servers cannot resolve `@shared/*`).
 *
 * This is the EXPLORATORY bug-condition test for the bugfix workflow. It
 * encodes the EXPECTED (fixed) behavior and is therefore expected to FAIL on
 * the UNFIXED build — the failure IS the success criterion for task 1: it
 * surfaces the counterexamples that confirm the two root-cause prongs and the
 * resulting install-layout runtime crash.
 *
 * Root cause (both prongs, confirmed in design.md):
 *   Prong 1 — `@shared/types` is DROPPED by the manifest generator:
 *     `isWorkspaceInternalName("@shared/types")` is true, so
 *     `computeFlatManifest` routes it to `resolveInternalByName`, which
 *     drops-and-hoists it. It has no registry deps to hoist, so it vanishes.
 *   Prong 2 — `@shared/config` is INVISIBLE to the generator: no tool
 *     `package.json` declares it (servers import it purely via workspace
 *     hoisting in dev), so it never enters the dependency union.
 *   Result — the install-time `npm install --omit=dev` never materializes
 *     `install_dir/node_modules/@shared/{config,types}`, and every server that
 *     requires them at runtime throws `MODULE_NOT_FOUND` and exits before
 *     serving any request (surfaced by the LM Studio bridge as
 *     `MCP error -32000: Connection closed`).
 *
 * Scoped PBT approach: the bug is deterministic, so the property is scoped to
 * the concrete failing cases — the affected servers crossed with their required
 * `@shared/*` packages (`isBugCondition(input)` is true for exactly these).
 *
 * Test cases (per design → Exploratory Bug Condition Checking and task 1):
 *   A — generator drop/invisibility (prongs 1 & 2): the real
 *       `computeFlatManifest` output `dependencies` must contain BOTH
 *       `@shared/types` and `@shared/config`. UNFIXED → absent → FAILS.
 *   B — install-layout resolution (Req 1.2): stage the current payload, run
 *       `npm install --omit=dev …` into a temp `install_dir`, and
 *       `install_dir/node_modules/@shared/{config,types}` must be PRESENT.
 *       UNFIXED → absent → FAILS.
 *   C — server startup (Req 1.3–1.9): from the installed layout, loading each
 *       affected server's entry must NOT throw `Cannot find module '@shared/…'`.
 *       UNFIXED → throws `MODULE_NOT_FOUND` → FAILS.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import {
  computeFlatManifest,
  defaultManifestReader,
} from "../../scripts/generate-production-manifest";
import { CANONICAL_TOOL_PAYLOADS, installedEntryFilename } from "../../scripts/payload-manifest";
import { stagePayload, stageRuntimeManifest } from "../../scripts/stage-payload";

const FEATURE_TAG = "[mcp-shared-module-resolution-fix] Property 1: Bug Condition";

/** `Installer/` root, from this test file's location (`Installer/tests/property`). */
const installerRoot = path.resolve(__dirname, "..", "..");
/** Repository root: one level up from `Installer/`. */
const repoRoot = path.resolve(installerRoot, "..");

// ─── The scoped bug-condition domain (design → Bug Details → Bug Condition) ──
//
// Each affected server, its staged entry file (relative to the installed
// layout, i.e. `install_dir/<serverName>/…`), the source `dist` root to copy
// from, and the `@shared/*` packages its shipped JS requires at runtime.

interface AffectedServer {
  serverName: string;
  /** Source dist root (repo-root-relative) staged to `install_dir/<serverName>/`. */
  distRoot: string;
  /** Entry file to load, relative to `install_dir/<serverName>/`. */
  installedEntryRelFile: string;
  /** The `@shared/*` packages this server requires at runtime. */
  requiredSharedPkgs: string[];
  /** The requirement this startup case validates. */
  requirement: string;
}

/**
 * The affected servers crossed with their required `@shared/*` packages.
 * `isBugCondition(input)` returns true for exactly these (non-empty
 * `requiredSharedPkgs`, started from the installed layout).
 */
const AFFECTED_SERVERS: readonly AffectedServer[] = [
  {
    serverName: "common",
    distRoot: "mcp/common/dist",
    installedEntryRelFile: "mcp-server.js",
    requiredSharedPkgs: ["@shared/types"],
    requirement: "1.3",
  },
  {
    serverName: "blender-bridge",
    distRoot: "BlenderBridge/dist",
    installedEntryRelFile: "config.js",
    requiredSharedPkgs: ["@shared/config"],
    requirement: "1.4",
  },
  {
    serverName: "lan-sub-agent",
    distRoot: "LanSubAgent/dist/LanSubAgent/src",
    installedEntryRelFile: "mcp-server.js",
    requiredSharedPkgs: ["@shared/config"],
    requirement: "1.5",
  },
  {
    serverName: "terminal",
    distRoot: "Terminal/dist",
    installedEntryRelFile: "mcp-server.js",
    requiredSharedPkgs: ["@shared/config"],
    requirement: "1.6",
  },
  {
    serverName: "web-browser",
    distRoot: "WebBrowser/dist",
    installedEntryRelFile: "mcp-server.js",
    requiredSharedPkgs: ["@shared/config"],
    requirement: "1.7",
  },
  {
    serverName: "python-shell",
    distRoot: "PythonShell/dist",
    installedEntryRelFile: "python-shell.js",
    requiredSharedPkgs: ["@shared/config"],
    requirement: "1.8",
  },
  {
    serverName: "skills",
    distRoot: "Skills/dist",
    installedEntryRelFile: "skills.js",
    requiredSharedPkgs: ["@shared/types"],
    requirement: "1.9",
  },
] as const;

/** The two unpublished workspace-internal packages at the heart of the bug. */
const SHARED_PKGS = ["@shared/config", "@shared/types"] as const;

/**
 * The scoped predicate from the design: an installed server startup is a bug
 * condition when it imports at least one `@shared/*` package from the installed
 * layout. Deterministic for the affected set.
 */
function isBugCondition(input: AffectedServer): boolean {
  return input.requiredSharedPkgs.length > 0;
}

// ─── npm/network gate (mirrors lean-payload-runtime-manifest.integration) ────

/** True iff a usable `npm` is on PATH (for the install-layout legs B & C). */
function npmAvailable(): boolean {
  for (const bin of ["npm.cmd", "npm"]) {
    try {
      execFileSync(bin, ["--version"], {
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      return true;
    } catch {
      /* try the next candidate */
    }
  }
  return false;
}

/**
 * Seed a minimal non-empty `dist` tree for ALL nine canonical tool payloads so
 * `stagePayload` (which copies every canonical `distRoot`) succeeds. The affected
 * servers' REAL dist is copied into the installed layout separately in test C;
 * this only needs each `distRoot` to exist and be non-empty.
 */
function seedAllDistTrees(seededRepoRoot: string): void {
  for (const tool of CANONICAL_TOOL_PAYLOADS) {
    const src = path.resolve(seededRepoRoot, tool.distRoot);
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, installedEntryFilename(tool.serverName)), "// entry\n");
  }
}

/**
 * Stage the current (unfixed) flat production manifest + lockfile into a temp
 * `install_dir`, then run `npm install --omit=dev …` there. Returns the
 * `install_dir` path (caller cleans up).
 */
function stageAndInstall(): string {
  const seededRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shared-mod-repo-"));
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-mod-install-"));
  try {
    seedAllDistTrees(seededRepoRoot);
    // Stage the affected server dirs so the payload root exists, then stage the
    // REAL generated flat manifest/lockfile (which, unfixed, omits `@shared/*`).
    stagePayload(seededRepoRoot, installDir);
    stageRuntimeManifest(installerRoot, installDir);

    execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: installDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  } finally {
    fs.rmSync(seededRepoRoot, { recursive: true, force: true });
  }
  return installDir;
}

/** True iff `install_dir/node_modules/<pkg>` resolves as a package dir. */
function sharedPkgInstalled(installDir: string, pkg: string): boolean {
  const pkgDir = path.join(installDir, "node_modules", ...pkg.split("/"));
  return fs.existsSync(path.join(pkgDir, "package.json"));
}

/**
 * Try to load an installed server entry in a child Node process (so a hard
 * `MODULE_NOT_FOUND` crash is observable without killing the test runner).
 * Copies the REAL server dist into `install_dir/<serverName>/` first.
 *
 * @returns `{ ok: true }` if the entry loaded, or `{ ok: false, error }` with
 *   the captured stderr/message when it threw (e.g. a missing-module crash).
 */
function tryLoadInstalledServer(
  installDir: string,
  srv: AffectedServer,
): { ok: true } | { ok: false; error: string } {
  // Place the REAL compiled server tree at the installed layout path so its
  // bare `require("@shared/…")` calls resolve (or fail) exactly as in prod.
  const srcDist = path.resolve(repoRoot, srv.distRoot);
  const destDir = path.join(installDir, srv.serverName);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(srcDist, destDir, { recursive: true });

  const entry = path.join(destDir, srv.installedEntryRelFile).replace(/\\/g, "\\\\");
  try {
    // `require` (not import) + a non-serving load: we only need module
    // resolution to run. stdio piped so a crash's stderr is captured.
    execFileSync(process.execPath, ["-e", `require("${entry}")`], {
      cwd: destDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? "");
    return { ok: false, error: `${stderr}\n${e.message ?? ""}` };
  }
}

/** True iff an error text is a `@shared/*` missing-module crash. */
function isSharedModuleNotFound(errorText: string): boolean {
  return (
    /Cannot find module '@shared\//.test(errorText) ||
    (/MODULE_NOT_FOUND/.test(errorText) && /@shared\//.test(errorText))
  );
}

describe(`${FEATURE_TAG} — installed servers must resolve @shared/*`, () => {
  // ── Test case A: generator drop/invisibility (prongs 1 & 2) ───────────────
  //
  // Pure: runs the real generator against the real manifests. Expected (fixed)
  // behavior is that BOTH `@shared/*` names appear in the flat manifest. On the
  // unfixed build they are absent, so this FAILS — surfacing the counterexample
  // that confirms prong 1 (drop) and prong 2 (invisibility).
  it("A: computeFlatManifest emits BOTH @shared/config and @shared/types (prongs 1 & 2)", () => {
    const gen = computeFlatManifest(defaultManifestReader(repoRoot), {
      name: "llm-toolkit-runtime",
      version: "0.0.0",
    });
    const deps = gen.manifest.dependencies;

    // Counterexample report when this fails on the unfixed build.
    const missing = SHARED_PKGS.filter((pkg) => !Object.hasOwn(deps, pkg));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `${FEATURE_TAG} [A] COUNTEREXAMPLE — flat manifest omits ${missing.join(
          ", ",
        )}. Prong 1: @shared/types dropped by isWorkspaceInternalName; Prong 2: @shared/config never entered the dependency union.`,
      );
    }

    // Expected (fixed) behavior — FAILS on unfixed code (both are absent).
    for (const pkg of SHARED_PKGS) {
      expect(Object.hasOwn(deps, pkg)).toBe(true);
    }
  });

  // ── Test case B: install-layout resolution (Req 1.2) ──────────────────────
  //
  // npm-gated. Stage the current payload, `npm install --omit=dev` into a temp
  // install_dir, and assert `node_modules/@shared/{config,types}` are PRESENT.
  // On the unfixed build they are ABSENT, so this FAILS.
  const maybeInstall = npmAvailable() ? it : it.skip;
  maybeInstall(
    "B: npm install --omit=dev materializes node_modules/@shared/{config,types} (Req 1.2)",
    () => {
      const installDir = stageAndInstall();
      try {
        const absent = SHARED_PKGS.filter((pkg) => !sharedPkgInstalled(installDir, pkg));
        if (absent.length > 0) {
          // eslint-disable-next-line no-console
          console.error(
            `${FEATURE_TAG} [B] COUNTEREXAMPLE — after npm install, install_dir/node_modules/${absent
              .map((p) => p)
              .join(
                " and ",
              )} ABSENT; the flat manifest dropped the workspace-internal @shared/* packages.`,
          );
        }
        // Expected (fixed) behavior — FAILS on unfixed code (both absent).
        for (const pkg of SHARED_PKGS) {
          expect(sharedPkgInstalled(installDir, pkg)).toBe(true);
        }
      } finally {
        fs.rmSync(installDir, { recursive: true, force: true });
      }
    },
    300_000,
  );

  // ── Test case C: server startup (Req 1.3–1.9) ─────────────────────────────
  //
  // npm-gated. From the installed layout, loading each affected server's entry
  // must NOT crash with a `@shared/*` missing-module error. On the unfixed
  // build every affected server throws MODULE_NOT_FOUND, so this FAILS.
  maybeInstall(
    "C: each affected server loads from the installed layout without a @shared/* MODULE_NOT_FOUND (Req 1.3–1.9)",
    () => {
      const installDir = stageAndInstall();
      try {
        fc.assert(
          fc.property(fc.constantFrom(...AFFECTED_SERVERS), (srv) => {
            // Scope guard: only the bug-condition inputs are exercised.
            expect(isBugCondition(srv)).toBe(true);

            const result = tryLoadInstalledServer(installDir, srv);
            if (!result.ok && isSharedModuleNotFound(result.error)) {
              // eslint-disable-next-line no-console
              console.error(
                `${FEATURE_TAG} [C] COUNTEREXAMPLE — server '${srv.serverName}' (Req ${srv.requirement}) threw MODULE_NOT_FOUND for ${srv.requiredSharedPkgs.join(
                  ", ",
                )} from the installed layout.`,
              );
            }

            // Expected (fixed) behavior: NO @shared/* missing-module crash.
            // FAILS on unfixed code (the require throws MODULE_NOT_FOUND).
            const crashedOnShared = !result.ok && isSharedModuleNotFound(result.error);
            expect(crashedOnShared).toBe(false);
          }),
          { numRuns: AFFECTED_SERVERS.length },
        );
      } finally {
        fs.rmSync(installDir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Follow-up (5.4.4): `llm-toolkit-*` bug condition exploration (task 6).
//
// Bugfix: mcp-shared-module-resolution-fix — Property 4 (Bug Condition —
// Installed servers cannot resolve `llm-toolkit-*`).
//
// Same exploratory structure as the `@shared/*` cases above, generalized to the
// five workspace-internal `llm-toolkit-*` packages the 5.4.3 generator STILL
// drops. These tests encode the EXPECTED (fixed) behavior and are therefore
// expected to FAIL on the current 5.4.3 build — the failure IS the success
// criterion for task 6: it surfaces the counterexamples confirming the generator
// drop and the resulting install-layout runtime crash of `common` +
// `lan-sub-agent`.
//
// Root cause (confirmed in design.md → Follow-up): every `llm-toolkit-*` name is
// matched by `isWorkspaceInternalName` (which returns true for
// `name.startsWith("llm-toolkit-")`), so `computeFlatManifest` routes it to the
// drop-and-hoist path with NO `file:` override — unlike the two `@shared/*`
// names the 5.4.3 fix special-cased. The five packages therefore never enter the
// flat `dependencies`, the install-time `npm install --omit=dev` never
// materializes `install_dir/node_modules/llm-toolkit-*`, and `common` +
// `lan-sub-agent` throw `MODULE_NOT_FOUND` (incl. the deep `/dist/*` subpaths)
// before serving any request.
//
// Scoped PBT approach: the bug is deterministic, so the property is scoped to the
// concrete failing cases — the consumers `{common, lan-sub-agent}` crossed with
// their required `llm-toolkit-*` packages (incl. deep subpaths) and the
// transitive closure (`isLlmToolkitBugCondition(input)` is true for exactly
// these).
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6

const LLM_FEATURE_TAG =
  "[mcp-shared-module-resolution-fix] Property 4: Bug Condition (llm-toolkit-*)";

/**
 * The five workspace-internal `llm-toolkit-*` packages in the transitive
 * closure the follow-up fix must provision. These are the bare top-level
 * package names that must appear in the flat manifest's `dependencies` and
 * materialize as `install_dir/node_modules/<name>` after install.
 */
const LLM_TOOLKIT_PKGS = [
  "llm-toolkit-ask-user",
  "llm-toolkit-calculator",
  "llm-toolkit-clock",
  "llm-toolkit-document-scraper",
  "llm-toolkit-observability",
] as const;

/**
 * A consumer server whose shipped JS requires one or more `llm-toolkit-*`
 * packages (incl. deep `/dist/*` subpaths) at load time from the installed
 * layout.
 */
interface LlmToolkitConsumer {
  serverName: string;
  /** Source dist root (repo-root-relative) staged to `install_dir/<serverName>/`. */
  distRoot: string;
  /** Entry file to load, relative to `install_dir/<serverName>/`. */
  installedEntryRelFile: string;
  /**
   * The `llm-toolkit-*` module specifiers this server's shipped JS requires at
   * load time — the exact strings that appear in `require(...)`, including the
   * deep `/dist/*` subpaths. Any of these failing to resolve is the bug.
   */
  requiredLlmToolkitSpecifiers: string[];
  /** The top-level `llm-toolkit-*` package names behind those specifiers. */
  requiredLlmToolkitPkgs: string[];
  /** The requirement this startup case validates. */
  requirement: string;
}

/**
 * The two consumers crossed with their required `llm-toolkit-*` packages:
 *   - `common/mcp-server.js` synchronously requires `./tools/{ask-user,
 *     calculator,clock,document-scraper}`, each of which requires a deep
 *     `llm-toolkit-<pkg>/dist/<entry>` subpath.
 *   - `lan-sub-agent/mcp-server.js` requires `./logger`, which requires
 *     `llm-toolkit-observability`.
 * `isLlmToolkitBugCondition(input)` returns true for exactly these.
 */
const LLM_TOOLKIT_CONSUMERS: readonly LlmToolkitConsumer[] = [
  {
    serverName: "common",
    distRoot: "mcp/common/dist",
    installedEntryRelFile: "mcp-server.js",
    requiredLlmToolkitSpecifiers: [
      "llm-toolkit-ask-user/dist/ask-user",
      "llm-toolkit-calculator/dist/calculator",
      "llm-toolkit-clock/dist/clock",
      "llm-toolkit-document-scraper/dist/document-scraper",
    ],
    requiredLlmToolkitPkgs: [
      "llm-toolkit-ask-user",
      "llm-toolkit-calculator",
      "llm-toolkit-clock",
      "llm-toolkit-document-scraper",
    ],
    requirement: "4.3",
  },
  {
    serverName: "lan-sub-agent",
    distRoot: "LanSubAgent/dist/LanSubAgent/src",
    installedEntryRelFile: "mcp-server.js",
    requiredLlmToolkitSpecifiers: ["llm-toolkit-observability"],
    requiredLlmToolkitPkgs: ["llm-toolkit-observability"],
    requirement: "4.4",
  },
] as const;

/**
 * The scoped predicate from the follow-up design: an installed consumer startup
 * is a bug condition when it imports at least one `llm-toolkit-*` package from
 * the installed layout. Deterministic for the two consumers above.
 */
function isLlmToolkitBugCondition(input: LlmToolkitConsumer): boolean {
  return input.requiredLlmToolkitPkgs.length > 0;
}

/** True iff an error text is an `llm-toolkit-*` missing-module crash. */
function isLlmToolkitModuleNotFound(errorText: string): boolean {
  return (
    /Cannot find module 'llm-toolkit-/.test(errorText) ||
    (/MODULE_NOT_FOUND/.test(errorText) && /llm-toolkit-/.test(errorText))
  );
}

/**
 * Try to load an installed consumer entry in a child Node process (so a hard
 * `MODULE_NOT_FOUND` crash is observable without killing the test runner).
 * Copies the REAL server dist into `install_dir/<serverName>/` first, exactly
 * like the `@shared/*` loader above.
 *
 * @returns `{ ok: true }` if the entry loaded, or `{ ok: false, error }` with
 *   the captured stderr/message when it threw (e.g. a missing-module crash).
 */
function tryLoadInstalledConsumer(
  installDir: string,
  srv: LlmToolkitConsumer,
): { ok: true } | { ok: false; error: string } {
  const srcDist = path.resolve(repoRoot, srv.distRoot);
  const destDir = path.join(installDir, srv.serverName);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(srcDist, destDir, { recursive: true });

  const entry = path.join(destDir, srv.installedEntryRelFile).replace(/\\/g, "\\\\");
  try {
    execFileSync(process.execPath, ["-e", `require("${entry}")`], {
      cwd: destDir,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString() ?? "");
    return { ok: false, error: `${stderr}\n${e.message ?? ""}` };
  }
}

describe(`${LLM_FEATURE_TAG} — installed servers must resolve llm-toolkit-*`, () => {
  // ── Test case A: generator drop ───────────────────────────────────────────
  //
  // Pure: runs the real generator against the real manifests. Expected (fixed)
  // behavior is that ALL five `llm-toolkit-*` names appear in the flat manifest.
  // On the current 5.4.3 build they are absent (dropped by
  // `isWorkspaceInternalName` with no `file:` override), so this FAILS —
  // surfacing the counterexample that confirms the generator drop.
  it("A: computeFlatManifest emits ALL five llm-toolkit-* packages (generator drop)", () => {
    const gen = computeFlatManifest(defaultManifestReader(repoRoot), {
      name: "llm-toolkit-runtime",
      version: "0.0.0",
    });
    const deps = gen.manifest.dependencies;

    // Counterexample report when this fails on the current 5.4.3 build.
    const missing = LLM_TOOLKIT_PKGS.filter((pkg) => !Object.hasOwn(deps, pkg));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `${LLM_FEATURE_TAG} [A] COUNTEREXAMPLE — flat manifest omits ${missing.join(
          ", ",
        )}. Cause: isWorkspaceInternalName matches llm-toolkit-* and computeFlatManifest drops-and-hoists it with NO file: override (unlike the two @shared/* names the 5.4.3 fix special-cased).`,
      );
    }

    // Expected (fixed) behavior — FAILS on the current build (all five absent).
    for (const pkg of LLM_TOOLKIT_PKGS) {
      expect(Object.hasOwn(deps, pkg)).toBe(true);
    }
  });

  // ── Test case B: install-layout resolution (Req 4.2) ──────────────────────
  //
  // npm-gated. Stage the current (5.4.3) payload, `npm install --omit=dev` into
  // a temp install_dir, and assert `node_modules/llm-toolkit-*` are PRESENT. On
  // the current build they are ABSENT, so this FAILS.
  const maybeInstallLlm = npmAvailable() ? it : it.skip;
  maybeInstallLlm(
    "B: npm install --omit=dev materializes node_modules/llm-toolkit-* for all five (Req 4.2)",
    () => {
      const installDir = stageAndInstall();
      try {
        const absent = LLM_TOOLKIT_PKGS.filter((pkg) => !sharedPkgInstalled(installDir, pkg));
        if (absent.length > 0) {
          // eslint-disable-next-line no-console
          console.error(
            `${LLM_FEATURE_TAG} [B] COUNTEREXAMPLE — after npm install, install_dir/node_modules/${absent.join(
              " and ",
            )} ABSENT; the 5.4.3 flat manifest dropped the workspace-internal llm-toolkit-* packages.`,
          );
        }
        // Expected (fixed) behavior — FAILS on the current build (all absent).
        for (const pkg of LLM_TOOLKIT_PKGS) {
          expect(sharedPkgInstalled(installDir, pkg)).toBe(true);
        }
      } finally {
        fs.rmSync(installDir, { recursive: true, force: true });
      }
    },
    300_000,
  );

  // ── Test case C: server startup (Req 4.3–4.5) ─────────────────────────────
  //
  // npm-gated. From the installed layout, loading `common/mcp-server.js` (→ the
  // deep `llm-toolkit-{ask-user,calculator,clock,document-scraper}/dist/*`
  // subpaths) and `lan-sub-agent/mcp-server.js` (→ `llm-toolkit-observability`)
  // must NOT crash with an `llm-toolkit-*` missing-module error. On the current
  // build both consumers throw MODULE_NOT_FOUND, so this FAILS.
  maybeInstallLlm(
    "C: common and lan-sub-agent load from the installed layout without an llm-toolkit-* MODULE_NOT_FOUND (Req 4.3–4.5)",
    () => {
      const installDir = stageAndInstall();
      try {
        fc.assert(
          fc.property(fc.constantFrom(...LLM_TOOLKIT_CONSUMERS), (srv) => {
            // Scope guard: only the bug-condition inputs are exercised.
            expect(isLlmToolkitBugCondition(srv)).toBe(true);

            const result = tryLoadInstalledConsumer(installDir, srv);
            if (!result.ok && isLlmToolkitModuleNotFound(result.error)) {
              // eslint-disable-next-line no-console
              console.error(
                `${LLM_FEATURE_TAG} [C] COUNTEREXAMPLE — server '${srv.serverName}' (Req ${srv.requirement}) threw MODULE_NOT_FOUND for one of ${srv.requiredLlmToolkitSpecifiers.join(
                  ", ",
                )} from the installed layout.`,
              );
            }

            // Expected (fixed) behavior: NO llm-toolkit-* missing-module crash.
            // FAILS on the current build (the require throws MODULE_NOT_FOUND).
            const crashedOnLlmToolkit = !result.ok && isLlmToolkitModuleNotFound(result.error);
            expect(crashedOnLlmToolkit).toBe(false);
          }),
          { numRuns: LLM_TOOLKIT_CONSUMERS.length },
        );
      } finally {
        fs.rmSync(installDir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
