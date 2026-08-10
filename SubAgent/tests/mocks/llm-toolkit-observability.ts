/**
 * Mock for llm-toolkit-observability used in SubAgent tests.
 * Provides no-op implementations to avoid ESM resolution issues.
 */

// ─── Logger ──────────────────────────────────────────────────────────────────

const noopLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  child: () => noopLogger,
  setLevel: () => {},
  addTransport: () => {},
};

export function getLogger() {
  return noopLogger;
}

export function setLogger() {}

export type Logger = typeof noopLogger;

// ─── Metrics ─────────────────────────────────────────────────────────────────

class MockCounter {
  readonly name: string;
  readonly help: string;
  private value = 0;
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  inc() {
    this.value++;
  }
  get() {
    return this.value;
  }
  getAllLabeled() {
    return [];
  }
  reset() {
    this.value = 0;
  }
}

class MockHistogram {
  readonly name: string;
  readonly help: string;
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  observe() {}
  getStats() {
    return { count: 0, sum: 0, mean: 0, buckets: [] };
  }
  reset() {}
}

class MockGauge {
  readonly name: string;
  readonly help: string;
  private value = 0;
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  set(v: number) {
    this.value = v;
  }
  inc() {
    this.value++;
  }
  dec() {
    this.value--;
  }
  get() {
    return this.value;
  }
  getAllLabeled() {
    return [];
  }
  reset() {
    this.value = 0;
  }
}

export class MetricsRegistry {
  private metrics = new Map<string, any>();
  counter(name: string, help: string) {
    let c = this.metrics.get(name);
    if (!c) {
      c = new MockCounter(name, help);
      this.metrics.set(name, c);
    }
    return c;
  }
  histogram(name: string, help: string) {
    let h = this.metrics.get(name);
    if (!h) {
      h = new MockHistogram(name, help);
      this.metrics.set(name, h);
    }
    return h;
  }
  gauge(name: string, help: string) {
    let g = this.metrics.get(name);
    if (!g) {
      g = new MockGauge(name, help);
      this.metrics.set(name, g);
    }
    return g;
  }
  getMetrics() {
    return Array.from(this.metrics.values());
  }
  exportJSON() {
    return {};
  }
  exportPrometheus() {
    return "";
  }
}

let globalRegistry: MetricsRegistry | null = null;

export function getRegistry(): MetricsRegistry {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistry();
  }
  return globalRegistry;
}

export function setRegistry(registry: MetricsRegistry): void {
  globalRegistry = registry;
}

// ─── Tracer ──────────────────────────────────────────────────────────────────

export enum SpanStatus {
  SUCCESS = "success",
  ERROR = "error",
  CANCELLED = "cancelled",
}

export class Tracer {
  startTrace() {
    return "mock-trace-id";
  }
  startSpan() {
    return "mock-span-id";
  }
  endSpan() {}
  endTrace() {}
  getTrace() {
    return null;
  }
  getActiveSpans() {
    return [];
  }
  addSpanLog() {}
  setSpanTag() {}
}

let globalTracer: Tracer | null = null;

export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

export function setTracer(tracer: Tracer): void {
  globalTracer = tracer;
}
