/**
 * Preservation Property Tests — Property 2 (C1 / GUI-installer path)
 *
 * Feature: mcp-plugin-startup-dependency-fix (Failure Mode 1, preservation half)
 *
 * OBSERVATION-FIRST: these tests record the actual UNFIXED behavior of the
 * bundled payload / `copy_payload` layout that the dependency fix (task 3) MUST
 * preserve, and assert it — so they PASS on unfixed code and act as a
 * regression baseline. The fix only ADDS a shared `node_modules/` tree as a
 * sibling of the nine `<server-name>/` dirs; it must not add, remove, rename,
 * or relocate any of the nine tools, their server names, or their dist roots,
 * and it must not move any plugin file INTO the plugin dirs.
 *
 * What is asserted (all MUST PASS on unfixed code):
 *   - The canonical nine `serverName -> distRoot` pairs are unchanged (mirrors
 *     the `tool_payload.rs` list, whose cross-source agreement proptest is the
 *     Rust source of truth — referenced/run separately, not duplicated here).
 *   - Server names and dist roots are unique (nine distinct entries).
 *   - After `copy_payload`, every plugin's entry script lands at the SAME
 *     `<server-name>/<entry>` location and structure as before — the dependency
 *     tree is additive at `node_modules/` (a sibling), never inside a plugin dir.
 *   - `copy_payload` is idempotent for the plugin trees (re-copy is a no-op on
 *     layout).
 *
 * The DESIRED post-fix invariant (a reachable SDK / `node_modules`) is asserted
 * by the Task 1 C1 exploration test
 * (`mcp-plugin-dependency-bug-condition.prop.test.ts`) and will pass after
 * task 3 — it is intentionally NOT part of this preservation baseline.
 *
 * Validates: Requirements 3.4 (and Property 2 preservation of the canonical set)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import {
  CANONICAL_TOOL_COUNT,
  CANONICAL_TOOL_PAYLOADS,
  canonicalPayloads,
  installedEntryFilename,
} from "../../scripts/payload-manifest";

// Installer/tests/property/ -> repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PAYLOAD_ROOT = path.join(REPO_ROOT, "Installer", "src-tauri", "payload");

// ─── copy_payload simulation (mirrors bundle.rs copy_payload, UNFIXED) ───────
//
// The UNFIXED install-time copy copies ONLY the nine per-tool trees:
//   resource_root/<server_name>/ -> install_dir/<server_name>/
// It copies no shared node_modules. This is the exact layout the fix must
// preserve for the plugin dirs (the fix only ADDS install_dir/node_modules/).

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

function simulateCopyPayload(resourceRoot: string, installDir: string): void {
  fs.mkdirSync(installDir, { recursive: true });
  for (const tool of canonicalPayloads()) {
    const src = path.join(resourceRoot, tool.serverName);
    const dst = path.join(installDir, tool.serverName);
    if (fs.existsSync(src)) {
      copyTree(src, dst);
    }
  }
}

/** Collect every regular file under `dir`, as install-dir-relative POSIX paths. */
function relativeFileSet(dir: string): Set<string> {
  const out = new Set<string>();
  function walk(cur: string): void {
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        out.add(path.relative(dir, full).replace(/\\/g, "/"));
      }
    }
  }
  walk(dir);
  return out;
}

const serverNameArb = fc.constantFrom(...CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName));

// ─── Canonical set preservation (Property 2 / Req 3.4) ───────────────────────

