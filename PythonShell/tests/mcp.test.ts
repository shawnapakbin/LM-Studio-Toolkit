import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPythonShellMcpServer } from "../src/mcp-server";

type ToolResult = {
  success: boolean;
  errorCode?: string;
  instructions?: string;
};

function parseToolResult(response: unknown): ToolResult {
  const callResult = response as {
    content?: Array<{ type: string; text?: string }>;
  };

  const textContent = callResult.content?.find((item) => item.type === "text")?.text;
  if (!textContent) {
    throw new Error("Missing text content in MCP response");
  }

  return JSON.parse(textContent) as ToolResult;
}

describe("PythonShell MCP integration", () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    process.env.PYTHON_SHELL_FORCE_MISSING = "1";

    const server = createPythonShellMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "python-shell-mcp-test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    delete process.env.PYTHON_SHELL_FORCE_MISSING;
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  });

  test("lists python tools", async () => {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "python_run_code")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "python_open_repl")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "python_open_idle")).toBe(true);
  });

  test("run code returns python missing guidance when unavailable", async () => {
    const responseRaw = await client.callTool({
      name: "python_run_code",
      arguments: { code: "print('hello')" },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(false);
    expect(response.errorCode).toBe("PYTHON_NOT_FOUND");
    expect(response.instructions).toContain("python.org/downloads");
  });

  test("open repl returns python missing guidance when unavailable", async () => {
    const responseRaw = await client.callTool({
      name: "python_open_repl",
      arguments: {},
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(false);
    expect(response.errorCode).toBe("PYTHON_NOT_FOUND");
    expect(response.instructions).toContain("python.org/downloads");
  });

  test("open idle returns python missing guidance when unavailable", async () => {
    const responseRaw = await client.callTool({
      name: "python_open_idle",
      arguments: {},
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(false);
    expect(response.errorCode).toBe("PYTHON_NOT_FOUND");
    expect(response.instructions).toContain("python.org/downloads");
  });
});
