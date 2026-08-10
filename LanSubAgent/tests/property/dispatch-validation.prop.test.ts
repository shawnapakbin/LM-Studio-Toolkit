/**
 * Property-based tests for dispatch manifest validation (Property 12).
 *
 * Property 12: TaskManifest schema compatibility.
 * - Generate valid TaskManifest objects that pass the existing dispatch_sub_tasks schema.
 * - Assert: same objects pass dispatch_lan_tasks schema validation without modification.
 * - Verified by dispatching through LanDispatcher — a valid manifest yields a non-empty
 *   dispatchId (validation passed), while an invalid manifest yields dispatchId === "".
 *
 * Validates: Requirements 5.1
 *
 * @tag Feature: lan-sub-agent, Property 12: TaskManifest schema compatibility
 */

import { jest } from "@jest/globals";
import * as fc from "fast-check";
import { EndpointRegistry } from "../../src/endpoint-registry";
import { InMemoryDedupCache, LanDispatcher } from "../../src/lan-dispatcher";
import { LoadBalancer, LoadBalancerConfig } from "../../src/load-balancer";
import type { TaskManifest } from "../../src/types";

// ─── Mock Dependencies ───────────────────────────────────────────────────────

// Set environment variables for self-exclusion before importing registry
process.env.SUBAGENT_LOCAL_HOST = "10.0.0.1";
process.env.SUBAGENT_LOCAL_PORT = "9999";

/** Silent logger to suppress output during tests */
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Mock HealthChecker — no-ops for the test */
const mockHealthChecker = {
  start: () => {},
  stop: () => {},
  probeEndpoint: async () => true,
  runCycle: async () => {},
};

/** Mock LanTelemetryTracker */
const mockTelemetry = {
  recordLanTask: () => {},
  recordLanFailure: () => {},
};

/** Mock CheckpointStore that does nothing */
const mockCheckpointStore = {
  save: () => {},
  load: () => [],
  clear: () => {},
};

/**
 * Creates a LanDispatcher with an empty registry (no endpoints).
 * Validation will pass for valid manifests (dispatchId !== ""),
 * but task execution will fail since no endpoints exist.
 */
function createTestDispatcher(): LanDispatcher {
  const registry = new EndpointRegistry([]);
  const loadBalancer = new LoadBalancer(
    registry,
    {
      strategy: "round-robin",
      retryLimit: 0,
      localHost: "10.0.0.1",
      localPort: 9999,
    },
    silentLogger as any,
  );

  return new LanDispatcher({
    registry,
    loadBalancer,
    healthChecker: mockHealthChecker as any,
    telemetry: mockTelemetry as any,
    logger: silentLogger as any,
    dedupCache: new InMemoryDedupCache(),
    checkpointStore: mockCheckpointStore as any,
  });
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Arbitrary for a non-empty string (trimmed) suitable for taskId / prompt */
const nonEmptyStringArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/** Arbitrary for a valid TaskDefinition */
const taskDefinitionArb = fc.record({
  taskId: nonEmptyStringArb,
  prompt: nonEmptyStringArb,
  systemPrompt: fc.option(nonEmptyStringArb, { nil: undefined }),
  allowedTools: fc.option(
    fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 5 }),
    { nil: undefined },
  ),
});

/** Arbitrary for a valid TaskManifest (matching the dispatch_sub_tasks schema) */
const validTaskManifestArb: fc.Arbitrary<TaskManifest> = fc.record({
  tasks: fc.array(taskDefinitionArb, { minLength: 1, maxLength: 10 }),
  systemPrompt: fc.option(nonEmptyStringArb, { nil: undefined }),
  synthesisPrompt: fc.option(nonEmptyStringArb, { nil: undefined }),
  mergePrompt: fc.option(nonEmptyStringArb, { nil: undefined }),
  temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
  maxTokens: fc.option(fc.integer({ min: 1, max: 128000 }), { nil: undefined }),
  modelContextSize: fc.option(fc.integer({ min: 1, max: 2000000 }), { nil: undefined }),
  concurrency: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
  maxRetries: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
  skipCache: fc.option(fc.boolean(), { nil: undefined }),
  cacheMaxAge: fc.option(fc.integer({ min: 0, max: 86400000 }), { nil: undefined }),
  autoChunk: fc.option(fc.boolean(), { nil: undefined }),
  keepCheckpoints: fc.option(fc.boolean(), { nil: undefined }),
  taskTimeout: fc.option(fc.integer({ min: 1000, max: 600000 }), { nil: undefined }),
  dispatchTimeout: fc.option(fc.integer({ min: 1000, max: 3600000 }), { nil: undefined }),
});

