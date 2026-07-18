/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

/**
 * Integration tests for checkpoint file I/O timing.
 *
 * Validates that checkpoint files are written within 1 second of task
 * completion, using real timers and temp directories.
 *
 * **Validates: Requirements 12.1**
 */

import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { CheckpointStore } from "../../src/checkpoint-store";
import type { CheckpointFile, TelemetryRecord } from "../../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "subagent-checkpoint-timing-"));
}

async function cleanTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

function makeTelemetry(): TelemetryRecord {
  return {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    wallClockMs: 500,
    tokensPerSecond: 40,
  };
}

function makeCheckpoint(taskId: string, inputHash?: string): CheckpointFile {
  return {
    taskId,
    inputHash: inputHash ?? `hash_${taskId}`,
    result: `Result for ${taskId}`,
    tokenUsage: { prompt: 10, completion: 20, total: 30 },
    telemetry: makeTelemetry(),
    completedAt: new Date().toISOString(),
  };
}

// ─── Test Suite: Checkpoint Write Timing ─────────────────────────────────────

describe("Integration: Checkpoint File I/O Timing", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanTempDir(tempDir);
  });

  it("writes checkpoint file within 1 second of call", async () => {
    const store = new CheckpointStore(tempDir);
    const dispatchId = "timing-test-dispatch";
    const checkpoint = makeCheckpoint("task-timing");

    const startTime = Date.now();
    const { checkpointFailed } = await store.writeCheckpoint(dispatchId, checkpoint);
    const elapsed = Date.now() - startTime;

    expect(checkpointFailed).toBe(false);
    expect(elapsed).toBeLessThan(1000); // Must complete within 1 second

    // Verify file actually exists on disk
    const filePath = path.join(tempDir, dispatchId, "task-timing.json");
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it("writes manifest file within 1 second of call", async () => {
    const store = new CheckpointStore(tempDir);
    const dispatchId = "manifest-timing-dispatch";
    const manifest = {
      tasks: [
        { taskId: "t1", prompt: "Do something" },
        { taskId: "t2", prompt: "Do another thing" },
      ],
      temperature: 0.7,
      maxTokens: 4096,
    };

    const startTime = Date.now();
    await store.writeManifest(dispatchId, manifest);
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(1000); // Must complete within 1 second

    // Verify manifest file exists
    const filePath = path.join(tempDir, dispatchId, "_manifest.json");
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.tasks).toHaveLength(2);
  });

  it("writes multiple checkpoints sequentially, each within 1 second", async () => {
    const store = new CheckpointStore(tempDir);
    const dispatchId = "multi-checkpoint-dispatch";
    const taskCount = 10;

    for (let i = 0; i < taskCount; i++) {
      const checkpoint = makeCheckpoint(`task-${i}`);
      const startTime = Date.now();
      const { checkpointFailed } = await store.writeCheckpoint(dispatchId, checkpoint);
      const elapsed = Date.now() - startTime;

      expect(checkpointFailed).toBe(false);
      expect(elapsed).toBeLessThan(1000);
    }

    // Verify all files were written
    const dir = path.join(tempDir, dispatchId);
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(taskCount);
  });

  it("reads checkpoints back correctly after write", async () => {
    const store = new CheckpointStore(tempDir);
    const dispatchId = "roundtrip-dispatch";
    const original = makeCheckpoint("roundtrip-task", "specific-hash-value");

    await store.writeCheckpoint(dispatchId, original);
    const checkpoints = await store.readCheckpoints(dispatchId);

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].taskId).toBe("roundtrip-task");
    expect(checkpoints[0].inputHash).toBe("specific-hash-value");
    expect(checkpoints[0].result).toBe("Result for roundtrip-task");
    expect(checkpoints[0].telemetry.promptTokens).toBe(10);
    expect(checkpoints[0].telemetry.completionTokens).toBe(20);
  });

  it("cleanup removes dispatch directory and all contents", async () => {
    const store = new CheckpointStore(tempDir);
    const dispatchId = "cleanup-dispatch";

    // Write a manifest and several checkpoints
    await store.writeManifest(dispatchId, { tasks: [{ taskId: "t1", prompt: "p" }] });
    await store.writeCheckpoint(dispatchId, makeCheckpoint("t1"));
    await store.writeCheckpoint(dispatchId, makeCheckpoint("t2"));

    // Verify directory exists
    const dir = path.join(tempDir, dispatchId);
    const statBefore = await fs.stat(dir);
    expect(statBefore.isDirectory()).toBe(true);

    // Clean up
    await store.cleanup(dispatchId);

    // Verify directory is gone
    await expect(fs.stat(dir)).rejects.toThrow();
  });

  it("handles concurrent checkpoint writes to same dispatch", async () => {
    const store = new CheckpointStore(tempDir);
    const dispatchId = "concurrent-dispatch";
    const checkpoints = Array.from({ length: 5 }, (_, i) => makeCheckpoint(`concurrent-${i}`));

    const startTime = Date.now();
    const results = await Promise.all(
      checkpoints.map((cp) => store.writeCheckpoint(dispatchId, cp)),
    );
    const elapsed = Date.now() - startTime;

    // All should succeed within 1 second total
    expect(results.every((r) => r.checkpointFailed === false)).toBe(true);
    expect(elapsed).toBeLessThan(1000);

    // Verify all files exist
    const readBack = await store.readCheckpoints(dispatchId);
    expect(readBack).toHaveLength(5);
  });
});
