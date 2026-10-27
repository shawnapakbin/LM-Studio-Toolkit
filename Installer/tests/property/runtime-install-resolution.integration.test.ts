/**
 * Bugfix: runtimes-npm-install-nonzero-exit — task 3.8 (Part B / B2)
 * Integration (build/CI level): a clean `install_dir` seeded with ONLY the
 * staged flat production `package.json` + `package-lock.json` resolves the
 * tools' production dependencies via the SAME invocation the installer's
 * Runtimes step runs.
 *
 * This is the direct counterpart to the (unfixed) H1 counterexample: before the
 * fix, `npm install --omit=dev` in a manifest-LESS `install_dir` exited
 * non-zero and never materialized `@modelcontextprotocol/sdk`. Here we seed the
 * REAL committed staged manifest + lockfile (the Part B / B2 artifacts) into a
 * clean temp dir and run:
 *
 *     npm install --omit=dev --ignore-scripts --no-audit --no-fund
 *
 * — exactly the args the fixed `NpmInstallOmitDev` arm uses (provision.rs,
 * task 3.5) — then assert `install_dir/node_modules` resolves
 * `@modelcontextprotocol/sdk` AND every runtime dependency the staged manifest
 * declares (the union hoisted from the nine servers).
 *
 * NETWORK + NPM GATED: this performs a real registry install, so it is OPT-IN.
 * It runs only when npm is on PATH AND `RUN_NPM_INSTALL_INTEGRATION=1` is set
 * (so the default `npm test` / CI unit run stays fast and offline-safe). When
 * the gate is off it is reported as skipped, never failed — matching the
 * design's "clean-install_dir npm resolution is exercised at build/CI level"
 * note. Enable it with:
 *
 *     RUN_NPM_INSTALL_INTEGRATION=1 npm run -w Installer test -- runtime-install-resolution
 *
 * Validates: Requirements 2.1
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** `Installer/` root, from this test file's location (`Installer/tests/property`). */
const installerRoot = path.resolve(__dirname, "..", "..");
/** The real committed staged runtime manifest + lockfile. */
const committedRuntimeManifestDir = path.resolve(installerRoot, "src-tauri", "runtime-manifest");

/** The first `npm` on PATH (Windows ships `npm.cmd`), or `undefined`. */
function findNpm(): string | undefined {
  for (const bin of ["npm.cmd", "npm"]) {
    try {
      execFileSync(bin, ["--version"], {
        stdio: "ignore",
        shell: process.platform === "win32",
      });
      return bin;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

const npmBin = findNpm();
const gateOn = process.env.RUN_NPM_INSTALL_INTEGRATION === "1" && npmBin !== undefined;
const maybe = gateOn ? it : it.skip;

describe("Runtime install resolution — clean install_dir + staged manifest (task 3.8)", () => {
  maybe(
    "resolves @modelcontextprotocol/sdk and every staged runtime dep via npm install --omit=dev --ignore-scripts",
    () => {
      // A clean temp install_dir holding ONLY the staged package.json +
      // package-lock.json (no node_modules, no tool dist trees needed for the
      // dependency resolution we assert).
      const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "rt-install-"));
      try {
        const manifestText = fs.readFileSync(
          path.join(committedRuntimeManifestDir, "package.json"),
          "utf8",
        );
        fs.copyFileSync(
          path.join(committedRuntimeManifestDir, "package.json"),
          path.join(installDir, "package.json"),
        );
        fs.copyFileSync(
          path.join(committedRuntimeManifestDir, "package-lock.json"),
          path.join(installDir, "package-lock.json"),
        );

        // The SAME invocation the fixed NpmInstallOmitDev arm runs (task 3.5).
        execFileSync(
          npmBin as string,
          ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
          {
            cwd: installDir,
            stdio: "pipe",
            shell: process.platform === "win32",
          },
        );

        const nodeModules = path.join(installDir, "node_modules");
        expect(fs.existsSync(nodeModules)).toBe(true);

        // The Required_Package the NpmDeps probe checks must be materialized.
        expect(fs.existsSync(path.join(nodeModules, "@modelcontextprotocol", "sdk"))).toBe(true);

        // Every runtime dependency the staged manifest declares (the union
        // hoisted from the nine servers) must resolve to a real package dir.
        const manifest = JSON.parse(manifestText) as { dependencies?: Record<string, string> };
        const deps = Object.keys(manifest.dependencies ?? {});
        expect(deps.length).toBeGreaterThan(0);
        const unresolved = deps.filter(
          (name) => !fs.existsSync(path.join(nodeModules, ...name.split("/"))),
        );
        expect(unresolved).toEqual([]);
      } finally {
        fs.rmSync(installDir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