describe("Property 2 (C1): canonical nine serverName -> distRoot list is unchanged", () => {
  /**
   * The canonical nine pairs must not drift under the dependency fix. This
   * mirrors `CANONICAL_TOOL_PAYLOADS` in `tool_payload.rs` (the Rust source of
   * truth). The Rust cross-source agreement proptest in
   * `tool_payload.rs` (`property_source_of_truth_agreement`) enforces that the
   * Rust list, this TS manifest, `mcp-config.js`, and `config_gen.rs` all agree;
   * it is RUN as part of the Rust suite (task 6 / `cargo test`) rather than
   * duplicated here. This TS test pins the manifest half of that agreement.
   *
   * MUST PASS on unfixed code.
   *
   * Validates: Requirements 3.4
   */
  it("keeps exactly the nine canonical serverName -> distRoot pairs", () => {
    const expected: ReadonlyArray<[string, string]> = [
      ["terminal", "Terminal/dist"],
      ["web-browser", "WebBrowser/dist"],
      ["common", "mcp/common/dist"],
      ["browserless", "Browserless/scripts"],
      ["python-shell", "PythonShell/dist"],
      ["skills", "Skills/dist"],
      ["blender-bridge", "BlenderBridge/dist"],
      ["3dtool", "3DTool/dist"],
      ["lan-sub-agent", "LanSubAgent/dist/LanSubAgent/src"],
    ];

    expect(CANONICAL_TOOL_PAYLOADS).toHaveLength(CANONICAL_TOOL_COUNT);
    const actual = CANONICAL_TOOL_PAYLOADS.map((t): [string, string] => [t.serverName, t.distRoot]);
    expect(actual).toEqual(expected);
  });

  it("has unique server names and unique dist roots (nine distinct entries)", () => {
    const names = new Set(CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName));
    const roots = new Set(CANONICAL_TOOL_PAYLOADS.map((t) => t.distRoot));
    expect(names.size).toBe(CANONICAL_TOOL_COUNT);
    expect(roots.size).toBe(CANONICAL_TOOL_COUNT);
  });

  /**
   * Property over the nine: no server name resolves to a `node_modules` marker
   * (so the additive dependency tree the fix introduces can never collide with
   * a real plugin dir).
   *
   * MUST PASS on unfixed code.
   */
  it("has no plugin server name equal to 'node_modules' (additive dep tree cannot collide)", () => {
    fc.assert(
      fc.property(serverNameArb, (serverName) => {
        expect(serverName).not.toBe("node_modules");
      }),
      { numRuns: CANONICAL_TOOL_COUNT },
    );
  });
});

// ─── Install-location preservation (Property 2 / Req 3.4) ────────────────────

describe("Property 2 (C1): plugin file placement under <server-name>/ is unchanged", () => {
  /**
   * After `copy_payload`, each plugin's entry script lands at the SAME
   * `<server-name>/<entry>` location and structure it does today. The
   * dependency tree the fix adds lives at `install_dir/node_modules/` (a
   * SIBLING of the plugin dirs), not inside any `<server-name>/` dir — so the
   * per-plugin file layout is byte-for-location identical.
   *
   * MUST PASS on unfixed code (the fix's `node_modules/` is additive).
   *
   * Validates: Requirements 3.4
   */
  it("lands each plugin's entry script at <server-name>/<entry> after copy_payload", () => {
    expect(fs.existsSync(PAYLOAD_ROOT)).toBe(true);

    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c1-preserve-install-"));
    try {
      simulateCopyPayload(PAYLOAD_ROOT, installDir);

      fc.assert(
        fc.property(serverNameArb, (serverName) => {
          const entry = installedEntryFilename(serverName);
          const entryPath = path.join(installDir, serverName, entry);
          // Entry sits directly under <server-name>/, exactly as before.
          expect(fs.existsSync(entryPath)).toBe(true);
          expect(fs.statSync(entryPath).isFile()).toBe(true);
        }),
        { numRuns: CANONICAL_TOOL_COUNT },
      );
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  /**
   * The copied plugin dirs are exactly the nine canonical server names — no
   * plugin dir is added, removed, or renamed by the copy. (On unfixed code the
   * install dir contains ONLY the nine; after the fix it additionally contains
   * a `node_modules/` sibling, which is asserted by the Task 1 C1 test.)
   *
   * MUST PASS on unfixed code.
   *
   * Validates: Requirements 3.4
   */
  it("copies exactly the nine canonical plugin dirs (no add/remove/rename of plugins)", () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c1-preserve-dirs-"));
    try {
      simulateCopyPayload(PAYLOAD_ROOT, installDir);

      const topLevelDirs = fs
        .readdirSync(installDir)
        .filter((name) => fs.statSync(path.join(installDir, name)).isDirectory())
        .sort();

      const expected = CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName).sort();
      expect(topLevelDirs).toEqual(expected);
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  /**
   * `copy_payload` is idempotent for the plugin trees: re-copying yields an
   * identical set of files/locations (the layout the fix must preserve).
   *
   * MUST PASS on unfixed code.
   *
   * Validates: Requirements 3.4
   */
  it("is idempotent for the plugin trees (re-copy leaves an identical file layout)", () => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-c1-preserve-idem-"));
    try {
      simulateCopyPayload(PAYLOAD_ROOT, installDir);
      const first = relativeFileSet(installDir);

      simulateCopyPayload(PAYLOAD_ROOT, installDir);
      const second = relativeFileSet(installDir);

      expect([...second].sort()).toEqual([...first].sort());
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });
});
