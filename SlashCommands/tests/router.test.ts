/**
 * SlashCommands router unit tests
 *
 * Mocks HTTP dispatch (post/get from dispatch.ts) and verifies that each
 * DispatchDescriptor variant is routed to the correct tool endpoint with the
 * correct payload.
 */

import { ENDPOINTS } from "../src/config";
import type { DispatchDescriptor } from "../src/parser";
import { route } from "../src/router";

// ── Mock dispatch helpers ─────────────────────────────────────────────────────

jest.mock("../src/dispatch", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

// Mock better-sqlite3 to avoid filesystem dependency in memory tests
jest.mock("better-sqlite3", () => {
  const mockDb = {
    prepare: jest.fn().mockReturnValue({
      get: jest
        .fn()
        .mockReturnValue({ total: 5, successes: 4, avg_ms: 120, min_ms: 80, max_ms: 200 }),
      all: jest.fn().mockReturnValue([{ id: 1, workflow_name: "test", success: 1 }]),
    }),
    close: jest.fn(),
  };
  return jest.fn().mockReturnValue(mockDb);
});

import { get, post } from "../src/dispatch";

const mockPost = post as jest.MockedFunction<typeof post>;
const mockGet = get as jest.MockedFunction<typeof get>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ success: true });
  mockGet.mockResolvedValue({ ok: true });
});

// ── ECM ───────────────────────────────────────────────────────────────────────

describe("route — ecm (non-compact)", () => {
  it("posts to ECM endpoint with action and params", async () => {
    const desc: DispatchDescriptor = {
      tool: "ecm",
      action: "store_segment",
      params: { sessionId: "s1", content: "hello", type: "conversation_turn" },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.ecm}/tools/ecm`, {
      action: "store_segment",
      sessionId: "s1",
      content: "hello",
      type: "conversation_turn",
    });
  });

  it("posts retrieve_context action", async () => {
    const desc: DispatchDescriptor = {
      tool: "ecm",
      action: "retrieve_context",
      params: { sessionId: "default", query: "what is the plan", topK: 3 },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.ecm}/tools/ecm`, {
      action: "retrieve_context",
      sessionId: "default",
      query: "what is the plan",
      topK: 3,
    });
  });

  it("posts list_segments action", async () => {
    const desc: DispatchDescriptor = {
      tool: "ecm",
      action: "list_segments",
      params: { sessionId: "default", limit: 10 },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.ecm}/tools/ecm`, {
      action: "list_segments",
      sessionId: "default",
      limit: 10,
    });
  });

  it("posts clear_session action", async () => {
    const desc: DispatchDescriptor = {
      tool: "ecm",
      action: "clear_session",
      params: { sessionId: "mySession" },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.ecm}/tools/ecm`, {
      action: "clear_session",
      sessionId: "mySession",
    });
  });
});

describe("route — ecm compact (two-step)", () => {
  it("calls post twice: summarize_session then list_segments", async () => {
    mockPost
      .mockResolvedValueOnce({ success: true, summary: "summarized" })
      .mockResolvedValueOnce({ data: { total: 3 } });

    const desc: DispatchDescriptor = {
      tool: "ecm",
      action: "compact",
      params: { sessionId: "s1", keepNewest: 5 },
    };
    const result = (await route(desc)) as Record<string, unknown>;

    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost).toHaveBeenNthCalledWith(1, `${ENDPOINTS.ecm}/tools/ecm`, {
      action: "summarize_session",
      sessionId: "s1",
      keepNewest: 5,
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, `${ENDPOINTS.ecm}/tools/ecm`, {
      action: "list_segments",
      sessionId: "s1",
      limit: 1,
    });
    expect(result.action).toBe("compact");
    expect(result.segmentsRemaining).toBe(3);
    expect(result.success).toBe(true);
  });

  it("returns 'unknown' for segmentsRemaining when list response has no data", async () => {
    mockPost.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({});

    const desc: DispatchDescriptor = {
      tool: "ecm",
      action: "compact",
      params: { sessionId: "default", keepNewest: 5 },
    };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(result.segmentsRemaining).toBe("unknown");
  });
});

// ── Calculator ────────────────────────────────────────────────────────────────

