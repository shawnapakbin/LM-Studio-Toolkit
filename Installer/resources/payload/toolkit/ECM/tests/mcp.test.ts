process.env.ECM_DB_PATH = ":memory:";
process.env.ECM_EMBEDDINGS_MODE = "mock";

describe("ECM MCP Server", () => {
  test("createECMMcpServer creates server without throwing", async () => {
    const { createECMMcpServer } = await import("../src/mcp-server");
    expect(() => createECMMcpServer()).not.toThrow();
  });

  test("created server has connect method (is a valid McpServer)", async () => {
    const { createECMMcpServer } = await import("../src/mcp-server");
    const server = createECMMcpServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
