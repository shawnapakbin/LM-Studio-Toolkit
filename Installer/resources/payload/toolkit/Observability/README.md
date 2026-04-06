# Observability Module

Comprehensive observability for LLM Toolkit with structured logging, Prometheus metrics, and distributed tracing.

## Features

- **Structured Logging**: Multi-level logger with trace correlation  
- **Prometheus Metrics**: Counter, Histogram, and Gauge with label support
- **Distributed Tracing**: Span-based execution timeline with parent-child relationships
- **Multiple Transports**: Console, JSON, and File output for logs
- **Export Formats**: JSON and Prometheus text format for metrics
- **Timeline Export**: Visual workflow execution traces

## Installation

```bash
npm install
npm run build
```

## Usage

### Logger

```typescript
import { Logger, ConsoleTransport, JSONTransport, FileTransport, LogLevel } from "@observability";

// Create logger with transports
const logger = new Logger();
logger.addTransport(new ConsoleTransport());
logger.addTransport(new JSONTransport());
logger.addTransport(new FileTransport("./logs/app.log"));

// Set minimum log level
logger.setLevel(LogLevel.INFO);

// Log messages
logger.debug("Debug details", { userId: "123" });
logger.info("User logged in", { username: "alice" });
logger.warn("API rate limit approaching", { remaining: 10 });
logger.error("Database connection failed", { error: "ECONNREFUSED" });

// Create child logger with context
const childLogger = logger.child("payment-service", "trace-abc-123");
childLogger.info("Processing payment", { amount: 99.99 });

// Log tool execution
logger.logToolExecution("terminal", true, 150, "trace-xyz", {
  command: "ls -la",
  exitCode: 0
});
```

### Metrics

```typescript
import { MetricsRegistry } from "@observability";

const registry = new MetricsRegistry();

// Counter - monotonically increasing
const requestCounter = registry.counter("http_requests_total", "Total HTTP requests");
requestCounter.inc(); // increment by 1
requestCounter.inc({ method: "GET", status: "200" }, 1);
requestCounter.inc({ method: "POST", status: "201" }, 1);

console.log(requestCounter.get()); // 3
console.log(requestCounter.get({ method: "GET", status: "200" })); // 1

// Histogram - distribution tracking
const latencyHistogram = registry.histogram(
  "http_request_duration_ms",
  "HTTP request latency in milliseconds",
  [10, 50, 100, 500, 1000, 5000, 10000] // custom buckets
);

latencyHistogram.observe(45);
latencyHistogram.observe(150);
latencyHistogram.observe(2500);

const stats = latencyHistogram.getStats();
console.log(stats);
// {
//   count: 3,
//   sum: 2695,
//   avg: 898.33,
//   buckets: [
//     { le: 10, count: 0 },
//     { le: 50, count: 1 },
//     { le: 100, count: 1 },
//     { le: 500, count: 2 },
//     ...
//   ]
// }

// Gauge - value that can go up or down
const activeConnections = registry.gauge("active_connections", "Number of active connections");
activeConnections.set(10);
activeConnections.inc(5);  // now 15
activeConnections.dec(3);  // now 12

console.log(activeConnections.get()); // 12

// Gauge with labels
activeConnections.set(100, { server: "api-1" });
activeConnections.set(75, { server: "api-2" });

console.log(activeConnections.get({ server: "api-1" })); // 100

// Export as JSON
const json = registry.exportJSON();
console.log(JSON.stringify(json, null, 2));

// Export as Prometheus format
const prometheus = registry.exportPrometheus();
console.log(prometheus);
// # HELP http_requests_total Total HTTP requests
// # TYPE http_requests_total counter
// http_requests_total 3
// http_requests_total{method="GET",status="200"} 1
// http_requests_total{method="POST",status="201"} 1
// ...
```

### Tracer

```typescript
import { Tracer, SpanStatus } from "@observability";

const tracer = new Tracer();

// Start a trace for a workflow
const traceId = tracer.startTrace("user-registration", "User Registration Workflow", {
  userId: "user-123",
  email: "alice@example.com"
});

// Create sequential spans
const span1 = tracer.startSpan(traceId, "validate-input");
tracer.logSpan(span1, "Validating email format");
tracer.logSpan(span1, "Checking password strength");
tracer.endSpan(span1, SpanStatus.SUCCESS, { valid: true });

const span2 = tracer.startSpan(traceId, "create-user");
tracer.logSpan(span2, "Inserting user into database");
tracer.endSpan(span2, SpanStatus.SUCCESS, { userId: "user-123" });

const span3 = tracer.startSpan(traceId, "send-welcome-email");
tracer.logSpan(span3, "Sending email via SendGrid");
tracer.endSpan(span3, SpanStatus.SUCCESS, { messageId: "msg-456" });

// End the trace
tracer.endTrace(traceId, SpanStatus.SUCCESS, { registeredUsers: 1042 });

// Export timeline as JSON
const timeline = tracer.exportTimeline(traceId);
console.log(JSON.stringify(timeline, null, 2));
// {
//   "traceId": "trace-abc-123",
//   "workflowId": "user-registration",
//   "workflowName": "User Registration Workflow",
//   "status": "SUCCESS",
//   "startTime": "2025-01-15T10:30:00.000Z",
//   "endTime": "2025-01-15T10:30:01.500Z",
//   "durationMs": 1500,
//   "spans": [
//     {
//       "spanId": "trace-abc-123-0",
//       "name": "validate-input",
//       "status": "SUCCESS",
//       "startTime": "2025-01-15T10:30:00.100Z",
//       "endTime": "2025-01-15T10:30:00.300Z",
//       "durationMs": 200,
//       "tags": { "valid": true },
//       "logs": [
//         { "timestamp": "2025-01-15T10:30:00.150Z", "message": "Validating email format" },
//         { "timestamp": "2025-01-15T10:30:00.250Z", "message": "Checking password strength" }
//       ]
//     },
//     ...
//   ]
// }

// Nested spans (parent-child relationships)
const parentSpan = tracer.startSpan(traceId, "process-order");
const childSpan1 = tracer.startSpan(traceId, "validate-inventory", {}, parentSpan);
tracer.endSpan(childSpan1, SpanStatus.SUCCESS);
const childSpan2 = tracer.startSpan(traceId, "charge-payment", {}, parentSpan);
tracer.endSpan(childSpan2, SpanStatus.SUCCESS);
tracer.endSpan(parentSpan, SpanStatus.SUCCESS);

// Get statistics
const stats = tracer.getStats();
console.log(stats);
// {
//   totalTraces: 5,
//   activeTraces: 2,
//   completedTraces: 3,
//   failedTraces: 1,
//   avgDurationMs: 850.5
// }

// Cleanup old traces (default TTL: 1 hour)
tracer.cleanup(); // removes completed traces older than 1 hour
tracer.cleanup(30 * 60 * 1000); // custom TTL: 30 minutes
```

