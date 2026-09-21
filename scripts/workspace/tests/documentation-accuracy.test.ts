// Documentation-accuracy assertion tests.
// Feature: codebase-cleanup-plugin-registration
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 4.4**
//
// These tests lock in the outcome of task 10.2 (reconcile documentation) by
// asserting the substantive accuracy claims across the primary toolkit
// documentation: README.md and every file under docs/. They cover:
//
//   6.1 — the primary documented TOOLKIT version string equals the root
//         package.json `version` (exactly, character-for-character), and no
//         stale pre-cleanup toolkit version is presented as the toolkit version.
//   6.2 / 6.3 — the registered plugin-entry count is 16, stated consistently
//         (with the `common`-bundles-4 + Browserless-schema-proxy note), with no
//         conflicting alternative *server/plugin* count.
//   6.4 — ECM is never presented as an active runtime server.
//   6.5 — the plugin-only configuration model is described as the sole method.
//   6.6 — no `mcp.json` example block and no hand-edit instruction (README hygiene).
//   6.7 — no claims describing deprecated / removed / absent features.
//   4.4 — Tool_Call_Normalization is documented as a single unified method that
//         every entry point routes through.
//
// ── Scoping notes (deliberate carve-outs) ────────────────────────────────────
// Requirement 6.1 talks about "the documentation" version. The repo currently
// hosts a concurrent `v2-4-0` feature whose artifacts (shared/config, Installer
// manifests) were intentionally left at 2.x, and whose name/version is
// legitimately referenced in docs (e.g. docs/VNEXT_FEATURES.md, release target
// `v2.4.0`). Per-workspace component READMEs (3DTool, SubAgent, Memory, …) also
// carry their own component version labels. None of those are the *toolkit*
// version claim.
//
// So the version assertion is scoped to the TOOLKIT-LEVEL version claim — the
// `**Version**: X` front-matter/footer lines in README.md and docs/ that
// describe the toolkit as a whole. Those must all equal the root package.json
// `version`. Incidental mentions of the concurrent feature's version and
// per-workspace component versions are out of scope and not asserted here.

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const README_PATH = path.join(REPO_ROOT, "README.md");
const DOCS_DIR = path.join(REPO_ROOT, "docs");

// Reuse the production README-hygiene detector so the 6.6 assertion exercises
// the exact same logic the verify:mcp-sync gate runs.
const { findReadmeOffenses } = require("../verify-mcp-sync");

const AUTHORITATIVE_COUNT = 16;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

/** All primary toolkit documentation files: README.md + every file under docs/. */
function collectToolkitDocFiles(): string[] {
  const files: string[] = [README_PATH];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(abs);
      }
    }
  };
  if (fs.existsSync(DOCS_DIR)) {
    walk(DOCS_DIR);
  }
  return files;
}

