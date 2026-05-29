/**
 * Metrics Collection for LLM Toolkit
 *
 * Provides counters, histograms, and gauges with Prometheus-compatible export.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsRegistry =
  exports.Gauge =
  exports.Histogram =
  exports.Counter =
  exports.MetricType =
    void 0;
exports.getRegistry = getRegistry;
exports.setRegistry = setRegistry;
/**
 * Metric types
 */
var MetricType;
((MetricType) => {
  MetricType["COUNTER"] = "counter";
  MetricType["HISTOGRAM"] = "histogram";
  MetricType["GAUGE"] = "gauge";
})(MetricType || (exports.MetricType = MetricType = {}));
/**
 * Counter - monotonically increasing value
 */
class Counter {
  name;
  help;
  labels;
  type = MetricType.COUNTER;
  value = 0;
  labeledCounters = new Map();
  constructor(name, help, labels) {
    this.name = name;
    this.help = help;
    this.labels = labels;
  }
  /**
   * Increment counter
   */
  inc(labels, value = 1) {
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
  get(labels) {
    if (labels) {
      const key = this.serializeLabels(labels);
      return this.labeledCounters.get(key) || 0;
    }
    return this.value;
  }
  /**
   * Get all labeled values
   */
  getAllLabeled() {
    const result = [];
    for (const [key, value] of this.labeledCounters) {
      const labels = this.deserializeLabels(key);
      result.push({ labels, value });
    }
    return result;
  }
  serializeLabels(labels) {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }
  deserializeLabels(key) {
    const labels = {};
    if (!key) return labels;
    const pairs = key.split(",");
    for (const pair of pairs) {
      const [k, v] = pair.split("=");
      labels[k] = v.replace(/"/g, "");
    }
    return labels;
  }
}
exports.Counter = Counter;
/**
 * Histogram - distribution of values with buckets
 */
class Histogram {
  name;
  help;
  labels;
  type = MetricType.HISTOGRAM;
  buckets;
  counts;
  sum = 0;
  count = 0;
  constructor(name, help, buckets, labels) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    // Default buckets for latency: 10ms, 50ms, 100ms, 500ms, 1s, 5s, 10s
    this.buckets = buckets || [10, 50, 100, 500, 1000, 5000, 10000];
    this.counts = new Array(this.buckets.length + 1).fill(0);
  }
  /**
   * Observe a value
   */
  observe(value) {
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
  getStats() {
    const bucketStats = this.buckets.map((le, i) => ({
      le,
      count: this.counts[i],
    }));
    bucketStats.push({ le: "+Inf", count: this.counts[this.counts.length - 1] });
    return {
      count: this.count,
      sum: this.sum,
      avg: this.count > 0 ? this.sum / this.count : 0,
      buckets: bucketStats,
    };
  }
}
exports.Histogram = Histogram;
/**
 * Gauge - value that can go up or down
 */
class Gauge {
  name;
  help;
  labels;
  type = MetricType.GAUGE;
  value = 0;
  labeledGauges = new Map();
  constructor(name, help, labels) {
    this.name = name;
    this.help = help;
    this.labels = labels;
  }
  /**
   * Set gauge value
   */
  set(value, labels) {
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
  inc(value = 1, labels) {
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
  dec(value = 1, labels) {
    this.inc(-value, labels);
  }
  /**
   * Get gauge value
   */
  get(labels) {
    if (labels) {
      const key = this.serializeLabels(labels);
      return this.labeledGauges.get(key) || 0;
    }
    return this.value;
  }
  /**
   * Get all labeled values
   */
  getAllLabeled() {
    const result = [];
    for (const [key, value] of this.labeledGauges) {
      const labels = this.deserializeLabels(key);
      result.push({ labels, value });
    }
    return result;
  }
  serializeLabels(labels) {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }
  deserializeLabels(key) {
    const labels = {};
    if (!key) return labels;
    const pairs = key.split(",");
    for (const pair of pairs) {
      const [k, v] = pair.split("=");
      labels[k] = v.replace(/"/g, "");
    }
    return labels;
  }
}
exports.Gauge = Gauge;
/**
 * Metrics registry
 */
class MetricsRegistry {
  metrics = new Map();
  /**
   * Register a counter
   */
  counter(name, help, labels) {
    let counter = this.metrics.get(name);
    if (!counter) {
      counter = new Counter(name, help, labels);
      this.metrics.set(name, counter);
    }
    return counter;
  }
  /**
   * Register a histogram
   */
  histogram(name, help, buckets, labels) {
    let histogram = this.metrics.get(name);
    if (!histogram) {
      histogram = new Histogram(name, help, buckets, labels);
      this.metrics.set(name, histogram);
    }
    return histogram;
  }
  /**
   * Register a gauge
   */
  gauge(name, help, labels) {
    let gauge = this.metrics.get(name);
    if (!gauge) {
      gauge = new Gauge(name, help, labels);
      this.metrics.set(name, gauge);
    }
    return gauge;
  }
  /**
   * Get all metrics
   */
  getMetrics() {
    return Array.from(this.metrics.values());
  }
  /**
   * Export as JSON
   */
  exportJSON() {
    const result = {};
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
  exportPrometheus() {
    const lines = [];
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
exports.MetricsRegistry = MetricsRegistry;
/**
 * Global metrics registry
 */
let globalRegistry = null;
/**
 * Get or create global registry
 */
function getRegistry() {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistry();
  }
  return globalRegistry;
}
/**
 * Set global registry
 */
function setRegistry(registry) {
  globalRegistry = registry;
}
