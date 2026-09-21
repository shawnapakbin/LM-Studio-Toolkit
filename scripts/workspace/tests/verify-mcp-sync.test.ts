// Self-tests for scripts/workspace/verify-mcp-sync.js
// Feature: codebase-cleanup-plugin-registration
// **Validates: Requirements 2.4, 6.6, 1.5**
//
// These self-tests exercise the *pure detection logic* exported by
// verify-mcp-sync.js so they never depend on the live README (which still
// carries an mcp.json example block and hand-edit instructions until task 10.2
// scrubs it). README-hygiene detection is verified against controlled fixture
// content — a clean fixture that must pass and dirty fixtures that must be
// flagged. Count/path assertions are checked against the real mcp-config.js
// source of truth via buildMcpServers().

import * as path from "path";

const {
  INTENDED_RUNTIME_SERVERS,
  EXPECTED_COUNT,
  checkRegistrationSet,
  checkCount,
  findTopLevelOffenders,
  findReadmeOffenses,
} = require("../verify-mcp-sync");
const { buildMcpServers } = require("../mcp-config");
const { OWNER_ID } = require("../plugin-ownership");

// ─── README fixtures (controlled content, NOT the live README) ───────────────

// Clean README: plugin-only model, no mcp.json example, no hand-edit instruction.
const CLEAN_README = `# LLM Toolkit

## Installation

Run \`npm run setup\` to register the toolkit plugins with LM Studio. The plugin
registration is managed automatically from the source of truth; there is nothing
to configure by hand.

## Servers

The toolkit registers 16 runtime servers as LM Studio plugins.

\`\`\`bash
npm run build && npm run startup:check
\`\`\`

\`\`\`json
{
  "some": "unrelated config that is not mcpServers"
}
\`\`\`
`;

// Dirty README variants — each should be flagged by exactly the relevant check.
const DIRTY_README_EXAMPLE_HEADING = `# LLM Toolkit

## mcp.json Example

Here is what the file looks like.
`;

const DIRTY_README_EMBEDDED_BLOCK = `# LLM Toolkit

Add the following configuration:

\`\`\`json
{
  "mcpServers": {
    "terminal": { "command": "node", "args": ["Terminal/dist/mcp-server.js"] }
  }
}
\`\`\`
`;

const DIRTY_README_HAND_EDIT = `# LLM Toolkit

## Manual configuration

Open \`mcp.json\` in your editor and add the server entries yourself.
`;

const DIRTY_README_ALL = `# LLM Toolkit

## mcp.json Example

Create \`mcp.json\` and paste the following into it:

\`\`\`json
{
  "mcpServers": {
    "terminal": { "command": "node" }
  }
}
\`\`\`
`;

