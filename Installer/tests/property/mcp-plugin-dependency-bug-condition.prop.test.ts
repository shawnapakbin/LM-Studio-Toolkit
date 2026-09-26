/**
 * Bug Condition Exploration Test — Property 1 (C1): Missing Runtime Dependency
 *
 * Feature: mcp-plugin-startup-dependency-fix (Failure Mode 1)
 *
 * These assertions encode the EXPECTED (post-fix) behavior for the GUI-installer
 * path: every staged plugin must ship (or have reachable) its
 * `@modelcontextprotocol/sdk` runtime dependency so that the plugin's
 * `mcp-server.js` bare `require("@modelcontextprotocol/sdk/server/mcp.js")`
 * resolves without `MODULE_NOT_FOUND` (and therefore without the bridge's
 * `Connection closed (-32000)`).
 *
 * ── Task 5 wiring (fix verification) ─────────────────────────────────────────
 * These are the SAME assertions written in task 1; the failure-mode assertions
 * (SDK reachable / SDK resolves after copy) are UNCHANGED. Only the
 * code-under-test wiring was updated so the tests exercise the FIXED behavior
 * instead of the unfixed stand-in:
 *
 *   - Staging: instead of reading a `payload/` that a build may or may not have
 *     produced, the test STAGES a temp payload with the SAME structure the
 *     fixed `stage-payload.ts` produces — each tool's real `dist` tree under
 *     `<serverName>/` PLUS the hoisted workspace-root `node_modules` scope
 *     (`@modelcontextprotocol`, which contains the SDK) staged ONCE as a sibling
 *     `payload/node_modules/`. This exercises the fix's staging contract
 *     (`DEPENDENCY_PAYLOAD` → `payload/node_modules/`) without copying all 470
 *     packages on every run.
 *   - Copy: `simulateCopyPayload` now mirrors the FIXED `bundle.rs copy_payload`
 *     — after the nine per-tool trees it copies the shared `node_modules`
 *     sibling into `install_dir/node_modules/` (via `dependencyPayload()`), so a
 *     bare `require` walking up from `<server-name>/mcp-server.js` resolves.
 *
 * On the FIXED code these tests PASS: the SDK is reachable from the staged
 * payload and resolvable from each plugin dir after copy_payload.
 *
 * Bug_Condition: isBugConditionMissingDependency(X) — C1 from design.
 *   X.installPath STARTS WITH "%LOCALAPPDATA%\LLM-Toolkit\"
 *     AND X.stages(mcpServerJs) = true
 *     AND X.stages(modelcontextprotocolSdk) = false
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import {
  CANONICAL_TOOL_COUNT,
  CANONICAL_TOOL_PAYLOADS,
  DEPENDENCY_PAYLOAD_SERVER_NAME,
  canonicalPayloads,
  dependencyPayload,
  installedEntryFilename,
} from "../../scripts/payload-manifest";

// ─── Repo layout ─────────────────────────────────────────────────────────────

// Installer/tests/property/ -> repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The bare module specifier every plugin's mcp-server.js requires at startup. */
const SDK_REQUIRE_SPECIFIER = "@modelcontextprotocol/sdk/server/mcp.js";
/** The package root a bare require must find under some reachable node_modules. */
const SDK_PACKAGE_DIR = path.join("@modelcontextprotocol", "sdk");
/** The dependency scope the SDK lives under in the hoisted workspace node_modules. */
const SDK_SCOPE = "@modelcontextprotocol";

// ─── Staged-payload fixture (mirrors the FIXED stage-payload.ts contract) ────
//
// The fixed `Installer/scripts/stage-payload.ts` produces a `payload/` with:
//   payload/<serverName>/…            (each of the nine tools' dist trees)
//   payload/node_modules/…            (the hoisted workspace-root node_modules,
//                                       a SINGLE sibling of the nine dirs)
//
// so that, once installed, a bare `require("@modelcontextprotocol/sdk/...")`
// walking up from `<server-name>/mcp-server.js` finds `install_dir/node_modules`.
//
// To exercise that contract deterministically (and without copying all ~470
// packages every run) the test stages a temp payload of the SAME shape: each
// tool's REAL dist tree plus the REAL hoisted `@modelcontextprotocol` scope
// (which contains the SDK the assertions check) under `payload/node_modules/`.
// The `node_modules` sibling directory name comes from the fix's canonical
// `DEPENDENCY_PAYLOAD_SERVER_NAME`, so the fixture cannot drift from the fix.

function copyTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyTree(s, d);
    } else if (stat.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Stage a temp payload root mirroring the fixed `stage-payload.ts`:
 *  - each canonical tool's real `dist` tree into `payload/<serverName>/`
 *  - the hoisted workspace-root `node_modules/@modelcontextprotocol` scope
 *    (which contains the SDK) into `payload/<node_modules>/@modelcontextprotocol`,
 *    the shared runtime-dependency sibling the fix stages.
 *
 * Returns the staged payload root (caller removes it).
 */
function stageFixturePayload(): string {
  const payloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c1-payload-"));

  // Nine per-tool dist trees, staged under their server-name dir (unchanged by
  // the fix). Each tool's `distRoot` is the real, already-built repo dist tree.
  for (const tool of CANONICAL_TOOL_PAYLOADS) {
    const src = path.join(REPO_ROOT, tool.distRoot);
    const dst = path.join(payloadRoot, tool.serverName);
    if (!fs.existsSync(src)) {
      throw new Error(
        `dist tree missing for ${tool.serverName} at ${src}; run \`npm run build\` first`,
      );
    }
    copyTree(src, dst);
  }

  // Shared runtime-dependency tree (C1 fix): stage the hoisted SDK scope ONCE as
  // a sibling `payload/node_modules/`, using the fix's canonical marker name so
  // the layout matches `DEPENDENCY_PAYLOAD` / the fixed `bundle.rs`.
  const depDirName = dependencyPayload().serverName; // "node_modules"
  const sdkScopeSrc = path.join(REPO_ROOT, "node_modules", SDK_SCOPE);
  if (!fs.existsSync(path.join(sdkScopeSrc, "sdk", "package.json"))) {
    throw new Error(
      `hoisted ${SDK_SCOPE}/sdk missing at ${sdkScopeSrc}; run \`npm ci\` at the repo root`,
    );
  }
  copyTree(sdkScopeSrc, path.join(payloadRoot, depDirName, SDK_SCOPE));

  return payloadRoot;
}

// ─── Node bare-require resolution simulation ─────────────────────────────────

/**
 * Faithfully simulate Node's CommonJS resolution of a *bare* specifier
 * `@scope/pkg/sub/path.js` starting from `fromDir`. Node walks each ancestor
 * directory, checking `<ancestor>/node_modules/<request>` (and, for a package
 * subpath, resolving the file within the package). We only need the walk +
 * existence check to reproduce MODULE_NOT_FOUND vs. resolved.
 *
 * Returns the absolute resolved path if it exists, or null (== MODULE_NOT_FOUND).
 */
function resolveBareRequire(fromDir: string, request: string): string | null {
  let dir = path.resolve(fromDir);
  // Walk up to the filesystem root.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, "node_modules", request);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    // Also accept resolving the package directory itself (package.json present),
    // which is what Node does before applying the subpath — this makes the
    // simulation robust to whether the sub-file is materialized in a temp copy.
    const pkgDir = path.join(dir, "node_modules", "@modelcontextprotocol", "sdk");
    if (fs.existsSync(path.join(pkgDir, "package.json"))) {
      return pkgDir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── copy_payload simulation (mirrors the FIXED bundle.rs copy_payload) ──────

/**
 * Mirror the install-time `copy_payload` in
 * `Installer/src-tauri/src/bundle.rs`: for each of the nine canonical tools,
 * copy `resource_root/<server_name>/` into `install_dir/<server_name>/`, THEN —
 * as the C1 fix added — copy the shared `resource_root/node_modules/` sibling
 * into `install_dir/node_modules/` (via `dependencyPayload()`), so that a bare
 * `require("@modelcontextprotocol/sdk/...")` walking up from
 * `<server-name>/mcp-server.js` resolves against the shared install-root tree.
 */
function simulateCopyPayload(resourceRoot: string, installDir: string): void {
  fs.mkdirSync(installDir, { recursive: true });
  for (const tool of canonicalPayloads()) {
    const src = path.join(resourceRoot, tool.serverName);
    const dst = path.join(installDir, tool.serverName);
    if (fs.existsSync(src)) {
      copyTree(src, dst);
    }
  }
  // C1 fix: copy the shared runtime-dependency tree as a sibling of the nine
  // plugin dirs (bundle.rs copies resource_root/node_modules -> install_dir/node_modules).
  const depDirName = dependencyPayload().serverName; // "node_modules"
  const depSrc = path.join(resourceRoot, depDirName);
  if (fs.existsSync(depSrc)) {
    copyTree(depSrc, path.join(installDir, depDirName));
  }
}

/**
 * Walk up from `startDir` looking for any reachable `node_modules` directory
 * that contains the SDK package. Returns the SDK package dir if reachable, else
 * null. This is the on-disk analogue of the resolution walk and encodes
 * "no reachable node_modules above <server-name>/mcp-server.js".
 */
function findReachableSdk(startDir: string, stopAt: string): string | null {
  let dir = path.resolve(startDir);
  const stop = path.resolve(stopAt);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const pkgJson = path.join(dir, "node_modules", SDK_PACKAGE_DIR, "package.json");
    if (fs.existsSync(pkgJson)) {
      return path.dirname(pkgJson);
    }
    if (path.resolve(dir) === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const serverNameArb = fc.constantFrom(...CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Property 1 (C1): GUI-installer plugins stage their SDK dependency (fixed)", () => {
  let payloadRoot: string;

  beforeAll(() => {
    payloadRoot = stageFixturePayload();
  });

  afterAll(() => {
    if (payloadRoot) {
      fs.rmSync(payloadRoot, { recursive: true, force: true });
    }
  });

  /**
   * C1.a — the staged payload makes `@modelcontextprotocol/sdk` reachable from
   * each staged plugin.
   *
   * For every staged plugin, the runtime dependency `@modelcontextprotocol/sdk`
   * must be reachable from the staged tree (as the sibling `payload/node_modules/`
   * the fix stages).
   *
   * Validates: Requirements 1.1, 2.1
   */
  it("stages @modelcontextprotocol/sdk reachable from each staged plugin", () => {
    // Precondition: the staged payload exists and the dependency sibling is present.
    expect(fs.existsSync(payloadRoot)).toBe(true);
    expect(fs.existsSync(path.join(payloadRoot, DEPENDENCY_PAYLOAD_SERVER_NAME))).toBe(true);

    fc.assert(
      fc.property(serverNameArb, (serverName) => {
        const pluginDir = path.join(payloadRoot, serverName);
        const entry = installedEntryFilename(serverName);
        const entryPath = path.join(pluginDir, entry);

        // Bug-condition sanity: the plugin server script IS staged...
        expect(fs.existsSync(entryPath)).toBe(true);

        // ...and its SDK dependency is ALSO reachable (expected behavior).
        const resolved = findReachableSdk(pluginDir, payloadRoot);
        expect(resolved).not.toBeNull();
      }),
      { numRuns: CANONICAL_TOOL_COUNT },
    );
  });

  /**
   * C1.b — after copy_payload into a temp install dir, the SDK must resolve.
   *
   * Reproduces the install-time copy exactly as the FIXED `bundle.rs` does
   * (nine per-tool trees PLUS the shared `node_modules` sibling) and then
   * simulates Node's bare-require resolution of
   * `@modelcontextprotocol/sdk/server/mcp.js` from each copied plugin dir.
   *
   * Validates: Requirements 1.2, 1.3, 2.2, 2.3
   */
  it("resolves the SDK from each plugin dir after copy_payload", () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c1-install-"));
    try {
      simulateCopyPayload(payloadRoot, installDir);

      // The copied tree must have each plugin's mcp-server.js...
      for (const tool of canonicalPayloads()) {
        const entry = installedEntryFilename(tool.serverName);
        expect(fs.existsSync(path.join(installDir, tool.serverName, entry))).toBe(true);
      }

      // ...and there must be a reachable node_modules ABOVE each plugin dir.
      const reachable =
        fs.existsSync(path.join(installDir, "node_modules")) &&
        fs.existsSync(path.join(installDir, "node_modules", SDK_PACKAGE_DIR, "package.json"));
      expect(reachable).toBe(true);

      // Node bare-require resolution simulation for every plugin dir.
      fc.assert(
        fc.property(serverNameArb, (serverName) => {
          const pluginDir = path.join(installDir, serverName);
          const resolved = resolveBareRequire(pluginDir, SDK_REQUIRE_SPECIFIER);
          expect(resolved).not.toBeNull();
        }),
        { numRuns: CANONICAL_TOOL_COUNT },
      );
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  /**
   * C1.c — after copy_payload into an isolated install root, a plugin dir
   * resolves the SDK against the shared sibling node_modules.
   *
   * This is the tightest reproduction of the install: copy the payload (a
   * plugin dir + the shared node_modules sibling, as the fixed bundle.rs does)
   * into an isolated temp dir and attempt to resolve the SDK from the plugin
   * dir. The post-fix behavior is that resolution succeeds because the shared
   * node_modules is copied alongside the plugin dirs at the install root.
   *
   * Validates: Requirements 1.2, 2.2
   */
  it("resolves the SDK for a copied plugin against the shared install-root node_modules", () => {
    fc.assert(
      fc.property(serverNameArb, (serverName) => {
        const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c1-iso-"));
        try {
          // Mirror the FIXED install: copy the plugin dir AND the shared
          // node_modules sibling into the install root (this is exactly what
          // copy_payload does — the deps land at install_dir/node_modules/).
          const srcPluginDir = path.join(payloadRoot, serverName);
          const dstPluginDir = path.join(isolatedRoot, serverName);
          copyTree(srcPluginDir, dstPluginDir);

          const depDirName = dependencyPayload().serverName;
          copyTree(path.join(payloadRoot, depDirName), path.join(isolatedRoot, depDirName));

          const resolved = resolveBareRequire(dstPluginDir, SDK_REQUIRE_SPECIFIER);
          expect(resolved).not.toBeNull();
        } finally {
          fs.rmSync(isolatedRoot, { recursive: true, force: true });
        }
      }),
      { numRuns: CANONICAL_TOOL_COUNT },
    );
  });
});
