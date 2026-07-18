/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * Integration tests for end-to-end dispatch lifecycle.
 *
 * Tests the full dispatch → LM Studio API → result cycle using nock
 * to mock the LM Studio API at http://localhost:1234/v1/chat/completions.
 *
 * **Validates: Requirements 2.6, 5.2, 12.1, 16.1, 16.3, 17.5**
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import nock from "nock";
import { type InternalTask, SessionPool } from "../../src/session-pool";
import type { SessionPoolConfig, TaskManifest } from "../../src/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:1234";
const API_PATH = "/v1/chat/completions";
const API_URL = `${API_BASE}${API_PATH}`;

const DEFAULT_CONFIG: SessionPoolConfig = {
  concurrency: 5,
  apiUrl: API_URL,
  defaultTimeout: 3600,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<TaskManifest>): TaskManifest {
  return {
    tasks: [],
    temperature: 0.7,
    maxTokens: 4096,
    maxRetries: 0,
    taskTimeout: 60,
    dispatchTimeout: 120,
    ...overrides,
  };
}

function makeTask(id: string, prompt: string, overrides?: Partial<InternalTask>): InternalTask {
  return {
    taskId: id,
    prompt,
    inputHash: `hash_${id}`,
    ...overrides,
  };
}

/** Build a successful text completion response. */
function textResponse(content: string, promptTokens = 10, completionTokens = 20) {
  return {
    choices: [
      {
        message: { role: "assistant", content, tool_calls: undefined },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/** Build a response containing tool calls. */
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

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "subagent-integration-"));
}

async function cleanTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  nock.cleanAll();
});

afterAll(() => {
  nock.cleanAll();
  nock.restore();
});

// ─── Test Suite: End-to-End Dispatch ─────────────────────────────────────────

