// Unit tests for MCP config generator output
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 7.1, 7.2**

const { buildMcpServers } = require("../../../../scripts/workspace/mcp-config");

describe("MCP Config Generator", () => {
  let mcpServers: Record<string, any>;

  beforeAll(() => {
    const result = buildMcpServers();
    mcpServers = result.mcpServers;
  });

  describe("common entry", () => {
    it("should have 'common' entry defined", () => {
      expect(mcpServers.common).toBeDefined();
    });

    it("should have correct relativeScript path in args", () => {
      expect(mcpServers.common.args[0]).toContain("mcp/common/dist/mcp-server.js");
    });

    it("should have command set to 'node'", () => {
      expect(mcpServers.common.command).toBe("node");
    });

    it("should use forward-slash separators in path (no backslashes)", () => {
      expect(mcpServers.common.args[0]).toMatch(/\//);
      expect(mcpServers.common.args[0]).not.toMatch(/\\/);
    });

    it("should have all 13 environment variables", () => {
      const env = mcpServers.common.env;
      expect(env.CALCULATOR_DEFAULT_PRECISION).toBe("12");
      expect(env.CALCULATOR_MAX_PRECISION).toBe("20");
      expect(env.DOC_SCRAPER_DEFAULT_TIMEOUT_MS).toBe("20000");
      expect(env.DOC_SCRAPER_MAX_TIMEOUT_MS).toBe("60000");
      expect(env.DOC_SCRAPER_MAX_CONTENT_BYTES).toBe("52428800");
      expect(env.DOC_SCRAPER_MAX_CONTENT_CHARS).toBe("50000");
      expect(env.DOC_SCRAPER_WORKSPACE_ROOT).toBeDefined();
      expect(env.CLOCK_DEFAULT_TIMEZONE).toBeDefined();
      expect(env.CLOCK_DEFAULT_LOCALE).toBe("en-US");
      expect(env.ASK_USER_DB_PATH).toBe("./memory.db");
      expect(env.ASK_USER_DEFAULT_EXPIRES_SECONDS).toBe("1800");
      expect(env.ASK_USER_MAX_EXPIRES_SECONDS).toBe("86400");
      expect(env.ASK_USER_MAX_QUESTIONS).toBe("20");
    });
  });

  describe("removed individual tool entries", () => {
    it("should NOT have 'calculator' entry", () => {
      expect(mcpServers.calculator).toBeUndefined();
    });

    it("should NOT have 'clock' entry", () => {
      expect(mcpServers.clock).toBeUndefined();
    });

    it("should NOT have 'ask-user' entry", () => {
      expect(mcpServers["ask-user"]).toBeUndefined();
    });

    it("should NOT have 'document-scraper' entry", () => {
      expect(mcpServers["document-scraper"]).toBeUndefined();
    });
  });

  describe("preserved tool entries", () => {
    it("should preserve 'terminal' entry", () => {
      expect(mcpServers.terminal).toBeDefined();
      expect(mcpServers.terminal.command).toBe("node");
    });

    it("should preserve 'web-browser' entry", () => {
      expect(mcpServers["web-browser"]).toBeDefined();
      expect(mcpServers["web-browser"].command).toBe("node");
    });

    it("should preserve 'browserless' entry", () => {
      expect(mcpServers.browserless).toBeDefined();
    });

    it("should preserve 'rag' entry", () => {
      expect(mcpServers.rag).toBeDefined();
      expect(mcpServers.rag.command).toBe("node");
    });

    it("should preserve 'python-shell' entry", () => {
      expect(mcpServers["python-shell"]).toBeDefined();
      expect(mcpServers["python-shell"].command).toBe("node");
    });

    it("should preserve 'skills' entry", () => {
      expect(mcpServers.skills).toBeDefined();
      expect(mcpServers.skills.command).toBe("node");
    });

    it("should preserve 'slash-commands' entry", () => {
      expect(mcpServers["slash-commands"]).toBeDefined();
      expect(mcpServers["slash-commands"].command).toBe("node");
    });

    it("should preserve 'blender-bridge' entry", () => {
      expect(mcpServers["blender-bridge"]).toBeDefined();
      expect(mcpServers["blender-bridge"].command).toBe("node");
    });
  });
});