// ─── Property 12 Tests ───────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 12: TaskManifest schema compatibility", () => {
  let dispatcher: LanDispatcher;

  beforeAll(() => {
    dispatcher = createTestDispatcher();
  });

  /**
   * **Validates: Requirements 5.1**
   *
   * For any valid TaskManifest that passes the dispatch_sub_tasks schema,
   * the same object SHALL pass dispatch_lan_tasks validation (non-empty dispatchId).
   */
  it("any valid TaskManifest passes LAN dispatch validation (dispatchId is non-empty)", async () => {
    await fc.assert(
      fc.asyncProperty(validTaskManifestArb, async (manifest) => {
        const result = await dispatcher.dispatch(manifest);

        // A non-empty dispatchId means validation passed.
        // The dispatch will fail (no endpoints) but that's expected —
        // what matters is that the manifest was accepted.
        expect(result.dispatchId).not.toBe("");
      }),
      { numRuns: 100 },
    );
  });

  it("valid manifests with only required task fields pass validation", async () => {
    const minimalManifestArb = fc.record({
      tasks: fc.array(
        fc.record({
          taskId: nonEmptyStringArb,
          prompt: nonEmptyStringArb,
        }),
        { minLength: 1, maxLength: 5 },
      ),
    }) as fc.Arbitrary<TaskManifest>;

    await fc.assert(
      fc.asyncProperty(minimalManifestArb, async (manifest) => {
        const result = await dispatcher.dispatch(manifest);
        expect(result.dispatchId).not.toBe("");
      }),
      { numRuns: 100 },
    );
  });

  it("valid manifests with all optional fields populated pass validation", async () => {
    const fullManifestArb = fc.record({
      tasks: fc.array(
        fc.record({
          taskId: nonEmptyStringArb,
          prompt: nonEmptyStringArb,
          systemPrompt: nonEmptyStringArb,
          allowedTools: fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
            minLength: 1,
            maxLength: 5,
          }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
      systemPrompt: nonEmptyStringArb,
      synthesisPrompt: nonEmptyStringArb,
      mergePrompt: nonEmptyStringArb,
      temperature: fc.double({ min: 0, max: 2, noNaN: true }),
      maxTokens: fc.integer({ min: 1, max: 128000 }),
      modelContextSize: fc.integer({ min: 1, max: 2000000 }),
      concurrency: fc.integer({ min: 1, max: 100 }),
      maxRetries: fc.integer({ min: 0, max: 10 }),
      skipCache: fc.boolean(),
      cacheMaxAge: fc.integer({ min: 0, max: 86400000 }),
      autoChunk: fc.boolean(),
      keepCheckpoints: fc.boolean(),
      taskTimeout: fc.integer({ min: 1000, max: 600000 }),
      dispatchTimeout: fc.integer({ min: 1000, max: 3600000 }),
    }) as fc.Arbitrary<TaskManifest>;

    await fc.assert(
      fc.asyncProperty(fullManifestArb, async (manifest) => {
        const result = await dispatcher.dispatch(manifest);
        expect(result.dispatchId).not.toBe("");
      }),
      { numRuns: 100 },
    );
  });

  it("dispatch returns a UUID-format dispatchId for valid manifests", async () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    await fc.assert(
      fc.asyncProperty(validTaskManifestArb, async (manifest) => {
        const result = await dispatcher.dispatch(manifest);
        expect(result.dispatchId).toMatch(uuidRegex);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 13: Invalid TaskManifest rejection without dispatch ────────────

/**
 * Property 13: Invalid TaskManifest rejection without dispatch
 * - Generate invalid manifests (missing tasks, empty array, wrong types)
 * - Assert: error returned, no LoadBalancer invocation, no HTTP requests
 *
 * @tag Feature: lan-sub-agent, Property 13: Invalid TaskManifest rejection without dispatch
 *
 * **Validates: Requirements 5.8**
 */

// ─── Property 13 Helpers ─────────────────────────────────────────────────────

/** Create a LanDispatcher with spied LoadBalancer to verify no selection occurs */
function createP13DispatcherWithSpies() {
  const registry = new EndpointRegistry([]);
  const lbConfig: LoadBalancerConfig = {
    strategy: "round-robin",
    retryLimit: 2,
    localHost: "10.0.0.1",
    localPort: 9999,
  };
  const loadBalancer = new LoadBalancer(registry, lbConfig, silentLogger as any);
  const selectEndpointSpy = jest.spyOn(loadBalancer, "selectEndpoint");
  const getCandidatesSpy = jest.spyOn(loadBalancer, "getCandidates");

  const mockTelemetryP13 = {
    recordLanTask: jest.fn(),
    recordLanFailure: jest.fn(),
  };

  const mockCheckpointStoreP13 = {
    save: jest.fn(),
    load: jest.fn().mockReturnValue([]),
    clear: jest.fn(),
  };

  const dispatcher = new LanDispatcher({
    registry,
    loadBalancer,
    healthChecker: mockHealthChecker as any,
    telemetry: mockTelemetryP13 as any,
    logger: silentLogger as any,
    dedupCache: new InMemoryDedupCache(),
    checkpointStore: mockCheckpointStoreP13 as any,
  });

  return { dispatcher, selectEndpointSpy, getCandidatesSpy, telemetry: mockTelemetryP13 };
}

// ─── Property 13 Arbitraries ─────────────────────────────────────────────────

/**
 * Case 1: Top-level non-object values (null, undefined, string, number, array at top level)
 */
const p13NonObjectManifestArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.array(fc.anything({ maxDepth: 1 }), { maxLength: 5 }),
);

/**
 * Case 2: Object without a `tasks` field
 */
const p13MissingTasksFieldArb: fc.Arbitrary<unknown> = fc
  .record({
    systemPrompt: fc.option(fc.string(), { nil: undefined }),
    concurrency: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  })
  .map((obj) => {
    // Ensure no "tasks" key exists
    const copy = { ...obj } as Record<string, unknown>;
    delete copy.tasks;
    return copy;
  });

/**
 * Case 3: `tasks` is not an array (string, number, object, null, boolean)
 */
const p13TasksNotArrayArb: fc.Arbitrary<unknown> = fc
  .oneof(
    fc.constant(null),
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.record({ nested: fc.string() }),
  )
  .map((tasksValue) => ({ tasks: tasksValue }));

/**
 * Case 4: `tasks` is an empty array
 */
const p13EmptyTasksArb: fc.Arbitrary<unknown> = fc.constant({ tasks: [] });

/**
 * Case 5: Tasks with missing/empty taskId or prompt
 */
const p13InvalidTaskItemArb: fc.Arbitrary<unknown> = fc.oneof(
  // Missing taskId entirely
  fc
    .record({ prompt: fc.string({ minLength: 1 }) })
    .map((t) => ({ tasks: [t] })),
  // Empty taskId
  fc
    .record({ taskId: fc.constant(""), prompt: fc.string({ minLength: 1 }) })
    .map((t) => ({ tasks: [t] })),
  // Whitespace-only taskId
  fc
    .record({ taskId: fc.constantFrom("  ", "\t", "\n"), prompt: fc.string({ minLength: 1 }) })
    .map((t) => ({ tasks: [t] })),
  // Missing prompt entirely
  fc
    .record({ taskId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0) })
    .map((t) => ({ tasks: [t] })),
  // Empty prompt
  fc
    .record({
      taskId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
      prompt: fc.constant(""),
    })
    .map((t) => ({ tasks: [t] })),
  // Whitespace-only prompt
  fc
    .record({
      taskId: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
      prompt: fc.constantFrom("  ", "\t", "\n"),
    })
    .map((t) => ({ tasks: [t] })),
);

/**
 * Case 6: Tasks that are not objects (null, string, number in array)
 */
const p13NonObjectTaskItemsArb: fc.Arbitrary<unknown> = fc
  .array(
    fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), fc.integer(), fc.boolean()),
    { minLength: 1, maxLength: 5 },
  )
  .map((items) => ({ tasks: items }));

/**
 * Combined arbitrary: any invalid manifest shape
 */
const p13InvalidManifestArb: fc.Arbitrary<unknown> = fc.oneof(
  p13NonObjectManifestArb,
  p13MissingTasksFieldArb,
  p13TasksNotArrayArb,
  p13EmptyTasksArb,
  p13InvalidTaskItemArb,
  p13NonObjectTaskItemsArb,
);

// ─── Property 13 Tests ──────────────────────────────────────────────────────

describe("Feature: lan-sub-agent, Property 13: Invalid TaskManifest rejection without dispatch", () => {
  /**
   * **Validates: Requirements 5.8**
   *
   * For any invalid TaskManifest (non-object, missing tasks, empty array,
   * wrong types, invalid task items), dispatch SHALL:
   * - Return dispatchId as empty string
   * - Return success as false
   * - Return an empty results array
   * - NOT invoke LoadBalancer.selectEndpoint or getCandidates
   */
  it("rejects invalid manifests with empty dispatchId, success=false, no results, and no LB invocation", async () => {
    await fc.assert(
      fc.asyncProperty(p13InvalidManifestArb, async (invalidManifest) => {
        const { dispatcher, selectEndpointSpy, getCandidatesSpy, telemetry } =
          createP13DispatcherWithSpies();

        const result = await dispatcher.dispatch(invalidManifest as any);

        // Validation failure returns empty dispatchId
        expect(result.dispatchId).toBe("");

        // Validation failure returns success=false
        expect(result.success).toBe(false);

        // No results produced
        expect(result.results).toHaveLength(0);

        // LoadBalancer never invoked (validation fails before endpoint selection)
        expect(selectEndpointSpy).not.toHaveBeenCalled();
        expect(getCandidatesSpy).not.toHaveBeenCalled();

        // No telemetry recorded (no actual task execution)
        expect(telemetry.recordLanTask).not.toHaveBeenCalled();
        expect(telemetry.recordLanFailure).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * Specifically for non-object top-level values (null, string, number, array),
   * the manifest is rejected immediately.
   */
  it("rejects non-object top-level manifests without any dispatch activity", async () => {
    await fc.assert(
      fc.asyncProperty(p13NonObjectManifestArb, async (invalidManifest) => {
        const { dispatcher, selectEndpointSpy, getCandidatesSpy } = createP13DispatcherWithSpies();

        const result = await dispatcher.dispatch(invalidManifest as any);

        expect(result.dispatchId).toBe("");
        expect(result.success).toBe(false);
        expect(result.results).toHaveLength(0);
        expect(selectEndpointSpy).not.toHaveBeenCalled();
        expect(getCandidatesSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * Specifically for manifests with tasks field of wrong type or empty array,
   * the manifest is rejected before any dispatch logic executes.
   */
  it("rejects manifests with invalid or empty tasks field without dispatch", async () => {
    const invalidTasksFieldArb = fc.oneof(p13TasksNotArrayArb, p13EmptyTasksArb);

    await fc.assert(
      fc.asyncProperty(invalidTasksFieldArb, async (invalidManifest) => {
        const { dispatcher, selectEndpointSpy, getCandidatesSpy } = createP13DispatcherWithSpies();

        const result = await dispatcher.dispatch(invalidManifest as any);

        expect(result.dispatchId).toBe("");
        expect(result.success).toBe(false);
        expect(result.results).toHaveLength(0);
        expect(selectEndpointSpy).not.toHaveBeenCalled();
        expect(getCandidatesSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 5.8**
   *
   * Specifically for manifests containing non-object items or items with
   * missing/empty taskId or prompt, the manifest is rejected.
   */
  it("rejects manifests with invalid task items (non-objects or missing/empty fields)", async () => {
    const badTaskItemsArb = fc.oneof(p13InvalidTaskItemArb, p13NonObjectTaskItemsArb);

    await fc.assert(
      fc.asyncProperty(badTaskItemsArb, async (invalidManifest) => {
        const { dispatcher, selectEndpointSpy, getCandidatesSpy } = createP13DispatcherWithSpies();

        const result = await dispatcher.dispatch(invalidManifest as any);

        expect(result.dispatchId).toBe("");
        expect(result.success).toBe(false);
        expect(result.results).toHaveLength(0);
        expect(selectEndpointSpy).not.toHaveBeenCalled();
        expect(getCandidatesSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
