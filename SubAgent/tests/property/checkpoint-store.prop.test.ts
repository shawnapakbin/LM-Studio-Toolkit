/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Property 22: Checkpoint/Resume Round Trip
// Property 23: Checkpoint Cleanup
// **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 12.6**

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as fc from "fast-check";
import {
  CheckpointFile,
  CheckpointStore,
  TaskDefinition,
  TaskManifest,
  TelemetryRecord,
  computeInputHash,
} from "../../src/checkpoint-store";

describe("Property 22: Checkpoint/Resume Round Trip", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-roundtrip-"));
    tempDirs.push(dir);
    return dir;
  }

  // --- Generators ---

  const taskIdGen = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")),
    { minLength: 1, maxLength: 32 },
  );

  const dispatchIdGen = fc.uuid();

  const promptGen = fc.string({ minLength: 1, maxLength: 200 });

  const _telemetryGen: fc.Arbitrary<TelemetryRecord> = fc.record({
    promptTokens: fc.nat({ max: 10000 }),
    completionTokens: fc.nat({ max: 10000 }),
    totalTokens: fc.nat({ max: 20000 }),
    wallClockMs: fc.nat({ max: 60000 }),
    tokensPerSecond: fc.float({ min: 0, max: 1000, noNaN: true }),
  });

  const taskDefinitionGen: fc.Arbitrary<TaskDefinition> = fc.record({
    taskId: taskIdGen,
    prompt: promptGen,
    systemPrompt: fc.option(promptGen, { nil: undefined }),
    allowedTools: fc.option(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
      { nil: undefined },
    ),
  });

  const manifestGen: fc.Arbitrary<TaskManifest> = fc.record({
    tasks: fc.array(taskDefinitionGen, { minLength: 1, maxLength: 5 }),
    systemPrompt: fc.option(promptGen, { nil: undefined }),
    synthesisPrompt: fc.option(promptGen, { nil: undefined }),
    mergePrompt: fc.option(promptGen, { nil: undefined }),
    temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
    maxTokens: fc.option(fc.integer({ min: 1, max: 32768 }), { nil: undefined }),
    modelContextSize: fc.option(fc.integer({ min: 1024, max: 65536 }), { nil: undefined }),
    concurrency: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
    maxRetries: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
    skipCache: fc.option(fc.boolean(), { nil: undefined }),
    cacheMaxAge: fc.option(fc.integer({ min: 0, max: 86400 }), { nil: undefined }),
    autoChunk: fc.option(fc.boolean(), { nil: undefined }),
    keepCheckpoints: fc.option(fc.boolean(), { nil: undefined }),
    taskTimeout: fc.option(fc.integer({ min: 60, max: 86400 }), { nil: undefined }),
    dispatchTimeout: fc.option(fc.integer({ min: 120, max: 172800 }), { nil: undefined }),
  });

  function makeCheckpoint(task: TaskDefinition, manifest: TaskManifest): CheckpointFile {
    return {
      taskId: task.taskId,
      inputHash: computeInputHash(task, manifest),
      result: `Result for ${task.taskId}`,
      tokenUsage: { prompt: 100, completion: 200, total: 300 },
      telemetry: {
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        wallClockMs: 1500,
        tokensPerSecond: 133.3,
      },
      completedAt: new Date().toISOString(),
    };
  }

  it("writeCheckpoint → readCheckpoints returns exactly K entries with matching data", async () => {
    await fc.assert(
      fc.asyncProperty(dispatchIdGen, manifestGen, async (dispatchId, manifest) => {
        // Ensure unique task IDs within the manifest
        const seenIds = new Set<string>();
        const uniqueTasks = manifest.tasks.filter((t) => {
          if (seenIds.has(t.taskId)) return false;
          seenIds.add(t.taskId);
          return true;
        });
        fc.pre(uniqueTasks.length > 0);
        manifest = { ...manifest, tasks: uniqueTasks };

        const baseDir = createTempDir();
        const store = new CheckpointStore(baseDir);

        // Write K checkpoints
        const written: CheckpointFile[] = [];
        for (const task of manifest.tasks) {
          const checkpoint = makeCheckpoint(task, manifest);
          await store.writeCheckpoint(dispatchId, checkpoint);
          written.push(checkpoint);
        }

        // Read them back
        const read = await store.readCheckpoints(dispatchId);

        // Verify exactly K entries returned
        expect(read.length).toBe(written.length);

        // Verify each written checkpoint is found in read results with matching data
        for (const w of written) {
          const found = read.find((r) => r.taskId === w.taskId);
          expect(found).toBeDefined();
          expect(found!.inputHash).toBe(w.inputHash);
          expect(found!.result).toBe(w.result);
          expect(found!.tokenUsage).toEqual(w.tokenUsage);
          expect(found!.completedAt).toBe(w.completedAt);
        }
      }),
      { numRuns: 15 },
    );
  });

  it("writeManifest → readManifest returns the same manifest", async () => {
    await fc.assert(
      fc.asyncProperty(dispatchIdGen, manifestGen, async (dispatchId, manifest) => {
        // Ensure unique task IDs
        const seenIds = new Set<string>();
        manifest = {
          ...manifest,
          tasks: manifest.tasks.filter((t) => {
            if (seenIds.has(t.taskId)) return false;
            seenIds.add(t.taskId);
            return true;
          }),
        };
        fc.pre(manifest.tasks.length > 0);

        const baseDir = createTempDir();
        const store = new CheckpointStore(baseDir);

        // Write manifest
        await store.writeManifest(dispatchId, manifest);

        // Read it back
        const read = await store.readManifest(dispatchId);

        // Verify manifest round-trips correctly
        expect(read).not.toBeNull();
        expect(read!.tasks.length).toBe(manifest.tasks.length);
        for (let i = 0; i < manifest.tasks.length; i++) {
          expect(read!.tasks[i].taskId).toBe(manifest.tasks[i].taskId);
          expect(read!.tasks[i].prompt).toBe(manifest.tasks[i].prompt);
        }
        expect(read!.systemPrompt).toBe(manifest.systemPrompt);
        expect(read!.synthesisPrompt).toBe(manifest.synthesisPrompt);
        expect(read!.temperature).toBe(manifest.temperature);
        expect(read!.maxTokens).toBe(manifest.maxTokens);
        expect(read!.concurrency).toBe(manifest.concurrency);
      }),
      { numRuns: 15 },
    );
  });

  it("validateHashes returns valid when hashes match recomputed values", async () => {
    await fc.assert(
      fc.asyncProperty(dispatchIdGen, manifestGen, async (dispatchId, manifest) => {
        // Ensure unique task IDs
        const seenIds = new Set<string>();
        manifest = {
          ...manifest,
          tasks: manifest.tasks.filter((t) => {
            if (seenIds.has(t.taskId)) return false;
            seenIds.add(t.taskId);
            return true;
          }),
        };
        fc.pre(manifest.tasks.length > 0);

        const baseDir = createTempDir();
        const store = new CheckpointStore(baseDir);

        // Write checkpoints with correct hashes
        for (const task of manifest.tasks) {
          const checkpoint = makeCheckpoint(task, manifest);
          await store.writeCheckpoint(dispatchId, checkpoint);
        }

        // Validate — all hashes should match since we used computeInputHash
        const result = await store.validateHashes(dispatchId, manifest);

        expect(result.valid).toBe(true);
        expect(result.mismatched).toHaveLength(0);
      }),
      { numRuns: 15 },
    );
  });
});

