/**
 * Metrics Collection for LLM Toolkit
 *
 * Provides counters, histograms, and gauges with Prometheus-compatible export.
 */

/**
 * Metric types
 */
export enum MetricType {
  COUNTER = "counter",
  HISTOGRAM = "histogram",
  GAUGE = "gauge",
}

/**
 * Metric labels
 */
export type Labels = Record<string, string>;

/**
 * Base metric interface
 */
export interface Metric {
  name: string;
  type: MetricType;
  help: string;
  labels?: Labels;
}

/**
 * Counter - monotonically increasing value
 */
export class Counter implements Metric {
  readonly type = MetricType.COUNTER;
  private value = 0;
  private labeledCounters = new Map<string, number>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labels?: Labels,
  ) {}

  /**
   * Increment counter
   */
  inc(labels?: Labels, value = 1): void {
    if (labels) {
      const key = this.serializeLabels(labels);
      const current = this.labeledCounters.get(key) || 0;
      this.labeledCounters.set(key, current + value);
    } else {
      this.value += value;
    }
  }

  /**
   * Get counter value
   */
  get(labels?: Labels): number {
    if (labels) {
      const key = this.serializeLabels(labels);
      return this.labeledCounters.get(key) || 0;
    }
    return this.value;
  }

  /**
   * Get all labeled values
   */
  getAllLabeled(): Array<{ labels: Labels; value: number }> {
    const result: Array<{ labels: Labels; value: number }> = [];
    for (const [key, value] of this.labeledCounters) {
      const labels = this.deserializeLabels(key);
      result.push({ labels, value });
    }
    return result;
  }

  private serializeLabels(labels: Labels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }

  private deserializeLabels(key: string): Labels {
    const labels: Labels = {};
    if (!key) return labels;

    const pairs = key.split(",");
    for (const pair of pairs) {
      const [k, v] = pair.split("=");
      labels[k] = v.replace(/"/g, "");
    }
    return labels;
  }
}

/**
 * Histogram - distribution of values with buckets
 */
export class Histogram implements Metric {
  readonly type = MetricType.HISTOGRAM;
  private buckets: number[];
  private counts: number[];
  private sum = 0;
  private count = 0;

  constructor(
    public readonly name: string,
    public readonly help: string,
    buckets?: number[],
    public readonly labels?: Labels,
  ) {
    // Default buckets for latency: 10ms, 50ms, 100ms, 500ms, 1s, 5s, 10s
    this.buckets = buckets || [10, 50, 100, 500, 1000, 5000, 10000];
    this.counts = new Array(this.buckets.length + 1).fill(0);
  }

  /**
   * Observe a value
   */
  observe(value: number): void {
    this.sum += value;
    this.count++;

    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        this.counts[i]++;
      }
    }
    // +Inf bucket
    this.counts[this.counts.length - 1]++;
  }

  /**
   * Get histogram statistics
   */
  getStats(): {
    count: number;
    sum: number;
    avg: number;
    buckets: Array<{ le: number | string; count: number }>;
  } {
    const bucketStats: Array<{ le: number | string; count: number }> = this.buckets.map(
      (le, i) => ({
        le,
        count: this.counts[i],
      }),
    );
    bucketStats.push({ le: "+Inf", count: this.counts[this.counts.length - 1] });

    return {
      count: this.count,
      sum: this.sum,
      avg: this.count > 0 ? this.sum / this.count : 0,
      buckets: bucketStats,
    };
  }
}

/**
 * Gauge - value that can go up or down
 */
