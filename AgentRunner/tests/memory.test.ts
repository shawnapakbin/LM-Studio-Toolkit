/**
 * LLM Toolkit
 * Copyright 2026 Shawna Pakbin
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file in the project root for full license text.
 */

/**
 * Memory Store Tests
 */

import fs from "fs";
import path from "path";
import { ErrorCode } from "@shared/types";
import { MemoryStore } from "../src/memory";
import { ExecutionMode, type Workflow, type WorkflowResult } from "../src/runner";

type RunHistoryRow = {
  workflow_id: string;
  success: number;
};

type RunStepRow = {
  step_id: string;
  tool_id: string;
};

describe("MemoryStore", () => {
  let memory: MemoryStore;
  const testDbPath = path.join(__dirname, "test-memory.db");

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    memory = new MemoryStore(testDbPath);
  });

  afterEach(() => {
    memory.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe("Run Storage", () => {
    test("stores and retrieves workflow run", () => {
      const workflow: Workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          {
            id: "step1",
            toolId: "calculator",
            endpoint: "/tools/calculate",
            input: { expression: "2 + 2" },
          },
        ],
      };

      const result: WorkflowResult = {
        workflowId: "test-workflow",
        success: true,
        steps: [
          {
            stepId: "step1",
            toolId: "calculator",
            success: true,
            data: { data: { result: 4 } },
            durationMs: 100,
            retries: 0,
            traceId: "test-trace-1",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        durationMs: 150,
        traceId: "test-workflow-trace",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const runId = memory.storeRun(workflow, result);
      expect(runId).toBeGreaterThan(0);

      const history = memory.getRunHistory("test-workflow", 10) as unknown as RunHistoryRow[];
      expect(history).toHaveLength(1);
      expect(history[0].workflow_id).toBe("test-workflow");
      expect(history[0].success).toBe(1);
    });

    test("stores run with metadata", () => {
      const workflow: Workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        mode: ExecutionMode.SEQUENTIAL,
        steps: [],
      };

      const result: WorkflowResult = {
        workflowId: "test-workflow",
        success: true,
        steps: [],
        durationMs: 50,
        traceId: "test-trace",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const metadata = { userId: "user123", tags: ["test", "example"] };
      memory.storeRun(workflow, result, metadata);

      const history = memory.getRunHistory("test-workflow", 1);
      expect(history[0].metadata).toBeDefined();
      const storedMetadata = JSON.parse(history[0].metadata!);
      expect(storedMetadata.userId).toBe("user123");
      expect(storedMetadata.tags).toEqual(["test", "example"]);
    });

    test("retrieves step details", () => {
      const workflow: Workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          {
            id: "step1",
            toolId: "calculator",
            endpoint: "/tools/calculate",
            input: { expression: "10 * 5" },
          },
          {
            id: "step2",
            toolId: "clock",
            endpoint: "/tools/get_time",
            input: {},
          },
        ],
      };

      const result: WorkflowResult = {
        workflowId: "test-workflow",
        success: true,
        steps: [
          {
            stepId: "step1",
            toolId: "calculator",
            success: true,
            data: { data: { result: 50 } },
            durationMs: 50,
            retries: 0,
            traceId: "trace-1",
            startedAt: new Date(),
            completedAt: new Date(),
          },
          {
            stepId: "step2",
            toolId: "clock",
            success: true,
            data: { data: { time: "12:00:00" } },
            durationMs: 30,
            retries: 0,
            traceId: "trace-2",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        durationMs: 100,
        traceId: "workflow-trace",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const runId = memory.storeRun(workflow, result);
      const steps = memory.getRunSteps(runId) as unknown as RunStepRow[];

      expect(steps).toHaveLength(2);
      expect(steps[0].step_id).toBe("step1");
      expect(steps[0].tool_id).toBe("calculator");
      expect(steps[1].step_id).toBe("step2");
      expect(steps[1].tool_id).toBe("clock");
    });
  });

  describe("Success Patterns", () => {
    test("tracks successful patterns", () => {
      const workflow: Workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          { id: "step1", toolId: "clock", endpoint: "/time", input: {} },
          { id: "step2", toolId: "calculator", endpoint: "/calc", input: {} },
        ],
      };

      const result: WorkflowResult = {
        workflowId: "test-workflow",
        success: true,
        steps: [
          {
            stepId: "step1",
            toolId: "clock",
            success: true,
            durationMs: 10,
            retries: 0,
            traceId: "t1",
            startedAt: new Date(),
            completedAt: new Date(),
          },
          {
            stepId: "step2",
            toolId: "calculator",
            success: true,
            durationMs: 20,
            retries: 0,
            traceId: "t2",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        durationMs: 50,
        traceId: "wf-trace",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      // Store same pattern multiple times
      memory.storeRun(workflow, result);
      memory.storeRun(workflow, result);
      memory.storeRun(workflow, result);

      const patterns = memory.getSuccessfulPatterns("test-workflow", 10);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].tool_sequence).toBe("clock,calculator");
      expect(patterns[0].success_count).toBe(3);
    });

    test("tracks different patterns separately", () => {
      const workflow1: Workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          { id: "step1", toolId: "clock", endpoint: "/time", input: {} },
          { id: "step2", toolId: "calculator", endpoint: "/calc", input: {} },
        ],
      };

      const workflow2: Workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        mode: ExecutionMode.SEQUENTIAL,
        steps: [
          { id: "step1", toolId: "calculator", endpoint: "/calc", input: {} },
          { id: "step2", toolId: "clock", endpoint: "/time", input: {} },
        ],
      };

      const result1: WorkflowResult = {
        workflowId: "test-workflow",
        success: true,
        steps: [
          {
            stepId: "step1",
            toolId: "clock",
            success: true,
            durationMs: 10,
            retries: 0,
            traceId: "t1",
            startedAt: new Date(),
            completedAt: new Date(),
          },
          {
            stepId: "step2",
            toolId: "calculator",
            success: true,
            durationMs: 20,
            retries: 0,
            traceId: "t2",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        durationMs: 50,
        traceId: "wf-trace-1",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const result2: WorkflowResult = {
        workflowId: "test-workflow",
        success: true,
        steps: [
          {
            stepId: "step1",
            toolId: "calculator",
            success: true,
            durationMs: 15,
            retries: 0,
            traceId: "t3",
            startedAt: new Date(),
            completedAt: new Date(),
          },
          {
            stepId: "step2",
            toolId: "clock",
            success: true,
            durationMs: 25,
            retries: 0,
            traceId: "t4",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        durationMs: 60,
        traceId: "wf-trace-2",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      memory.storeRun(workflow1, result1);
      memory.storeRun(workflow2, result2);

      const patterns = memory.getSuccessfulPatterns("test-workflow", 10);
      expect(patterns).toHaveLength(2);

      const sequences = patterns.map((p) => p.tool_sequence);
      expect(sequences).toContain("clock,calculator");
      expect(sequences).toContain("calculator,clock");
    });
  });

  describe("Session Management", () => {
    test("creates and retrieves session", () => {
      const session = memory.createSession("session-1", { user: "alice" });
      expect(session.sessionId).toBe("session-1");
      expect(session.context.user).toBe("alice");

      const retrieved = memory.getSession("session-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.sessionId).toBe("session-1");
      expect(retrieved?.context.user).toBe("alice");
    });

    test("updates session context", () => {
      memory.createSession("session-1", { count: 0 });
      memory.updateSession("session-1", { count: 5, newField: "test" });

      const session = memory.getSession("session-1");
      expect(session?.context.count).toBe(5);
      expect(session?.context.newField).toBe("test");
    });

    test("deletes session", () => {
      memory.createSession("session-1");
      memory.deleteSession("session-1");

      const session = memory.getSession("session-1");
      expect(session).toBeUndefined();
    });

    test("cleans up old sessions", () => {
      // Create sessions with different timestamps
      const oldSession = memory.createSession("old-session");
      oldSession.lastActivityAt = new Date(Date.now() - 7200000); // 2 hours ago

      memory.createSession("recent-session");

      const cleaned = memory.cleanupSessions(3600000); // 1 hour timeout
      expect(cleaned).toBe(1);

      expect(memory.getSession("old-session")).toBeUndefined();
      expect(memory.getSession("recent-session")).toBeDefined();
    });
  });

  describe("Statistics", () => {
    test("provides accurate statistics", () => {
      const workflow: Workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        mode: ExecutionMode.SEQUENTIAL,
        steps: [{ id: "step1", toolId: "calculator", endpoint: "/calc", input: {} }],
      };

      const successResult: WorkflowResult = {
        workflowId: "test-workflow",
        success: true,
        steps: [
          {
            stepId: "step1",
            toolId: "calculator",
            success: true,
            durationMs: 100,
            retries: 0,
            traceId: "t1",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        durationMs: 120,
        traceId: "wf-1",
        startedAt: new Date(),
        completedAt: new Date(),
      };

      const failResult: WorkflowResult = {
        workflowId: "test-workflow",
        success: false,
        steps: [
          {
            stepId: "step1",
            toolId: "calculator",
            success: false,
            errorCode: ErrorCode.EXECUTION_FAILED,
            errorMessage: "Failed",
            durationMs: 50,
            retries: 2,
            traceId: "t2",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        ],
        durationMs: 80,
        traceId: "wf-2",
        startedAt: new Date(),
        completedAt: new Date(),
        error: "Step failed",
      };

      memory.storeRun(workflow, successResult);
      memory.storeRun(workflow, successResult);
      memory.storeRun(workflow, failResult);

      const stats = memory.getStats();
      expect(stats.totalRuns).toBe(3);
      expect(stats.successfulRuns).toBe(2);
      expect(stats.failedRuns).toBe(1);
      expect(stats.totalSteps).toBe(3);
      expect(stats.avgDurationMs).toBeGreaterThan(0);
    });
  });
});