## Global Singletons

For convenience, use global singleton instances:

```typescript
import { getLogger, setLogger, getRegistry, setRegistry, getTracer, setTracer } from "@observability";

// Set up global logger
const logger = new Logger();
logger.addTransport(new ConsoleTransport());
setLogger(logger);

// Use global logger anywhere
getLogger().info("Application started");

// Similarly for registry and tracer
const registry = new MetricsRegistry();
setRegistry(registry);

const tracer = new Tracer();
setTracer(tracer);
```

## Integration Examples

### Agent Runner Integration

```typescript
import { getLogger, getRegistry, getTracer, SpanStatus } from "@observability";

class AgentRunner {
  private logger = getLogger();
  private registry = getRegistry();
  private tracer = getTracer();
  private executionCounter = this.registry.counter("agent_executions_total", "Total agent executions");
  private durationHistogram = this.registry.histogram("agent_duration_ms", "Agent execution duration");

  async runWorkflow(workflowId: string, steps: Step[]): Promise<any> {
    const traceId = this.tracer.startTrace(workflowId, `Workflow ${workflowId}`);
    this.logger.info(`Starting workflow ${workflowId}`, { stepCount: steps.length });
    
    const startTime = Date.now();
    
    try {
      for (const step of steps) {
        const spanId = this.tracer.startSpan(traceId, step.name);
        
        try {
          const result = await this.executeStep(step);
          this.tracer.endSpan(spanId, SpanStatus.SUCCESS, { result });
        } catch (error) {
          this.tracer.endSpan(spanId, SpanStatus.ERROR, { error: error.message });
          throw error;
        }
      }
      
      this.tracer.endTrace(traceId, SpanStatus.SUCCESS);
      this.executionCounter.inc({ status: "success" });
      
      const duration = Date.now() - startTime;
      this.durationHistogram.observe(duration);
      this.logger.logToolExecution("workflow", true, duration, traceId, { workflowId });
      
    } catch (error) {
      this.tracer.endTrace(traceId, SpanStatus.ERROR);
      this.executionCounter.inc({ status: "error" });
      this.logger.error(`Workflow failed: ${workflowId}`, { error: error.message });
      throw error;
    }
  }
}
```

### Tool Execution Wrapper

```typescript
import { getLogger, getRegistry, SpanStatus } from "@observability";

async function executeToolWithObservability(
  toolName: string,
  operation: string,
  traceId: string,
  fn: () => Promise<any>
): Promise<any> {
  const logger = getLogger();
  const registry = getRegistry();
  
  const counter = registry.counter(`${toolName}_executions_total`, `Total ${toolName} executions`);
  const histogram = registry.histogram(`${toolName}_duration_ms`, `${toolName} execution duration`);
  
  const startTime = Date.now();
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    counter.inc({ operation, status: "success" });
    histogram.observe(duration);
    logger.logToolExecution(toolName, true, duration, traceId, { operation });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    counter.inc({ operation, status: "error" });
    histogram.observe(duration);
    logger.logToolExecution(toolName, false, duration, traceId, { operation, error: error.message });
    
    throw error;
  }
}
```

## Testing

```bash
npm test
```

Current test coverage: 13 tests passing

## Architecture

- **Logger**: Multi-transport structured logging with log levels (DEBUG, INFO, WARN, ERROR)
- **Metrics**: Prometheus-compatible telemetry with Counter (monotonic), Histogram (distribution), Gauge (up/down)
- **Tracer**: Span-based distributed tracing with parent-child relationships and timeline export
- **Transports**: ConsoleTransport (ANSI colored), JSONTransport (single-line JSON), FileTransport (buffered writes)
- **Export**: JSON (structured) and Prometheus text format (industry standard)

## License

Non-Commercial License (Commercial use requires a separate negotiated agreement with royalties). See ../LICENSE.
Original Author: Shawna Pakbin
