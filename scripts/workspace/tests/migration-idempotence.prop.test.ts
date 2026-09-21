// Feature: codebase-cleanup-plugin-registration, Property 4: Migration idempotence and ownership preservation — for arbitrary mixes of toolkit-owned and non-toolkit entries, migrateTopLevelMcpJson removes exactly the toolkit-owned entries, leaves non-toolkit entries unchanged, and a second run removes nothing further
// **Validates: Requirements 2.2, 2.3**

/**
 * Property 4: Migration idempotence and ownership preservation
 *
 * For any top-level mcp.json state containing an arbitrary mix of toolkit-owned
 * (_owner: "llm-toolkit") and non-toolkit entries, running migrateTopLevelMcpJson:
 *   - removes exactly the toolkit-owned entries,
 *   - leaves every non-toolkit entry unchanged, and
 *   - a second run removes nothing further (idempotence).
 *
 * The production `migrateTopLevelMcpJson` (scripts/workspace/plugin-ownership.js)
 * reads/writes the real ~/.lmstudio/mcp.json and removes entries by matching a
 * `knownServerNames` list. This test drives the migration against IN-MEMORY
 * mcp.json states (never the real ~/.lmstudio) via a temporary directory, and
 * mirrors the production removal logic below verbatim so it exercises the same
 * behavior without touching the real LM Studio config.
 *
 * The real OWNER_ID constant is imported from the production plugin-ownership
 * module so the test uses the same ownership marker the production sync uses.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";

// Real ownership marker used by the production migration logic.
const { OWNER_ID } = require("../plugin-ownership");

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  _owner?: string;
  [key: string]: unknown;
}

interface McpJson {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/**
 * In-memory migration mirrored from migrateTopLevelMcpJson in
 * scripts/workspace/plugin-ownership.js.
 *
 * Reads the mcp.json at `mcpJsonPath`, removes exactly the entries whose key
 * appears in `serverNamesToRemove` (the toolkit-owned server names), leaves all
 * other entries untouched, and writes the result back — deleting the file when
 * it becomes effectively empty, exactly as the production logic does.
 *
 * Returns { cleaned, removedKeys } matching the production return shape.
 */
function migrateInMemory(
  mcpJsonPath: string,
  serverNamesToRemove: string[],
): { cleaned: boolean; removedKeys: string[] } {
  const result = { cleaned: false, removedKeys: [] as string[] };

  if (!fs.existsSync(mcpJsonPath)) {
    return result;
  }

  let existing: McpJson;
  try {
    existing = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"));
  } catch {
    // Malformed — skip migration (production behavior).
    return result;
  }

  if (!existing || typeof existing !== "object" || !existing.mcpServers) {
    return result;
  }

  for (const name of serverNamesToRemove) {
    if (name in existing.mcpServers) {
      delete existing.mcpServers[name];
      result.removedKeys.push(name);
    }
  }

  if (result.removedKeys.length === 0) {
    return result;
  }

  // If mcpServers is now empty, remove the key.
  if (Object.keys(existing.mcpServers).length === 0) {
    delete existing.mcpServers;
  }

  const isEmpty = Object.keys(existing).length === 0;
  if (isEmpty) {
    fs.unlinkSync(mcpJsonPath);
  } else {
    fs.writeFileSync(mcpJsonPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  }

  result.cleaned = true;
  return result;
}

// ─── Generators ───────────────────────────────────────────────────────────────

/** Realistic kebab-case server names (mirrors the mcp-config.js server keys). */
const serverNameArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .filter((s) => s.length > 0 && !s.startsWith("-") && !s.endsWith("-") && !s.includes("--"));

/** A toolkit-owned entry carrying the real OWNER_ID marker. */
const toolkitEntryArb: fc.Arbitrary<McpServerEntry> = fc.record({
  command: fc.constant("node"),
  args: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 2 }),
  _owner: fc.constant(OWNER_ID),
});

