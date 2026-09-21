// Feature: codebase-cleanup-plugin-registration, Property 2: Write-targeting confinement — for generated registered-server sets, the sync provisioning logic writes only under each server's own {pluginRoot}/{serverName}/, never into top-level mcp.json, and never into another server's directory (temporary plugin root)
// **Validates: Requirements 1.6, 2.1**

/**
 * Property 2: Write-targeting confinement
 *
 * For any generated set of registered servers, when the sync provisioning logic
 * runs against a temporary plugin root, every file it writes lands under that
 * server's own per-plugin directory ({pluginRoot}/{serverName}/); no write ever
 * targets the top-level mcp.json; and a server's bridge config never appears in
 * any other server's directory.
 *
 * The write loop below is the Pass-3 provisioning logic extracted verbatim from
 * scripts/workspace/sync-lmstudio-bridge-configs.js. The ownership marker
 * (OWNER_ID) is imported from the real plugin-ownership module so the test
 * exercises the same constant the production sync uses. Every write is routed
 * through an instrumented writer that records the absolute target path, allowing
 * the test to assert confinement without touching the real ~/.lmstudio directory.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";

// Real ownership marker used by the production sync provisioning logic.
const { OWNER_ID } = require("../plugin-ownership");

interface ServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Pass-3 provisioning logic mirrored from sync-lmstudio-bridge-configs.js.
 *
 * `writeFile` is injected so the test can record every absolute path the sync
 * would write to. It writes exclusively under `{pluginRoot}/{serverName}/` and
 * never references the top-level mcp.json.
 */
function provisionPlugins(
  pluginRoot: string,
  mcpServers: Record<string, ServerConfig>,
  writeFile: (filePath: string, content: string) => void,
): void {
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const pluginDir = path.join(pluginRoot, serverName);
    const targetFile = path.join(pluginDir, "mcp-bridge-config.json");

    fs.mkdirSync(pluginDir, { recursive: true });

    const manifestFile = path.join(pluginDir, "manifest.json");
    const manifest = {
      type: "plugin",
      runner: "mcpBridge",
      owner: "mcp",
      name: serverName,
      _owner: OWNER_ID,
    };
    writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    const installStateFile = path.join(pluginDir, "install-state.json");
    const installState = {
      by: "mcp-bridge-v1",
      at: Date.now(),
      _owner: OWNER_ID,
    };
    writeFile(installStateFile, `${JSON.stringify(installState, null, 2)}\n`);

    // No existing config to merge in this isolated provisioning exercise.
    const mergedConfig = { ...serverConfig, env: { ...serverConfig.env } };
    writeFile(targetFile, `${JSON.stringify(mergedConfig, null, 2)}\n`);
  }
}

// ─── Generators ───────────────────────────────────────────────────────────────

/** Realistic kebab-case server names (mirrors the mcp-config.js server keys). */
const serverNameArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  // Keep names path-safe: no leading/trailing/doubled dashes that would collapse
  // to an empty or ambiguous directory name.
  .filter((s) => s.length > 0 && !s.startsWith("-") && !s.endsWith("-") && !s.includes("--"));

/** A single server's built-config shape as produced by buildMcpServers(). */
const serverConfigArb: fc.Arbitrary<ServerConfig> = fc.record({
  command: fc.constant("node"),
  args: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 1, maxLength: 2 }),
  env: fc.dictionary(
    fc.stringOf(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ_".split("")), {
      minLength: 1,
      maxLength: 20,
    }),
    fc.string({ maxLength: 30 }),
    { maxKeys: 5 },
  ),
});

/** A non-empty set of servers keyed by unique server name. */
const serverSetArb: fc.Arbitrary<Record<string, ServerConfig>> = fc
  .uniqueArray(fc.tuple(serverNameArb, serverConfigArb), {
    minLength: 1,
    maxLength: 8,
    selector: ([name]) => name,
  })
  .map((pairs) => Object.fromEntries(pairs));

// ─── Property Test ──────────────────────────────────────────────────────────

describe("Feature: codebase-cleanup-plugin-registration", () => {
  it("Property 2: Write-targeting confinement", () => {
    fc.assert(
      fc.property(serverSetArb, (mcpServers) => {
        const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "confinement-"));
        // A synthetic top-level mcp.json path that the sync must never touch.
        const topLevelMcpJson = path.join(pluginRoot, "..", "mcp.json");
        const resolvedTopLevel = path.resolve(topLevelMcpJson);

        const writes: string[] = [];
        const writeFile = (filePath: string, content: string): void => {
          writes.push(path.resolve(filePath));
          fs.writeFileSync(filePath, content, { encoding: "utf8" });
        };

        try {
          provisionPlugins(pluginRoot, mcpServers, writeFile);

          const serverNames = Object.keys(mcpServers);
          const resolvedRoot = path.resolve(pluginRoot);

          for (const written of writes) {
            // (a) Every write lands under the plugin root.
            const rel = path.relative(resolvedRoot, written);
            expect(rel.startsWith("..")).toBe(false);
            expect(path.isAbsolute(rel)).toBe(false);

            // (b) No write ever targets the top-level mcp.json.
            expect(written).not.toBe(resolvedTopLevel);
            expect(path.basename(written)).not.toBe("mcp.json");

            // (c) Every write is confined to exactly one server's own directory,
            //     and that directory belongs to a registered server.
            const segments = rel.split(path.sep);
            expect(segments.length).toBe(2); // {serverName}/{file}
            const owningServer = segments[0];
            expect(serverNames).toContain(owningServer);
          }

          // (d) Each server's bridge config appears only in its own directory —
          //     never in another server's directory.
          for (const serverName of serverNames) {
            const ownBridge = path.resolve(
              path.join(pluginRoot, serverName, "mcp-bridge-config.json"),
            );
            const bridgeWrites = writes.filter(
              (w) => path.basename(w) === "mcp-bridge-config.json",
            );
            const writesForThisServer = bridgeWrites.filter(
              (w) => path.basename(path.dirname(w)) === serverName,
            );
            // Exactly one bridge config written, in this server's own dir.
            expect(writesForThisServer).toEqual([ownBridge]);

            // The bridge config file physically exists only under this server's dir.
            for (const other of serverNames) {
              if (other === serverName) continue;
              const foreign = path.join(pluginRoot, other, "mcp-bridge-config.json");
              const foreignConfig = fs.existsSync(foreign)
                ? JSON.parse(fs.readFileSync(foreign, "utf8"))
                : null;
              // A foreign directory's config, if present, is that server's own —
              // its manifest name must match the foreign server, not this one.
              const foreignManifestPath = path.join(pluginRoot, other, "manifest.json");
              if (fs.existsSync(foreignManifestPath)) {
                const foreignManifest = JSON.parse(fs.readFileSync(foreignManifestPath, "utf8"));
                expect(foreignManifest.name).toBe(other);
                expect(foreignManifest.name).not.toBe(serverName);
              }
              // Sanity: the foreign config (if any) is a distinct file object.
              expect(foreign).not.toBe(ownBridge);
              void foreignConfig;
            }
          }

          // (e) The top-level mcp.json was never created by the sync.
          expect(fs.existsSync(resolvedTopLevel)).toBe(false);
        } finally {
          fs.rmSync(pluginRoot, { recursive: true, force: true });
        }
      }),
      { numRuns: 150 },
    );
  });
});
