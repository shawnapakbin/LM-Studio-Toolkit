/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Feature: sub-agent-mcp
// **Validates: Requirements 5.4, 5.5, 5.7**

import * as fc from "fast-check";
import nock from "nock";
import { type InternalTask, SessionPool } from "../../src/session-pool";
import type { SessionPoolConfig, TaskManifest } from "../../src/types";

const API_BASE = "http://localhost:1234";
const API_PATH = "/v1/chat/completions";

const defaultConfig: SessionPoolConfig = {
  concurrency: 1,
  apiUrl: `${API_BASE}${API_PATH}`,
  defaultTimeout: 3600,
};

function makeManifest(overrides?: Partial<TaskManifest>): TaskManifest {
  return {
    tasks: [],
    temperature: 0.7,
    maxTokens: 4096,
    maxRetries: 0,
    taskTimeout: 300,
    dispatchTimeout: 600,
    ...overrides,
  };
}

function makeTask(overrides?: Partial<InternalTask>): InternalTask {
  return {
    taskId: "test-task",
    prompt: "Do something",
    inputHash: "abc123",
    ...overrides,
  };
}

/** Helper to build a chat completion response with tool_calls */
function toolCallResponse(toolCalls: Array<{ name: string; id?: string; args?: string }>) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map((tc, i) => ({
            id: tc.id ?? `call_${i}`,
            type: "function",
            function: { name: tc.name, arguments: tc.args ?? "{}" },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/** Helper to build a final text response (no tool calls) */
function textResponse(content: string) {
  return {
    choices: [
      {
        message: { role: "assistant", content, tool_calls: undefined },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

beforeEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.cleanAll();
  nock.restore();
});

/**
 * Property 7: Unauthorized Tool Call Rejection
 *
 * For any Sub_Session with an allowed_tools list, if the model requests
 * a tool not in that list, the system returns a tool call error to the
 * session indicating the tool is unavailable — never routing the call
 * to the target MCP server.
 *
 * **Validates: Requirements 5.4**
 */
describe("Property 7: Unauthorized Tool Call Rejection", () => {
  // Generator for valid tool names (alphanumeric + underscores)
  const toolNameArb = fc
    .string({ minLength: 1, maxLength: 30 })
    .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
    .filter((s) => s !== "dispatch_sub_tasks");

  it("unauthorized tool calls produce an error message fed back to the model", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate an allowed tools list (1-5 tools)
        fc.uniqueArray(toolNameArb, { minLength: 1, maxLength: 5 }),
        // Generate an unauthorized tool name not in the allowed list
        toolNameArb,
        async (allowedTools, unauthorizedTool) => {
          // Ensure the unauthorized tool is truly not in the list
          fc.pre(!allowedTools.includes(unauthorizedTool));

          nock.cleanAll();

          // First response: model requests an unauthorized tool
          const _scope = nock(API_BASE)
            .post(API_PATH)
            .reply(200, toolCallResponse([{ name: unauthorizedTool, id: "call_unauth" }]));

          // Second response: model returns final text after seeing error
          let capturedBody: any = null;
          const _scope2 = nock(API_BASE)
            .post(API_PATH, (body) => {
              capturedBody = body;
              return true;
            })
            .reply(200, textResponse("Done"));

          const pool = new SessionPool(defaultConfig);
          const task = makeTask({ allowedTools, taskId: `task-${allowedTools[0]}` });
          const manifest = makeManifest();

          const results = await pool.dispatch(manifest, [task]);
          expect(results[0].status).toBe("success");

          // Verify the error was fed back — the second request should include
          // a tool message with an error indicating the tool is not available
          expect(capturedBody).not.toBeNull();
          const messages = capturedBody.messages;
          const toolMessage = messages.find(
            (m: any) => m.role === "tool" && m.tool_call_id === "call_unauth",
          );
          expect(toolMessage).toBeDefined();
          const errorContent = JSON.parse(toolMessage.content);
          expect(errorContent.error).toContain(unauthorizedTool);
          expect(errorContent.error).toMatch(/not available/i);
        },
      ),
      { numRuns: 3 },
    );
  });

  it("unauthorized tool never gets routed (only error response, never success)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(toolNameArb, { minLength: 1, maxLength: 3 }),
        toolNameArb,
        async (allowedTools, unauthorizedTool) => {
          fc.pre(!allowedTools.includes(unauthorizedTool));

          nock.cleanAll();

          // Model requests unauthorized tool, then gives final text
          nock(API_BASE)
            .post(API_PATH)
            .reply(200, toolCallResponse([{ name: unauthorizedTool }]));

          let secondRequestBody: any = null;
          nock(API_BASE)
            .post(API_PATH, (body) => {
              secondRequestBody = body;
              return true;
            })
            .reply(200, textResponse("Final"));

          const pool = new SessionPool(defaultConfig);
          const task = makeTask({ allowedTools, taskId: "route-test" });
          const results = await pool.dispatch(makeManifest(), [task]);

          // The session completed — the tool was NOT routed externally
          expect(results[0].status).toBe("success");
          // Verify the tool response contains an error, not a successful result
          const toolMsg = secondRequestBody.messages.find((m: any) => m.role === "tool");
          expect(toolMsg).toBeDefined();
          const parsed = JSON.parse(toolMsg.content);
          expect(parsed).toHaveProperty("error");
        },
      ),
      { numRuns: 3 },
    );
  });
});

/**
 * Property 8: No Tools When allowed_tools Absent
 *
 * For any task definition that omits the allowed_tools field, the HTTP
 * request to LM Studio contains no `tools` field and no `tool_choice`
 * field, executing as a single chat completion.
 *
 * **Validates: Requirements 5.5**
 */