describe("route — calculator", () => {
  it("posts expression to calculator endpoint", async () => {
    const desc: DispatchDescriptor = { tool: "calculator", expression: "2 + 2" };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.calculator}/tools/calculate_engineering`, {
      expression: "2 + 2",
    });
  });

  it("includes precision when provided", async () => {
    const desc: DispatchDescriptor = { tool: "calculator", expression: "pi", precision: 5 };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.calculator}/tools/calculate_engineering`, {
      expression: "pi",
      precision: 5,
    });
  });

  it("omits precision when undefined", async () => {
    const desc: DispatchDescriptor = { tool: "calculator", expression: "1+1" };
    await route(desc);
    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("precision");
  });
});

// ── WebBrowser ────────────────────────────────────────────────────────────────

describe("route — webbrowser", () => {
  it("posts url and options to webbrowser endpoint", async () => {
    const desc: DispatchDescriptor = {
      tool: "webbrowser",
      url: "https://example.com",
      outputFormat: "markdown",
      screenshot: false,
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.webbrowser}/tools/browse_web`, {
      url: "https://example.com",
      outputFormat: "markdown",
      screenshot: false,
    });
  });

  it("includes waitForSelector when provided", async () => {
    const desc: DispatchDescriptor = {
      tool: "webbrowser",
      url: "https://example.com",
      outputFormat: "text",
      screenshot: true,
      waitForSelector: "#main",
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.webbrowser}/tools/browse_web`, {
      url: "https://example.com",
      outputFormat: "text",
      screenshot: true,
      waitForSelector: "#main",
    });
  });

  it("omits waitForSelector when not provided", async () => {
    const desc: DispatchDescriptor = {
      tool: "webbrowser",
      url: "https://example.com",
      outputFormat: "markdown",
      screenshot: false,
    };
    await route(desc);
    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("waitForSelector");
  });
});

// ── Clock ─────────────────────────────────────────────────────────────────────

describe("route — clock", () => {
  it("posts to clock endpoint with no body when no timezone", async () => {
    const desc: DispatchDescriptor = { tool: "clock" };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.clock}/tools/get_current_datetime`, {});
  });

  it("includes timeZone when provided", async () => {
    const desc: DispatchDescriptor = { tool: "clock", timeZone: "America/New_York" };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.clock}/tools/get_current_datetime`, {
      timeZone: "America/New_York",
    });
  });
});

// ── Terminal ──────────────────────────────────────────────────────────────────

describe("route — terminal", () => {
  it("posts command to terminal endpoint", async () => {
    const desc: DispatchDescriptor = { tool: "terminal", command: "ls -la" };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.terminal}/tools/run_terminal_command`, {
      command: "ls -la",
    });
  });

  it("includes cwd when provided", async () => {
    const desc: DispatchDescriptor = { tool: "terminal", command: "ls", cwd: "/tmp" };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.terminal}/tools/run_terminal_command`, {
      command: "ls",
      cwd: "/tmp",
    });
  });

  it("omits cwd when not provided", async () => {
    const desc: DispatchDescriptor = { tool: "terminal", command: "pwd" };
    await route(desc);
    const [, body] = mockPost.mock.calls[0];
    expect(body).not.toHaveProperty("cwd");
  });
});

// ── PythonShell ───────────────────────────────────────────────────────────

