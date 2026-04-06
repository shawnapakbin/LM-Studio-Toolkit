import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAskUserMcpServer } from "../src/mcp-server";

type ToolResult = {
  success: boolean;
  errorCode?: string;
  interviewId?: string;
  status?: string;
  responses?: unknown[];
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

describe("AskUser MCP integration", () => {
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    process.env.ASK_USER_DB_PATH = ":memory:";

    const server = createAskUserMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "ask-user-mcp-test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
  });

  test("lists ask_user_interview tool", async () => {
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "ask_user_interview")).toBe(true);
  });

  test("create, submit, and get interview flow", async () => {
    const createResultRaw = await client.callTool({
      name: "ask_user_interview",
      arguments: {
        action: "create",
        payload: {
          title: "Clarify scope",
          questions: [
            {
              id: "scope",
              type: "single_choice",
              prompt: "Which scope?",
              required: true,
              options: [
                { id: "mvp", label: "MVP" },
                { id: "full", label: "Full" },
              ],
            },
          ],
        },
      },
    });

    const createResult = parseToolResult(createResultRaw);
    expect(createResult.success).toBe(true);
    expect(createResult.interviewId).toBeDefined();
    expect(createResult.status).toBe("pending");

    const interviewId = createResult.interviewId as string;

    const submitResultRaw = await client.callTool({
      name: "ask_user_interview",
      arguments: {
        action: "submit",
        payload: {
          interviewId,
          responses: [{ questionId: "scope", value: "mvp" }],
        },
      },
    });

    const submitResult = parseToolResult(submitResultRaw);
    expect(submitResult.success).toBe(true);
    expect(submitResult.status).toBe("answered");

    const getResultRaw = await client.callTool({
      name: "ask_user_interview",
      arguments: {
        action: "get",
        payload: { interviewId },
      },
    });

    const getResult = parseToolResult(getResultRaw);
    expect(getResult.success).toBe(true);
    expect(getResult.interviewId).toBe(interviewId);
    expect(Array.isArray(getResult.responses)).toBe(true);
  });

  test("returns INVALID_INPUT for empty questions", async () => {
    const responseRaw = await client.callTool({
      name: "ask_user_interview",
      arguments: {
        action: "create",
        payload: {
          title: "Invalid",
          questions: [],
        },
      },
    });

    const response = parseToolResult(responseRaw);
    expect(response.success).toBe(false);
    expect(response.errorCode).toBe("INVALID_INPUT");
  });
});