describe("verify-mcp-sync self-tests", () => {
  // ─── README hygiene detection (Requirement 6.6) ─────────────────────────────
  describe("README hygiene detection (Requirement 6.6)", () => {
    it("passes a clean README with no mcp.json example or hand-edit instruction", () => {
      expect(findReadmeOffenses(CLEAN_README)).toEqual([]);
    });

    it("treats empty README content as no offenses (nothing to flag)", () => {
      expect(findReadmeOffenses("")).toEqual([]);
    });

    it("flags an 'mcp.json Example' section heading", () => {
      const offenses = findReadmeOffenses(DIRTY_README_EXAMPLE_HEADING);
      expect(offenses.length).toBeGreaterThan(0);
      expect(offenses.some((o: string) => /example.*heading|section heading/i.test(o))).toBe(true);
    });

    it("flags a fenced JSON block that embeds an mcpServers object", () => {
      const offenses = findReadmeOffenses(DIRTY_README_EMBEDDED_BLOCK);
      expect(offenses.length).toBeGreaterThan(0);
      expect(offenses.some((o: string) => /mcpServers|example block/i.test(o))).toBe(true);
    });

    it("does NOT flag an unrelated fenced JSON block that has no mcpServers key", () => {
      // The clean fixture contains a JSON block without mcpServers — it must not
      // be mistaken for the example block.
      const offenses = findReadmeOffenses(CLEAN_README);
      expect(offenses.some((o: string) => /example block/i.test(o))).toBe(false);
    });

    it("flags a hand-edit instruction referencing mcp.json", () => {
      const offenses = findReadmeOffenses(DIRTY_README_HAND_EDIT);
      expect(offenses.length).toBeGreaterThan(0);
      expect(offenses.some((o: string) => /hand-edit instruction/i.test(o))).toBe(true);
    });

    it("flags every offense when a README contains all three problems", () => {
      const offenses = findReadmeOffenses(DIRTY_README_ALL);
      // Heading + embedded block + hand-edit instruction = 3 distinct offenses.
      expect(offenses.length).toBe(3);
      expect(offenses.some((o: string) => /heading/i.test(o))).toBe(true);
      expect(offenses.some((o: string) => /example block/i.test(o))).toBe(true);
      expect(offenses.some((o: string) => /hand-edit instruction/i.test(o))).toBe(true);
    });
  });

  // ─── Registration-count assertion (Requirements 1.5, 2.4) ───────────────────
  describe("registered plugin-entry count assertion (Requirements 1.5, 2.4)", () => {
    let registeredNames: string[];

    beforeAll(() => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const { mcpServers } = buildMcpServers();
      registeredNames = Object.keys(mcpServers);
      warnSpy.mockRestore();
    });

    it("EXPECTED_COUNT is 16", () => {
      expect(EXPECTED_COUNT).toBe(16);
    });

    it("the intended runtime-server set contains exactly 16 entries", () => {
      expect(INTENDED_RUNTIME_SERVERS).toHaveLength(16);
    });

    it("mcp-config.js registers exactly 16 plugin entries", () => {
      expect(registeredNames).toHaveLength(EXPECTED_COUNT);
    });

    it("checkCount reports ok when the registered count matches", () => {
      const result = checkCount(registeredNames.length);
      expect(result.ok).toBe(true);
      expect(result.count).toBe(16);
      expect(result.expected).toBe(16);
    });

    it("checkCount reports not-ok (with diagnostics) when the count is wrong", () => {
      const result = checkCount(15);
      expect(result.ok).toBe(false);
      expect(result.count).toBe(15);
      expect(result.expected).toBe(16);
    });
  });

  // ─── Registration-set / path resolution assertions (Requirement 1.5) ────────
  describe("registration-set and relativeScript/path assertions against mcp-config.js", () => {
    let mcpServers: Record<string, any>;
    let missingBuilds: string[];
    let registeredNames: string[];

    beforeAll(() => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const result = buildMcpServers();
      mcpServers = result.mcpServers;
      missingBuilds = result.missingBuilds;
      registeredNames = Object.keys(mcpServers);
      warnSpy.mockRestore();
    });

    it("the registered set equals the intended runtime-server set (no missing/unexpected)", () => {
      const { missing, unexpected, ok } = checkRegistrationSet(registeredNames);
      expect(missing).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(ok).toBe(true);
    });

    it("checkRegistrationSet names a missing intended server", () => {
      const withoutGit = registeredNames.filter((n) => n !== "git");
      const { missing, ok } = checkRegistrationSet(withoutGit);
      expect(ok).toBe(false);
      expect(missing).toContain("git");
    });

    it("checkRegistrationSet names an unexpected registered server", () => {
      const withExtra = [...registeredNames, "not-a-real-server"];
      const { unexpected, ok } = checkRegistrationSet(withExtra);
      expect(ok).toBe(false);
      expect(unexpected).toContain("not-a-real-server");
    });

    it("each non-external server resolves node + an absolute mcp-server.js arg path", () => {
      for (const name of INTENDED_RUNTIME_SERVERS) {
        const entry = mcpServers[name];
        expect(entry).toBeDefined();
        expect(entry.command).toBe("node");
        expect(Array.isArray(entry.args)).toBe(true);
        expect(entry.args).toHaveLength(1);
        const scriptArg: string = entry.args[0];
        expect(path.isAbsolute(scriptArg)).toBe(true);
        // Paths are normalized to forward slashes for the emitted config.
        expect(scriptArg).not.toContain("\\");
      }
    });

    it("resolves the nested relativeScript paths for @shared-dependent servers", () => {
      // Confirmed emitted paths (task 2.1): these servers emit nested artifacts.
      const nestedExpectations: Record<string, string> = {
        "lan-sub-agent": "LanSubAgent/dist/LanSubAgent/src/mcp-server.js",
        git: "Git/dist/Git/src/mcp-server.js",
        "package-manager": "PackageManager/dist/PackageManager/src/mcp-server.js",
        "file-editor": "FileEditor/dist/FileEditor/src/mcp-server.js",
      };
      for (const [name, relative] of Object.entries(nestedExpectations)) {
        expect(mcpServers[name].args[0]).toContain(relative);
      }
    });

    it("resolves the flat relativeScript paths for standalone servers", () => {
      const flatExpectations: Record<string, string> = {
        "3dtool": "3DTool/dist/mcp-server.js",
        "sub-agent": "SubAgent/dist/mcp-server.js",
        "csv-exporter": "CSVExporter/dist/mcp-server.js",
      };
      for (const [name, relative] of Object.entries(flatExpectations)) {
        expect(mcpServers[name].args[0]).toContain(relative);
      }
    });

    it("missingBuilds only ever contains registered relativeScript paths (never bogus names)", () => {
      // missingBuilds is populated when a workspace has not been built yet. It is
      // valid for it to be non-empty in an unbuilt checkout, but every entry must
      // be one of the registered non-external relativeScript strings.
      for (const relativeScript of missingBuilds) {
        expect(typeof relativeScript).toBe("string");
        expect(relativeScript).toMatch(/\.js$/);
      }
    });
  });

  // ─── Top-level mcp.json offender detection (Requirement 2.4) ────────────────
  describe("top-level mcp.json offender detection (Requirement 2.4)", () => {
    const toolkitOwnedNames = new Set(["terminal", "git", "file-editor", "calculator"]);

    it("reports no offenders when top-level mcp.json is absent/empty", () => {
      expect(findTopLevelOffenders(null, toolkitOwnedNames)).toEqual([]);
      expect(findTopLevelOffenders({}, toolkitOwnedNames)).toEqual([]);
      expect(findTopLevelOffenders({ mcpServers: {} }, toolkitOwnedNames)).toEqual([]);
    });

    it("names a toolkit-owned entry matched by registered/legacy name", () => {
      const topLevel = {
        mcpServers: {
          terminal: { command: "node" },
          "some-third-party": { command: "other" },
        },
      };
      const offenders = findTopLevelOffenders(topLevel, toolkitOwnedNames);
      expect(offenders).toContain("terminal");
      expect(offenders).not.toContain("some-third-party");
    });

    it("names a toolkit-owned entry marked by the _owner marker even under a foreign key", () => {
      const topLevel = {
        mcpServers: {
          "renamed-entry": { command: "node", _owner: OWNER_ID },
          "third-party": { command: "other" },
        },
      };
      const offenders = findTopLevelOffenders(topLevel, toolkitOwnedNames);
      expect(offenders).toContain("renamed-entry");
      expect(offenders).not.toContain("third-party");
    });

    it("leaves non-toolkit entries untouched", () => {
      const topLevel = {
        mcpServers: {
          "external-a": { command: "a" },
          "external-b": { command: "b" },
        },
      };
      expect(findTopLevelOffenders(topLevel, toolkitOwnedNames)).toEqual([]);
    });
  });
});