describe("route — pythonshell", () => {
  it("posts python_run_code action", async () => {
    const desc: DispatchDescriptor = {
      tool: "pythonshell",
      action: "run_code",
      code: "print(1)",
      cwd: "/tmp",
      timeoutMs: 5000,
    };

    await route(desc);

    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.pythonshell}/tools/python_run_code`, {
      code: "print(1)",
      cwd: "/tmp",
      timeoutMs: 5000,
    });
  });

  it("posts python_open_repl action", async () => {
    const desc: DispatchDescriptor = {
      tool: "pythonshell",
      action: "open_repl",
      cwd: "/work",
    };

    await route(desc);

    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.pythonshell}/tools/python_open_repl`, {
      cwd: "/work",
    });
  });

  it("posts python_open_idle action", async () => {
    const desc: DispatchDescriptor = {
      tool: "pythonshell",
      action: "open_idle",
    };

    await route(desc);

    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.pythonshell}/tools/python_open_idle`, {});
  });
});

// ── Skills ────────────────────────────────────────────────────────────────────

describe("route — skills", () => {
  it("posts list_skills action to skills endpoint", async () => {
    const desc: DispatchDescriptor = { tool: "skills", action: "list_skills", params: {} };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.skills}/tools/skills`, {
      action: "list_skills",
    });
  });

  it("posts execute_skill with params spread", async () => {
    const desc: DispatchDescriptor = {
      tool: "skills",
      action: "execute_skill",
      params: { name: "my-skill", params: { key: "val" } },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.skills}/tools/skills`, {
      action: "execute_skill",
      name: "my-skill",
      params: { key: "val" },
    });
  });

  it("posts delete_skill action", async () => {
    const desc: DispatchDescriptor = {
      tool: "skills",
      action: "delete_skill",
      params: { name: "old-skill" },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.skills}/tools/skills`, {
      action: "delete_skill",
      name: "old-skill",
    });
  });
});

// ── RAG ───────────────────────────────────────────────────────────────────────

describe("route — rag", () => {
  it("posts query action to rag endpoint", async () => {
    const desc: DispatchDescriptor = {
      tool: "rag",
      action: "query",
      params: { query: "what is AI", topK: 5 },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.rag}/tools/rag`, {
      action: "query",
      query: "what is AI",
      topK: 5,
    });
  });

  it("posts ingest action with source", async () => {
    const desc: DispatchDescriptor = {
      tool: "rag",
      action: "ingest",
      params: { content: "some text", source: "docs" },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.rag}/tools/rag`, {
      action: "ingest",
      content: "some text",
      source: "docs",
    });
  });

  it("posts list_sources action", async () => {
    const desc: DispatchDescriptor = { tool: "rag", action: "list_sources", params: {} };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.rag}/tools/rag`, { action: "list_sources" });
  });

  it("posts delete_source action", async () => {
    const desc: DispatchDescriptor = {
      tool: "rag",
      action: "delete_source",
      params: { sourceId: "src-1" },
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.rag}/tools/rag`, {
      action: "delete_source",
      sourceId: "src-1",
    });
  });
});

// ── AskUser ───────────────────────────────────────────────────────────────────

describe("route — askuser", () => {
  it("posts create_interview with prompt to askuser endpoint", async () => {
    const desc: DispatchDescriptor = { tool: "askuser", prompt: "What is your name?" };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.askuser}/tools/ask_user`, {
      action: "create_interview",
      prompt: "What is your name?",
    });
  });

  it("includes title when provided", async () => {
    const desc: DispatchDescriptor = {
      tool: "askuser",
      prompt: "Hello",
      title: "Greeting",
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.askuser}/tools/ask_user`, {
      action: "create_interview",
      prompt: "Hello",
      title: "Greeting",
    });
  });

  it("includes expiresInSeconds when provided", async () => {
    const desc: DispatchDescriptor = {
      tool: "askuser",
      prompt: "Confirm?",
      expiresInSeconds: 60,
    };
    await route(desc);
    expect(mockPost).toHaveBeenCalledWith(`${ENDPOINTS.askuser}/tools/ask_user`, {
      action: "create_interview",
      prompt: "Confirm?",
      expiresInSeconds: 60,
    });
  });

  it("omits optional fields when not provided", async () => {
    const desc: DispatchDescriptor = { tool: "askuser", prompt: "hi" };
    await route(desc);
    const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("expiresInSeconds");
  });
});

// ── Tools list ────────────────────────────────────────────────────────────────

