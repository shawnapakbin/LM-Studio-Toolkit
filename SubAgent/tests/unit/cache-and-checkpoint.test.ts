/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { CheckpointStore } from "../../src/checkpoint-store";
import { DedupCache } from "../../src/dedup-cache";

describe("DedupCache — clear with prefix matching zero entries (Req 7.8)", () => {
  let cache: DedupCache;

  beforeEach(() => {
    cache = new DedupCache(":memory:");
  });

  afterEach(() => {
    cache.close();
  });

  it("returns 0 when prefix matches no entries", () => {
    // Add an entry with a known hash
    cache.set("abc123def456", {
      inputHash: "abc123def456",
      result: "test result",
      tokenUsage: { prompt: 10, completion: 20, total: 30 },
      completedAt: new Date().toISOString(),
      modelId: "test-model",
    });

    // Clear with a prefix that doesn't match
    const removed = cache.clear({ prefix: "zzz" });
    expect(removed).toBe(0);
  });

  it("returns 0 when cache is empty and prefix is provided", () => {
    const removed = cache.clear({ prefix: "abc" });
    expect(removed).toBe(0);
  });

  it("removes matching entries when prefix does match", () => {
    cache.set("abc111", {
      inputHash: "abc111",
      result: "result1",
      tokenUsage: { prompt: 10, completion: 20, total: 30 },
      completedAt: new Date().toISOString(),
      modelId: "m1",
    });
    cache.set("abc222", {
      inputHash: "abc222",
      result: "result2",
      tokenUsage: { prompt: 10, completion: 20, total: 30 },
      completedAt: new Date().toISOString(),
      modelId: "m1",
    });
    cache.set("def333", {
      inputHash: "def333",
      result: "result3",
      tokenUsage: { prompt: 10, completion: 20, total: 30 },
      completedAt: new Date().toISOString(),
      modelId: "m1",
    });

    const removed = cache.clear({ prefix: "abc" });
    expect(removed).toBe(2);

    // def333 should still exist
    const remaining = cache.get("def333", 86400);
    expect(remaining).not.toBeNull();
  });

  it("removes all entries when no options provided", () => {
    cache.set("hash1", {
      inputHash: "hash1",
      result: "r1",
      tokenUsage: { prompt: 5, completion: 10, total: 15 },
      completedAt: new Date().toISOString(),
      modelId: "m1",
    });
    cache.set("hash2", {
      inputHash: "hash2",
      result: "r2",
      tokenUsage: { prompt: 5, completion: 10, total: 15 },
      completedAt: new Date().toISOString(),
      modelId: "m1",
    });

    const removed = cache.clear();
    expect(removed).toBe(2);
  });
});

describe("CheckpointStore — corrupt JSON handling (Req 12.8)", () => {
  let tmpDir: string;
  let store: CheckpointStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-cp-test-"));
    store = new CheckpointStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("skips corrupt checkpoint files and returns empty array", async () => {
    const dispatchId = "test-dispatch-corrupt";
    const dispatchDir = path.join(tmpDir, dispatchId);
    await fs.mkdir(dispatchDir, { recursive: true });

    // Write a corrupt JSON file
    await fs.writeFile(
      path.join(dispatchDir, "task-bad.json"),
      "{ this is not valid json !!!",
      "utf-8",
    );

    const checkpoints = await store.readCheckpoints(dispatchId);
    expect(checkpoints).toEqual([]);
  });

  it("skips corrupt files while returning valid checkpoint files", async () => {
    const dispatchId = "test-dispatch-mixed";
    const dispatchDir = path.join(tmpDir, dispatchId);
    await fs.mkdir(dispatchDir, { recursive: true });

    // Write a valid checkpoint
    const validCheckpoint = {
      taskId: "task-good",
      inputHash: "abc123",
      result: "Good result",
      tokenUsage: { prompt: 10, completion: 20, total: 30 },
      telemetry: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        wallClockMs: 1000,
        tokensPerSecond: 20,
      },
      completedAt: "2024-01-01T00:00:00.000Z",
    };
    await fs.writeFile(
      path.join(dispatchDir, "task-good.json"),
      JSON.stringify(validCheckpoint),
      "utf-8",
    );

    // Write a corrupt JSON file
    await fs.writeFile(path.join(dispatchDir, "task-corrupt.json"), "not json at all", "utf-8");

    const checkpoints = await store.readCheckpoints(dispatchId);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].taskId).toBe("task-good");
  });

  it("treats files with missing required fields as incomplete", async () => {
    const dispatchId = "test-dispatch-incomplete";
    const dispatchDir = path.join(tmpDir, dispatchId);
    await fs.mkdir(dispatchDir, { recursive: true });

    // Write a JSON file with missing required fields (no inputHash)
    await fs.writeFile(
      path.join(dispatchDir, "task-incomplete.json"),
      JSON.stringify({ taskId: "task-incomplete", result: "partial" }),
      "utf-8",
    );

    const checkpoints = await store.readCheckpoints(dispatchId);
    expect(checkpoints).toEqual([]);
  });

  it("returns empty array for non-existent dispatch directory", async () => {
    const checkpoints = await store.readCheckpoints("non-existent-dispatch");
    expect(checkpoints).toEqual([]);
  });
});

describe("CheckpointStore — write failure behavior (Req 12.7)", () => {
  it("returns checkpointFailed: true when write fails due to I/O error", async () => {
    // Use a path targeting a file as a directory — guaranteed to fail on any OS
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-cp-fail-"));
    const blockingFile = path.join(tmpDir, "blocker");
    await fs.writeFile(blockingFile, "I am a file, not a directory", "utf-8");

    // The CheckpointStore will try to mkdir inside "blocker" which is a file — this fails
    const store = new CheckpointStore(blockingFile);

    const result = await store.writeCheckpoint("dispatch-fail", {
      taskId: "task-1",
      inputHash: "hash123",
      result: "test result",
      tokenUsage: { prompt: 5, completion: 10, total: 15 },
      telemetry: {
        promptTokens: 5,
        completionTokens: 10,
        totalTokens: 15,
        wallClockMs: 500,
        tokensPerSecond: 20,
      },
      completedAt: "2024-01-01T00:00:00.000Z",
    });

    expect(result.checkpointFailed).toBe(true);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns checkpointFailed: false on successful write", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "subagent-cp-write-"));
    const store = new CheckpointStore(tmpDir);

    const result = await store.writeCheckpoint("dispatch-ok", {
      taskId: "task-success",
      inputHash: "hash456",
      result: "success result",
      tokenUsage: { prompt: 10, completion: 20, total: 30 },
      telemetry: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        wallClockMs: 1000,
        tokensPerSecond: 20,
      },
      completedAt: "2024-01-01T00:00:00.000Z",
    });

    expect(result.checkpointFailed).toBe(false);

    // Verify the file was written
    const filePath = path.join(tmpDir, "dispatch-ok", "task-success.json");
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.taskId).toBe("task-success");

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
