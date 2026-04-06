import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTerminalMcpServer } from "../src/mcp-server";
import { clearPunchoutSession } from "../src/punchout";

type ToolResult = {
  success: boolean;
  errorCode?: string;
  stdout?: string;
  punchout?: boolean;
  pid?: number;
  reused?: boolean;
};

function parseToolResult(response: unknown): ToolResult {
  const normalize = (value: unknown): ToolResult => {
    const result = value as { data?: unknown; structuredContent?: unknown };
    if (result?.structuredContent && typeof result.structuredContent === "object") {
      return normalize(result.structuredContent);
    }
    if (result?.data && typeof result.data === "object") {
      return {
        ...(result as Record<string, unknown>),
        ...(result.data as Record<string, unknown>),
      } as ToolResult;
    }
    return value as ToolResult;
  };

  const callResult = response as {
    content?: Array<{ type: string; text?: string }>;
    toolResult?: unknown;
  };

  if (callResult.toolResult && typeof callResult.toolResult === "object") {
    return normalize(callResult.toolResult);
  }

  const textContent = callResult.content?.find((item) => item.type === "text")?.text;
  if (!textContent) {
    throw new Error("Missing text content in MCP response");
  }

  return normalize(JSON.parse(textContent));
}

describe("Terminal MCP integration", () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    const server = createTerminalMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "terminal-mcp-test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  beforeEach(() => {
    clearPunchoutSession();
  });

  afterAll(async () => {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  });

  test("lists run_terminal_command tool", async () => {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "run_terminal_command")).toBe(true);
  });

  test("executes a safe command", async () => {
    const responseRaw = await client.callTool({
      name: "run_terminal_command",
      arguments: { command: "echo hello" },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(true);
    expect((response.stdout ?? "").toLowerCase()).toContain("hello");
  });

  test("blocks denied command patterns", async () => {
    const responseRaw = await client.callTool({
      name: "run_terminal_command",
      arguments: { command: "rm -rf /tmp/test" },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(false);
    expect(response.errorCode).toBe("POLICY_BLOCKED");
  });

  test("blocks cwd escape attempts", async () => {
    const responseRaw = await client.callTool({
      name: "run_terminal_command",
      arguments: { command: "echo hello", cwd: "../.." },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(false);
    expect(response.errorCode).toBe("POLICY_BLOCKED");
  });

  test("returns punchout metadata", async () => {
    const responseRaw = await client.callTool({
      name: "run_terminal_command",
      arguments: { command: "echo hello", punchout: true },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(true);
    expect(response.punchout).toBe(true);
    expect(typeof response.pid).toBe("number");
    expect(response.stdout).toBeUndefined();
  });

  test("punchout still enforces policy", async () => {
    const responseRaw = await client.callTool({
      name: "run_terminal_command",
      arguments: { command: "rm -rf /tmp/test", punchout: true },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(false);
    expect(response.errorCode).toBe("POLICY_BLOCKED");
  });
});
