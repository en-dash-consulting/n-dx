import { describe, it, expect } from "vitest";
import {
  ConcurrentExecutionMetrics,
  DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG,
} from "../../../src/process/concurrent-execution-metrics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

/**
 * Create a metrics instance with an injectable clock for deterministic tests.
 */
function createMetrics(
  opts?: {
    startTime?: number;
    maxSnapshots?: number;
    maxCompletedTasks?: number;
  },
): { metrics: ConcurrentExecutionMetrics; advanceClock: (ms: number) => void; now: () => number } {
  let currentTime = opts?.startTime ?? 1_700_000_000_000;

  const metrics = new ConcurrentExecutionMetrics(
    {
      maxSnapshots: opts?.maxSnapshots,
      maxCompletedTasks: opts?.maxCompletedTasks,
    },
    { now: () => currentTime },
  );

  return {
    metrics,
    advanceClock: (ms: number) => { currentTime += ms; },
    now: () => currentTime,
  };
}

/**
 * Record N snapshots with a fixed concurrent count and memory pattern.
 */
function recordSnapshots(
  metrics: ConcurrentExecutionMetrics,
  advanceClock: (ms: number) => void,
  count: number,
  opts: {
    concurrentCount: number;
    totalRssBytes: number;
    systemMemoryPercent: number;
    loadAvg1m: number;
    perTaskRss?: Array<{ taskId: string; rssBytes: number }>;
    intervalMs?: number;
  },
): void {
  const intervalMs = opts.intervalMs ?? 10_000;
  for (let i = 0; i < count; i++) {
    if (i > 0) advanceClock(intervalMs);
    metrics.recordSnapshot({
      concurrentCount: opts.concurrentCount,
      totalRssBytes: opts.totalRssBytes,
      systemMemoryPercent: opts.systemMemoryPercent,
      loadAvg1m: opts.loadAvg1m,
      perTaskRss: opts.perTaskRss ?? [],
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConcurrentExecutionMetrics", () => {

  // -----------------------------------------------------------------------
  // Constructor & defaults
  // -----------------------------------------------------------------------

  describe("constructor", () => {
    it("creates with default config when no options provided", () => {
      const metrics = new ConcurrentExecutionMetrics();
      expect(metrics.config).toEqual(DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG);
    });

    it("merges partial config with defaults", () => {
      const metrics = new ConcurrentExecutionMetrics({ maxSnapshots: 100 });
      expect(metrics.config.maxSnapshots).toBe(100);
      expect(metrics.config.maxCompletedTasks).toBe(
        DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG.maxCompletedTasks,
      );
    });

    it("starts with zero counts", () => {
      const metrics = new ConcurrentExecutionMetrics();
      expect(metrics.snapshotCount).toBe(0);
      expect(metrics.activeTaskCount).toBe(0);
      expect(metrics.completedTaskCount).toBe(0);
    });
  });

  describe("DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG", () => {
    it("has sensible defaults", () => {
      const cfg = DEFAULT_CONCURRENT_EXECUTION_METRICS_CONFIG;
      expect(cfg.maxSnapshots).toBe(360);
      expect(cfg.maxCompletedTasks).toBe(50);
    });
  });

  // -----------------------------------------------------------------------
  // Task lifecycle
  // -----------------------------------------------------------------------

  describe("taskStarted()", () => {
    it("registers a new active task", () => {
      const { metrics } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);

      expect(metrics.activeTaskCount).toBe(1);
      expect(metrics.completedTaskCount).toBe(0);
    });

    it("tracks multiple tasks independently", () => {
      const { metrics } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1001);
      metrics.taskStarted("task-2", "Add feature", 1002);

      expect(metrics.activeTaskCount).toBe(2);
    });

    it("overwrites an existing task with the same ID", () => {
      const { metrics } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);
      metrics.taskStarted("task-1", "Fix bug v2", 5678);

      expect(metrics.activeTaskCount).toBe(1);
      const active = metrics.getActiveTaskMetrics();
      expect(active[0]!.pid).toBe(5678);
    });
  });

  describe("taskCompleted()", () => {
    it("moves task from active to completed", () => {
      const { metrics } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);
      expect(metrics.activeTaskCount).toBe(1);

      metrics.taskCompleted("task-1");
      expect(metrics.activeTaskCount).toBe(0);
      expect(metrics.completedTaskCount).toBe(1);
    });

    it("records completion timestamp", () => {
      const { metrics, advanceClock } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);
      advanceClock(60_000); // 1 minute later
      metrics.taskCompleted("task-1");

      const completed = metrics.getCompletedTaskMetrics();
      expect(completed).toHaveLength(1);
      expect(completed[0]!.completedAt).toBeTruthy();
      expect(completed[0]!.durationMs).toBe(60_000);
    });

    it("no-ops for unknown taskId", () => {
      const { metrics } = createMetrics();
      metrics.taskCompleted("nonexistent");
      expect(metrics.completedTaskCount).toBe(0);
    });

    it("evicts oldest completed when over limit", () => {
      const { metrics } = createMetrics({ maxCompletedTasks: 2 });

      metrics.taskStarted("task-1", "Task 1", 1001);
      metrics.taskCompleted("task-1");
      metrics.taskStarted("task-2", "Task 2", 1002);
      metrics.taskCompleted("task-2");
      metrics.taskStarted("task-3", "Task 3", 1003);
      metrics.taskCompleted("task-3"); // evicts task-1

      expect(metrics.completedTaskCount).toBe(2);
      const completed = metrics.getCompletedTaskMetrics();
      expect(completed.map((t) => t.taskId)).toEqual(["task-2", "task-3"]);
    });
  });

  // -----------------------------------------------------------------------
  // Snapshot recording
  // -----------------------------------------------------------------------

  describe("recordSnapshot()", () => {
    it("records a snapshot and increments count", () => {
      const { metrics } = createMetrics();
      metrics.recordSnapshot({
        concurrentCount: 2,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.5,
        perTaskRss: [],
      });

      expect(metrics.snapshotCount).toBe(1);
    });

    it("evicts oldest snapshot when ring buffer is full", () => {
      const { metrics, advanceClock } = createMetrics({ maxSnapshots: 3 });

      recordSnapshots(metrics, advanceClock, 4, {
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 40,
        loadAvg1m: 1.0,
      });

      expect(metrics.snapshotCount).toBe(3);
    });

    it("updates per-task metrics from perTaskRss", () => {
      const { metrics } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);

      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.5,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });

      const active = metrics.getActiveTaskMetrics();
      expect(active).toHaveLength(1);
      expect(active[0]!.currentRssBytes).toBe(100 * MB);
      expect(active[0]!.peakRssBytes).toBe(100 * MB);
      expect(active[0]!.sampleCount).toBe(1);
    });

    it("tracks peak RSS per task", () => {
      const { metrics, advanceClock } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);

      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 60,
        loadAvg1m: 2.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 200 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 150 * MB,
        systemMemoryPercent: 55,
        loadAvg1m: 1.5,
        perTaskRss: [{ taskId: "task-1", rssBytes: 150 * MB }],
      });

      const active = metrics.getActiveTaskMetrics();
      expect(active[0]!.peakRssBytes).toBe(200 * MB);
      expect(active[0]!.currentRssBytes).toBe(150 * MB);
    });

    it("computes average RSS per task", () => {
      const { metrics, advanceClock } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);

      // 100MB + 200MB + 300MB = 600MB total, 3 samples → avg = 200MB
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 200 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 300 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 300 * MB }],
      });

      const active = metrics.getActiveTaskMetrics();
      expect(active[0]!.avgRssBytes).toBe(200 * MB);
    });

    it("tracks concurrent count during task execution", () => {
      const { metrics, advanceClock } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);

      // 3 snapshots: concurrent counts of 1, 2, 3 → avg = 2
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 2,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 55,
        loadAvg1m: 1.5,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 3,
        totalRssBytes: 300 * MB,
        systemMemoryPercent: 60,
        loadAvg1m: 2.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });

      const active = metrics.getActiveTaskMetrics();
      expect(active[0]!.avgConcurrentDuringExecution).toBe(2);
    });

    it("ignores perTaskRss for unknown tasks", () => {
      const { metrics } = createMetrics();
      // Record RSS for a task that wasn't registered
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "unknown", rssBytes: 100 * MB }],
      });

      expect(metrics.activeTaskCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  describe("getLatestSnapshot()", () => {
    it("returns zero-state when no snapshots recorded", () => {
      const { metrics } = createMetrics();
      const snapshot = metrics.getLatestSnapshot();

      expect(snapshot.concurrentCount).toBe(0);
      expect(snapshot.totalRssBytes).toBe(0);
      expect(snapshot.systemMemoryPercent).toBe(0);
      expect(snapshot.loadAvg1m).toBe(0);
      expect(snapshot.timestamp).toBeTruthy();
    });

    it("returns the most recent snapshot", () => {
      const { metrics, advanceClock } = createMetrics();

      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 40,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 3,
        totalRssBytes: 300 * MB,
        systemMemoryPercent: 60,
        loadAvg1m: 2.5,
        perTaskRss: [],
      });

      const latest = metrics.getLatestSnapshot();
      expect(latest.concurrentCount).toBe(3);
      expect(latest.totalRssBytes).toBe(300 * MB);
    });

    it("returns a copy (not a reference)", () => {
      const { metrics } = createMetrics();
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });

      const snap1 = metrics.getLatestSnapshot();
      snap1.concurrentCount = 999;
      const snap2 = metrics.getLatestSnapshot();
      expect(snap2.concurrentCount).toBe(1);
    });
  });

  describe("getSnapshots()", () => {
    it("returns empty array when nothing recorded", () => {
      const { metrics } = createMetrics();
      expect(metrics.getSnapshots()).toEqual([]);
    });

    it("returns all recorded snapshots", () => {
      const { metrics, advanceClock } = createMetrics();

      recordSnapshots(metrics, advanceClock, 5, {
        concurrentCount: 2,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.5,
      });

      expect(metrics.getSnapshots()).toHaveLength(5);
    });

    it("returns copies of snapshots", () => {
      const { metrics } = createMetrics();
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });

      const all = metrics.getSnapshots();
      all[0]!.concurrentCount = 999;
      expect(metrics.getSnapshots()[0]!.concurrentCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Utilization patterns
  // -----------------------------------------------------------------------

  describe("computePatterns()", () => {
    it("returns zero patterns when no snapshots", () => {
      const { metrics } = createMetrics();
      const patterns = metrics.computePatterns();

      expect(patterns.peakConcurrent).toBe(0);
      expect(patterns.avgConcurrent).toBe(0);
      expect(patterns.peakTotalRssBytes).toBe(0);
      expect(patterns.avgTotalRssBytes).toBe(0);
      expect(patterns.snapshotCount).toBe(0);
      expect(patterns.windowDurationMs).toBe(0);
    });

    it("computes peak and average concurrent count", () => {
      const { metrics, advanceClock } = createMetrics();

      // Simulate varying concurrency: 1, 3, 2
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 40,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 3,
        totalRssBytes: 300 * MB,
        systemMemoryPercent: 60,
        loadAvg1m: 3.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 2,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 2.0,
        perTaskRss: [],
      });

      const patterns = metrics.computePatterns();
      expect(patterns.peakConcurrent).toBe(3);
      expect(patterns.avgConcurrent).toBe(2); // (1+3+2)/3 = 2.0
      expect(patterns.snapshotCount).toBe(3);
    });

    it("computes peak and average RSS", () => {
      const { metrics, advanceClock } = createMetrics();

      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 40,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 300 * MB,
        systemMemoryPercent: 60,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });

      const patterns = metrics.computePatterns();
      expect(patterns.peakTotalRssBytes).toBe(300 * MB);
      expect(patterns.avgTotalRssBytes).toBe(200 * MB); // (100+300+200)/3 = 200
    });

    it("computes system memory percent patterns", () => {
      const { metrics, advanceClock } = createMetrics();

      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 30,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 60,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 90,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });

      const patterns = metrics.computePatterns();
      expect(patterns.peakSystemMemoryPercent).toBe(90);
      expect(patterns.avgSystemMemoryPercent).toBe(60); // (30+60+90)/3 = 60
    });

    it("computes load average patterns", () => {
      const { metrics, advanceClock } = createMetrics();

      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 4.0,
        perTaskRss: [],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [],
      });

      const patterns = metrics.computePatterns();
      expect(patterns.peakLoadAvg1m).toBe(4.0);
      expect(patterns.avgLoadAvg1m).toBe(2); // (1+4+1)/3 = 2.0
    });

    it("computes window duration from first to last snapshot", () => {
      const { metrics, advanceClock } = createMetrics();

      recordSnapshots(metrics, advanceClock, 5, {
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        intervalMs: 10_000,
      });

      const patterns = metrics.computePatterns();
      // 5 snapshots at 10s intervals = 40s window
      expect(patterns.windowDurationMs).toBe(40_000);
    });
  });

  // -----------------------------------------------------------------------
  // Task metrics queries
  // -----------------------------------------------------------------------

  describe("getActiveTaskMetrics()", () => {
    it("returns empty array when no active tasks", () => {
      const { metrics } = createMetrics();
      expect(metrics.getActiveTaskMetrics()).toEqual([]);
    });

    it("returns metrics for active tasks", () => {
      const { metrics, advanceClock } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);
      advanceClock(30_000);

      const active = metrics.getActiveTaskMetrics();
      expect(active).toHaveLength(1);
      expect(active[0]!.taskId).toBe("task-1");
      expect(active[0]!.taskTitle).toBe("Fix bug");
      expect(active[0]!.pid).toBe(1234);
      expect(active[0]!.durationMs).toBe(30_000);
      expect(active[0]!.completedAt).toBeUndefined();
    });

    it("returns zero averages when no samples collected", () => {
      const { metrics } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);

      const active = metrics.getActiveTaskMetrics();
      expect(active[0]!.avgRssBytes).toBe(0);
      expect(active[0]!.peakRssBytes).toBe(0);
      expect(active[0]!.avgConcurrentDuringExecution).toBe(0);
      expect(active[0]!.sampleCount).toBe(0);
    });
  });

  describe("getCompletedTaskMetrics()", () => {
    it("returns empty array when no completed tasks", () => {
      const { metrics } = createMetrics();
      expect(metrics.getCompletedTaskMetrics()).toEqual([]);
    });

    it("retains metrics after task completion", () => {
      const { metrics, advanceClock } = createMetrics();
      metrics.taskStarted("task-1", "Fix bug", 1234);

      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 200 * MB,
        systemMemoryPercent: 55,
        loadAvg1m: 1.2,
        perTaskRss: [{ taskId: "task-1", rssBytes: 200 * MB }],
      });
      advanceClock(10_000);

      metrics.taskCompleted("task-1");

      const completed = metrics.getCompletedTaskMetrics();
      expect(completed).toHaveLength(1);
      expect(completed[0]!.taskId).toBe("task-1");
      expect(completed[0]!.peakRssBytes).toBe(200 * MB);
      expect(completed[0]!.avgRssBytes).toBe(150 * MB); // (100+200)/2
      expect(completed[0]!.sampleCount).toBe(2);
      expect(completed[0]!.completedAt).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Full summary
  // -----------------------------------------------------------------------

  describe("getSummary()", () => {
    it("returns a complete summary with all sections", () => {
      const { metrics, advanceClock } = createMetrics();

      // Start a task and record some data
      metrics.taskStarted("task-1", "Fix bug", 1234);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.5,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      advanceClock(10_000);
      metrics.recordSnapshot({
        concurrentCount: 2,
        totalRssBytes: 250 * MB,
        systemMemoryPercent: 55,
        loadAvg1m: 2.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 150 * MB }],
      });

      const summary = metrics.getSummary();

      // Current snapshot
      expect(summary.current.concurrentCount).toBe(2);
      expect(summary.current.totalRssBytes).toBe(250 * MB);

      // Patterns
      expect(summary.patterns.peakConcurrent).toBe(2);
      expect(summary.patterns.snapshotCount).toBe(2);

      // Active tasks
      expect(summary.activeTasks).toHaveLength(1);
      expect(summary.activeTasks[0]!.taskId).toBe("task-1");

      // Completed tasks (none yet)
      expect(summary.completedTasks).toEqual([]);

      // Timestamp
      expect(summary.timestamp).toBeTruthy();
    });

    it("includes completed tasks in summary", () => {
      const { metrics, advanceClock } = createMetrics();

      metrics.taskStarted("task-1", "Fix bug", 1234);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      advanceClock(10_000);
      metrics.taskCompleted("task-1");

      metrics.taskStarted("task-2", "Add feature", 5678);

      const summary = metrics.getSummary();
      expect(summary.activeTasks).toHaveLength(1);
      expect(summary.activeTasks[0]!.taskId).toBe("task-2");
      expect(summary.completedTasks).toHaveLength(1);
      expect(summary.completedTasks[0]!.taskId).toBe("task-1");
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  describe("reset()", () => {
    it("clears all metrics data", () => {
      const { metrics, advanceClock } = createMetrics();

      metrics.taskStarted("task-1", "Fix bug", 1234);
      recordSnapshots(metrics, advanceClock, 5, {
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 50,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });
      metrics.taskCompleted("task-1");

      metrics.reset();

      expect(metrics.snapshotCount).toBe(0);
      expect(metrics.activeTaskCount).toBe(0);
      expect(metrics.completedTaskCount).toBe(0);
      expect(metrics.getSnapshots()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Integration-style test: full lifecycle
  // -----------------------------------------------------------------------

  describe("full lifecycle", () => {
    it("tracks concurrent execution across multiple tasks", () => {
      const { metrics, advanceClock } = createMetrics();

      // Task 1 starts
      metrics.taskStarted("task-1", "Fix bug", 1001);
      metrics.recordSnapshot({
        concurrentCount: 1,
        totalRssBytes: 100 * MB,
        systemMemoryPercent: 40,
        loadAvg1m: 1.0,
        perTaskRss: [{ taskId: "task-1", rssBytes: 100 * MB }],
      });

      advanceClock(10_000);

      // Task 2 starts (now concurrent)
      metrics.taskStarted("task-2", "Add feature", 1002);
      metrics.recordSnapshot({
        concurrentCount: 2,
        totalRssBytes: 250 * MB,
        systemMemoryPercent: 55,
        loadAvg1m: 2.0,
        perTaskRss: [
          { taskId: "task-1", rssBytes: 120 * MB },
          { taskId: "task-2", rssBytes: 130 * MB },
        ],
      });

      advanceClock(10_000);

      // Task 3 starts (3 concurrent)
      metrics.taskStarted("task-3", "Write tests", 1003);
      metrics.recordSnapshot({
        concurrentCount: 3,
        totalRssBytes: 400 * MB,
        systemMemoryPercent: 65,
        loadAvg1m: 3.0,
        perTaskRss: [
          { taskId: "task-1", rssBytes: 130 * MB },
          { taskId: "task-2", rssBytes: 140 * MB },
          { taskId: "task-3", rssBytes: 130 * MB },
        ],
      });

      advanceClock(10_000);

      // Task 1 completes
      metrics.taskCompleted("task-1");
      metrics.recordSnapshot({
        concurrentCount: 2,
        totalRssBytes: 280 * MB,
        systemMemoryPercent: 55,
        loadAvg1m: 2.5,
        perTaskRss: [
          { taskId: "task-2", rssBytes: 145 * MB },
          { taskId: "task-3", rssBytes: 135 * MB },
        ],
      });

      // Verify patterns
      const patterns = metrics.computePatterns();
      expect(patterns.peakConcurrent).toBe(3);
      expect(patterns.peakTotalRssBytes).toBe(400 * MB);

      // Verify active tasks
      expect(metrics.activeTaskCount).toBe(2);
      const active = metrics.getActiveTaskMetrics();
      const task2 = active.find((t) => t.taskId === "task-2");
      expect(task2).toBeDefined();
      expect(task2!.peakRssBytes).toBe(145 * MB);
      expect(task2!.sampleCount).toBe(3); // appeared in 3 snapshots

      // Verify completed task
      expect(metrics.completedTaskCount).toBe(1);
      const completed = metrics.getCompletedTaskMetrics();
      expect(completed[0]!.taskId).toBe("task-1");
      expect(completed[0]!.peakRssBytes).toBe(130 * MB);
      // Task 1 avg concurrent: (1 + 2 + 3) / 3 = 2.0
      expect(completed[0]!.avgConcurrentDuringExecution).toBe(2);

      // Full summary
      const summary = metrics.getSummary();
      expect(summary.current.concurrentCount).toBe(2);
      expect(summary.patterns.snapshotCount).toBe(4);
      expect(summary.activeTasks).toHaveLength(2);
      expect(summary.completedTasks).toHaveLength(1);
    });
  });
});