describe("route — tools_list", () => {
  it("returns success with all tool names and endpoints (no HTTP call)", async () => {
    const desc: DispatchDescriptor = { tool: "tools_list" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    const tools = result.tools as Array<{ name: string; endpoint: string }>;
    expect(tools.some((t) => t.name === "Calculator")).toBe(true);
    expect(tools.some((t) => t.name === "ECM")).toBe(true);
    expect(tools.length).toBe(Object.keys(ENDPOINTS).length);
  });
});

// ── Tools health ──────────────────────────────────────────────────────────────

describe("route — tools_health", () => {
  it("GETs /health for all endpoints when no toolName specified", async () => {
    const desc: DispatchDescriptor = { tool: "tools_health" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(mockGet).toHaveBeenCalledTimes(Object.keys(ENDPOINTS).length);
    expect(result.success).toBe(true);
    const health = result.health as Record<string, string>;
    expect(health.calculator).toBe("healthy");
  });

  it("marks tool as unhealthy when ok is falsy", async () => {
    mockGet.mockResolvedValue({ ok: false });
    const desc: DispatchDescriptor = { tool: "tools_health" };
    const result = (await route(desc)) as Record<string, unknown>;
    const health = result.health as Record<string, string>;
    expect(Object.values(health).every((v) => v === "unhealthy")).toBe(true);
  });

  it("marks tool as unreachable when GET throws", async () => {
    mockGet.mockRejectedValue(new Error("ECONNREFUSED"));
    const desc: DispatchDescriptor = { tool: "tools_health" };
    const result = (await route(desc)) as Record<string, unknown>;
    const health = result.health as Record<string, string>;
    expect(Object.values(health).every((v) => v === "unreachable")).toBe(true);
  });

  it("checks only the specified tool when toolName is provided", async () => {
    const desc: DispatchDescriptor = { tool: "tools_health", toolName: "calculator" };
    await route(desc);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(`${ENDPOINTS.calculator}/health`);
  });

  it("returns 'unknown tool' for an unrecognised toolName", async () => {
    const desc: DispatchDescriptor = { tool: "tools_health", toolName: "nonexistent" };
    const result = (await route(desc)) as Record<string, unknown>;
    const health = result.health as Record<string, string>;
    expect(health.nonexistent).toBe("unknown tool");
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ── Tools schema ──────────────────────────────────────────────────────────────

describe("route — tools_schema", () => {
  it("GETs /tool-schema for the specified tool", async () => {
    mockGet.mockResolvedValue({ schema: {} });
    const desc: DispatchDescriptor = { tool: "tools_schema", toolName: "calculator" };
    await route(desc);
    expect(mockGet).toHaveBeenCalledWith(`${ENDPOINTS.calculator}/tool-schema`);
  });

  it("returns error for unknown toolName", async () => {
    const desc: DispatchDescriptor = { tool: "tools_schema", toolName: "bogus" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

// ── Memory ────────────────────────────────────────────────────────────────────

describe("route — memory_stats", () => {
  it("returns success with stats from SQLite (no HTTP call)", async () => {
    const desc: DispatchDescriptor = { tool: "memory_stats" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("returns success:false when DB is unavailable", async () => {
    const Database = require("better-sqlite3");
    Database.mockImplementationOnce(() => {
      throw new Error("no such file");
    });
    const desc: DispatchDescriptor = { tool: "memory_stats" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toContain("no such file");
  });
});

describe("route — memory_history", () => {
  it("queries history with the given limit (no HTTP call)", async () => {
    const desc: DispatchDescriptor = { tool: "memory_history", limit: 10 };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe("route — memory_patterns", () => {
  it("queries patterns (no HTTP call)", async () => {
    const desc: DispatchDescriptor = { tool: "memory_patterns" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

// ── Config show ───────────────────────────────────────────────────────────────

describe("route — config_show", () => {
  it("returns config with all tool endpoints (no HTTP call)", async () => {
    const desc: DispatchDescriptor = { tool: "config_show" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    const config = result.config as Record<string, unknown>;
    const tools = config.tools as Array<{ name: string; key: string; endpoint: string }>;
    expect(tools.some((t) => t.key === "calculator")).toBe(true);
    expect(tools.some((t) => t.key === "ecm")).toBe(true);
  });
});

// ── Unknown ───────────────────────────────────────────────────────────────────

describe("route — unknown", () => {
  it("returns success:false with error message and available commands", async () => {
    const desc: DispatchDescriptor = { tool: "unknown", raw: "/foobar" };
    const result = (await route(desc)) as Record<string, unknown>;
    expect(mockPost).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain("/foobar");
    expect(Array.isArray(result.availableCommands)).toBe(true);
  });
});
