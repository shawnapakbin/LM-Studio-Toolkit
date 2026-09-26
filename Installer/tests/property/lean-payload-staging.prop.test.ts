/**
 * Feature: installer-runtime-provisioning
 * Property 7: The staged payload is lean — no `node_modules` at any depth.
 *
 * For any populated staging tree, `assertLeanPayload` must:
 *   - Req 2.1 / 2.7: report `unexpected-top-level` for EVERY top-level entry
 *     that is not one of the nine canonical server names, naming each offending
 *     path, and report NONE when the top level is exactly the nine.
 *   - Req 2.2 / 2.3: report `node-modules` for EVERY path segment equal to
 *     `node_modules` at ANY depth, naming the offending path, and report NONE
 *     when no such segment exists.
 *
 * The violation set is asserted to be EXACT: no false positives on a lean
 * payload, and no false negatives when strays / nested `node_modules` are
 * present. The nine canonical server names are derived from the single source
 * of truth (`CANONICAL_TOOL_PAYLOADS` via `stagingDestDirName`), never
 * re-hardcoded.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.7
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import { CANONICAL_TOOL_PAYLOADS, stagingDestDirName } from "../../scripts/payload-manifest";
import {
  type LeanPayloadViolation,
  assertLeanPayload,
  stagePayload,
} from "../../scripts/stage-payload";

const FEATURE_TAG =
  "Feature: installer-runtime-provisioning, Property 7: The staged payload is lean — no `node_modules` at any depth";

// The canonical nine server dir names, derived from the single source of truth.
const CANONICAL_DIR_NAMES: readonly string[] = CANONICAL_TOOL_PAYLOADS.map((t) =>
  stagingDestDirName(t),
);

/** Make a throwaway staging root under the OS temp dir. */
function makeStagingRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lean-payload-"));
}

/** Recursively remove a staging root, ignoring errors. */
function teardown(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Populate a staging root with the given top-level directories, each holding a
 * single small regular file so the tree is non-empty but stays well under the
 * size budget.
 */
function seedTopLevelDirs(root: string, dirNames: readonly string[]): void {
  for (const name of dirNames) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mcp-server.js"), "// entry\n");
  }
}

/** Seed a `node_modules` directory (with a file) at an arbitrary nested path. */
function seedNodeModulesAt(root: string, segments: readonly string[]): string {
  const parent = path.join(root, ...segments);
  const nm = path.join(parent, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, "package.json"), "{}\n");
  return nm;
}

/** The `node-modules`-kind violation detail paths, normalized. */
function nodeModulesDetails(violations: LeanPayloadViolation[]): string[] {
  return violations
    .filter((v) => v.kind === "node-modules")
    .map((v) => path.resolve(v.detail))
    .sort();
}

/** The `unexpected-top-level`-kind violation detail paths, normalized. */
function unexpectedTopLevelDetails(violations: LeanPayloadViolation[]): string[] {
  return violations
    .filter((v) => v.kind === "unexpected-top-level")
    .map((v) => path.resolve(v.detail))
    .sort();
}

describe(FEATURE_TAG, () => {
  // ─── (a) Exactly the nine canonical dirs → no violations ───────────────────
  it("reports no violations for a payload of exactly the nine canonical server dirs", () => {
    fc.assert(
      fc.property(
        // Shuffle the nine so the assertion is order-independent.
        fc.shuffledSubarray(CANONICAL_DIR_NAMES, {
          minLength: CANONICAL_DIR_NAMES.length,
          maxLength: CANONICAL_DIR_NAMES.length,
        }),
        (dirs) => {
          const root = makeStagingRoot();
          try {
            seedTopLevelDirs(root, dirs);
            const violations = assertLeanPayload(root);
            expect(violations).toEqual([]);
          } finally {
            teardown(root);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── (b) A stray `node_modules` at top level or nested → node-modules ──────
  it("reports a node_modules violation naming a stray node_modules at any depth", () => {
    // A nesting path built from canonical dir names (0..3 deep). An empty path
    // places `node_modules` at the top level (which is ALSO an unexpected
    // top-level entry); a non-empty path nests it under a canonical dir.
    const nestingArb = fc.array(fc.constantFrom(...CANONICAL_DIR_NAMES), {
      minLength: 0,
      maxLength: 3,
    });

    fc.assert(
      fc.property(nestingArb, (segments) => {
        const root = makeStagingRoot();
        try {
          // Start from a lean nine-dir baseline so the ONLY violation source is
          // the injected node_modules (and, when top-level, its unexpectedness).
          seedTopLevelDirs(root, CANONICAL_DIR_NAMES);
          const nmPath = seedNodeModulesAt(root, segments);

          const violations = assertLeanPayload(root);
          const nmDetails = nodeModulesDetails(violations);

          // The offending node_modules path is named exactly once.
          expect(nmDetails).toContain(path.resolve(nmPath));

          if (segments.length === 0) {
            // Top-level node_modules is ALSO an unexpected top-level entry.
            expect(unexpectedTopLevelDetails(violations)).toContain(path.resolve(nmPath));
          } else {
            // Nested under a canonical dir: no NEW unexpected top-level entry.
            expect(unexpectedTopLevelDetails(violations)).toEqual([]);
          }
        } finally {
          teardown(root);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ─── (c) Arbitrary extra unexpected top-level entries → unexpected-top-level ─
  it("reports an unexpected-top-level violation naming each stray top-level entry", () => {
    // Extra top-level names that are NOT canonical and NOT `node_modules` (that
    // one has its own combined behavior covered above).
    const strayNameArb = fc
      .string({ minLength: 1, maxLength: 12 })
      .map((s) => s.replace(/[^A-Za-z0-9_-]/g, "") || "x")
      .filter((s) => !CANONICAL_DIR_NAMES.includes(s) && s !== "node_modules");

    fc.assert(
      fc.property(fc.uniqueArray(strayNameArb, { minLength: 1, maxLength: 5 }), (strays) => {
        const root = makeStagingRoot();
        try {
          // Lean baseline plus the stray extra top-level dirs.
          seedTopLevelDirs(root, CANONICAL_DIR_NAMES);
          seedTopLevelDirs(root, strays);

          const violations = assertLeanPayload(root);

          const expectedUnexpected = strays.map((s) => path.resolve(root, s)).sort();
          expect(unexpectedTopLevelDetails(violations)).toEqual(expectedUnexpected);
          // No node_modules were seeded, so none reported.
          expect(nodeModulesDetails(violations)).toEqual([]);
        } finally {
          teardown(root);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ─── Integration: a real stagePayload run yields zero violations ───────────
  it("produces a lean payload (no violations) from stagePayload over the nine dist trees", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lean-payload-repo-"));
    const stagingRootDir = makeStagingRoot();
    try {
      // Seed a minimal, non-empty dist tree at each canonical source distRoot.
      for (const tool of CANONICAL_TOOL_PAYLOADS) {
        const src = path.resolve(repoRoot, tool.distRoot);
        fs.mkdirSync(src, { recursive: true });
        const entry = tool.serverName === "browserless" ? "schema-proxy.js" : "mcp-server.js";
        fs.writeFileSync(path.join(src, entry), "// entry\n");
      }

      stagePayload(repoRoot, stagingRootDir);

      const violations = assertLeanPayload(stagingRootDir);
      expect(violations).toEqual([]);

      // Top level is exactly the nine canonical server dirs.
      const topLevel = fs.readdirSync(stagingRootDir).sort();
      expect(topLevel).toEqual([...CANONICAL_DIR_NAMES].sort());
    } finally {
      teardown(repoRoot);
      teardown(stagingRootDir);
    }
  });
});
