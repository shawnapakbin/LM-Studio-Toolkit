/**
 * @author Shawna Pakbin
 * @organization Revive Digit Studio
 * @version 2.3.1
 */

// Property tests for dry-run dispatch — validates completeness of the DryRunReport
// produced by handleDryRunDispatch.

import * as fc from "fast-check";
import type { ServerConfig } from "../../src/mcp-server";
import { handleDryRunDispatch } from "../../src/tools/dry-run-dispatch";
import type { TaskDefinition, TaskManifest } from "../../src/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal ServerConfig using in-memory SQLite */
function makeConfig(cachePath = ":memory:"): ServerConfig {
  return {
    maxConcurrency: 1,
    cachePath,
    checkpointDir: "./.subagent-checkpoints/",
    apiUrl: "http://localhost:1234/v1/chat/completions",
    model: "default",
    promptTokenCost: 0,
    completionTokenCost: 0,
  };
}

/** Parse the DryRunReport from the handler response */
function parseReport(response: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(response.content[0].text);
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a task prompt (non-empty, reasonable size for testing) */
const arbPrompt = fc.string({ minLength: 1, maxLength: 500 });

/** Generate an optional system prompt */
const arbSystemPrompt = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined });

/** Generate optional allowed tools */
const arbAllowedTools = fc.option(
  fc.array(fc.stringMatching(/^[a-z_]{1,20}$/), { minLength: 1, maxLength: 5 }),
  { nil: undefined },
);

/** Generate a TaskDefinition with a guaranteed unique taskId based on index */
function arbTaskDef(index: number): fc.Arbitrary<TaskDefinition> {
  return fc.record({
    taskId: fc.constant(`task-${index}`),
    prompt: arbPrompt,
    systemPrompt: arbSystemPrompt,
    allowedTools: arbAllowedTools,
  });
}

/** Generate a TaskManifest with 1–10 tasks, each with unique IDs */
const arbManifest: fc.Arbitrary<TaskManifest> = fc.integer({ min: 1, max: 10 }).chain((taskCount) =>
  fc.record({
    tasks: fc
      .tuple(...Array.from({ length: taskCount }, (_, i) => arbTaskDef(i)))
      .map((tasks) => tasks as TaskDefinition[]),
    systemPrompt: arbSystemPrompt,
    temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
    maxTokens: fc.option(fc.integer({ min: 1, max: 32768 }), { nil: undefined }),
    modelContextSize: fc.option(fc.integer({ min: 1024, max: 131072 }), { nil: undefined }),
    concurrency: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
    skipCache: fc.option(fc.boolean(), { nil: undefined }),
    cacheMaxAge: fc.option(fc.integer({ min: 0, max: 86400 }), { nil: undefined }),
    autoChunk: fc.option(fc.boolean(), { nil: undefined }),
  }),
);

/** Generate a manifest with at least one duplicate task (same prompt and system prompt) */
const arbManifestWithDuplicates: fc.Arbitrary<TaskManifest> = fc
  .integer({ min: 2, max: 8 })
  .chain((taskCount) =>
    fc.record({
      tasks: fc.tuple(arbPrompt, arbSystemPrompt).map(([sharedPrompt, sharedSysPrompt]) =>
        Array.from({ length: taskCount }, (_, i) => ({
          taskId: `dup-task-${i}`,
          prompt: sharedPrompt,
          systemPrompt: sharedSysPrompt,
        })),
      ),
      systemPrompt: fc.constant(undefined),
      temperature: fc.constant(undefined),
      maxTokens: fc.constant(undefined),
      modelContextSize: fc.option(fc.integer({ min: 1024, max: 131072 }), { nil: undefined }),
      concurrency: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
      skipCache: fc.constant(undefined),
      cacheMaxAge: fc.constant(undefined),
      autoChunk: fc.constant(undefined),
    }),
  );

// ─── Property 28: Dry Run Report Completeness ────────────────────────────────

