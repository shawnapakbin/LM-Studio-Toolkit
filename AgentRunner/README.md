# Agent Runner

Enterprise-grade orchestration and workflow execution for LLM Toolkit.


## Features

- **Tool Call Normalization**: All tool calls dispatched by the runner are normalized to a canonical schema before execution, ensuring compatibility with legacy and new formats and reducing integration errors.
- **Tool Registry**: Central registry of all available tools with health checking
- **Workflow Execution**: Sequential and parallel execution modes with dependency management
- **Retry & Fallback**: Configurable retry policies with exponential backoff
- **Memory Store**: SQLite-based persistent storage for run history and patterns
- **Session Context**: Short-lived memory for single-session workflows
- **Observable**: Full tracing with trace IDs and timing metrics

## Quick Start

```typescript
import { createAgentRunner, ExecutionMode } from "@llm-toolkit/agent-runner";

// Create agent runner with default configuration
const { registry, runner, memory } = createAgentRunner({
  autoRegisterTools: true,
  startHealthMonitor: true,
  healthCheckIntervalMs: 60000, // Check every minute
});

// Define a workflow
const workflow = {
  id: "example-workflow",
  name: "Example Multi-Step Workflow",
  mode: ExecutionMode.SEQUENTIAL,
  steps: [
    {
      id: "step1",
      toolId: "clock",
      endpoint: "/tools/get_current_datetime",
      input: { timeZone: "UTC" },
      timeoutMs: 5000,
    },
    {
      id: "step2",
      toolId: "calculator",
      endpoint: "/tools/calculate_engineering",
      input: { expression: "2 + 2" },
      retryPolicy: {
        maxRetries: 3,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
      },
    },
  ],
};

// Execute workflow
const result = await runner.executeWorkflow(workflow);

// Store result in memory
memory.storeRun(workflow, result);

console.log(`Workflow ${result.success ? "succeeded" : "failed"}`);
console.log(`Duration: ${result.durationMs}ms`);
console.log(`Trace ID: ${result.traceId}`);
```

## Tool Registry

### Register Custom Tools

```typescript
import { ToolRegistry, ToolCapability, ToolStatus } from "@llm-toolkit/agent-runner";

const registry = new ToolRegistry();

registry.register({
  id: "my-custom-tool",
  name: "My Custom Tool",
  description: "Does something useful",
  version: "1.0.0",
  capabilities: [ToolCapability.COMPUTE],
  httpEndpoint: "http://localhost:3000",
  healthEndpoint: "http://localhost:3000/health",
  schemaEndpoint: "http://localhost:3000/tool-schema",
  status: ToolStatus.UNKNOWN,
});
```

### Health Checking

```typescript
// Check all tools
const healthStatus = await registry.checkAllToolsHealth();
console.log(healthStatus); // Map<toolId, ToolStatus>

// Get only healthy tools
const healthyTools = registry.getHealthyTools();

// Start periodic health monitoring
registry.startHealthCheckMonitor(60000); // Check every 60s

// Stop monitoring
registry.stopHealthCheckMonitor();
```


## Workflow Execution

### Tool Call Normalization
Before dispatching any tool call, the runner normalizes the input to a canonical format using the shared normalization utility (`shared/toolCallNormalizer.ts`). This guarantees that all tool invocations—regardless of their source—are schema-consistent and robust to legacy/variant formats.

### Clarification-First Planning (AskUser)

Use AskUser before executing ambiguous requests.

```typescript
const prompt = "fix this asap";
const ambiguity = runner.analyzePromptAmbiguity(prompt);

if (ambiguity.ambiguous) {
  const clarificationWorkflow = runner.buildClarificationWorkflow(prompt, {
    taskRunId: "task-123",
    expiresInSeconds: 1800,
  });

  await runner.executeWorkflow(clarificationWorkflow);
}
```

`buildClarificationWorkflow()` generates a one-step workflow that calls AskUser:
- tool: `ask-user`
- endpoint: `/tools/ask_user_interview`
- action: `create`
- question set: goal, scope, constraints, timeline, approval

### Sequential Execution

Steps execute one after another. Dependencies are checked before each step.

```typescript
const workflow = {
  id: "sequential-workflow",
  name: "Sequential Workflow",
  mode: ExecutionMode.SEQUENTIAL,
  steps: [
    { id: "step1", toolId: "clock", endpoint: "/tools/get_current_datetime", input: {} },
    { 
      id: "step2", 
      toolId: "calculator", 
      endpoint: "/tools/calculate_engineering",
      input: { expression: "10 * 2" },
      dependsOn: ["step1"], // Only runs after step1 completes
    },
  ],
};
```

### Parallel Execution

All steps execute concurrently.

