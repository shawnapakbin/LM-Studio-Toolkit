// Unit/example tests for the MCP plugin registration list (source of truth: scripts/workspace/mcp-config.js)
// Feature: codebase-cleanup-plugin-registration
// **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 8.3**

const { buildMcpServers } = require("../mcp-config");

describe("MCP plugin registration list", () => {
  let mcpServers: Record<string, any>;

  beforeAll(() => {
    // buildMcpServers() may warn about missing built artifacts / external
    // binaries not on PATH; those warnings are irrelevant to the registration
    // list assertions below, so suppress them for clean test output.
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const result = buildMcpServers();
    mcpServers = result.mcpServers;
    warnSpy.mockRestore();
  });

  // Requirement 1.2 — the nine Shipped runtime servers remain registered.
  // (Retire-and-gate: `rag` and `slash-commands` are no longer Shipped; the
  // Shipped set is the nine canonical servers.)
  describe("existing runtime servers (Requirement 1.2)", () => {
    const existingKeys = [
      "terminal",
      "web-browser",
      "common",
      "browserless",
      "python-shell",
      "skills",
      "blender-bridge",
      "3dtool",
      "lan-sub-agent",
    ];

    it("registers all nine existing server keys", () => {
      expect(existingKeys).toHaveLength(9);
      for (const key of existingKeys) {
        expect(mcpServers[key]).toBeDefined();
      }
    });
  });

  // Requirement 1.3 — no Library_Workspace is registered as a plugin.
  describe("library workspaces are absent (Requirement 1.3)", () => {
    const libraryWorkspaces = [
      "CLI",
      "Installer",
      "AgentRunner",
      "Memory",
      "Observability",
      "shared",
    ];

    it.each(libraryWorkspaces)("does not register library workspace %s", (workspace) => {
      // Library workspaces must not appear under their name or common kebab-case forms.
      const candidateKeys = [
        workspace,
        workspace.toLowerCase(),
        workspace.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
      ];
      for (const key of candidateKeys) {
        expect(mcpServers[key]).toBeUndefined();
      }
    });
  });

  // Requirement 1.4 — Browserless registers via the schema-proxy wrapper.
  describe("Browserless registration (Requirement 1.4)", () => {
    it("registers browserless via Browserless/scripts/schema-proxy.js", () => {
      const browserless = mcpServers.browserless;
      expect(browserless).toBeDefined();
      expect(browserless.command).toBe("node");
      // args[0] is the resolved absolute path; normalized to forward slashes.
      expect(browserless.args[0]).toContain("Browserless/scripts/schema-proxy.js");
      expect(browserless.args[0]).not.toMatch(/mcp-server\.js$/);
    });
  });

  // Requirements 1.5 / 8.3 — registered plugin-entry count equals the nine
  // Shipped servers (retire-and-gate reduced the set from 16 to 9).
  describe("registered plugin-entry count (Requirements 1.5, 8.3)", () => {
    it("registers exactly 9 plugin entries", () => {
      expect(Object.keys(mcpServers)).toHaveLength(9);
    });

    it("registers exactly the nine Shipped servers", () => {
      const expectedKeys = [
        "terminal",
        "web-browser",
        "common",
        "browserless",
        "python-shell",
        "skills",
        "blender-bridge",
        "3dtool",
        "lan-sub-agent",
      ];
      expect(expectedKeys).toHaveLength(9);
      expect(Object.keys(mcpServers).sort()).toEqual(expectedKeys.sort());
    });
  });
});