describe("Property 23: Checkpoint Cleanup", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-cleanup-"));
    tempDirs.push(dir);
    return dir;
  }

  const taskIdGen = fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-_".split("")),
    { minLength: 1, maxLength: 32 },
  );

  const dispatchIdGen = fc.uuid();

  const promptGen = fc.string({ minLength: 1, maxLength: 200 });

  const taskDefinitionGen: fc.Arbitrary<TaskDefinition> = fc.record({
    taskId: taskIdGen,
    prompt: promptGen,
    systemPrompt: fc.option(promptGen, { nil: undefined }),
    allowedTools: fc.option(
      fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
      { nil: undefined },
    ),
  });

  const manifestGen: fc.Arbitrary<TaskManifest> = fc.record({
    tasks: fc.array(taskDefinitionGen, { minLength: 1, maxLength: 5 }),
    systemPrompt: fc.option(promptGen, { nil: undefined }),
    synthesisPrompt: fc.option(promptGen, { nil: undefined }),
    mergePrompt: fc.option(promptGen, { nil: undefined }),
    temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
    maxTokens: fc.option(fc.integer({ min: 1, max: 32768 }), { nil: undefined }),
    modelContextSize: fc.option(fc.integer({ min: 1024, max: 65536 }), { nil: undefined }),
    concurrency: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
    maxRetries: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
    skipCache: fc.option(fc.boolean(), { nil: undefined }),
    cacheMaxAge: fc.option(fc.integer({ min: 0, max: 86400 }), { nil: undefined }),
    autoChunk: fc.option(fc.boolean(), { nil: undefined }),
    keepCheckpoints: fc.option(fc.boolean(), { nil: undefined }),
    taskTimeout: fc.option(fc.integer({ min: 60, max: 86400 }), { nil: undefined }),
    dispatchTimeout: fc.option(fc.integer({ min: 120, max: 172800 }), { nil: undefined }),
  });

  it("cleanup removes the entire directory; readCheckpoints returns empty and readManifest returns null", async () => {
    await fc.assert(
      fc.asyncProperty(dispatchIdGen, manifestGen, async (dispatchId, manifest) => {
        // Ensure unique task IDs
        const seenIds = new Set<string>();
        manifest = {
          ...manifest,
          tasks: manifest.tasks.filter((t) => {
            if (seenIds.has(t.taskId)) return false;
            seenIds.add(t.taskId);
            return true;
          }),
        };
        fc.pre(manifest.tasks.length > 0);

        const baseDir = createTempDir();
        const store = new CheckpointStore(baseDir);

        // Write manifest and checkpoints
        await store.writeManifest(dispatchId, manifest);
        for (const task of manifest.tasks) {
          const checkpoint: CheckpointFile = {
            taskId: task.taskId,
            inputHash: computeInputHash(task, manifest),
            result: `Result for ${task.taskId}`,
            tokenUsage: { prompt: 50, completion: 100, total: 150 },
            telemetry: {
              promptTokens: 50,
              completionTokens: 100,
              totalTokens: 150,
              wallClockMs: 1000,
              tokensPerSecond: 100,
            },
            completedAt: new Date().toISOString(),
          };
          await store.writeCheckpoint(dispatchId, checkpoint);
        }

        // Verify files exist before cleanup
        const beforeCheckpoints = await store.readCheckpoints(dispatchId);
        const beforeManifest = await store.readManifest(dispatchId);
        expect(beforeCheckpoints.length).toBe(manifest.tasks.length);
        expect(beforeManifest).not.toBeNull();

        // Cleanup
        await store.cleanup(dispatchId);

        // Verify directory is gone
        const dispatchDir = path.join(baseDir, dispatchId);
        expect(fs.existsSync(dispatchDir)).toBe(false);

        // readCheckpoints returns empty array
        const afterCheckpoints = await store.readCheckpoints(dispatchId);
        expect(afterCheckpoints).toEqual([]);

        // readManifest returns null
        const afterManifest = await store.readManifest(dispatchId);
        expect(afterManifest).toBeNull();
      }),
      { numRuns: 15 },
    );
  });
});
