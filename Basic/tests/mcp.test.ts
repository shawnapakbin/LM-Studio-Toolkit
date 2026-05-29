import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBasicMcpServer } from "../src/mcp-server";

type ToolResult = {
  success: boolean;
  errorCode?: string;
  interviewId?: string;
  status?: string;
  data?: Record<string, unknown>;
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

describe("Basic MCP integration", () => {
  let client: Client;
  let server: ReturnType<typeof createBasicMcpServer>;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    process.env.ASK_USER_DB_PATH = ":memory:";

    server = createBasicMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "basic-mcp-test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await Promise.all([clientTransport.close(), serverTransport.close()]);
    await server.close();
  });

  // ── Tool discovery ─────────────────────────────────────────────────────────

  test("lists all three tools", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("get_current_datetime");
    expect(names).toContain("calculate_engineering");
    expect(names).toContain("interview_user");
    expect(tools.tools).toHaveLength(3);
  });

  // ── get_current_datetime ───────────────────────────────────────────────────

  describe("get_current_datetime", () => {
    test("returns current UTC datetime without parameters", async () => {
      const raw = await client.callTool({ name: "get_current_datetime", arguments: {} });
      const result = parseToolResult(raw) as unknown as {
        success: boolean;
        nowUtcIso: string;
        unixMs: number;
      };
      expect(result.success).toBe(true);
      expect(result.nowUtcIso).toBeDefined();
      expect(result.unixMs).toBeGreaterThan(0);
    });

    test("accepts a valid IANA timezone", async () => {
      const raw = await client.callTool({
        name: "get_current_datetime",
        arguments: { timeZone: "America/New_York" },
      });
      const result = parseToolResult(raw) as unknown as {
        success: boolean;
        requestedTimeZone: string;
      };
      expect(result.success).toBe(true);
      expect(result.requestedTimeZone).toBe("America/New_York");
    });

    test("returns isError true for invalid timezone", async () => {
      const raw = await client.callTool({
        name: "get_current_datetime",
        arguments: { timeZone: "Fake/Zone" },
      });
      const callResult = raw as { isError?: boolean };
      expect(callResult.isError).toBe(true);
    });
  });

  // ── calculate_engineering ──────────────────────────────────────────────────

  describe("calculate_engineering", () => {
    test("evaluates a basic arithmetic expression", async () => {
      const raw = await client.callTool({
        name: "calculate_engineering",
        arguments: { expression: "2 + 2" },
      });
      const result = parseToolResult(raw) as unknown as {
        success: boolean;
        value: string;
      };
      expect(result.success).toBe(true);
      expect(result.value).toBe("4");
    });

    test("evaluates a trig expression", async () => {
      const raw = await client.callTool({
        name: "calculate_engineering",
        arguments: { expression: "sin(0)" },
      });
      const result = parseToolResult(raw) as unknown as {
        success: boolean;
        value: string;
      };
      expect(result.success).toBe(true);
      expect(result.value).toBe("0");
    });

    test("returns isError true for unsafe expression (eval)", async () => {
      const raw = await client.callTool({
        name: "calculate_engineering",
        arguments: { expression: "eval('1+1')" },
      });
      const callResult = raw as { isError?: boolean };
      expect(callResult.isError).toBe(true);
    });
  });

  // ── ask_user_interview ─────────────────────────────────────────────────────

  describe("interview_user", () => {
    test("full create → submit → get flow", async () => {
      // Create
      const createRaw = await client.callTool({
        name: "interview_user",
        arguments: {
          action: "create",
          payload: {
            title: "Confirm action",
            questions: [
              {
                id: "confirm",
                type: "confirm",
                prompt: "Proceed?",
                required: true,
              },
            ],
          },
        },
      });
      const createResult = parseToolResult(createRaw);
      expect(createResult.success).toBe(true);
      expect(createResult.interviewId).toBeDefined();
      expect(createResult.status).toBe("pending");

      const interviewId = createResult.interviewId as string;

      // Submit
      const submitRaw = await client.callTool({
        name: "interview_user",
        arguments: {
          action: "submit",
          payload: {
            interviewId,
            responses: [{ questionId: "confirm", value: true }],
          },
        },
      });
      const submitResult = parseToolResult(submitRaw);
      expect(submitResult.success).toBe(true);

      // Get
      const getRaw = await client.callTool({
        name: "interview_user",
        arguments: {
          action: "get",
          payload: { interviewId },
        },
      });
      const getResult = parseToolResult(getRaw) as unknown as {
        success: boolean;
        status: string;
        responses: unknown[];
      };
      expect(getResult.success).toBe(true);
      expect(getResult.status).toBe("answered");
      expect(getResult.responses).toHaveLength(1);
    });

    test("returns isError true for unknown interviewId", async () => {
      const raw = await client.callTool({
        name: "interview_user",
        arguments: {
          action: "get",
          payload: { interviewId: "00000000-0000-0000-0000-000000000000" },
        },
      });
      const callResult = raw as { isError?: boolean };
      expect(callResult.isError).toBe(true);
    });

    test("accepts create payload passed as stringified JSON", async () => {
      const raw = await client.callTool({
        name: "interview_user",
        arguments: {
          action: "create",
          payload: JSON.stringify({
            title: "Clarify preferences",
            questions: [
              {
                id: "pref",
                type: "text",
                prompt: "What is your preferred output format?",
                required: true,
              },
            ],
          }),
        },
      });

      const result = parseToolResult(raw);
      expect(result.success).toBe(true);
      expect(result.interviewId).toBeDefined();
      expect(result.status).toBe("pending");
    });

    test("allows creating interview even with approval-phrased prompts", async () => {
      const raw = await client.callTool({
        name: "interview_user",
        arguments: {
          action: "create",
          payload: {
            questions: [
              {
                id: "approval",
                type: "text",
                prompt:
                  "Do you approve 'terminal:run_terminal_command' in local terminal? Command 'dir C:/temp' will be executed.",
              },
            ],
          },
        },
      });

      const result = parseToolResult(raw);
      expect(result.success).toBe(true);
      expect(result.status).toBe("pending");
    });
  });
});
