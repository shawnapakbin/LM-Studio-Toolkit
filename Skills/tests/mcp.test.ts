// Must be set before any import that triggers the store singleton
process.env.SKILLS_DB_PATH = ":memory:";

describe("Skills MCP Server", () => {
  test("createSkillsMcpServer creates server without throwing", async () => {
    const { createSkillsMcpServer } = await import("../src/mcp-server");
    expect(() => createSkillsMcpServer()).not.toThrow();
  });

  test("created server has connect method (is a valid McpServer)", async () => {
    const { createSkillsMcpServer } = await import("../src/mcp-server");
    const server = createSkillsMcpServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