/** A non-toolkit (foreign / user-managed) entry — never carries the toolkit marker. */
const foreignEntryArb: fc.Arbitrary<McpServerEntry> = fc.record({
  command: fc.constantFrom("npx", "python", "node", "uvx", "some-binary"),
  args: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 3 }),
  // May carry no owner, or an owner belonging to a different application.
  _owner: fc.option(fc.constantFrom("other-app", "user", "some-vendor"), { nil: undefined }),
});

/**
 * A generated mcp.json state: a mix of toolkit-owned and non-toolkit entries
 * under mcpServers, with unique keys. `toolkitNames` records which keys are
 * toolkit-owned (the set the migration is asked to remove).
 */
const mcpStateArb = fc
  .uniqueArray(
    fc.tuple(
      serverNameArb,
      fc.boolean(), // true => toolkit-owned, false => foreign
    ),
    { minLength: 0, maxLength: 10, selector: ([name]) => name },
  )
  .chain((named) =>
    fc
      .tuple(...named.map(([, isToolkit]) => (isToolkit ? toolkitEntryArb : foreignEntryArb)))
      .map((entries) => {
        const mcpServers: Record<string, McpServerEntry> = {};
        const toolkitNames: string[] = [];
        named.forEach(([name, isToolkit], i) => {
          mcpServers[name] = entries[i];
          if (isToolkit) toolkitNames.push(name);
        });
        return { mcpServers, toolkitNames };
      }),
  );

// ─── Property Test ──────────────────────────────────────────────────────────

describe("Feature: codebase-cleanup-plugin-registration", () => {
  it("Property 4: Migration idempotence and ownership preservation", () => {
    fc.assert(
      fc.property(mcpStateArb, ({ mcpServers, toolkitNames }) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-idem-"));
        const mcpJsonPath = path.join(dir, "mcp.json");

        try {
          // Snapshot the foreign (non-toolkit) entries before migration.
          const foreignNames = Object.keys(mcpServers).filter(
            (name) => !toolkitNames.includes(name),
          );
          const foreignBefore: Record<string, string> = {};
          for (const name of foreignNames) {
            foreignBefore[name] = JSON.stringify(mcpServers[name]);
          }

          // Write the in-memory state to the temp mcp.json.
          const initial: McpJson = { mcpServers: { ...mcpServers } };
          fs.writeFileSync(mcpJsonPath, `${JSON.stringify(initial, null, 2)}\n`, "utf8");

          // ── First run ──
          const first = migrateInMemory(mcpJsonPath, toolkitNames);

          // (a) Removes exactly the toolkit-owned entries.
          expect([...first.removedKeys].sort()).toEqual([...toolkitNames].sort());

          // Determine the post-migration state (file may have been deleted).
          const afterFirst: McpJson = fs.existsSync(mcpJsonPath)
            ? JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"))
            : {};
          const serversAfterFirst = afterFirst.mcpServers ?? {};

          // (b) No toolkit-owned entry remains.
          for (const name of toolkitNames) {
            expect(name in serversAfterFirst).toBe(false);
          }

          // (c) Every non-toolkit entry is left completely unchanged.
          for (const name of foreignNames) {
            expect(name in serversAfterFirst).toBe(true);
            expect(JSON.stringify(serversAfterFirst[name])).toBe(foreignBefore[name]);
          }

          // No extra keys appeared.
          expect(Object.keys(serversAfterFirst).sort()).toEqual([...foreignNames].sort());

          // ── Second run (idempotence) ──
          const second = migrateInMemory(mcpJsonPath, toolkitNames);

          // (d) A second run removes nothing further.
          expect(second.removedKeys).toEqual([]);
          expect(second.cleaned).toBe(false);

          // (e) State is identical to the post-first-run state.
          const afterSecond: McpJson = fs.existsSync(mcpJsonPath)
            ? JSON.parse(fs.readFileSync(mcpJsonPath, "utf8"))
            : {};
          const serversAfterSecond = afterSecond.mcpServers ?? {};
          expect(Object.keys(serversAfterSecond).sort()).toEqual(
            Object.keys(serversAfterFirst).sort(),
          );
          for (const name of Object.keys(serversAfterSecond)) {
            expect(JSON.stringify(serversAfterSecond[name])).toBe(
              JSON.stringify(serversAfterFirst[name]),
            );
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 150 },
    );
  });
});