```typescript
const workflow = {
  id: "parallel-workflow",
  name: "Parallel Workflow",
  mode: ExecutionMode.PARALLEL,
  steps: [
    { id: "step1", toolId: "clock", endpoint: "/tools/get_current_datetime", input: {} },
    { id: "step2", toolId: "calculator", endpoint: "/tools/calculate_engineering", input: { expression: "5 * 5" } },
    { id: "step3", toolId: "webbrowser", endpoint: "/tools/browse_web", input: { url: "https://example.com" } },
  ],
};
```

### Retry Policies

Configure retry behavior per-step or use defaults.

```typescript
const step = {
  id: "step1",
  toolId: "calculator",
  endpoint: "/tools/calculate_engineering",
  input: { expression: "sqrt(144)" },
  retryPolicy: {
    maxRetries: 5,
    retryDelayMs: 1000,
    backoffMultiplier: 2, // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  },
};
```

## Memory Store

### Store and Retrieve Runs

```typescript
// Store workflow result
const runId = memory.storeRun(workflow, result, { userId: "user123" });

// Get run history
const history = memory.getRunHistory("workflow-id", 50);

// Get successful runs only
const successfulRuns = memory.getSuccessfulRuns("workflow-id", 20);

// Get steps for a run
const steps = memory.getRunSteps(runId);
```

### Pattern Recognition

The memory store automatically tracks successful tool sequences.

```typescript
// Get most successful patterns for a workflow
const patterns = memory.getSuccessfulPatterns("workflow-id", 10);

patterns.forEach(pattern => {
  console.log(`Pattern: ${pattern.tool_sequence}`);
  console.log(`Success count: ${pattern.success_count}`);
  console.log(`Last used: ${pattern.last_used_at}`);
});
```

### Session Context

Short-lived memory for single sessions.

```typescript
// Create session
const session = memory.createSession("session-123", { user: "alice" });

// Update session
memory.updateSession("session-123", { lastCommand: "calculate 2+2" });

// Get session
const currentSession = memory.getSession("session-123");

// Clean up old sessions (older than 1 hour)
memory.cleanupSessions(3600000);
```

## Statistics

```typescript
// Registry stats
const registryStats = registry.getStats();
console.log(`Total tools: ${registryStats.totalTools}`);
console.log(`Healthy: ${registryStats.healthyTools}`);
console.log(`Unhealthy: ${registryStats.unhealthyTools}`);

// Memory stats
const memoryStats = memory.getStats();
console.log(`Total runs: ${memoryStats.totalRuns}`);
console.log(`Success rate: ${(memoryStats.successfulRuns / memoryStats.totalRuns * 100).toFixed(2)}%`);
console.log(`Average duration: ${memoryStats.avgDurationMs}ms`);
```

## Error Handling

All workflow results include comprehensive error information:

```typescript
const result = await runner.executeWorkflow(workflow);

if (!result.success) {
  console.error(`Workflow failed: ${result.error}`);
  
  // Check individual step failures
  result.steps.forEach(step => {
    if (!step.success) {
      console.error(`Step ${step.stepId} failed:`);
      console.error(`  Error Code: ${step.errorCode}`);
      console.error(`  Error Message: ${step.errorMessage}`);
      console.error(`  Retries: ${step.retries}`);
    }
  });
}
```

## Cancellation

Cancel running workflows by ID:

```typescript
// Start a workflow
const resultPromise = runner.executeWorkflow(longRunningWorkflow);

// Cancel it
const cancelled = runner.cancelWorkflow(longRunningWorkflow.id);

if (cancelled) {
  console.log("Workflow cancelled");
}

// Get list of running workflows
const running = runner.getRunningWorkflows();
console.log(`Running workflows: ${running.join(", ")}`);
```

## Environment Variables

- `BASE_PORT`: Base port number for tool endpoints (default: 3330)
- `AGENT_MEMORY_DB`: Path to SQLite database (default: `./data/agent-memory.db`)

## Architecture

```
┌─────────────────┐
│  Agent Runner   │
├─────────────────┤
│                 │
│  ┌───────────┐  │
│  │ Registry  │  │  ← Tool discovery & health checking
│  └───────────┘  │
│                 │
│  ┌───────────┐  │
│  │  Runner   │  │  ← Workflow orchestration & retry logic
│  └───────────┘  │
│                 │
│  ┌───────────┐  │
│  │  Memory   │  │  ← Persistent storage & pattern recognition
│  └───────────┘  │
│                 │
└─────────────────┘
        │
        ├───────► Terminal (3333)
        ├───────► WebBrowser (3334)
        ├───────► Calculator (3335)
        ├───────► DocumentScraper (3336)
        ├───────► Clock (3337)
        ├───────► AskUser (3338)
        ├───────► RAG (3339)
        ├───────► Skills (3341)
        ├───────► ECM (3342)
        └───────► Browserless (3003)
```

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin
