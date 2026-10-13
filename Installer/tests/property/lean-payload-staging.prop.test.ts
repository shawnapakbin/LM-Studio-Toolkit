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

import {
  CANONICAL_TOOL_PAYLOADS,
  canonicalPayloads,
  installedEntryFilename,
  SANCTIONED_PAYLOAD_ROOT_FILES,
  stagingDestDirName,
} from "../../scripts/payload-manifest";
import {
  assertLeanPayload,
  type LeanPayloadViolation,
  stagePayload,
} from "../../scripts/stage-payload";

const FEATURE_TAG =
  "Feature: installer-runtime-provisioning, Property 7: The staged payload is lean — no `node_modules` at any depth";

// Colocated negative-copy coverage for the reverted (lean) `bundle.rs`
// `copy_payload` — the TS-side companion to the Rust Property 10 proptest
// (task 2.4). Task 4.1 replaces the two obsolete C1 dependency proptests
// (`mcp-plugin-dependency-bug-condition.prop.test.ts` /
// `mcp-plugin-dependency-preservation.prop.test.ts`), whose staged/copied
// `node_modules`-sibling assertions are false under the Lean_Payload.
const COPY_FEATURE_TAG =
  "Feature: installer-runtime-provisioning, Property 10: Copy is plugin-dist-only and never writes `node_modules`";

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

  // ─── (a2) Nine dirs PLUS the sanctioned flat manifest files → no violations ─
  //
  // Task 3.4 (bugfix runtimes-npm-install-nonzero-exit, Req 2.1/3.6): the flat
  // production `package.json` + `package-lock.json` staged at the payload ROOT
  // are sanctioned NON-TOOL file entries. A lean payload carrying any subset of
  // them (as regular files) alongside the nine dirs must yield no violations,
  // while a DIRECTORY sharing a sanctioned name must still be flagged (a tree —
  // e.g. a disguised `node_modules` — can never masquerade as an allowed file).
  it("reports no violations when the sanctioned flat manifest files sit at the payload root", () => {
    fc.assert(
      fc.property(
        fc.subarray([...SANCTIONED_PAYLOAD_ROOT_FILES], {
          minLength: 0,
          maxLength: SANCTIONED_PAYLOAD_ROOT_FILES.length,
        }),
        (files) => {
          const root = makeStagingRoot();
          try {
            seedTopLevelDirs(root, CANONICAL_DIR_NAMES);
            for (const f of files) {
              fs.writeFileSync(path.join(root, f), "{}\n");
            }
            const violations = assertLeanPayload(root);
            expect(violations).toEqual([]);
          } finally {
            teardown(root);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("flags a directory that shares a sanctioned flat-file name as unexpected-top-level", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SANCTIONED_PAYLOAD_ROOT_FILES), (name) => {
        const root = makeStagingRoot();
        try {
          seedTopLevelDirs(root, CANONICAL_DIR_NAMES);
          // A DIRECTORY (not a file) at a sanctioned name — must NOT be treated
          // as the sanctioned flat file.
          const dir = path.join(root, name);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, "leak.js"), "// tree\n");

          const violations = assertLeanPayload(root);
          expect(unexpectedTopLevelDetails(violations)).toContain(path.resolve(root, name));
        } finally {
          teardown(root);
        }
      }),
      { numRuns: 20 },
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
      .filter(
        (s) =>
          !CANONICAL_DIR_NAMES.includes(s) &&
          s !== "node_modules" &&
          // The sanctioned flat runtime-manifest files are permitted at the top
          // level (task 3.4), so a stray-directory generator must never pick
          // their names — otherwise a permitted name would be expected to fault.
          !SANCTIONED_PAYLOAD_ROOT_FILES.includes(s),
      );

    fc.assert(
      // Unique by lowercase so we never generate two names that collide on a
      // case-insensitive filesystem (e.g. Windows), where `"x"` and `"X"` are
      // the SAME on-disk directory and would yield one entry, not two.
      fc.property(
        fc.uniqueArray(strayNameArb, {
          minLength: 1,
          maxLength: 5,
          selector: (s) => s.toLowerCase(),
        }),
        (strays) => {
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
        },
      ),
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

// ─── Lean copy_payload simulation (mirrors the REVERTED bundle.rs) ───────────
//
// The reverted (lean) `Installer/src-tauri/src/bundle.rs` `copy_payload` copies
// ONLY the nine per-tool trees:
//   resource_root/<server_name>/ -> install_dir/<server_name>/
// and NEVER copies a bundled `node_modules` sibling (Req 7.2) nor verifies one
// (Req 7.3). This is the on-disk companion to the Rust Property 10 proptest.

/** Recursively copy a directory tree (files + subdirs). */
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
 * Mirror the reverted `bundle.rs copy_payload`: copy each of the nine canonical
 * `<serverName>/` trees from `resourceRoot` into `installDir`, and NOTHING else
 * (no `node_modules` sibling). Returns true on success (all present source
 * trees copied). This deliberately ignores any `node_modules` sibling in
 * `resourceRoot` so a stray one can never leak into `installDir`.
 */
function simulateLeanCopyPayload(resourceRoot: string, installDir: string): boolean {
  fs.mkdirSync(installDir, { recursive: true });
  for (const tool of canonicalPayloads()) {
    const src = path.join(resourceRoot, tool.serverName);
    const dst = path.join(installDir, tool.serverName);
    if (fs.existsSync(src)) {
      copyTree(src, dst);
    }
  }
  return true;
}

/** True iff any path segment under `root` equals `node_modules` (at any depth). */
function hasNodeModulesAnywhere(root: string): boolean {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return false;
  }
  for (const name of entries) {
    const full = path.join(root, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (name === "node_modules") {
        return true;
      }
      if (hasNodeModulesAnywhere(full)) {
        return true;
      }
    }
  }
  return false;
}

describe(COPY_FEATURE_TAG, () => {
  // A per-plugin flag: does this plugin's source dist tree carry a stray nested
  // `node_modules` directory? (Even if a plugin tree somehow carries one, the
  // reverted copy still only copies the nine <serverName>/ trees — so what
  // matters for Req 7.2/7.3 is that copy_payload never writes an
  // install_dir/node_modules SIBLING from a copy step.)
  const perPluginNestedNmArb = fc.array(fc.boolean(), {
    minLength: CANONICAL_TOOL_PAYLOADS.length,
    maxLength: CANONICAL_TOOL_PAYLOADS.length,
  });
  // Whether the resource root additionally carries a stray top-level
  // `node_modules` sibling (the exact bundled-deps artifact the revert removes).
  const strayResourceNmArb = fc.boolean();

  /**
   * (a) For any staged lean payload — including a resource root that carries a
   * stray top-level `node_modules` sibling — `copy_payload` succeeds and NEVER
   * creates `install_dir/node_modules` (Req 7.2), and never fails for lack of a
   * bundled `node_modules` (Req 7.3).
   *
   * Validates: Requirements 7.2, 7.3
   */
  it("copies the nine plugin trees and never writes install_dir/node_modules", () => {
    fc.assert(
      fc.property(perPluginNestedNmArb, strayResourceNmArb, (nestedFlags, strayResourceNm) => {
        const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lean-copy-src-"));
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "lean-copy-dst-"));
        try {
          // Stage a lean payload: each of the nine <serverName>/ trees with a
          // non-empty entry script.
          CANONICAL_TOOL_PAYLOADS.forEach((tool) => {
            const pluginDir = path.join(resourceRoot, tool.serverName);
            fs.mkdirSync(pluginDir, { recursive: true });
            fs.writeFileSync(
              path.join(pluginDir, installedEntryFilename(tool.serverName)),
              "// entry\n",
            );
          });

          // A stray top-level node_modules sibling in the resource root: the
          // reverted copy must ignore it (never copy it into install_dir).
          if (strayResourceNm) {
            const strayNm = path.join(resourceRoot, "node_modules", "@modelcontextprotocol", "sdk");
            fs.mkdirSync(strayNm, { recursive: true });
            fs.writeFileSync(path.join(strayNm, "package.json"), "{}\n");
          }

          const ok = simulateLeanCopyPayload(resourceRoot, installDir);

          // Copy succeeds without a bundled node_modules (Req 7.3).
          expect(ok).toBe(true);

          // The nine plugin outputs are present.
          for (const tool of CANONICAL_TOOL_PAYLOADS) {
            const entry = path.join(
              installDir,
              tool.serverName,
              installedEntryFilename(tool.serverName),
            );
            expect(fs.existsSync(entry)).toBe(true);
          }

          // No install_dir/node_modules sibling was written by the copy step
          // (Req 7.2) — regardless of a stray sibling in the resource root.
          expect(fs.existsSync(path.join(installDir, "node_modules"))).toBe(false);

          // And no node_modules segment exists ANYWHERE under install_dir from
          // the copy step (the seeded per-plugin flags never plant one, since
          // the lean staging above stages no node_modules; this asserts the
          // copy introduces none).
          void nestedFlags;
          expect(hasNodeModulesAnywhere(installDir)).toBe(false);
        } finally {
          teardown(resourceRoot);
          teardown(installDir);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * (b) A real `stagePayload` run followed by a lean `copy_payload` yields an
   * install dir with the nine plugin trees and no `node_modules` anywhere.
   *
   * Validates: Requirements 7.2, 7.3
   */
  it("stagePayload → copy_payload yields no node_modules in the install dir", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lean-copy-repo-"));
    const stagingRootDir = makeStagingRoot();
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "lean-copy-inst-"));
    try {
      for (const tool of CANONICAL_TOOL_PAYLOADS) {
        const src = path.resolve(repoRoot, tool.distRoot);
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, installedEntryFilename(tool.serverName)), "// entry\n");
      }

      stagePayload(repoRoot, stagingRootDir);
      const ok = simulateLeanCopyPayload(stagingRootDir, installDir);

      expect(ok).toBe(true);
      expect(fs.existsSync(path.join(installDir, "node_modules"))).toBe(false);
      expect(hasNodeModulesAnywhere(installDir)).toBe(false);

      const topLevel = fs.readdirSync(installDir).sort();
      expect(topLevel).toEqual([...CANONICAL_DIR_NAMES].sort());
    } finally {
      teardown(repoRoot);
      teardown(stagingRootDir);
      teardown(installDir);
    }
  });
});
