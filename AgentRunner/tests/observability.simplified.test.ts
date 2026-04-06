import { type LogEntry, Logger, setLogger } from "llm-toolkit-observability";
import { MetricsRegistry, setRegistry } from "llm-toolkit-observability";
import { Tracer, setTracer } from "llm-toolkit-observability";
import { type ToolMetadata, ToolRegistry, ToolStatus } from "../src/registry";
import { AgentRunner, ExecutionMode } from "../src/runner";

/**
 * Observability Integration Tests
 *
 * Validates that observability (metrics, logs, traces) are properly recorded
 * during workflow execution.
 */
describe("ObservabilityIntegration", () => {
  let registry: ToolRegistry;
  let runner: AgentRunner;
  let logger: Logger;
  let metricsRegistry: MetricsRegistry;
  let tracer: Tracer;

  beforeEach(() => {
    logger = new Logger();
    metricsRegistry = new MetricsRegistry();
    tracer = new Tracer();

    setLogger(logger);
    setRegistry(metricsRegistry);
    setTracer(tracer);

    registry = new ToolRegistry();
    runner = new AgentRunner(registry, logger, metricsRegistry, tracer);

    const tool1: ToolMetadata = {
      id: "tool1",
      name: "Test Tool 1",
      description: "Tool 1",
      version: "1.0.0",
      capabilities: [],
      httpEndpoint: "http://localhost:3001",
      healthEndpoint: "http://localhost:3001/health",
      schemaEndpoint: "http://localhost:3001/schema",
      status: ToolStatus.HEALTHY,
    };

    const tool2: ToolMetadata = {
      id: "tool2",
      name: "Test Tool 2",
      description: "Tool 2",
      version: "1.0.0",
      capabilities: [],
      httpEndpoint: "http://localhost:3002",
      healthEndpoint: "http://localhost:3002/health",
      schemaEndpoint: "http://localhost:3002/schema",
      status: ToolStatus.HEALTHY,
    };

    registry.register(tool1);
    registry.register(tool2);
  });

  it("records workflow execution metrics on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, success: true, data: { result: "test" } }),
    });

    const workflow = {
      id: "test-workflow-1",
      name: "Test Workflow",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "step1",
          toolId: "tool1",
          endpoint: "http://localhost:3001/test",
          input: {},
          retries: 1,
        },
      ],
      timeoutMs: 5000,
    };

    await runner.executeWorkflow(workflow);

    const metricsJSON = metricsRegistry.exportJSON();
    const execCounter = metricsJSON["workflow_executions_total"] as
      | { labeled?: Array<{ labels: Record<string, string> }> }
      | undefined;

    expect(execCounter).toBeDefined();
    expect(execCounter?.labeled).toContainEqual(
      expect.objectContaining({
        labels: { workflowId: "test-workflow-1", status: "success" },
      }),
    );
  });

  it("records workflow duration histogram", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, success: true }),
    });

    const workflow = {
      id: "test-workflow-2",
      name: "Duration Test",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "step1",
          toolId: "tool1",
          endpoint: "http://localhost:3001/test",
          input: {},
          retries: 1,
        },
      ],
      timeoutMs: 5000,
    };

    await runner.executeWorkflow(workflow);

    const metricsJSON = metricsRegistry.exportJSON();
    const durationMetric = metricsJSON["workflow_duration_ms"] as { type?: string } | undefined;
    expect(durationMetric).toBeDefined();
    expect(durationMetric?.type).toBe("histogram");
  });

  it("creates workflow trace with step spans", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, success: true }),
    });

    const workflow = {
      id: "trace-test",
      name: "Trace Workflow",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "step1",
          toolId: "tool1",
          endpoint: "http://localhost:3001/test",
          input: {},
          retries: 1,
        },
      ],
      timeoutMs: 5000,
    };

    await runner.executeWorkflow(workflow);

    const traces = tracer.getAllTraces();
    const workflowTrace = traces.find((t) => t.workflowName === "Trace Workflow");

    expect(workflowTrace).toBeDefined();
    expect(workflowTrace?.spans.length).toBeGreaterThan(0);

    const stepSpans = workflowTrace?.spans.filter((s) => s.name.startsWith("step-"));
    expect(stepSpans?.length).toBeGreaterThan(0);
  });

  it("records step execution metrics with labels", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, success: true }),
    });

    const workflow = {
      id: "step-metrics-test",
      name: "Step Metrics",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "step1",
          toolId: "tool1",
          endpoint: "http://localhost:3001/test",
          input: {},
          retries: 1,
        },
        {
          id: "step2",
          toolId: "tool2",
          endpoint: "http://localhost:3002/test",
          input: {},
          retries: 1,
        },
      ],
      timeoutMs: 5000,
    };

    await runner.executeWorkflow(workflow);

    const metricsJSON = metricsRegistry.exportJSON();
    const stepCounter = metricsJSON["workflow_step_executions_total"] as
      | { labeled?: Array<{ labels: Record<string, string> }> }
      | undefined;

    expect(stepCounter?.labeled).toContainEqual(
      expect.objectContaining({
        labels: { toolId: "tool1", status: "success" },
      }),
    );
    expect(stepCounter?.labeled).toContainEqual(
      expect.objectContaining({
        labels: { toolId: "tool2", status: "success" },
      }),
    );
  });

  it("logs workflow execution with trace correlation", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, success: true }),
    });

    const logs: LogEntry[] = [];
    logger.addTransport({
      write: (entry: LogEntry) => logs.push(entry),
    });

    const workflow = {
      id: "log-test",
      name: "Log Test",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "step1",
          toolId: "tool1",
          endpoint: "http://localhost:3001/test",
          input: {},
          retries: 1,
        },
      ],
      timeoutMs: 5000,
    };

    await runner.executeWorkflow(workflow);

    const workflowLogs = logs.filter((l) => l.message.includes("log-test"));
    expect(workflowLogs.length).toBeGreaterThan(0);

    // All logs should have trace ID
    workflowLogs.forEach((log) => {
      expect(log.traceId).toBeDefined();
    });
  });

  it("handles failed workflow metrics", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("Tool error"));

    const workflow = {
      id: "failure-test",
      name: "Failure Test",
      mode: ExecutionMode.SEQUENTIAL,
      steps: [
        {
          id: "step1",
          toolId: "tool1",
          endpoint: "http://localhost:3001/test",
          input: {},
          retries: 0,
        },
      ],
      timeoutMs: 5000,
    };

    await runner.executeWorkflow(workflow);

    const metricsJSON = metricsRegistry.exportJSON();
    const execCounter = metricsJSON["workflow_executions_total"] as
      | { labeled?: Array<{ labels: Record<string, string> }> }
      | undefined;

    expect(execCounter?.labeled).toContainEqual(
      expect.objectContaining({
        labels: { workflowId: "failure-test", status: "error" },
      }),
    );
  });
});