function toRepoRelative(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

/** The root package.json `version` field — the single source of truth (6.1). */
function rootPackageVersion(): string {
  const pkg = JSON.parse(readFile(path.join(REPO_ROOT, "package.json")));
  return pkg.version;
}

/**
 * Extract toolkit-level `**Version**: X` claims from a doc. Returns the version
 * token(s) found. A blank/placeholder value (e.g. a template's `________`) is
 * ignored — it is not a concrete version claim.
 */
function extractToolkitVersionClaims(content: string): string[] {
  const claims: string[] = [];
  const re = /^\*\*Version\*\*:\s*([^\s].*?)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const value = m[1].trim().replace(/`/g, "");
    // Ignore placeholder/template lines (release checklist blank field).
    if (/^_+$/.test(value) || value.length === 0) continue;
    claims.push(value);
  }
  return claims;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Feature: codebase-cleanup-plugin-registration — documentation accuracy", () => {
  let readme: string;
  let docFiles: string[];
  let pkgVersion: string;

  beforeAll(() => {
    readme = readFile(README_PATH);
    docFiles = collectToolkitDocFiles();
    pkgVersion = rootPackageVersion();
  });

  // ── Requirement 6.1: single toolkit version string equal to package.json ────
  describe("version accuracy (Requirement 6.1)", () => {
    it("root package.json declares a concrete version", () => {
      expect(typeof pkgVersion).toBe("string");
      expect(pkgVersion.length).toBeGreaterThan(0);
    });

    it("the README states the toolkit version and it equals package.json exactly", () => {
      const claims = extractToolkitVersionClaims(readme);
      // The README must carry a toolkit version claim.
      expect(claims.length).toBeGreaterThan(0);
      for (const claim of claims) {
        expect(claim).toBe(pkgVersion);
      }
    });

    it("every toolkit-level `**Version**:` claim across docs equals package.json exactly", () => {
      const offenders: Array<{ file: string; claim: string }> = [];
      for (const file of docFiles) {
        const claims = extractToolkitVersionClaims(readFile(file));
        for (const claim of claims) {
          if (claim !== pkgVersion) {
            offenders.push({ file: toRepoRelative(file), claim });
          }
        }
      }
      // Any toolkit-level version claim that disagrees with package.json is a
      // documentation-accuracy failure (6.1).
      expect(offenders).toEqual([]);
    });

    it("no toolkit-level version claim presents a stale pre-cleanup toolkit version", () => {
      // The root toolkit version before this cleanup was 2.3.2 (root
      // package.json) — it must never re-appear as a *toolkit* version claim.
      // (This is distinct from per-workspace component versions, which are not
      // toolkit-level `**Version**:` claims and are not scanned here.)
      const STALE_TOOLKIT_VERSIONS = ["2.3.2"];
      const offenders: Array<{ file: string; claim: string }> = [];
      for (const file of docFiles) {
        for (const claim of extractToolkitVersionClaims(readFile(file))) {
          if (STALE_TOOLKIT_VERSIONS.includes(claim)) {
            offenders.push({ file: toRepoRelative(file), claim });
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  // ── Requirements 6.2 / 6.3: authoritative count of 16, no conflicts ─────────
  describe("registered plugin-entry count (Requirements 6.2, 6.3)", () => {
    it("README states the authoritative count of 16 with the bundling/schema-proxy note", () => {
      expect(readme).toMatch(/\b16\b\s+(registered\s+)?plugin\s+entr(y|ies)/i);
      // `common` bundles 4 tools.
      expect(readme).toMatch(/common[^\n]*bundle[^\n]*4\s+tools/i);
      expect(readme).toMatch(/Calculator[^\n]*Clock[^\n]*AskUser[^\n]*DocumentScraper/i);
      // Browserless registers via the schema-proxy wrapper.
      expect(readme).toMatch(/Browserless[^\n]*schema-proxy/i);
    });

    it("the docs registration guides state the count of 16 with the bundling/schema-proxy note", () => {
      // The canonical registration guides that carry the count + note.
      const guideNames = ["mcp-json.md", "LM-Studio-MCP.md"];
      for (const name of guideNames) {
        const file = docFiles.find((f) => path.basename(f) === name);
        expect(file).toBeDefined();
        const content = readFile(file as string);
        expect(content).toMatch(/\b16\b\s+(registered\s+)?plugin\s+entr(y|ies)/i);
        expect(content).toMatch(/common[^\n]*bundle[^\n]*4\s+tools/i);
        expect(content).toMatch(/Browserless[^\n]*schema-proxy/i);
      }
    });

    it("presents no conflicting alternative server/plugin count anywhere in the toolkit docs", () => {
      // A conflicting count is a number != 16 immediately qualifying
      // "registered servers/plugins/plugin entries" — the same phrasing the
      // authoritative statement uses. Counts of *tools* (e.g. 3DTool's 13
      // tools, or "4 tools" in the bundling note) are not server/plugin counts
      // and are allowed.
      const conflictRe =
        /\b(\d+)\s+(?:registered\s+)?(?:servers?|plugins?|plugin\s+entr(?:y|ies))\b/gi;
      const offenders: Array<{ file: string; text: string }> = [];
      for (const file of docFiles) {
        const content = readFile(file);
        let m: RegExpExecArray | null;
        while ((m = conflictRe.exec(content)) !== null) {
          const n = Number(m[1]);
          if (n !== AUTHORITATIVE_COUNT) {
            offenders.push({ file: toRepoRelative(file), text: m[0] });
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  // ── Requirement 6.4: ECM never presented as an active runtime server ────────
  describe("ECM absent as an active server (Requirement 6.4)", () => {
    it("no toolkit doc mentions ECM", () => {
      // ECM was fully removed. It must not appear in any server count, list, or
      // table. A whole-word match avoids matching substrings inside other words.
      const ecmRe = /\bECM\b/;
      const offenders: string[] = [];
      for (const file of docFiles) {
        if (ecmRe.test(readFile(file))) {
          offenders.push(toRepoRelative(file));
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  // ── Requirement 6.5: plugin-only described as the sole method ───────────────
  describe("plugin-only configuration model (Requirement 6.5)", () => {
    it("README describes the plugin-only model as the sole supported method", () => {
      expect(readme).toMatch(/plugin-only\s+configuration\s+model/i);
      expect(readme).toMatch(/sole\s+supported\s+method/i);
    });

    it("the registration guide docs describe plugin-only as the sole method", () => {
      const guideNames = ["mcp-json.md", "LM-Studio-MCP.md"];
      for (const name of guideNames) {
        const file = docFiles.find((f) => path.basename(f) === name);
        expect(file).toBeDefined();
        const content = readFile(file as string);
        expect(content).toMatch(/plugin-only\s+configuration\s+model/i);
        expect(content).toMatch(/sole\s+supported\s+method/i);
      }
    });
  });

  // ── Requirement 6.6: no mcp.json example / hand-edit instruction ────────────
  describe("README mcp.json hygiene (Requirement 6.6)", () => {
    it("README has no mcp.json example block and no hand-edit instruction", () => {
      // Reuse the production detector — identical to the verify:mcp-sync gate.
      expect(findReadmeOffenses(readme)).toEqual([]);
    });

    it("no toolkit doc embeds an mcp.json example block or instructs a hand-edit", () => {
      // Apply the same detector across every doc file. docs/mcp-json.md names
      // `mcp.json` in prose but must not embed an mcpServers example block or
      // tell the user to create/open/edit it by hand.
      const offenders: Array<{ file: string; offenses: string[] }> = [];
      for (const file of docFiles) {
        const offenses = findReadmeOffenses(readFile(file));
        if (offenses.length > 0) {
          offenders.push({ file: toRepoRelative(file), offenses });
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  // ── Requirement 6.7: no deprecated / removed / absent feature claims ────────
  describe("no deprecated or absent-feature claims (Requirement 6.7)", () => {
    it("no toolkit doc references the removed deprecated/ directory", () => {
      const offenders: string[] = [];
      for (const file of docFiles) {
        if (readFile(file).includes("deprecated/")) {
          offenders.push(toRepoRelative(file));
        }
      }
      expect(offenders).toEqual([]);
    });

    it("no toolkit doc presents ECM as a removed-but-documented feature", () => {
      // Covered structurally by 6.4 (ECM absent entirely); re-assert here as the
      // primary example of a removed feature that must not be advertised.
      for (const file of docFiles) {
        expect(readFile(file)).not.toMatch(/\bECM\b/);
      }
    });
  });

  // ── Requirement 4.4: Tool_Call_Normalization documented as unified ──────────
  describe("tool-call normalization documented as unified (Requirement 4.4)", () => {
    it("README describes a single unified normalizeToolCall path across all entry points", () => {
      expect(readme).toMatch(/normalizeToolCall/);
      // Every entry point routes through the one shared utility.
      expect(readme).toMatch(/every\s+(tool-call\s+)?entry\s+point\s+routes\s+through/i);
      expect(readme).toMatch(/AgentRunner[^\n]*SubAgent[^\n]*AskUser/i);
      // No partial / legacy / alternative paths remain.
      expect(readme).toMatch(/no\s+(partial|passthrough|legacy)[^\n]*(branch|stub|path)/i);
    });

    it("the architecture doc describes the unified normalization path", () => {
      const file = docFiles.find((f) => path.basename(f) === "ARCHITECTURE.md");
      expect(file).toBeDefined();
      const content = readFile(file as string);
      expect(content).toMatch(/normalizeToolCall/);
      expect(content).toMatch(/AgentRunner[^\n]*SubAgent[^\n]*AskUser/i);
      expect(content).toMatch(/one\s+unified\s+path|single\s+shared/i);
    });
  });
});
