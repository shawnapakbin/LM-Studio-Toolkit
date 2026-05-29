/**
 * Execution Tracer for LLM Toolkit
 *
 * Tracks workflow execution with detailed timeline and span information.
 */

import { generateTraceId } from "@shared/types";

/**
 * Span status
 */
export enum SpanStatus {
  SUCCESS = "success",
  ERROR = "error",
  CANCELLED = "cancelled",
}

/**
 * Span represents a unit of work
 */
export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status?: SpanStatus;
  tags: Record<string, string | number | boolean>;
  logs: Array<{ timestamp: number; message: string; data?: unknown }>;
}

/**
 * Trace represents a complete workflow execution
 */
export interface Trace {
  traceId: string;
  workflowId: string;
  workflowName: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status?: SpanStatus;
  spans: Span[];
  metadata: Record<string, unknown>;
}

/**
 * Tracer for creating and managing traces
 */
export class Tracer {
  private traces = new Map<string, Trace>();
  private activeSpans = new Map<string, Span>();

  /**
   * Start a new trace
   */
  startTrace(workflowId: string, workflowName: string, metadata?: Record<string, unknown>): string {
    const traceId = generateTraceId();
    const trace: Trace = {
      traceId,
      workflowId,
      workflowName,
      startTime: Date.now(),
      spans: [],
      metadata: metadata || {},
    };
    this.traces.set(traceId, trace);
    return traceId;
  }

  /**
   * End a trace
   */
  endTrace(traceId: string, status: SpanStatus): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    trace.endTime = Date.now();
    trace.durationMs = trace.endTime - trace.startTime;
    trace.status = status;
  }

  /**
   * Start a new span
   */
  startSpan(
    traceId: string,
    name: string,
    tags?: Record<string, string | number | boolean>,
    parentSpanId?: string,
  ): string {
    const trace = this.traces.get(traceId);
    if (!trace) {
      throw new Error(`Trace ${traceId} not found`);
    }

    const spanId = `${traceId}-${trace.spans.length}`;
    const span: Span = {
      spanId,
      traceId,
      parentSpanId,
      name,
      startTime: Date.now(),
      tags: tags || {},
      logs: [],
    };

    trace.spans.push(span);
    this.activeSpans.set(spanId, span);
    return spanId;
  }

  /**
   * End a span
   */
  endSpan(
    spanId: string,
    status: SpanStatus,
    tags?: Record<string, string | number | boolean>,
  ): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = status;

    if (tags) {
      Object.assign(span.tags, tags);
    }

    this.activeSpans.delete(spanId);
  }

  /**
   * Add a log to a span
   */
  logSpan(spanId: string, message: string, data?: unknown): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;

    span.logs.push({
      timestamp: Date.now(),
      message,
      data,
    });
  }

  /**
   * Get a trace
   */
  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  /**
   * Get all traces
   */
  getAllTraces(): Trace[] {
    return Array.from(this.traces.values());
  }

  /**
   * Export trace as timeline JSON
   */
  exportTimeline(traceId: string): Record<string, unknown> | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;

    const timeline = {
      traceId: trace.traceId,
      workflowId: trace.workflowId,
      workflowName: trace.workflowName,
      startTime: new Date(trace.startTime).toISOString(),
      endTime: trace.endTime ? new Date(trace.endTime).toISOString() : null,
      durationMs: trace.durationMs,
      status: trace.status,
      metadata: trace.metadata,
      spans: trace.spans.map((span) => ({
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        startTime: new Date(span.startTime).toISOString(),
        endTime: span.endTime ? new Date(span.endTime).toISOString() : null,
        durationMs: span.durationMs,
        status: span.status,
        tags: span.tags,
        logs: span.logs.map((log) => ({
          timestamp: new Date(log.timestamp).toISOString(),
          message: log.message,
          data: log.data,
        })),
      })),
    };

    return timeline;
  }

  /**
   * Clear old traces
   */
  cleanup(maxAgeMs = 3600000): void {
    const now = Date.now();
    for (const [traceId, trace] of this.traces) {
      if (trace.endTime && now - trace.endTime > maxAgeMs) {
        this.traces.delete(traceId);
      }
    }
  }

  /**
   * Get trace statistics
   */
  getStats(): {
    totalTraces: number;
    activeTraces: number;
    completedTraces: number;
    failedTraces: number;
    avgDurationMs: number;
  } {
    const traces = Array.from(this.traces.values());
    const completed = traces.filter((t) => t.endTime);
    const active = traces.filter((t) => !t.endTime);
    const failed = completed.filter((t) => t.status === SpanStatus.ERROR);

    const totalDuration = completed.reduce((sum, t) => sum + (t.durationMs || 0), 0);
    const avgDuration = completed.length > 0 ? totalDuration / completed.length : 0;

    return {
      totalTraces: traces.length,
      activeTraces: active.length,
      completedTraces: completed.length,
      failedTraces: failed.length,
      avgDurationMs: avgDuration,
    };
  }
}

/**
 * Global tracer instance
 */
let globalTracer: Tracer | null = null;

/**
 * Get or create global tracer
 */
export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
  }
  return globalTracer;
}

/**
 * Set global tracer
 */
export function setTracer(tracer: Tracer): void {
  globalTracer = tracer;
}
