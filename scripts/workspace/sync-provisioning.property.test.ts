// Feature: codebase-cleanup-plugin-registration, Property 3: Provisioned-file completeness and ownership

/**
 * Feature: codebase-cleanup-plugin-registration
 * Property 3: Provisioned-file completeness and ownership
 *
 * For all generated sets of registered servers provisioned to a temporary
 * plugin root, each server's directory contains `mcp-bridge-config.json`,
 * `manifest.json`, and `install-state.json`, and `install-state.json` carries
 * the ownership marker `_owner === "llm-toolkit"`.
 *
 * Validates: Requirements 1.7, 2.1
 * Design: Property 3
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";

// Real ownership constants/helpers from the production module, so this test
// exercises the actual `_owner` marker value and the real owned-dir detection
// used by the sync script (never the real ~/.lmstudio directory — see below).
const { OWNER_ID, getOwnedPluginDirs, isOwnedByToolkit } = require("./plugin-ownership");

/**
 * Faithful replica of the Pass-3 provisioning routine from
 * `scripts/workspace/sync-lmstudio-bridge-configs.js`.
 *
 * The sync script executes `main()` at module load and calls `process.exit`,
 * so it cannot be imported directly (the same reason the env-merge property
 * test re-implements its merge logic). This helper mirrors the script's
 * per-plugin write logic exactly: for each registered server it creates
 * `{pluginRoot}/{serverName}/` and writes `manifest.json`, `install-state.json`,
 * and `mcp-bridge-config.json`, all tagged with the real `OWNER_ID`.
 *
 * It runs against a caller-supplied temporary plugin root, never the real
 * LM Studio directory.
 */
function provisionServers(
  pluginRoot: string,
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>,
): void {
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const pluginDir = path.join(pluginRoot, serverName);
    fs.mkdirSync(pluginDir, { recursive: true });

    const manifest = {
      type: "plugin",
      runner: "mcpBridge",
      owner: "mcp",
      name: serverName,
      _owner: OWNER_ID,
    };
    fs.writeFileSync(
      path.join(pluginDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8" },
    );

    const installState = {
      by: "mcp-bridge-v1",
      at: Date.now(),
      _owner: OWNER_ID,
    };
    fs.writeFileSync(
      path.join(pluginDir, "install-state.json"),
      `${JSON.stringify(installState, null, 2)}\n`,
      { encoding: "utf8" },
    );

    fs.writeFileSync(
      path.join(pluginDir, "mcp-bridge-config.json"),
      `${JSON.stringify(serverConfig, null, 2)}\n`,
      { encoding: "utf8" },
    );
  }
}

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * A valid MCP server name. Server keys in `mcp-config.js` are kebab-case tokens
 * (e.g. `web-browser`, `python-shell`, `3dtool`). We generate filesystem-safe
 * names so each maps to a real subdirectory under the temp plugin root.
 */
const serverNameArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")), {
    minLength: 1,
    maxLength: 24,
  })
  // Avoid names that are empty after trimming leading/trailing hyphens or that
  // collide with reserved path segments; keep them as plausible server keys.
  .filter((name) => name.replace(/-/g, "").length > 0 && name !== "." && name !== "..");

/** A single server config value in the shape produced by `buildMcpServers()`. */
const serverConfigArb = fc.record({
  command: fc.constant("node"),
  args: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 1, maxLength: 2 }),
  env: fc
    .array(
      fc.tuple(
        fc.stringOf(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ_".split("")), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.string({ maxLength: 30 }),
      ),
      { maxLength: 5 },
    )
    .map((pairs) => Object.fromEntries(pairs)),
});

/**
 * A non-empty set of registered servers keyed by unique server name — the
 * equivalent of the `mcpServers` map handed to the sync provisioning loop.
 */
const serverSetArb = fc
  .uniqueArray(serverNameArb, { minLength: 1, maxLength: 16, selector: (n) => n })
  .chain((names) =>
    fc.tuple(...names.map(() => serverConfigArb)).map((configs) => {
      const set: Record<string, any> = {};
      names.forEach((name, i) => {
        set[name] = configs[i];
      });
      return set;
    }),
  );

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Feature: codebase-cleanup-plugin-registration", () => {
  const REQUIRED_FILES = ["mcp-bridge-config.json", "manifest.json", "install-state.json"] as const;

  /**
   * Feature: codebase-cleanup-plugin-registration, Property 3: Provisioned-file completeness and ownership
   *
   * Validates: Requirements 1.7, 2.1
   * Design: Property 3
   */
  it("Property 3: each provisioned server dir has all three files and install-state ownership", () => {
    fc.assert(
      fc.property(serverSetArb, (mcpServers) => {
        // Isolated temporary plugin root — never the real ~/.lmstudio directory.
        const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-toolkit-plugin-root-"));

        try {
          provisionServers(pluginRoot, mcpServers);

          for (const serverName of Object.keys(mcpServers)) {
            const pluginDir = path.join(pluginRoot, serverName);

            // Completeness: all three provisioned files exist (Req 1.7).
            for (const file of REQUIRED_FILES) {
              expect(fs.existsSync(path.join(pluginDir, file))).toBe(true);
            }

            // Ownership: install-state.json carries `_owner === "llm-toolkit"` (Req 2.1).
            const installState = JSON.parse(
              fs.readFileSync(path.join(pluginDir, "install-state.json"), "utf8"),
            );
            expect(installState._owner).toBe("llm-toolkit");
            expect(installState._owner).toBe(OWNER_ID);

            // The real ownership detector recognizes the provisioned dir as toolkit-owned.
            expect(isOwnedByToolkit(pluginDir)).toBe(true);
          }

          // The real enumeration helper returns exactly the provisioned server dirs.
          const ownedDirs = getOwnedPluginDirs(pluginRoot).map((d: string) => path.basename(d));
          expect(ownedDirs.sort()).toEqual(Object.keys(mcpServers).sort());
        } finally {
          fs.rmSync(pluginRoot, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  });
});
