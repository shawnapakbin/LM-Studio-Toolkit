import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import {
  CANONICAL_TOOL_COUNT,
  CANONICAL_TOOL_PAYLOADS,
  canonicalPayloads,
} from "../../scripts/payload-manifest";

// ─── Clean-checkout reproduction harness ─────────────────────────────────────

/**
 * A minimal, faithful stand-in for a fresh CI checkout of the repo. The staging
 * root (`Installer/src-tauri/payload/`) is git-ignored and therefore ABSENT in
 * a clean checkout — exactly the state in which `tauri build` bundles resources.
 * We model just enough layout to (a) observe the staging root as the bundler
 * would and (b) run the Installer `beforeBuildCommand` proxy.
 */
interface CleanCheckout {
  repoRoot: string;
  /** `Installer/src-tauri/payload/` — the NSIS `bundle.resources` staging root. */
  stagingRoot: string;
  cleanup(): void;
}

function makeCleanCheckout(): CleanCheckout {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clean-checkout-"));
  const srcTauri = path.join(repoRoot, "Installer", "src-tauri");
  fs.mkdirSync(srcTauri, { recursive: true });
  // NOTE: we deliberately do NOT create `payload/`. On a clean checkout the
  // git-ignored staging root does not exist until `stage:payload` runs.
  const stagingRoot = path.join(srcTauri, "payload");
  return {
    repoRoot,
    stagingRoot,
    cleanup() {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Observe what NSIS would see under the staging root at bundle time: for each
 * canonical server name, does a present, non-empty `payload/<serverName>/`
 * directory exist? This is the install-time contract the produced `setup.exe`
 * must satisfy (`resources/payload/<serverName>/`).
 */
function observeStagedPayload(
  stagingRoot: string,
): { serverName: string; exists: boolean; nonEmpty: boolean }[] {
  return canonicalPayloads().map((t) => {
    const dir = path.join(stagingRoot, t.serverName);
    let exists = false;
    let nonEmpty = false;
    try {
      exists = fs.statSync(dir).isDirectory();
      if (exists) nonEmpty = fs.readdirSync(dir).length > 0;
    } catch {
      exists = false;
      nonEmpty = false;
    }
    return { serverName: t.serverName, exists, nonEmpty };
  });
}

/**
 * Reproduce the ordered UNFIXED CI steps on a clean checkout, stopping at the
 * point NSIS would bundle `bundle.resources = ["payload/"]`:
 *   1. `npm ci`      — install deps (no payload effect)
 *   2. `typecheck`   — `tsc --noEmit` (no payload effect)
 *   3. tauri-action / `npx tauri` → `tauri build`, whose only pre-build hook is
 *      `beforeBuildCommand` (`vite build`, the FRONTEND) — optionally run below.
 * None of these stages the payload, so the staging root is untouched.
 *
 * @param runBeforeBuildCommand when true, also runs the `vite build` proxy to
 *   prove the frontend hook does not populate the staging root (test case 2).
 */
function reproduceUnfixedCiUpToBundle(
  checkout: CleanCheckout,
  runBeforeBuildCommand: boolean,
): void {
  // Steps 1 (`npm ci`) and 2 (`typecheck`) do not touch the staging root; we do
  // not shell out to them here (they need the full repo) — their irrelevance to
  // the payload is the point. The unfixed workflow has NO `stage:payload` step.

  if (runBeforeBuildCommand) {
    // `beforeBuildCommand` proxy: the Installer `build` script is `vite build`,
    // which emits the installer FRONTEND — it neither builds the 16 tools nor
    // stages them. Emulate its ONLY effect on disk: a frontend `dist/`. Crucially
    // it must leave `src-tauri/payload/` untouched.
    const frontendDist = path.join(checkout.repoRoot, "Installer", "dist");
    fs.mkdirSync(frontendDist, { recursive: true });
    fs.writeFileSync(path.join(frontendDist, "index.html"), "<!doctype html><html></html>");
    fs.writeFileSync(path.join(frontendDist, "assets.js"), "// vite frontend bundle");
  }
  // Execution reaches the NSIS bundle step here with the staging root exactly as
  // the clean checkout left it.
}

// ─── Test case 1: empty staging root on clean checkout ───────────────────────

describe("Property 1: Bug Condition — clean checkout bundles resources without a staged payload", () => {
  /**
   * Validates: Requirements 1.1, 1.2, 2.1, 2.2
   *
   * Test case 1: On a clean checkout with no `stage:payload` run, the staging
   * root is absent/empty when the CI reaches the NSIS bundle step. Asserts the
   * Expected Behavior — a populated `resources/payload/<serverName>/` for ALL
   * 16 tools. FAILS on the unfixed pipeline (nothing staged the payload).
   */
  it("stages a populated payload/<serverName>/ for all 16 tools before bundling (empty staging root)", () => {
    const checkout = makeCleanCheckout();
    try {
      reproduceUnfixedCiUpToBundle(checkout, /* runBeforeBuildCommand */ false);

      // Sanity: this really is a clean-checkout bug-condition build — the
      // staging root was never populated by any step above.
      expect(fs.existsSync(checkout.stagingRoot)).toBe(false);

      const staged = observeStagedPayload(checkout.stagingRoot);

      // Property over all 16 canonical server names: each must be present and
      // non-empty at bundle time. On the unfixed pipeline every name fails.
      fc.assert(
        fc.property(
          fc.constantFrom(...CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName)),
          (name) => {
            const entry = staged.find((s) => s.serverName === name);
            expect(entry).toBeDefined();
            expect(entry?.exists).toBe(true);
            expect(entry?.nonEmpty).toBe(true);
          },
        ),
        { numRuns: CANONICAL_TOOL_COUNT },
      );
    } finally {
      checkout.cleanup();
    }
  });

  // ─── Test case 2: beforeBuildCommand (vite build) does not stage ───────────

  /**
   * Test case 2: Running the Installer `beforeBuildCommand` (`vite build`) — the
   * only pre-build hook `tauri build` runs — leaves the staging root still empty,
   * confirming the frontend hook is NOT the staging step. Then asserts the same
   * Expected Behavior. FAILS on the unfixed pipeline.
   */
  it("beforeBuildCommand (vite build) leaves the staging root empty, so no tool payload is bundled", () => {
    const checkout = makeCleanCheckout();
    try {
      reproduceUnfixedCiUpToBundle(checkout, /* runBeforeBuildCommand */ true);

      // The frontend build emitted Installer/dist but must not have populated
      // the tool-payload staging root.
      expect(fs.existsSync(path.join(checkout.repoRoot, "Installer", "dist"))).toBe(true);
      const stagingPopulated =
        fs.existsSync(checkout.stagingRoot) && fs.readdirSync(checkout.stagingRoot).length > 0;
      expect(stagingPopulated).toBe(false);

      const staged = observeStagedPayload(checkout.stagingRoot);

      // Expected Behavior over all 16 tools — fails on the unfixed pipeline.
      fc.assert(
        fc.property(
          fc.constantFrom(...CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName)),
          (name) => {
            const entry = staged.find((s) => s.serverName === name);
            expect(entry?.exists && entry?.nonEmpty).toBe(true);
          },
        ),
        { numRuns: CANONICAL_TOOL_COUNT },
      );
    } finally {
      checkout.cleanup();
    }
  });

  // ─── The unfixed release workflow has no staging step (root-cause probe) ───

  /**
   * Root-cause probe (Req 1.1): the unfixed release workflow reaches the Tauri
   * build with no `stage:payload` step before it. This encodes
   * `stagePayloadRanBeforeBundle(X) = false` for the CI path. After Fix A (task
   * 3.1) a staging step is inserted before "Build Tauri app" and this passes.
   */
  it("runs stage:payload before the Tauri build in the release workflow", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const yaml = require("js-yaml") as typeof import("js-yaml");
    const workflowPath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "installer-release.yml",
    );
    const doc = yaml.load(fs.readFileSync(workflowPath, "utf8")) as {
      jobs: Record<string, { steps: { name?: string; run?: string; uses?: string }[] }>;
    };
    const steps = doc.jobs["build-installer"].steps;

    const bundleIdx = steps.findIndex(
      (s) => (s.uses ?? "").includes("tauri-action") || /tauri\s+build|npx tauri/.test(s.run ?? ""),
    );
    expect(bundleIdx).toBeGreaterThanOrEqual(0);

    const stageIdx = steps.findIndex((s) =>
      /stage:payload|build:installer/.test(`${s.name ?? ""} ${s.run ?? ""}`),
    );

    // A staging step must exist AND run before the bundle step. On the unfixed
    // workflow there is no such step (stageIdx === -1), so this fails.
    expect(stageIdx).toBeGreaterThanOrEqual(0);
    expect(stageIdx).toBeLessThan(bundleIdx);
  });
});
