import { spawnSync } from "node:child_process";
import * as path from "node:path";
// Feature: browserless-npx-migration, Property 4: Preflight Version Gate
/**
 * Property-based tests for the preflight version gate.
 * Uses fast-check to verify that the preflight check exits with code 0
 * if and only if the Node.js major version is >= 24.
 *
 * **Validates: Requirements 5.1, 5.2**
 */
import * as fc from "fast-check";

const PREFLIGHT_SCRIPT = path.resolve(__dirname, "..", "scripts", "preflight-check.js");

/**
 * Helper that spawns a small Node.js wrapper which overrides
 * process.versions.node before requiring the preflight script.
 * Returns the exit code, stdout, and stderr.
 */
function runPreflightWithMajor(major: number): {
  exitCode: number | null;
  stdout: string;
  stderr: string;
} {
  // We spawn a node process that patches process.versions.node
  // to a synthetic version string, then runs the preflight script.
  const code = `
    Object.defineProperty(process.versions, 'node', {
      value: '${major}.0.0',
      writable: true,
      configurable: true
    });
    require(${JSON.stringify(PREFLIGHT_SCRIPT.replace(/\\/g, "/"))});
  `;

  const result = spawnSync("node", ["-e", code], {
    stdio: "pipe",
    timeout: 5000,
  });

  return {
    exitCode: result.status,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
}

describe("Feature: browserless-npx-migration, Property 4: Preflight Version Gate", () => {
  test("exit code is 0 if and only if major version >= 24", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), (major) => {
        const { exitCode } = runPreflightWithMajor(major);
        if (major >= 24) {
          expect(exitCode).toBe(0);
        } else {
          expect(exitCode).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("stderr contains '24' when major version < 24", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), (major) => {
        const { stderr } = runPreflightWithMajor(major);
        expect(stderr).toContain("24");
      }),
      { numRuns: 100 },
    );
  });

  test("stdout contains success message when major version >= 24", () => {
    fc.assert(
      fc.property(fc.integer({ min: 24, max: 99 }), (major) => {
        const { stdout } = runPreflightWithMajor(major);
        expect(stdout).toContain("OK");
      }),
      { numRuns: 100 },
    );
  });
});
