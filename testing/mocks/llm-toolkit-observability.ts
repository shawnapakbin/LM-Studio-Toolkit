/**
 * Comprehensive mock for llm-toolkit-observability used in tests.
 * Provides no-op implementations of Logger, MetricsRegistry, and Tracer
 * to avoid ESM resolution issues with the workspace-linked Observability package.
 */

// ─── Logger Mock ─────────────────────────────────────────────────────────────

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  traceId?: string;
  spanId?: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private entries: LogEntry[] = [];
  info(_msg: string, _data?: any) {}
  warn(_msg: string, _data?: any) {}
  error(_msg: string, _data?: any) {}
  debug(_msg: string, _data?: any) {}
  trace(_msg: string, _data?: any) {}
  child() {
    return new Logger();
  }
  setLevel() {}
  addTransport() {}
  getEntries() {
    return this.entries;
  }
}

export function getLogger(): Logger {
  return new Logger();
}

export function setLogger(_logger?: any) {}

export class ConsoleTransport {
  write() {}
}

export class JSONTransport {
  write() {}
}

export class FileTransport {
  constructor() {}
  write() {}
  flush() {}
  close() {}
}

// ─── Metrics Mock ────────────────────────────────────────────────────────────

export enum MetricType {
  COUNTER = "counter",
  HISTOGRAM = "histogram",
  GAUGE = "gauge",
}

export type Labels = Record<string, string>;

export class Counter {
  readonly type = MetricType.COUNTER;
  readonly name: string;
  readonly help: string;
  private value = 0;
  constructor(name: string, help: string, _labels?: Labels) {
    this.name = name;
    this.help = help;
  }
  inc(_labels?: Labels, _amount?: number) {
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

export class Histogram {
  readonly type = MetricType.HISTOGRAM;
  readonly name: string;
  readonly help: string;
  constructor(name: string, help: string, _buckets?: number[], _labels?: Labels) {
    this.name = name;
    this.help = help;
  }
  observe(_value: number, _labels?: Labels) {}
  getStats() {
    return { count: 0, sum: 0, mean: 0, buckets: [] };
  }
  reset() {}
}

export class Gauge {
  readonly type = MetricType.GAUGE;
  readonly name: string;
  readonly help: string;
  private value = 0;
  constructor(name: string, help: string, _labels?: Labels) {
    this.name = name;
    this.help = help;
  }
  set(value: number, _labels?: Labels) {
    this.value = value;
  }
  inc(_labels?: Labels, _amount?: number) {
    this.value++;
  }
  dec(_labels?: Labels, _amount?: number) {
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
  counter(name: string, help: string, labels?: Labels): Counter {
    let c = this.metrics.get(name);
    if (!c) {
      c = new Counter(name, help, labels);
      this.metrics.set(name, c);
    }
    return c;
  }
  histogram(name: string, help: string, buckets?: number[], labels?: Labels): Histogram {
    let h = this.metrics.get(name);
    if (!h) {
      h = new Histogram(name, help, buckets, labels);
      this.metrics.set(name, h);
    }
    return h;
  }
  gauge(name: string, help: string, labels?: Labels): Gauge {
    let g = this.metrics.get(name);
    if (!g) {
      g = new Gauge(name, help, labels);
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

export function setRegistry(_registry: MetricsRegistry): void {
  globalRegistry = _registry;
}

// ─── Tracer Mock ─────────────────────────────────────────────────────────────

export enum SpanStatus {
  SUCCESS = "success",
  ERROR = "error",
  CANCELLED = "cancelled",
}

export class Tracer {
  startTrace(_workflowId?: string, _workflowName?: string, _metadata?: Record<string, unknown>) {
    return "mock-trace-id";
  }
  startSpan(_traceId?: string, _name?: string, _parentSpanId?: string) {
    return "mock-span-id";
  }
  endSpan(_spanId?: string, _status?: SpanStatus, _tags?: Record<string, any>) {}
  endTrace(_traceId?: string, _status?: SpanStatus) {}
  getTrace(_traceId?: string) {
    return null;
  }
  getActiveSpans() {
    return [];
  }
  addSpanLog(_spanId?: string, _message?: string, _data?: unknown) {}
  setSpanTag(_spanId?: string, _key?: string, _value?: string | number | boolean) {}
}

let globalTracer: Tracer | null = null;

export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

export function setTracer(_tracer: Tracer): void {
  globalTracer = _tracer;
}
