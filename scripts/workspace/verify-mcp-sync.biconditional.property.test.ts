// Feature: codebase-cleanup-plugin-registration, Property 5: Verification pass biconditional

/**
 * Feature: codebase-cleanup-plugin-registration
 * Property 5: Verification pass biconditional
 *
 * For all top-level `mcp.json` states, the redesigned `verify:mcp-sync` reports
 * pass if and only if the count of toolkit-owned entries is zero; when it fails,
 * every offending server is named.
 *
 * Validates: Requirements 2.4
 * Design: Property 5
 *
 * ── Testing approach ─────────────────────────────────────────────────────────
 * The redesigned `verify-mcp-sync.js` runs its checks at module load and calls
 * `process.exit`, and its Check 4 reads the real `~/.lmstudio/mcp.json` from disk.
 * It cannot be imported to drive against arbitrary in-memory states without
 * touching the real user file. Following the same faithful-mirror pattern the
 * sibling sync property tests use (sync-provisioning.property.test.ts mirrors the
 * provisioning loop; the env-merge test re-implements the merge logic), this test
 * re-implements Check 4's toolkit-owned-detection and pass/fail decision exactly
 * as `verify-mcp-sync.js` performs it, and drives it against generated in-memory
 * `mcp.json` states. It uses the REAL ownership constants and the REAL registered
 * server names from the production modules, so it exercises the actual
 * `_owner: "llm-toolkit"` marker value, the actual legacy names, and the actual
 * registered set — never the real ~/.lmstudio directory.
 */

import * as fc from "fast-check";

// Real ownership constants from the production module: the exact `_owner` marker
// value (OWNER_ID) and the legacy plugin names that Check 4 treats as toolkit-owned.
const { OWNER_ID, LEGACY_PLUGIN_NAMES } = require("./plugin-ownership");
// Real registered runtime-server names — Check 4 also treats any top-level key
// matching a registered server name as toolkit-owned.
const { buildMcpServers } = require("./mcp-config");

/**
 * Faithful replica of Check 4 from `scripts/workspace/verify-mcp-sync.js`.
 *
 * Given the set of toolkit-owned names (registered server names + legacy names)
 * and an in-memory top-level `mcp.json` object, this mirrors the script's logic:
 *
 *   - A file that is absent/empty or has no `mcpServers` object is a pass with no
 *     offenders (Check 4's early "file absent or empty" branch).
 *   - Otherwise an entry is toolkit-owned if its key is a known toolkit name OR
 *     its value carries `_owner === OWNER_ID`.
 *   - Pass iff there are zero offenders; on failure the offenders list names every
 *     offending server.
 *
 * Returns `{ pass, offenders }` — `pass` mirrors the exit-0 (no failures) outcome
 * for this check, and `offenders` is the per-offense diagnostic list.
 */
function evaluateTopLevelCheck(
  toolkitOwnedNames: Set<string>,
  topLevel: unknown,
): { pass: boolean; offenders: string[] } {
  if (
    !topLevel ||
    typeof topLevel !== "object" ||
    !(topLevel as { mcpServers?: unknown }).mcpServers
  ) {
    return { pass: true, offenders: [] };
  }

  const offenders: string[] = [];
  const mcpServers = (topLevel as { mcpServers: Record<string, unknown> }).mcpServers;
  for (const [name, entry] of Object.entries(mcpServers)) {
    const isNamedToolkit = toolkitOwnedNames.has(name);
    const isMarkedToolkit =
      entry !== null &&
      typeof entry === "object" &&
      (entry as { _owner?: unknown })._owner === OWNER_ID;
    if (isNamedToolkit || isMarkedToolkit) {
      offenders.push(name);
    }
  }

  return { pass: offenders.length === 0, offenders };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/**
 * Names that the check must classify as toolkit-owned: the real registered
 * runtime-server names plus the real legacy plugin names.
 */
function buildToolkitOwnedNames(): Set<string> {
  // buildMcpServers() may warn about external binaries not being on PATH; silence
  // that noise for the duration of the read.
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { mcpServers } = buildMcpServers();
    return new Set<string>([...Object.keys(mcpServers), ...LEGACY_PLUGIN_NAMES]);
  } finally {
    console.warn = originalWarn;
  }
}

const TOOLKIT_OWNED_NAMES = buildToolkitOwnedNames();
const TOOLKIT_NAME_LIST = [...TOOLKIT_OWNED_NAMES];

/** A name that is NOT a toolkit name (a third-party server the user configured). */
const nonToolkitNameArb = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")), {
    minLength: 1,
    maxLength: 20,
  })
  .filter((name) => name.length > 0 && !TOOLKIT_OWNED_NAMES.has(name));

