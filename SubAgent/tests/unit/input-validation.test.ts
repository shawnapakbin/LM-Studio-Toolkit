/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import { TaskManifestSchema, loadConfig } from "../../src/mcp-server";

describe("TaskManifestSchema validation", () => {
  const validTask = { taskId: "task-1", prompt: "Analyze this code" };

  describe("tasks array bounds", () => {
    it("rejects an empty tasks array", () => {
      const result = TaskManifestSchema.safeParse({ tasks: [] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("at least 1");
      }
    });

    it("accepts exactly 1 task (minimum)", () => {
      const result = TaskManifestSchema.safeParse({ tasks: [validTask] });
      expect(result.success).toBe(true);
    });

    it("accepts exactly 20 tasks (maximum)", () => {
      const tasks = Array.from({ length: 20 }, (_, i) => ({
        taskId: `task-${i}`,
        prompt: "Do something",
      }));
      const result = TaskManifestSchema.safeParse({ tasks });
      expect(result.success).toBe(true);
    });

    it("rejects more than 20 tasks", () => {
      const tasks = Array.from({ length: 21 }, (_, i) => ({
        taskId: `task-${i}`,
        prompt: "Do something",
      }));
      const result = TaskManifestSchema.safeParse({ tasks });
      expect(result.success).toBe(false);
    });
  });

  describe("taskId validation", () => {
    it("rejects empty taskId", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "", prompt: "test" }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts taskId of 1 character", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "a", prompt: "test" }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts taskId of 64 characters (max)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "a".repeat(64), prompt: "test" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects taskId longer than 64 characters", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "a".repeat(65), prompt: "test" }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("prompt validation", () => {
    it("rejects empty prompt", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "t1", prompt: "" }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts prompt of 100,000 characters (max)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "t1", prompt: "x".repeat(100_000) }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects prompt exceeding 100,000 characters", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "t1", prompt: "x".repeat(100_001) }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("timeout validation", () => {
    it("rejects taskTimeout below 60", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        taskTimeout: 59,
      });
      expect(result.success).toBe(false);
    });

    it("accepts taskTimeout of 60 (minimum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        taskTimeout: 60,
      });
      expect(result.success).toBe(true);
    });

    it("accepts taskTimeout of 86400 (maximum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        taskTimeout: 86400,
      });
      expect(result.success).toBe(true);
    });

    it("rejects taskTimeout above 86400", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        taskTimeout: 86401,
      });
      expect(result.success).toBe(false);
    });

    it("rejects dispatchTimeout below 120", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        dispatchTimeout: 119,
      });
      expect(result.success).toBe(false);
    });

    it("accepts dispatchTimeout of 120 (minimum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        dispatchTimeout: 120,
      });
      expect(result.success).toBe(true);
    });

    it("accepts dispatchTimeout of 172800 (maximum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        dispatchTimeout: 172800,
      });
      expect(result.success).toBe(true);
    });

    it("rejects dispatchTimeout above 172800", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        dispatchTimeout: 172801,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer taskTimeout", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        taskTimeout: 60.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("concurrency validation", () => {
    it("rejects concurrency of 0", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        concurrency: 0,
      });
      expect(result.success).toBe(false);
    });

    it("accepts concurrency of 1 (minimum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        concurrency: 1,
      });
      expect(result.success).toBe(true);
    });

    it("accepts concurrency of 10 (maximum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        concurrency: 10,
      });
      expect(result.success).toBe(true);
    });

    it("rejects concurrency of 11", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        concurrency: 11,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer concurrency", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        concurrency: 2.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("temperature validation", () => {
    it("accepts temperature of 0.0", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        temperature: 0,
      });
      expect(result.success).toBe(true);
    });

    it("accepts temperature of 2.0", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        temperature: 2,
      });
      expect(result.success).toBe(true);
    });

    it("rejects temperature above 2.0", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        temperature: 2.1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative temperature", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        temperature: -0.1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("maxTokens validation", () => {
    it("accepts maxTokens of 1 (minimum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        maxTokens: 1,
      });
      expect(result.success).toBe(true);
    });

    it("accepts maxTokens of 32768 (maximum)", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        maxTokens: 32768,
      });
      expect(result.success).toBe(true);
    });

    it("rejects maxTokens of 0", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        maxTokens: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects maxTokens exceeding 32768", () => {
      const result = TaskManifestSchema.safeParse({
        tasks: [validTask],
        maxTokens: 32769,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("allowedTools validation", () => {
    it("accepts up to 20 allowed tools", () => {
      const tools = Array.from({ length: 20 }, (_, i) => `tool_${i}`);
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "t1", prompt: "test", allowedTools: tools }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects more than 20 allowed tools", () => {
      const tools = Array.from({ length: 21 }, (_, i) => `tool_${i}`);
      const result = TaskManifestSchema.safeParse({
        tasks: [{ taskId: "t1", prompt: "test", allowedTools: tools }],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Duplicate task IDs rejection", () => {
  it("dispatch handler rejects duplicate task IDs", async () => {
    // Import the handler directly to test duplicate ID validation
    const { handleDispatchSubTasks } = await import("../../src/tools/dispatch-sub-tasks");
    const config = {
      maxConcurrency: 1,
      cachePath: ":memory:",
      checkpointDir: "/tmp/test-checkpoints",
      apiUrl: "http://localhost:1234/v1/chat/completions",
      model: "default",
      promptTokenCost: 0,
      completionTokenCost: 0,
    };

    const result = await handleDispatchSubTasks(
      {
        tasks: [
          { taskId: "dup-task", prompt: "First task" },
          { taskId: "dup-task", prompt: "Second task" },
        ],
      },
      config,
    );

    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("Duplicate task IDs");
    expect(parsed.error).toContain("dup-task");
  });
});

describe("loadConfig environment variable handling", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns default concurrency of 1 when env var is absent", () => {
    delete process.env.SUBAGENT_MAX_CONCURRENCY;
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(1);
  });

  it("returns default concurrency of 1 when env var is empty string", () => {
    process.env.SUBAGENT_MAX_CONCURRENCY = "";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(1);
  });

  it("returns default concurrency of 1 when env var is non-integer", () => {
    process.env.SUBAGENT_MAX_CONCURRENCY = "abc";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(1);
  });

  it("returns default concurrency of 1 when env var is below valid range", () => {
    process.env.SUBAGENT_MAX_CONCURRENCY = "0";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(1);
  });

  it("returns default concurrency of 1 when env var exceeds valid range", () => {
    process.env.SUBAGENT_MAX_CONCURRENCY = "11";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(1);
  });

  it("parses float env var by truncating to integer (parseInt behavior)", () => {
    // parseInt("2.5", 10) returns 2, which is in range 1-10
    process.env.SUBAGENT_MAX_CONCURRENCY = "2.5";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(2);
  });

  it("parses valid integer concurrency within range", () => {
    process.env.SUBAGENT_MAX_CONCURRENCY = "5";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(5);
  });

  it("accepts concurrency of 1 (minimum)", () => {
    process.env.SUBAGENT_MAX_CONCURRENCY = "1";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(1);
  });

  it("accepts concurrency of 10 (maximum)", () => {
    process.env.SUBAGENT_MAX_CONCURRENCY = "10";
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(10);
  });

  it("returns default values for all config fields when no env vars set", () => {
    delete process.env.SUBAGENT_MAX_CONCURRENCY;
    delete process.env.SUBAGENT_CACHE_PATH;
    delete process.env.SUBAGENT_CHECKPOINT_DIR;
    delete process.env.SUBAGENT_API_URL;
    delete process.env.SUBAGENT_MODEL;
    delete process.env.SUBAGENT_PROMPT_TOKEN_COST;
    delete process.env.SUBAGENT_COMPLETION_TOKEN_COST;

    const config = loadConfig();
    expect(config.maxConcurrency).toBe(1);
    expect(config.cachePath).toBe("./subagent-cache.db");
    expect(config.checkpointDir).toBe("./.subagent-checkpoints/");
    expect(config.apiUrl).toBe("http://localhost:1234/v1/chat/completions");
    expect(config.model).toBe("default");
    expect(config.promptTokenCost).toBe(0);
    expect(config.completionTokenCost).toBe(0);
  });
});