describe("Property 8: No Tools When allowed_tools Absent", () => {
  // Generator for arbitrary task prompts
  const promptArb = fc.string({ minLength: 1, maxLength: 200 });
  const systemPromptArb = fc.option(fc.string({ minLength: 1, maxLength: 200 }), {
    nil: undefined,
  });

  it("requests without allowedTools have no tools or tool_choice fields", async () => {
    await fc.assert(
      fc.asyncProperty(promptArb, systemPromptArb, async (prompt, systemPrompt) => {
        nock.cleanAll();

        let capturedBody: any = null;
        nock(API_BASE)
          .post(API_PATH, (body) => {
            capturedBody = body;
            return true;
          })
          .reply(200, textResponse("Response"));

        const pool = new SessionPool(defaultConfig);
        const task = makeTask({
          prompt,
          systemPrompt,
          allowedTools: undefined,
          taskId: "no-tools-task",
        });

        await pool.dispatch(makeManifest({ systemPrompt: systemPrompt ?? undefined }), [task]);

        // Verify the request body does NOT contain tools or tool_choice
        expect(capturedBody).not.toBeNull();
        expect(capturedBody).not.toHaveProperty("tools");
        expect(capturedBody).not.toHaveProperty("tool_choice");
      }),
      { numRuns: 3 },
    );
  });

  it("requests WITH allowedTools DO have tools and tool_choice fields", async () => {
    const toolNameArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
      .filter((s) => s !== "dispatch_sub_tasks");

    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(toolNameArb, { minLength: 1, maxLength: 5 }),
        async (allowedTools) => {
          nock.cleanAll();

          let capturedBody: any = null;
          nock(API_BASE)
            .post(API_PATH, (body) => {
              capturedBody = body;
              return true;
            })
            .reply(200, textResponse("Response with tools"));

          const pool = new SessionPool(defaultConfig);
          const task = makeTask({ allowedTools, taskId: "with-tools-task" });
          await pool.dispatch(makeManifest(), [task]);

          // Verify the request body DOES contain tools and tool_choice
          expect(capturedBody).not.toBeNull();
          expect(capturedBody).toHaveProperty("tools");
          expect(capturedBody).toHaveProperty("tool_choice", "auto");
          expect(Array.isArray(capturedBody.tools)).toBe(true);
          expect(capturedBody.tools.length).toBe(allowedTools.length);
        },
      ),
      { numRuns: 3 },
    );
  });
});

/**
 * Property 9: Tool Call Loop Termination at 25 Iterations
 *
 * If 25 tool call rounds occur without a final text response, the loop
 * terminates, last output is used, and task is marked `truncated: true`.
 *
 * **Validates: Requirements 5.7**
 */
describe("Property 9: Tool Call Loop Termination at 25 Iterations", () => {
  const toolNameArb = fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s))
    .filter((s) => s !== "dispatch_sub_tasks");

  it("loop terminates after 25 iterations with truncated: true", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate allowed tools list with at least one tool
        fc.uniqueArray(toolNameArb, { minLength: 1, maxLength: 3 }),
        async (allowedTools) => {
          nock.cleanAll();

          // Mock 25 responses, each returning a tool call (never a final text)
          for (let i = 0; i < 25; i++) {
            nock(API_BASE)
              .post(API_PATH)
              .reply(200, toolCallResponse([{ name: allowedTools[0], id: `call_${i}` }]));
          }

          const pool = new SessionPool(defaultConfig);
          const task = makeTask({ allowedTools, taskId: "loop-test" });
          const results = await pool.dispatch(makeManifest(), [task]);

          // The task should complete with truncated flag
          expect(results).toHaveLength(1);
          expect(results[0].status).toBe("success");
          expect(results[0].truncated).toBe(true);
        },
      ),
      { numRuns: 3 },
    );
  });

  it("loop does NOT truncate if model produces text before 25 iterations", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(toolNameArb, { minLength: 1, maxLength: 3 }),
        // Generate a random number of iterations before final text (1-24)
        fc.integer({ min: 1, max: 24 }),
        async (allowedTools, iterationsBeforeText) => {
          nock.cleanAll();

          // Mock N tool call responses then 1 final text response
          for (let i = 0; i < iterationsBeforeText; i++) {
            nock(API_BASE)
              .post(API_PATH)
              .reply(200, toolCallResponse([{ name: allowedTools[0], id: `call_${i}` }]));
          }
          nock(API_BASE).post(API_PATH).reply(200, textResponse("Final answer"));

          const pool = new SessionPool(defaultConfig);
          const task = makeTask({ allowedTools, taskId: "no-trunc-test" });
          const results = await pool.dispatch(makeManifest(), [task]);

          expect(results).toHaveLength(1);
          expect(results[0].status).toBe("success");
          expect(results[0].truncated).toBeUndefined();
          expect(results[0].response).toBe("Final answer");
        },
      ),
      { numRuns: 3 },
    );
  });

  it("exactly 25 HTTP requests are made when always returning tool calls", async () => {
    nock.cleanAll();

    const allowedTools = ["read_file"];
    let requestCount = 0;

    for (let i = 0; i < 25; i++) {
      nock(API_BASE)
        .post(API_PATH)
        .reply(200, () => {
          requestCount++;
          return toolCallResponse([{ name: "read_file", id: `call_${requestCount}` }]);
        });
    }

    const pool = new SessionPool(defaultConfig);
    const task = makeTask({ allowedTools, taskId: "count-test" });
    await pool.dispatch(makeManifest(), [task]);

    expect(requestCount).toBe(25);
  });
});