/**
 * **Validates: Requirements 15.2, 15.4, 15.5, 15.6**
 *
 * Property 28: For any valid Task_Manifest, the DryRunReport includes:
 * - task count after dedup
 * - per-task estimated tokens
 * - total estimated tokens
 * - budget exceedance flags
 * - cache hit/miss indicators per task
 * - execution plan with FIFO batch ordering
 * - (when cache telemetry exists) estimated wall-clock time
 */
describe("Property 28: Dry Run Report Completeness", () => {
  it("report includes taskCount matching input manifest task count", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        expect(report.taskCount).toBe(manifest.tasks.length);
      }),
      { numRuns: 25 },
    );
  });

  it("per-task analysis has entry for every task in the manifest", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        // Every task should have a per-task analysis entry
        expect(report.perTaskAnalysis.length).toBe(manifest.tasks.length);

        // Every task ID in manifest should appear in perTaskAnalysis
        const reportTaskIds = report.perTaskAnalysis.map((a: any) => a.taskId);
        for (const task of manifest.tasks) {
          expect(reportTaskIds).toContain(task.taskId);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("estimatedTokens matches the chars/4 formula for each task", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        for (const task of manifest.tasks) {
          const analysis = report.perTaskAnalysis.find((a: any) => a.taskId === task.taskId);
          expect(analysis).toBeDefined();

          const systemPrompt = task.systemPrompt ?? manifest.systemPrompt ?? "";
          const toolDefs = task.allowedTools ? JSON.stringify(task.allowedTools) : "";
          const expectedTokens = Math.round(
            (systemPrompt.length + task.prompt.length + toolDefs.length) / 4,
          );

          expect(analysis.estimatedTokens).toBe(expectedTokens);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("exceedsBudget correctly reflects 80% threshold", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        const modelContextSize = manifest.modelContextSize ?? 8192;
        const budgetLimit = modelContextSize * 0.8;

        for (const analysis of report.perTaskAnalysis) {
          const task = manifest.tasks.find((t) => t.taskId === analysis.taskId)!;
          const systemPrompt = task.systemPrompt ?? manifest.systemPrompt ?? "";
          const toolDefs = task.allowedTools ? JSON.stringify(task.allowedTools) : "";
          const estimatedTokens = (systemPrompt.length + task.prompt.length + toolDefs.length) / 4;

          if (estimatedTokens > budgetLimit) {
            expect(analysis.exceedsBudget).toBe(true);
          } else {
            expect(analysis.exceedsBudget).toBe(false);
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  it("execution plan batches tasks by concurrency limit in FIFO order", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        const concurrency = manifest.concurrency ?? config.maxConcurrency;

        // Execution plan should exist
        expect(report.executionPlan).toBeDefined();
        expect(Array.isArray(report.executionPlan)).toBe(true);

        // Each batch should have at most `concurrency` tasks
        for (const batch of report.executionPlan) {
          expect(batch.taskIds.length).toBeGreaterThan(0);
          expect(batch.taskIds.length).toBeLessThanOrEqual(concurrency);
        }

        // Batches should be numbered sequentially starting from 1
        for (let i = 0; i < report.executionPlan.length; i++) {
          expect(report.executionPlan[i].batch).toBe(i + 1);
        }

        // Tasks in the execution plan should only be non-deduplicated and non-cached
        const executedTaskIds = report.executionPlan.flatMap((b: any) => b.taskIds);
        for (const taskId of executedTaskIds) {
          const analysis = report.perTaskAnalysis.find((a: any) => a.taskId === taskId);
          expect(analysis.deduplicated).toBe(false);
          expect(analysis.cached).toBe(false);
        }
      }),
      { numRuns: 25 },
    );
  });

  it("deduplicatedCount correctly identifies duplicate tasks", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifestWithDuplicates, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        // All tasks share the same prompt → all but the first should be deduplicated
        expect(report.deduplicatedCount).toBe(manifest.tasks.length - 1);
        expect(report.tasksAfterDedup).toBe(1);

        // First task should NOT be marked as deduplicated
        const firstAnalysis = report.perTaskAnalysis.find(
          (a: any) => a.taskId === manifest.tasks[0].taskId,
        );
        expect(firstAnalysis.deduplicated).toBe(false);

        // All subsequent tasks SHOULD be marked as deduplicated
        for (let i = 1; i < manifest.tasks.length; i++) {
          const analysis = report.perTaskAnalysis.find(
            (a: any) => a.taskId === manifest.tasks[i].taskId,
          );
          expect(analysis.deduplicated).toBe(true);
        }
      }),
      { numRuns: 15 },
    );
  });

  it("cache hit/miss indicators are present for every task", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        // Every task should have a cached field (true or false)
        for (const analysis of report.perTaskAnalysis) {
          expect(typeof analysis.cached).toBe("boolean");
        }
      }),
      { numRuns: 25 },
    );
  });

  it("reports estimationAvailable=false and null wallclock when no telemetry in cache", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        // Use a fresh in-memory cache (no telemetry data)
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        // With no cache telemetry, estimation should be unavailable
        expect(report.estimationAvailable).toBe(false);
        expect(report.estimatedWallClockMs).toBeNull();
      }),
      { numRuns: 15 },
    );
  });

  it("estimation fields have correct types regardless of availability", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        // Fields always present in report
        expect("estimationAvailable" in report).toBe(true);
        expect("estimatedWallClockMs" in report).toBe(true);
        expect(typeof report.estimationAvailable).toBe("boolean");

        if (report.estimationAvailable) {
          expect(typeof report.estimatedWallClockMs).toBe("number");
          expect(report.estimatedWallClockMs).toBeGreaterThan(0);
        } else {
          expect(report.estimatedWallClockMs).toBeNull();
        }
      }),
      { numRuns: 15 },
    );
  });

  it("totalEstimatedTokens equals sum of all per-task estimated tokens", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        // Compute expected total from per-task values
        const sumFromPerTask = report.perTaskAnalysis.reduce(
          (sum: number, a: any) => sum + a.estimatedTokens,
          0,
        );

        // Total should approximately match (rounding may differ slightly)
        // The implementation rounds totalEstimatedTokens from un-rounded per-task floats
        // so we allow a small difference due to cumulative rounding
        expect(Math.abs(report.totalEstimatedTokens - sumFromPerTask)).toBeLessThanOrEqual(
          manifest.tasks.length,
        );
      }),
      { numRuns: 25 },
    );
  });

  it("report contains all required structural fields", async () => {
    await fc.assert(
      fc.asyncProperty(arbManifest, async (manifest) => {
        const config = makeConfig();
        const response = await handleDryRunDispatch(manifest, config);
        const report = parseReport(response);

        // Structural completeness: all top-level fields present
        expect("taskCount" in report).toBe(true);
        expect("deduplicatedCount" in report).toBe(true);
        expect("tasksAfterDedup" in report).toBe(true);
        expect("perTaskAnalysis" in report).toBe(true);
        expect("totalEstimatedTokens" in report).toBe(true);
        expect("executionPlan" in report).toBe(true);
        expect("estimatedWallClockMs" in report).toBe(true);
        expect("estimationAvailable" in report).toBe(true);

        // Per-task analysis structural completeness
        for (const analysis of report.perTaskAnalysis) {
          expect("taskId" in analysis).toBe(true);
          expect("estimatedTokens" in analysis).toBe(true);
          expect("exceedsBudget" in analysis).toBe(true);
          expect("cached" in analysis).toBe(true);
          expect("deduplicated" in analysis).toBe(true);
          expect("wouldChunk" in analysis).toBe(true);
        }

        // Execution plan entry structure
        for (const batch of report.executionPlan) {
          expect("batch" in batch).toBe(true);
          expect("taskIds" in batch).toBe(true);
          expect(typeof batch.batch).toBe("number");
          expect(Array.isArray(batch.taskIds)).toBe(true);
        }
      }),
      { numRuns: 15 },
    );
  });
});
