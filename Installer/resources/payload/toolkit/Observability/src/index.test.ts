import { JSONTransport, Logger } from "./logger";
import { MetricsRegistry } from "./metrics";
import { SpanStatus, Tracer } from "./tracer";

describe("Observability Module", () => {
  describe("Logger", () => {
    test("should create logger and log messages", () => {
      const logger = new Logger();
      logger.addTransport(new JSONTransport());

      expect(() => logger.info("Test message")).not.toThrow();
      expect(() => logger.debug("Debug message", { key: "value" })).not.toThrow();
      expect(() => logger.warn("Warning")).not.toThrow();
      expect(() => logger.error("Error")).not.toThrow();
    });

    test("should create child logger", () => {
      const logger = new Logger();
      const child = logger.child("test-tool");

      expect(child).toBeDefined();
      expect(() => child.info("Child message")).not.toThrow();
    });

    test("should log tool execution", () => {
      const logger = new Logger();
      expect(() => logger.logToolExecution("test-tool", true, 150, "trace-123")).not.toThrow();
    });
  });

  describe("MetricsRegistry", () => {
    test("should create and increment counter", () => {
      const registry = new MetricsRegistry();
      const counter = registry.counter("test_counter", "Test counter");

      counter.inc();
      counter.inc(undefined, 5);

      expect(counter.get()).toBe(6);
    });

    test("should create and observe histogram", () => {
      const registry = new MetricsRegistry();
      const histogram = registry.histogram("test_histogram", "Test histogram");

      histogram.observe(100);
      histogram.observe(200);

      const stats = histogram.getStats();
      expect(stats.count).toBe(2);
      expect(stats.sum).toBe(300);
    });

    test("should create and set gauge", () => {
      const registry = new MetricsRegistry();
      const gauge = registry.gauge("test_gauge", "Test gauge");

      gauge.set(42);
      expect(gauge.get()).toBe(42);

      gauge.inc(8);
      expect(gauge.get()).toBe(50);
    });

    test("should export metrics as JSON", () => {
      const registry = new MetricsRegistry();
      const counter = registry.counter("requests", "Total requests");
      counter.inc();

      const json = registry.exportJSON();
      const requestsMetric = json.requests as { type?: string; value?: number } | undefined;
      expect(requestsMetric).toBeDefined();
      expect(requestsMetric?.type).toBe("counter");
      expect(requestsMetric?.value).toBe(1);
    });

    test("should export metrics as Prometheus format", () => {
      const registry = new MetricsRegistry();
      const counter = registry.counter("requests_total", "Total requests");
      counter.inc();

      const prometheus = registry.exportPrometheus();
      expect(prometheus).toContain("# HELP requests_total Total requests");
      expect(prometheus).toContain("# TYPE requests_total counter");
      expect(prometheus).toContain("requests_total 1");
    });
  });

  describe("Tracer", () => {
    test("should create and complete trace", () => {
      const tracer = new Tracer();

      const traceId = tracer.startTrace("workflow-1", "Test Workflow");
      expect(traceId).toBeDefined();

      expect(() => tracer.endTrace(traceId, SpanStatus.SUCCESS)).not.toThrow();
    });

    test("should create spans within trace", () => {
      const tracer = new Tracer();
      const traceId = tracer.startTrace("workflow-1", "Test Workflow");

      const spanId = tracer.startSpan(traceId, "step-1");
      expect(spanId).toBeDefined();

      expect(() => tracer.endSpan(spanId, SpanStatus.SUCCESS)).not.toThrow();
    });

    test("should log to span", () => {
      const tracer = new Tracer();
      const traceId = tracer.startTrace("workflow-1", "Test Workflow");
      const spanId = tracer.startSpan(traceId, "step-1");

      expect(() => tracer.logSpan(spanId, "Processing...")).not.toThrow();

      tracer.endSpan(spanId, SpanStatus.SUCCESS);
    });

    test("should export timeline", () => {
      const tracer = new Tracer();
      const traceId = tracer.startTrace("workflow-1", "Test Workflow");
      const spanId = tracer.startSpan(traceId, "step-1");
      tracer.endSpan(spanId, SpanStatus.SUCCESS);
      tracer.endTrace(traceId, SpanStatus.SUCCESS);

      const timeline = tracer.exportTimeline(traceId);
      expect(timeline).toBeDefined();
      expect(timeline?.traceId).toBe(traceId);
      expect(timeline?.spans).toHaveLength(1);
    });

    test("should provide statistics", () => {
      const tracer = new Tracer();
      const traceId = tracer.startTrace("workflow-1", "Test Workflow");
      tracer.endTrace(traceId, SpanStatus.SUCCESS);

      const stats = tracer.getStats();
      expect(stats.totalTraces).toBe(1);
      expect(stats.completedTraces).toBe(1);
      expect(stats.activeTraces).toBe(0);
    });
  });
});
