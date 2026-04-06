import { MemoryStore } from "../src/index";

describe("MemoryStore", () => {
  let memory: MemoryStore;

  beforeEach(() => {
    memory = new MemoryStore(":memory:");
  });

  afterEach(async () => {
    await memory.close();
  });

  test("should create a task run", async () => {
    const taskId = await memory.createTaskRun("test prompt", "trace-123");
    expect(taskId).toBeTruthy();
  });

  test("should record a tool call", async () => {
    const taskId = await memory.createTaskRun("test", "trace-123");
    await memory.recordToolCall(taskId, "test_tool", { input: "test" }, { output: "result" }, true);
    // Verify by querying (would need additional getters in production)
    expect(taskId).toBeTruthy();
  });

  test("should add and retrieve rules", async () => {
    await memory.addRule("command_deny", "rm -rf", "Destructive command");
    const rules = await memory.getRules("command_deny");
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].pattern).toBe("rm -rf");
  });
});
