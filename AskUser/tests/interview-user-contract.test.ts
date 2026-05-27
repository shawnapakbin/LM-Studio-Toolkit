import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Express } from "express";
import request from "supertest";
import { createAskUserMcpServer } from "../src/mcp-server";

const EXPECTED_STATUSES = ["pending", "answered", "expired", "rejected"] as const;

type ToolResult = {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  toolName?: string;
  purpose?: string;
  interviewId?: string;
  status?: string;
  responses?: unknown[];
  isDuplicate?: boolean;
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

describe("interview_user contract", () => {
  let app: Express;
  let client: Client;
  let server: ReturnType<typeof createAskUserMcpServer>;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    process.env.ASK_USER_DB_PATH = ":memory:";

    const httpModule = await import("../src/index");
    app = httpModule.app;

    server = createAskUserMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "ask-user-contract-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await Promise.all([clientTransport.close(), serverTransport.close()]);
    await server.close();
  });

  test("tool discovery and HTTP schema align on interview_user name", async () => {
    const [tools, schemaResponse] = await Promise.all([
      client.listTools(),
      request(app).get("/tool-schema"),
    ]);

    expect(tools.tools.some((tool) => tool.name === "interview_user")).toBe(true);
    expect(schemaResponse.status).toBe(200);
    expect(schemaResponse.body.name).toBe("interview_user");
  });

  test("HTTP schema exposes endpoint actions and payload contract", async () => {
    const schemaResponse = await request(app).get("/tool-schema");

    expect(schemaResponse.status).toBe(200);
    expect(schemaResponse.body.parameters?.properties?.action?.enum).toEqual([
      "create",
      "submit",
      "get",
    ]);
    expect(schemaResponse.body.parameters?.required).toEqual(["action", "payload"]);
  });

  test("MCP schema includes action contract and idempotency hint", async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === "interview_user");

    expect(tool).toBeDefined();
    expect(tool?.description ?? "").toContain("create, submit, get");
    expect(JSON.stringify(tool ?? {})).toContain("idempotencyKey");
  });

  test("contract statuses include pending, answered, expired, rejected", async () => {
    const createResponse = await request(app)
      .post("/tools/interview_user")
      .send({
        action: "create",
        payload: {
          title: "Status contract",
          expiresInSeconds: 30,
          questions: [{ id: "confirm", type: "confirm", prompt: "Proceed?", required: true }],
        },
      });

    expect(createResponse.status).toBe(200);
    expect(EXPECTED_STATUSES).toContain(createResponse.body.status);
    expect(createResponse.body.status).toBe("pending");
  });

  test("submit is idempotent with idempotencyKey", async () => {
    const createResponse = await request(app)
      .post("/tools/interview_user")
      .send({
        action: "create",
        payload: {
          title: "Idempotency contract",
          questions: [{ id: "approve", type: "confirm", prompt: "Approve?", required: true }],
        },
      });

    const interviewId = createResponse.body.interviewId as string;

    const firstSubmit = await request(app)
      .post("/tools/interview_user")
      .send({
        action: "submit",
        payload: {
          interviewId,
          idempotencyKey: "idem-contract-1",
          responses: [{ questionId: "approve", value: true }],
        },
      });

    const secondSubmit = await request(app)
      .post("/tools/interview_user")
      .send({
        action: "submit",
        payload: {
          interviewId,
          idempotencyKey: "idem-contract-1",
          responses: [{ questionId: "approve", value: false }],
        },
      });

    expect(firstSubmit.status).toBe(200);
    expect(firstSubmit.body.isDuplicate).toBe(false);
    expect(secondSubmit.status).toBe(200);
    expect(secondSubmit.body.isDuplicate).toBe(true);
    expect(secondSubmit.body.responses).toEqual(firstSubmit.body.responses);
    expect(secondSubmit.body.status).toBe("answered");
  });

  test("HTTP response envelope always includes toolName and purpose", async () => {
    const successResponse = await request(app)
      .post("/tools/interview_user")
      .send({
        action: "create",
        payload: {
          title: "Envelope success",
          questions: [{ id: "q1", type: "text", prompt: "What?", required: true }],
        },
      });

    const errorResponse = await request(app)
      .post("/tools/interview_user")
      .send({
        action: "create",
        payload: { questions: [] },
      });

    expect(successResponse.body.toolName).toBe("interview_user");
    expect(successResponse.body.purpose).toBe("clarification_only");
    expect(errorResponse.body.toolName).toBe("interview_user");
    expect(errorResponse.body.purpose).toBe("clarification_only");
  });

  test("MCP responses include envelope fields", async () => {
    const createRaw = await client.callTool({
      name: "interview_user",
      arguments: {
        action: "create",
        payload: {
          title: "MCP envelope",
          questions: [{ id: "q1", type: "text", prompt: "Why?", required: true }],
        },
      },
    });

    const createResult = parseToolResult(createRaw);
    expect(createResult.success).toBe(true);
    expect(createResult.toolName).toBe("interview_user");
    expect(createResult.purpose).toBe("clarification_only");
    expect(EXPECTED_STATUSES).toContain(createResult.status as (typeof EXPECTED_STATUSES)[number]);
  });

  test("legacy endpoint is no longer exposed", async () => {
    const response = await request(app)
      .post("/tools/ask_user_interview")
      .send({
        action: "create",
        payload: {
          title: "Legacy",
          questions: [{ id: "q1", type: "text", prompt: "Legacy?", required: true }],
        },
      });

    expect(response.status).toBe(404);
  });

  test("MCP tool path contract supports create, submit, get end-to-end", async () => {
    const createRaw = await client.callTool({
      name: "interview_user",
      arguments: {
        action: "create",
        payload: {
          title: "Roundtrip",
          questions: [{ id: "scope", type: "text", prompt: "Scope?", required: true }],
        },
      },
    });
    const create = parseToolResult(createRaw);

    const submitRaw = await client.callTool({
      name: "interview_user",
      arguments: {
        action: "submit",
        payload: {
          interviewId: create.interviewId,
          responses: [{ questionId: "scope", value: "mvp" }],
        },
      },
    });
    const submit = parseToolResult(submitRaw);

    const getRaw = await client.callTool({
      name: "interview_user",
      arguments: {
        action: "get",
        payload: { interviewId: create.interviewId },
      },
    });
    const get = parseToolResult(getRaw);

    expect(create.success).toBe(true);
    expect(submit.success).toBe(true);
    expect(get.success).toBe(true);
    expect(get.status).toBe("answered");
  });
});
