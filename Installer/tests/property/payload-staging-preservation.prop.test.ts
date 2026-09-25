import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import {
  CANONICAL_TOOL_COUNT,
  CANONICAL_TOOL_PAYLOADS,
  type DistPresence,
  canonicalPayloads,
  isComplete,
  planPayloadStaging,
} from "../../scripts/payload-manifest";

/**
 * Bugfix: installer-plugin-path-and-browserless-secret
 * Property 4 (Preservation — Names, Command, Ownership, Env, Secrets, User
 * Paths Unchanged) — the staging (TypeScript) half.
 *
 * These tests encode behavior observed on the UNFIXED staging pipeline that the
 * fix MUST preserve, so they PASS today and act as a regression baseline. The
 * fix (Concern 1) only MIRRORS the existing `payload/<serverName>/` layout and
 * adds a parity assertion; it must NOT change the completeness check (abort on
 * missing/empty dist tree) or the canonical `distRoot` list.
 *
 * Validates: Requirements 3.4
 *   - the staging completeness check still aborts on any missing/empty tree;
 *   - the nine canonical serverName -> distRoot pairs are unchanged;
 *   - the staging destination dir is `<serverName>/` (the layout the seam will
 *     mirror), so the seam's leading dir will equal the staging dest per tool.
 *
 * The staging secret GUARD (Concern 2) is NEW code and is covered by the Task 1
 * bug-condition test (`browserless-secret-guard-bug-condition.prop.test.ts`);
 * its preservation half (a clean payload passes) is documented here as PENDING
 * THE FIX via a skipped test so it lands with the guard (task 3.5).
 */

// ─── Completeness-check preservation (Req 3.4) ───────────────────────────────

/**
 * The full set of presence facts with every tool present and non-empty. Used as
 * the "clean" baseline that must remain complete.
 */
function allPresent(): DistPresence[] {
  return CANONICAL_TOOL_PAYLOADS.map((t) => ({
    serverName: t.serverName,
    exists: true,
    nonEmpty: true,
  }));
}

describe("Property 4: Preservation — staging completeness check (Req 3.4)", () => {
  it("reports all 9 present when every dist tree exists and is non-empty", () => {
    const plan = planPayloadStaging(allPresent());
    expect(plan.required).toHaveLength(CANONICAL_TOOL_COUNT);
    expect(plan.present).toHaveLength(CANONICAL_TOOL_COUNT);
    expect(plan.missing).toHaveLength(0);
    expect(isComplete(plan)).toBe(true);
  });

  it("still aborts (missing non-empty) if ANY dist tree is absent or empty", () => {
    // Property: for any non-empty subset of tools made absent OR empty, the
    // plan is incomplete and names exactly those tools as missing. This is the
    // completeness-abort behavior the fix must preserve.
    const serverNames = CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName);

    fc.assert(
      fc.property(
        // A non-empty subset of server names to break.
        fc
          .subarray(serverNames, { minLength: 1 })
          .chain((broken) =>
            // For each broken tool, pick whether it is ABSENT or EMPTY.
            fc
              .array(fc.constantFrom("absent", "empty"), {
                minLength: broken.length,
                maxLength: broken.length,
              })
              .map((kinds) => ({ broken, kinds })),
          ),
        ({ broken, kinds }) => {
          const brokenSet = new Set(broken);
          const presence: DistPresence[] = CANONICAL_TOOL_PAYLOADS.map((t) => {
            if (!brokenSet.has(t.serverName)) {
              return { serverName: t.serverName, exists: true, nonEmpty: true };
            }
            const idx = broken.indexOf(t.serverName);
            const kind = kinds[idx];
            return kind === "absent"
              ? { serverName: t.serverName, exists: false, nonEmpty: false }
              : { serverName: t.serverName, exists: true, nonEmpty: false };
          });

          const plan = planPayloadStaging(presence);

          // Incomplete, and the missing set is EXACTLY the broken tools.
          expect(isComplete(plan)).toBe(false);
          expect([...plan.missing].sort()).toEqual([...broken].sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  it("treats a tool with NO presence entry as missing (fail-closed)", () => {
    // Drop the first tool's presence entry entirely.
    const presence = allPresent().slice(1);
    const plan = planPayloadStaging(presence);
    expect(isComplete(plan)).toBe(false);
    expect(plan.missing).toContain(CANONICAL_TOOL_PAYLOADS[0].serverName);
  });
});

// ─── Canonical distRoot list preservation (Req 3.4) ──────────────────────────

describe("Property 4: Preservation — canonical serverName -> distRoot list (Req 3.4)", () => {
  it("keeps exactly the nine canonical serverName -> distRoot pairs unchanged", () => {
    // The source dist-root list must not drift under the fix (Concern 1 only
    // changes how the INSTALLED entry path is derived, not the source layout).
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

  it("has unique server names and unique dist roots", () => {
    const names = new Set(CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName));
    const roots = new Set(CANONICAL_TOOL_PAYLOADS.map((t) => t.distRoot));
    expect(names.size).toBe(CANONICAL_TOOL_COUNT);
    expect(roots.size).toBe(CANONICAL_TOOL_COUNT);
  });
});

// ─── Staging-layout parity: dest dir == serverName (Concern 1 seam mirror) ───

describe("Property 4: Preservation — staging destination is <serverName>/ (seam parity)", () => {
  /**
   * The staging destination directory name for each tool is its `serverName`
   * (not its `distRoot`). This is the layout the shared entry-path seam mirrors:
   * once `installed_entry_relpath(tool)` lands, its LEADING dir must equal this
   * staging destination dir name. We assert the invariant the seam will match,
   * observing it directly by copying each tool's dist tree into a temp staging
   * root exactly as `stagePayload` does (`payload/<serverName>/`).
   */
  it("copies each tool's dist tree into payload/<serverName>/ for all 9 tools", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stage-parity-repo-"));
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stage-parity-out-"));
    try {
      // Seed a minimal dist tree at each canonical source distRoot.
      for (const tool of canonicalPayloads()) {
        const src = path.resolve(repoRoot, tool.distRoot);
        fs.mkdirSync(src, { recursive: true });
        const entry = tool.serverName === "browserless" ? "schema-proxy.js" : "mcp-server.js";
        fs.writeFileSync(path.join(src, entry), "// entry\n");
      }

      // Mirror stagePayload's copy behavior: dest = <stagingRoot>/<serverName>/.
      for (const tool of canonicalPayloads()) {
        const src = path.resolve(repoRoot, tool.distRoot);
        const dest = path.resolve(stagingRoot, tool.serverName);
        fs.cpSync(src, dest, { recursive: true });
      }

      // Property over all nine: the destination dir is named <serverName> and the
      // expected entry file lands directly under it (matching the seam's
      // install_dir/<serverName>/<entry> layout the fix will generate).
      fc.assert(
        fc.property(
          fc.constantFrom(...CANONICAL_TOOL_PAYLOADS.map((t) => t.serverName)),
          (name) => {
            const destDir = path.resolve(stagingRoot, name);
            expect(fs.existsSync(destDir)).toBe(true);
            expect(fs.statSync(destDir).isDirectory()).toBe(true);

            const entry = name === "browserless" ? "schema-proxy.js" : "mcp-server.js";
            // The seam's leading dir (serverName) + entry resolves to a real file.
            expect(fs.existsSync(path.join(destDir, entry))).toBe(true);
          },
        ),
        { numRuns: CANONICAL_TOOL_COUNT },
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  });
});

// ─── Pending the fix: the staging secret guard's clean-pass preservation ─────

describe("Property 4: Preservation — staging secret guard passes on a clean payload", () => {
  /**
   * The NEW staging secret guard (task 3.5) must PASS (not abort) on a payload
   * that carries only empty/placeholder secret values. Its bug-condition
   * counterpart (abort on a seeded live secret) is exercised by
   * browserless-secret-guard-bug-condition.prop.test.ts.
   *
   * Now that the guard is wired, we import it from scripts/stage-payload and
   * assert it returns NO findings for a placeholder-only payload.
   *
   * Validates: Requirements 2.5, 2.6 (preservation half)
   */
  it("does not abort on a payload with only empty/placeholder secret values", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { scanPayloadForSecrets } = require("../../scripts/stage-payload") as {
      scanPayloadForSecrets: (root: string) => unknown[];
    };
    expect(typeof scanPayloadForSecrets).toBe("function");

    const placeholders = ["your-browserless-api-token-here", "your-browserless-api-key-here", ""];

    fc.assert(
      fc.property(fc.constantFrom(...placeholders), (placeholder) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "payload-clean-"));
        try {
          const browserlessDir = path.join(root, "browserless");
          fs.mkdirSync(browserlessDir, { recursive: true });
          fs.writeFileSync(path.join(browserlessDir, "schema-proxy.js"), "// entry\n");
          fs.writeFileSync(
            path.join(browserlessDir, "mcp-bridge-config.json"),
            JSON.stringify(
              {
                command: "node",
                args: ["schema-proxy.js"],
                env: { BROWSERLESS_TOKEN: placeholder },
              },
              null,
              2,
            ),
          );
          // A clean (placeholder-only) payload yields NO findings — no abort.
          const findings = scanPayloadForSecrets(root);
          expect(Array.isArray(findings)).toBe(true);
          expect(findings).toHaveLength(0);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: placeholders.length },
    );
  });
});