describe("Integration: End-to-End Dispatch", () => {
  it("dispatches multiple tasks with different prompts and collects results", async () => {
    const pool = new SessionPool(DEFAULT_CONFIG);
    const manifest = makeManifest({ concurrency: 3 });
    const tasks: InternalTask[] = [
      makeTask("task-alpha", "Summarize document A"),
      makeTask("task-beta", "Summarize document B"),
      makeTask("task-gamma", "Summarize document C"),
    ];

    // Mock 3 separate API calls — each returns a unique response
    const scope = nock(API_BASE)
      .post(API_PATH)
      .reply(200, textResponse("Summary of A", 15, 25))
      .post(API_PATH)
      .reply(200, textResponse("Summary of B", 12, 22))
      .post(API_PATH)
      .reply(200, textResponse("Summary of C", 18, 28));

    const results = await pool.dispatch(manifest, tasks);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === "success")).toBe(true);
    // Each task should have a response
    for (const result of results) {
      expect(result.response).toBeDefined();
      expect(result.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
    // Verify all API calls were made
    expect(scope.isDone()).toBe(true);
  });

  it("assigns unique session IDs to each dispatched task", async () => {
    const pool = new SessionPool(DEFAULT_CONFIG);
    const manifest = makeManifest({ concurrency: 5 });
    const tasks: InternalTask[] = Array.from({ length: 5 }, (_, i) =>
      makeTask(`task-${i}`, `Prompt ${i}`),
    );

    nock(API_BASE).post(API_PATH).times(5).reply(200, textResponse("Result"));

    const results = await pool.dispatch(manifest, tasks);

    const sessionIds = results.map((r) => r.sessionId);
    const uniqueIds = new Set(sessionIds);
    expect(uniqueIds.size).toBe(5);
  });

  it("includes telemetry data in each task result", async () => {
    const pool = new SessionPool(DEFAULT_CONFIG);
    const manifest = makeManifest();
    const tasks: InternalTask[] = [makeTask("telem-task", "Generate content")];

    nock(API_BASE)
      .post(API_PATH)
      .reply(200, textResponse("Generated content", 50, 100));

    const results = await pool.dispatch(manifest, tasks);

    expect(results[0].telemetry).toBeDefined();
    expect(results[0].telemetry!.promptTokens).toBe(50);
    expect(results[0].telemetry!.completionTokens).toBe(100);
    expect(results[0].telemetry!.totalTokens).toBe(150);
    expect(results[0].telemetry!.wallClockMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Test Suite: Tool Call → Normalize → Route → Result Cycle ────────────────

describe("Integration: Tool Call Lifecycle", () => {
  it("processes tool call followed by final text response", async () => {
    const pool = new SessionPool(DEFAULT_CONFIG);
    const manifest = makeManifest();
    const tasks: InternalTask[] = [
      makeTask("tool-task", "Use the read_file tool", {
        allowedTools: ["read_file", "write_file"],
      }),
    ];

    // First API call returns a tool call request
    // Second API call (after tool result) returns final text
    const scope = nock(API_BASE)
      .post(API_PATH)
      .reply(
        200,
        toolCallResponse([{ name: "read_file", id: "call_1", args: '{"path":"/tmp/test.txt"}' }]),
      )
      .post(API_PATH)
      .reply(200, textResponse("File content processed successfully"));

    const results = await pool.dispatch(manifest, tasks);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("success");
    expect(results[0].response).toBe("File content processed successfully");
    expect(scope.isDone()).toBe(true);
  });

  it("rejects tool calls not in the allowed_tools list", async () => {
    const pool = new SessionPool(DEFAULT_CONFIG);
    const manifest = makeManifest();
    const tasks: InternalTask[] = [
      makeTask("restricted-task", "Try unauthorized tool", {
        allowedTools: ["read_file"],
      }),
    ];

    // Model requests unauthorized tool, then system sends error back, model responds with text
    const scope = nock(API_BASE)
      .post(API_PATH)
      .reply(200, toolCallResponse([{ name: "delete_database", id: "call_bad" }]))
      .post(API_PATH)
      .reply(200, textResponse("I cannot use that tool, here is my answer instead"));

    const results = await pool.dispatch(manifest, tasks);

    expect(results[0].status).toBe("success");
    expect(results[0].response).toContain("I cannot use that tool");
    expect(scope.isDone()).toBe(true);
  });

  it("blocks dispatch_sub_tasks tool calls via recursion guard", async () => {
    const pool = new SessionPool(DEFAULT_CONFIG);
    const manifest = makeManifest();
    const tasks: InternalTask[] = [
      makeTask("recursion-task", "Try to recurse", {
        allowedTools: ["read_file", "dispatch_sub_tasks"],
      }),
    ];

    // Model tries dispatch_sub_tasks, gets error, then produces final text
    const scope = nock(API_BASE)
      .post(API_PATH)
      .reply(200, toolCallResponse([{ name: "dispatch_sub_tasks", id: "call_recurse" }]))
      .post(API_PATH)
      .reply(200, textResponse("Cannot recurse, providing direct answer"));

    const results = await pool.dispatch(manifest, tasks);

    expect(results[0].status).toBe("success");
    expect(results[0].response).toContain("Cannot recurse");
    expect(scope.isDone()).toBe(true);
  });

  it("handles multiple sequential tool calls before final response", async () => {
    const pool = new SessionPool(DEFAULT_CONFIG);
    const manifest = makeManifest();
    const tasks: InternalTask[] = [
      makeTask("multi-tool-task", "Use multiple tools", {
        allowedTools: ["read_file", "list_dir"],
      }),
    ];

    const scope = nock(API_BASE)
      .post(API_PATH)
      .reply(200, toolCallResponse([{ name: "read_file", id: "c1" }]))
      .post(API_PATH)
      .reply(200, toolCallResponse([{ name: "list_dir", id: "c2" }]))
      .post(API_PATH)
      .reply(200, textResponse("Completed analysis with both tools"));

    const results = await pool.dispatch(manifest, tasks);

    expect(results[0].status).toBe("success");
    expect(results[0].response).toBe("Completed analysis with both tools");
    expect(scope.isDone()).toBe(true);
  });
});
