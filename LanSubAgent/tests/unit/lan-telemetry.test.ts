import { LanTelemetryTracker } from "../../src/lan-telemetry";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("LanTelemetryTracker", () => {
  let tracker: LanTelemetryTracker;

  beforeEach(() => {
    tracker = new LanTelemetryTracker();
  });

  describe("recordLanTask", () => {
    it("records a single task and tracks metrics", () => {
      tracker.recordLanTask("task-1", "ep-1", 500, 100, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({
        endpointId: "ep-1",
        host: "192.168.1.10",
        port: 1234,
        totalRequests: 1,
        totalFailures: 0,
        totalTokens: 100,
        averageResponseMs: 500,
      });
      expect(metrics[0].lastRequestAt).not.toBeNull();
    });

    it("computes running average incrementally for multiple tasks", () => {
      tracker.recordLanTask("task-1", "ep-1", 200, 50, "192.168.1.10", 1234);
      tracker.recordLanTask("task-2", "ep-1", 400, 80, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      expect(metrics[0].totalRequests).toBe(2);
      expect(metrics[0].totalTokens).toBe(130);
      // Running average: (200 + 400) / 2 = 300
      expect(metrics[0].averageResponseMs).toBeCloseTo(300, 5);
    });

    it("tracks tasks across multiple endpoints independently", () => {
      tracker.recordLanTask("task-1", "ep-1", 300, 50, "192.168.1.10", 1234);
      tracker.recordLanTask("task-2", "ep-2", 600, 120, "192.168.1.11", 5000);

      const metrics = tracker.getEndpointMetrics();
      expect(metrics).toHaveLength(2);

      const ep1 = metrics.find((m) => m.endpointId === "ep-1")!;
      const ep2 = metrics.find((m) => m.endpointId === "ep-2")!;

      expect(ep1.totalRequests).toBe(1);
      expect(ep1.averageResponseMs).toBe(300);
      expect(ep1.totalTokens).toBe(50);

      expect(ep2.totalRequests).toBe(1);
      expect(ep2.averageResponseMs).toBe(600);
      expect(ep2.totalTokens).toBe(120);
    });

    it("accumulates tokens across multiple tasks for same endpoint", () => {
      tracker.recordLanTask("task-1", "ep-1", 100, 50, "192.168.1.10", 1234);
      tracker.recordLanTask("task-2", "ep-1", 200, 75, "192.168.1.10", 1234);
      tracker.recordLanTask("task-3", "ep-1", 300, 25, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      expect(metrics[0].totalTokens).toBe(150);
    });
  });

  describe("recordLanFailure", () => {
    it("records a failure and increments failure count", () => {
      tracker.recordLanFailure("ep-1", 1000, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      expect(metrics[0]).toMatchObject({
        endpointId: "ep-1",
        totalRequests: 1,
        totalFailures: 1,
        totalTokens: 0,
        averageResponseMs: 1000,
      });
    });

    it("failures count in running average alongside successes", () => {
      tracker.recordLanTask("task-1", "ep-1", 200, 50, "192.168.1.10", 1234);
      tracker.recordLanFailure("ep-1", 800, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      expect(metrics[0].totalRequests).toBe(2);
      expect(metrics[0].totalFailures).toBe(1);
      // Running average: (200 + 800) / 2 = 500
      expect(metrics[0].averageResponseMs).toBeCloseTo(500, 5);
    });
  });

  describe("computeLanSummary", () => {
    it("returns empty summary when no data", () => {
      const summary = tracker.computeLanSummary();
      expect(summary).toEqual({
        endpointBreakdown: [],
        totalTasks: 0,
        totalFailures: 0,
        totalDurationMs: 0,
      });
    });

    it("aggregates across all endpoints", () => {
      tracker.recordLanTask("task-1", "ep-1", 200, 50, "192.168.1.10", 1234);
      tracker.recordLanTask("task-2", "ep-1", 400, 80, "192.168.1.10", 1234);
      tracker.recordLanTask("task-3", "ep-2", 600, 120, "192.168.1.11", 5000);
      tracker.recordLanFailure("ep-2", 100, "192.168.1.11", 5000);

      const summary = tracker.computeLanSummary();
      expect(summary.totalTasks).toBe(4);
      expect(summary.totalFailures).toBe(1);
      expect(summary.endpointBreakdown).toHaveLength(2);
      // totalDurationMs = (300 * 2) + (350 * 2) = 600 + 700 = 1300
      expect(summary.totalDurationMs).toBeCloseTo(1300, 0);
    });
  });

  describe("getEndpointMetrics", () => {
    it("returns empty array when no endpoints tracked", () => {
      expect(tracker.getEndpointMetrics()).toEqual([]);
    });

    it("includes p95ResponseMs in output", () => {
      // Record several tasks with known durations
      tracker.recordLanTask("task-1", "ep-1", 100, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-2", "ep-1", 200, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-3", "ep-1", 300, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-4", "ep-1", 400, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-5", "ep-1", 500, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-6", "ep-1", 600, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-7", "ep-1", 700, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-8", "ep-1", 800, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-9", "ep-1", 900, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-10", "ep-1", 1000, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-11", "ep-1", 1100, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-12", "ep-1", 1200, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-13", "ep-1", 1300, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-14", "ep-1", 1400, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-15", "ep-1", 1500, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-16", "ep-1", 1600, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-17", "ep-1", 1700, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-18", "ep-1", 1800, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-19", "ep-1", 1900, 10, "192.168.1.10", 1234);
      tracker.recordLanTask("task-20", "ep-1", 2000, 10, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      // p95 of 20 items: ceil(20 * 0.95) - 1 = ceil(19) - 1 = 18 → index 18 → value 1900
      expect(metrics[0].p95ResponseMs).toBe(1900);
    });

    it("returns 0 for p95 when only one data point", () => {
      tracker.recordLanTask("task-1", "ep-1", 500, 10, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      // p95 of 1 item: ceil(1 * 0.95) - 1 = ceil(0.95) - 1 = 1 - 1 = 0 → value 500
      expect(metrics[0].p95ResponseMs).toBe(500);
    });
  });

  describe("clear", () => {
    it("resets all metrics to empty", () => {
      tracker.recordLanTask("task-1", "ep-1", 300, 50, "192.168.1.10", 1234);
      tracker.recordLanTask("task-2", "ep-2", 600, 120, "192.168.1.11", 5000);

      tracker.clear();

      expect(tracker.getEndpointMetrics()).toEqual([]);
      expect(tracker.computeLanSummary()).toEqual({
        endpointBreakdown: [],
        totalTasks: 0,
        totalFailures: 0,
        totalDurationMs: 0,
      });
    });

    it("allows recording new data after clear", () => {
      tracker.recordLanTask("task-1", "ep-1", 300, 50, "192.168.1.10", 1234);
      tracker.clear();

      tracker.recordLanTask("task-2", "ep-1", 700, 200, "192.168.1.10", 1234);

      const metrics = tracker.getEndpointMetrics();
      expect(metrics).toHaveLength(1);
      expect(metrics[0].totalRequests).toBe(1);
      expect(metrics[0].averageResponseMs).toBe(700);
      expect(metrics[0].totalTokens).toBe(200);
    });
  });

  describe("incremental running average", () => {
    it("computes correct average for many data points", () => {
      // Record 100 tasks with durations 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        tracker.recordLanTask(`task-${i}`, "ep-1", i, 10, "192.168.1.10", 1234);
      }

      const metrics = tracker.getEndpointMetrics();
      // Expected average: (1 + 2 + ... + 100) / 100 = 5050 / 100 = 50.5
      expect(metrics[0].averageResponseMs).toBeCloseTo(50.5, 5);
    });
  });
});
