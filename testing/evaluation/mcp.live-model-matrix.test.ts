/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

import { LMStudioClient } from "@lmstudio/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

type ToolResult = {
  success: boolean;
  interviewId?: string;
  errorCode?: string;
};

const DEFAULT_MODELS = [
  "nvidia/nemotron-3-nano",
  "qwen/qwen3-vl-30b",
  "bytedance/seed-oss-36b",
  "mistralai/ministral-3-14b-reasoning",
  "openai/gpt-oss-20b",
];

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

async function unloadAllLoadedModels(client: LMStudioClient): Promise<void> {
  const loadedEmbeddings = await client.embedding.listLoaded();
  for (const model of loadedEmbeddings) {
    await model.unload();
  }

  const loadedLlms = await client.llm.listLoaded();
  for (const model of loadedLlms) {
    await model.unload();
  }

  const remainingEmbeddings = await client.embedding.listLoaded();
  const remainingLlms = await client.llm.listLoaded();
  expect(remainingEmbeddings.length).toBe(0);
  expect(remainingLlms.length).toBe(0);
}

const runLive = process.env.LMSTUDIO_LIVE_TEST === "true";
const describeIfLive = runLive ? describe : describe.skip;

describeIfLive("LM Studio model matrix with MCP smoke", () => {
  const matrixModels = (process.env.LMSTUDIO_TOOL_MODELS ?? DEFAULT_MODELS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  let lmstudio: LMStudioClient;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    jest.setTimeout(180000);
    process.env.ASK_USER_DB_PATH = ":memory:";

    lmstudio = new LMStudioClient();

    const module = await import("../../AskUser/src/mcp-server");
    const server = module.createAskUserMcpServer();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "mcp-model-matrix-client", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await Promise.all([clientTransport.close(), serverTransport.close()]);
    await unloadAllLoadedModels(lmstudio);
  });

  test("unloads all models before each load and runs MCP smoke", async () => {
    for (const modelKey of matrixModels) {
      await unloadAllLoadedModels(lmstudio);

      const loadedModel = await lmstudio.llm.load(modelKey, {
        identifier: `mcp-live-${modelKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      });

      const loadedAfterLoad = await lmstudio.llm.listLoaded();
      expect(loadedAfterLoad.some((item) => item.identifier === loadedModel.identifier)).toBe(true);

      const toolResponseRaw = await client.callTool({
        name: "ask_user_interview",
        arguments: {
          action: "create",
          payload: {
            title: `MCP matrix for ${modelKey}`,
            questions: [
              {
                id: "approve",
                type: "confirm",
                prompt: "Proceed?",
                required: true,
              },
            ],
          },
        },
      });

      const toolResponse = parseToolResult(toolResponseRaw);
      expect(toolResponse.success).toBe(true);
      expect(toolResponse.interviewId).toBeDefined();

      await loadedModel.unload();
      const loadedAfterUnload = await lmstudio.llm.listLoaded();
      expect(loadedAfterUnload.some((item) => item.identifier === loadedModel.identifier)).toBe(
        false,
      );
    }
  }, 180000);
});