/** An entry object carrying the real toolkit ownership marker. */
const markedToolkitEntryArb = fc.record({
  command: fc.constant("node"),
  args: fc.array(fc.string({ maxLength: 20 }), { maxLength: 2 }),
  _owner: fc.constant(OWNER_ID),
});

/** A plain third-party entry with no ownership marker. */
const nonToolkitEntryArb = fc.record({
  command: fc.string({ minLength: 1, maxLength: 12 }),
  args: fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
});

/**
 * A single generated top-level entry, tagged with whether it should be counted
 * as a toolkit-owned offender. Three flavors:
 *   1. name matches a registered/legacy toolkit name  → offender
 *   2. arbitrary name + `_owner: OWNER_ID` marker      → offender
 *   3. non-toolkit name + no marker                    → not an offender
 */
const namedToolkitEntryArb =
  TOOLKIT_NAME_LIST.length > 0
    ? fc
        .tuple(fc.constantFrom(...TOOLKIT_NAME_LIST), nonToolkitEntryArb)
        .map(([name, entry]) => ({ name, entry, offender: true }))
    : fc
        // Fallback (should never happen: there are always ≥16 registered names)
        .tuple(nonToolkitNameArb, markedToolkitEntryArb)
        .map(([name, entry]) => ({ name, entry, offender: true }));

const markedByOwnerEntryArb = fc
  .tuple(nonToolkitNameArb, markedToolkitEntryArb)
  .map(([name, entry]) => ({ name, entry, offender: true }));

const cleanEntryArb = fc
  .tuple(nonToolkitNameArb, nonToolkitEntryArb)
  .map(([name, entry]) => ({ name, entry, offender: false }));

const taggedEntryArb = fc.oneof(namedToolkitEntryArb, markedByOwnerEntryArb, cleanEntryArb);

/**
 * An arbitrary in-memory top-level `mcp.json` state: an arbitrary mix of
 * toolkit-owned and non-toolkit entries, deduplicated by key (later keys win,
 * carrying their offender tag), plus the expected offender set.
 */
const mcpJsonStateArb = fc.array(taggedEntryArb, { minLength: 0, maxLength: 12 }).map((entries) => {
  const mcpServers: Record<string, unknown> = {};
  const offenderByName = new Map<string, boolean>();
  for (const { name, entry, offender } of entries) {
    mcpServers[name] = entry;
    offenderByName.set(name, offender);
  }
  const expectedOffenders = [...offenderByName.entries()]
    .filter(([, isOffender]) => isOffender)
    .map(([name]) => name);
  return { topLevel: { mcpServers }, expectedOffenders };
});

// ─── Property Test ───────────────────────────────────────────────────────────

describe("Feature: codebase-cleanup-plugin-registration", () => {
  /**
   * Feature: codebase-cleanup-plugin-registration, Property 5: Verification pass biconditional
   *
   * Validates: Requirements 2.4
   * Design: Property 5
   */
  describe("Property 5: Verification pass biconditional", () => {
    it("reports pass iff zero toolkit-owned entries, and names every offender on failure", () => {
      fc.assert(
        fc.property(mcpJsonStateArb, ({ topLevel, expectedOffenders }) => {
          const { pass, offenders } = evaluateTopLevelCheck(TOOLKIT_OWNED_NAMES, topLevel);

          // Biconditional: pass ⇔ zero toolkit-owned entries.
          expect(pass).toBe(expectedOffenders.length === 0);

          // On failure, every offending server is named (set equality, order-free).
          expect(new Set(offenders)).toEqual(new Set(expectedOffenders));
          // And a failure names at least one offender; a pass names none.
          expect(offenders.length === 0).toBe(pass);
        }),
        { numRuns: 200 },
      );
    });

    it("passes when the top-level mcp.json is absent, empty, or has no mcpServers", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant({}),
            fc.constant({ mcpServers: undefined }),
            fc.record({ other: fc.string() }),
          ),
          (topLevel) => {
            const { pass, offenders } = evaluateTopLevelCheck(TOOLKIT_OWNED_NAMES, topLevel);
            expect(pass).toBe(true);
            expect(offenders).toEqual([]);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("passes when every entry is a non-toolkit third-party server", () => {
      const onlyCleanStateArb = fc
        .array(cleanEntryArb, { minLength: 1, maxLength: 10 })
        .map((entries) => {
          const mcpServers: Record<string, unknown> = {};
          for (const { name, entry } of entries) mcpServers[name] = entry;
          return { mcpServers };
        });

      fc.assert(
        fc.property(onlyCleanStateArb, (topLevel) => {
          const { pass, offenders } = evaluateTopLevelCheck(TOOLKIT_OWNED_NAMES, topLevel);
          expect(pass).toBe(true);
          expect(offenders).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });
  });
});
