/**
 * Frontend-build output test.
 *
 * Feature: windows-installer-setup-exe (Requirement 1.6)
 *
 * Req 1.6 pins a contract between two manifests: the installer `package.json`
 * `build` script (Vite) must produce the frontend output at the exact location
 * that `tauri.conf.json` names as `frontendDist`. If either side drifts, Tauri
 * bundles a stale or empty frontend and the `setup.exe` ships a broken UI.
 *
 * This test verifies the contract on two levels:
 *
 *   1. Config wiring (fast, always runs):
 *      - package.json `build` invokes `vite build`.
 *      - tauri.conf.json `build.frontendDist` resolves (relative to
 *        src-tauri/) to Installer/dist.
 *      - the Vite entry `index.html` exists at the Installer root.
 *
 *   2. Real build output (runs `vite build` and asserts the artifact):
 *      - running the build produces `<frontendDist>/index.html` plus assets.
 *      Build artifacts are git-ignored; the test restores any pre-existing
 *      dist/ it displaced so it leaves the working tree as it found it.
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

/** Installer/ root, resolved from this test file's location. */
const installerRoot = resolve(__dirname, "..", "..");

const PACKAGE_JSON_PATH = resolve(installerRoot, "package.json");
const TAURI_CONF_PATH = resolve(installerRoot, "src-tauri", "tauri.conf.json");
const SRC_TAURI_DIR = resolve(installerRoot, "src-tauri");
const INDEX_HTML_PATH = resolve(installerRoot, "index.html");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Resolve the `build.frontendDist` path from tauri.conf.json (relative to src-tauri/). */
function frontendDistDir(): string {
  const conf = readJson(TAURI_CONF_PATH);
  const build = conf.build as Record<string, unknown> | undefined;
  const frontendDist = build?.frontendDist;
  if (typeof frontendDist !== "string") {
    throw new Error("tauri.conf.json build.frontendDist is not a string");
  }
  // frontendDist is relative to the tauri config dir (src-tauri/).
  return resolve(SRC_TAURI_DIR, frontendDist);
}

describe("frontend build — config wiring (Req 1.6)", () => {
  it("package.json `build` script invokes Vite", () => {
    const pkg = readJson(PACKAGE_JSON_PATH);
    const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
    const build = scripts.build;
    expect(typeof build).toBe("string");
    expect(build as string).toMatch(/\bvite build\b/);
  });

  it("tauri.conf.json `frontendDist` resolves to Installer/dist", () => {
    expect(frontendDistDir()).toBe(resolve(installerRoot, "dist"));
  });

  it("the Vite entry index.html exists at the Installer root", () => {
    expect(existsSync(INDEX_HTML_PATH)).toBe(true);
    const html = readFileSync(INDEX_HTML_PATH, "utf8");
    // The entry must reference a module script for Vite to have a build entry.
    expect(html).toMatch(/<script[^>]*type="module"[^>]*>/);
  });
});

describe("frontend build — produces frontendDist output (Req 1.6)", () => {
  const distDir = frontendDistDir();
  let backupDir: string | null = null;

  beforeAll(() => {
    // Preserve any pre-existing dist/ so the test leaves the tree as found.
    if (existsSync(distDir)) {
      backupDir = mkdtempSync(resolve(tmpdir(), "installer-dist-backup-"));
      cpSync(distDir, backupDir, { recursive: true });
      rmSync(distDir, { recursive: true, force: true });
    }

    // Run the real frontend build. Vite is a Node tool (not cargo), so this is
    // fast and not blocked by execution policy. The command is a fixed string
    // with no interpolated input.
    execSync("npm run build", {
      cwd: installerRoot,
      stdio: "pipe",
    });
  }, 120_000);

  afterAll(() => {
    // Restore the original dist/ (or clean the one we generated).
    rmSync(distDir, { recursive: true, force: true });
    if (backupDir) {
      cpSync(backupDir, distDir, { recursive: true });
      rmSync(backupDir, { recursive: true, force: true });
    }
  });

  it("produces index.html at the frontendDist location", () => {
    const indexHtml = resolve(distDir, "index.html");
    expect(existsSync(indexHtml)).toBe(true);
    expect(dirname(indexHtml)).toBe(distDir);
  });

  it("produces built assets alongside index.html", () => {
    const entries = readdirSync(distDir);
    // Vite emits an index.html plus at least one additional asset (bundled JS,
    // typically under assets/). Assert more than just the HTML shell exists.
    expect(entries).toContain("index.html");
    expect(entries.length).toBeGreaterThan(1);
  });

  it("the built index.html references a bundled asset (not the raw source entry)", () => {
    const html = readFileSync(resolve(distDir, "index.html"), "utf8");
    // The dev entry points at /src/main.tsx; the built output rewrites it to a
    // hashed bundle. Assert the raw source entry is gone.
    expect(html).not.toMatch(/\/src\/main\.tsx/);
    expect(html).toMatch(/<script[^>]*type="module"[^>]*src=/);
  });
});