export class Gauge implements Metric {
  readonly type = MetricType.GAUGE;
  private value = 0;
  private labeledGauges = new Map<string, number>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labels?: Labels,
  ) {}

  /**
   * Set gauge value
   */
  set(value: number, labels?: Labels): void {
    if (labels) {
      const key = this.serializeLabels(labels);
      this.labeledGauges.set(key, value);
    } else {
      this.value = value;
    }
  }

  /**
   * Increment gauge
   */
  inc(value = 1, labels?: Labels): void {
    if (labels) {
      const key = this.serializeLabels(labels);
      const current = this.labeledGauges.get(key) || 0;
      this.labeledGauges.set(key, current + value);
    } else {
      this.value += value;
    }
  }

  /**
   * Decrement gauge
   */
  dec(value = 1, labels?: Labels): void {
    this.inc(-value, labels);
  }

  /**
   * Get gauge value
   */
  get(labels?: Labels): number {
    if (labels) {
      const key = this.serializeLabels(labels);
      return this.labeledGauges.get(key) || 0;
    }
    return this.value;
  }

  /**
   * Get all labeled values
   */
  getAllLabeled(): Array<{ labels: Labels; value: number }> {
    const result: Array<{ labels: Labels; value: number }> = [];
    for (const [key, value] of this.labeledGauges) {
      const labels = this.deserializeLabels(key);
      result.push({ labels, value });
    }
    return result;
  }

  private serializeLabels(labels: Labels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }

  private deserializeLabels(key: string): Labels {
    const labels: Labels = {};
    if (!key) return labels;

    const pairs = key.split(",");
    for (const pair of pairs) {
      const [k, v] = pair.split("=");
      labels[k] = v.replace(/"/g, "");
    }
    return labels;
  }
}

/**
 * Metrics registry
 */
export class MetricsRegistry {
  private metrics = new Map<string, Metric>();

  /**
   * Register a counter
   */
  counter(name: string, help: string, labels?: Labels): Counter {
    let counter = this.metrics.get(name) as Counter;
    if (!counter) {
      counter = new Counter(name, help, labels);
      this.metrics.set(name, counter);
    }
    return counter;
  }

  /**
   * Register a histogram
   */
  histogram(name: string, help: string, buckets?: number[], labels?: Labels): Histogram {
    let histogram = this.metrics.get(name) as Histogram;
    if (!histogram) {
      histogram = new Histogram(name, help, buckets, labels);
      this.metrics.set(name, histogram);
    }
    return histogram;
  }

  /**
   * Register a gauge
   */
  gauge(name: string, help: string, labels?: Labels): Gauge {
    let gauge = this.metrics.get(name) as Gauge;
    if (!gauge) {
      gauge = new Gauge(name, help, labels);
      this.metrics.set(name, gauge);
    }
    return gauge;
  }

  /**
   * Get all metrics
   */
  getMetrics(): Metric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Export as JSON
   */
  exportJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const metric of this.metrics.values()) {
      if (metric instanceof Counter) {
        result[metric.name] = {
          type: "counter",
          value: metric.get(),
          labeled: metric.getAllLabeled(),
        };
      } else if (metric instanceof Histogram) {
        result[metric.name] = {
          type: "histogram",
          ...metric.getStats(),
        };
      } else if (metric instanceof Gauge) {
        result[metric.name] = {
          type: "gauge",
          value: metric.get(),
          labeled: metric.getAllLabeled(),
        };
      }
    }

    return result;
  }

  /**
   * Export as Prometheus text format
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      if (metric instanceof Counter) {
        // Unlabeled
        lines.push(`${metric.name} ${metric.get()}`);
        // Labeled
        for (const { labels, value } of metric.getAllLabeled()) {
          const labelStr = Object.entries(labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(",");
          lines.push(`${metric.name}{${labelStr}} ${value}`);
        }
      } else if (metric instanceof Histogram) {
        const stats = metric.getStats();
        for (const bucket of stats.buckets) {
          const le = bucket.le === "+Inf" ? "+Inf" : bucket.le;
          lines.push(`${metric.name}_bucket{le="${le}"} ${bucket.count}`);
        }
        lines.push(`${metric.name}_sum ${stats.sum}`);
        lines.push(`${metric.name}_count ${stats.count}`);
      } else if (metric instanceof Gauge) {
        // Unlabeled
        lines.push(`${metric.name} ${metric.get()}`);
        // Labeled
        for (const { labels, value } of metric.getAllLabeled()) {
          const labelStr = Object.entries(labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(",");
          lines.push(`${metric.name}{${labelStr}} ${value}`);
        }
      }

      lines.push(""); // Empty line between metrics
    }

    return lines.join("\n");
  }
}

/**
 * Global metrics registry
 */
let globalRegistry: MetricsRegistry | null = null;

/**
 * Get or create global registry
 */
export function getRegistry(): MetricsRegistry {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistry();
  }
  return globalRegistry;
}

/**
 * Set global registry
 */
export function setRegistry(registry: MetricsRegistry): void {
  globalRegistry = registry;
}
