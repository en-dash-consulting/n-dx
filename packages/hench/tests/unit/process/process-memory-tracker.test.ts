import { describe, it, expect, beforeEach } from "vitest";
import {
  ProcessMemoryTracker,
  DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG,
} from "../../../src/process/process-memory-tracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

/**
 * Create a tracker with an injectable clock for deterministic tests.
 */
function createTracker(
  config?: Parameters<typeof ProcessMemoryTracker.prototype.recordSample extends (...args: infer _P) => void ? never : never>,
  opts?: {
    startTime?: number;
    maxSamples?: number;
    minSamplesForLeakDetection?: number;
    leakSlopeThreshold?: number;
    leakRSquaredThreshold?: number;
    maxCompletedHistories?: number;
  },
): { tracker: ProcessMemoryTracker; advanceClock: (ms: number) => void } {
  let currentTime = opts?.startTime ?? 1_700_000_000_000;

  const tracker = new ProcessMemoryTracker(
    {
      maxSamples: opts?.maxSamples,
      minSamplesForLeakDetection: opts?.minSamplesForLeakDetection,
      leakSlopeThreshold: opts?.leakSlopeThreshold,
      leakRSquaredThreshold: opts?.leakRSquaredThreshold,
      maxCompletedHistories: opts?.maxCompletedHistories,
    },
    { now: () => currentTime },
  );

  return {
    tracker,
    advanceClock: (ms: number) => { currentTime += ms; },
  };
}

/**
 * Record a series of samples with linearly growing RSS to simulate a leak.
 */
function recordLinearGrowth(
  tracker: ProcessMemoryTracker,
  advanceClock: (ms: number) => void,
  taskId: string,
  count: number,
  baseRss: number,
  growthPerSample: number,
  intervalMs: number = 10_000,
): void {
  for (let i = 0; i < count; i++) {
    if (i > 0) advanceClock(intervalMs);
    const rss = baseRss + i * growthPerSample;
    tracker.recordSample(taskId, "Test task", 1234, rss);
  }
}

// ---------------------------------------------------------------------------
// Constructor & defaults
// ---------------------------------------------------------------------------

describe("ProcessMemoryTracker", () => {
  describe("constructor", () => {
    it("creates with default config when no options provided", () => {
      const tracker = new ProcessMemoryTracker();
      expect(tracker.config).toEqual(DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG);
    });

    it("merges partial config with defaults", () => {
      const tracker = new ProcessMemoryTracker({ maxSamples: 100 });
      expect(tracker.config.maxSamples).toBe(100);
      expect(tracker.config.minSamplesForLeakDetection).toBe(
        DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG.minSamplesForLeakDetection,
      );
    });

    it("starts with zero active and completed counts", () => {
      const tracker = new ProcessMemoryTracker();
      expect(tracker.activeCount).toBe(0);
      expect(tracker.completedCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG
  // -------------------------------------------------------------------------

  describe("DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG", () => {
    it("has sensible defaults", () => {
      const cfg = DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG;
      expect(cfg.maxSamples).toBe(360);
      expect(cfg.minSamplesForLeakDetection).toBe(6);
      expect(cfg.leakSlopeThreshold).toBe(100 * 1024); // 100 KB/s
      expect(cfg.leakRSquaredThreshold).toBe(0.7);
      expect(cfg.maxCompletedHistories).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // Sample recording
  // -------------------------------------------------------------------------

  describe("recordSample()", () => {
    let tracker: ProcessMemoryTracker;

    beforeEach(() => {
      ({ tracker } = createTracker());
    });

    it("creates a new entry on first sample", () => {
      tracker.recordSample("task-1", "Test task", 1234, 50 * MB);
      expect(tracker.activeCount).toBe(1);

      const history = tracker.getHistory("task-1");
      expect(history).toBeDefined();
      expect(history!.taskId).toBe("task-1");
      expect(history!.taskTitle).toBe("Test task");
      expect(history!.pid).toBe(1234);
      expect(history!.samples).toHaveLength(1);
      expect(history!.samples[0]!.rssBytes).toBe(50 * MB);
    });

    it("appends to existing entry on subsequent samples", () => {
      tracker.recordSample("task-1", "Test task", 1234, 50 * MB);
      tracker.recordSample("task-1", "Test task", 1234, 55 * MB);
      tracker.recordSample("task-1", "Test task", 1234, 60 * MB);

      const history = tracker.getHistory("task-1");
      expect(history!.samples).toHaveLength(3);
      expect(history!.samples[2]!.rssBytes).toBe(60 * MB);
    });

    it("tracks multiple processes independently", () => {
      tracker.recordSample("task-1", "Task 1", 1001, 50 * MB);
      tracker.recordSample("task-2", "Task 2", 1002, 80 * MB);

      expect(tracker.activeCount).toBe(2);
      expect(tracker.getHistory("task-1")!.pid).toBe(1001);
      expect(tracker.getHistory("task-2")!.pid).toBe(1002);
    });

    it("tracks peak RSS", () => {
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      tracker.recordSample("task-1", "Test", 1234, 80 * MB); // peak
      tracker.recordSample("task-1", "Test", 1234, 60 * MB);

      const history = tracker.getHistory("task-1");
      expect(history!.peakRssBytes).toBe(80 * MB);
      expect(history!.currentRssBytes).toBe(60 * MB);
    });

    it("evicts oldest sample when ring buffer is full", () => {
      const { tracker: t } = createTracker({ maxSamples: 3 });

      t.recordSample("task-1", "Test", 1234, 10 * MB);
      t.recordSample("task-1", "Test", 1234, 20 * MB);
      t.recordSample("task-1", "Test", 1234, 30 * MB);
      t.recordSample("task-1", "Test", 1234, 40 * MB); // evicts 10MB

      const history = t.getHistory("task-1");
      expect(history!.samples).toHaveLength(3);
      expect(history!.samples[0]!.rssBytes).toBe(20 * MB);
      expect(history!.samples[2]!.rssBytes).toBe(40 * MB);
    });

    it("updates PID when it changes", () => {
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      tracker.recordSample("task-1", "Test", 5678, 55 * MB);

      const history = tracker.getHistory("task-1");
      expect(history!.pid).toBe(5678);
    });

    it("records valid ISO timestamps", () => {
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);

      const history = tracker.getHistory("task-1");
      expect(history!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(history!.samples[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // -------------------------------------------------------------------------
  // Process lifecycle
  // -------------------------------------------------------------------------

  describe("markCompleted()", () => {
    it("moves process from active to completed", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      expect(tracker.activeCount).toBe(1);
      expect(tracker.completedCount).toBe(0);

      tracker.markCompleted("task-1");
      expect(tracker.activeCount).toBe(0);
      expect(tracker.completedCount).toBe(1);
    });

    it("retains history after completion", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      tracker.recordSample("task-1", "Test", 1234, 55 * MB);
      tracker.markCompleted("task-1");

      const history = tracker.getHistory("task-1");
      expect(history).toBeDefined();
      expect(history!.samples).toHaveLength(2);
      expect(history!.endedAt).toBeTruthy();
    });

    it("evicts oldest completed when over limit", () => {
      const { tracker } = createTracker({ maxCompletedHistories: 2 });

      tracker.recordSample("task-1", "Task 1", 1001, 50 * MB);
      tracker.markCompleted("task-1");

      tracker.recordSample("task-2", "Task 2", 1002, 60 * MB);
      tracker.markCompleted("task-2");

      tracker.recordSample("task-3", "Task 3", 1003, 70 * MB);
      tracker.markCompleted("task-3"); // evicts task-1

      expect(tracker.completedCount).toBe(2);
      expect(tracker.getHistory("task-1")).toBeUndefined();
      expect(tracker.getHistory("task-2")).toBeDefined();
      expect(tracker.getHistory("task-3")).toBeDefined();
    });

    it("no-ops for unknown taskId", () => {
      const { tracker } = createTracker();
      tracker.markCompleted("nonexistent");
      expect(tracker.completedCount).toBe(0);
    });
  });

  describe("remove()", () => {
    it("removes a process without retaining history", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      tracker.remove("task-1");

      expect(tracker.activeCount).toBe(0);
      expect(tracker.completedCount).toBe(0);
      expect(tracker.getHistory("task-1")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // History queries
  // -------------------------------------------------------------------------

  describe("getHistory()", () => {
    it("returns undefined for unknown taskId", () => {
      const { tracker } = createTracker();
      expect(tracker.getHistory("unknown")).toBeUndefined();
    });

    it("searches both active and completed processes", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Active", 1001, 50 * MB);
      tracker.recordSample("task-2", "Completed", 1002, 60 * MB);
      tracker.markCompleted("task-2");

      expect(tracker.getHistory("task-1")).toBeDefined();
      expect(tracker.getHistory("task-2")).toBeDefined();
    });

    it("returns a copy of samples (not a reference)", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);

      const history = tracker.getHistory("task-1")!;
      history.samples.push({
        rssBytes: 999,
        timestamp: "2024-01-01T00:00:00Z",
        epochMs: 0,
      });

      // Original should still have only 1 sample
      expect(tracker.getHistory("task-1")!.samples).toHaveLength(1);
    });
  });

  describe("getAllHistories()", () => {
    it("returns empty array when nothing tracked", () => {
      const { tracker } = createTracker();
      expect(tracker.getAllHistories()).toEqual([]);
    });

    it("includes both active and completed", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Active", 1001, 50 * MB);
      tracker.recordSample("task-2", "Completed", 1002, 60 * MB);
      tracker.markCompleted("task-2");

      const all = tracker.getAllHistories();
      expect(all).toHaveLength(2);
      expect(all.map((h) => h.taskId).sort()).toEqual(["task-1", "task-2"]);
    });
  });

  describe("getActiveHistories()", () => {
    it("returns only active processes", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Active", 1001, 50 * MB);
      tracker.recordSample("task-2", "Completed", 1002, 60 * MB);
      tracker.markCompleted("task-2");

      const active = tracker.getActiveHistories();
      expect(active).toHaveLength(1);
      expect(active[0]!.taskId).toBe("task-1");
    });
  });

  // -------------------------------------------------------------------------
  // Leak detection
  // -------------------------------------------------------------------------

  describe("detectLeaks()", () => {
    it("returns healthy when no processes are tracked", () => {
      const { tracker } = createTracker();
      const summary = tracker.detectLeaks();

      expect(summary.activeProcesses).toBe(0);
      expect(summary.leaks).toEqual([]);
      expect(summary.health).toBe("healthy");
    });

    it("returns healthy when process has too few samples", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
      });

      // Only 3 samples — not enough for leak detection
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      advanceClock(10_000);
      tracker.recordSample("task-1", "Test", 1234, 60 * MB);
      advanceClock(10_000);
      tracker.recordSample("task-1", "Test", 1234, 70 * MB);

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toEqual([]);
      expect(summary.health).toBe("healthy");
    });

    it("detects a clear memory leak", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 1024, // 1 KB/s — low threshold for test
        leakRSquaredThreshold: 0.7,
      });

      // Simulate 200 KB/s growth over 10 samples at 10s intervals
      // growth = 2MB per 10s = ~200KB/s
      recordLinearGrowth(tracker, advanceClock, "task-1", 10, 50 * MB, 2 * MB, 10_000);

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toHaveLength(1);
      expect(summary.leaks[0]!.taskId).toBe("task-1");
      expect(summary.leaks[0]!.trend.isLeaking).toBe(true);
      expect(summary.leaks[0]!.trend.slopeBytesSec).toBeGreaterThan(0);
      expect(summary.leaks[0]!.trend.rSquared).toBeGreaterThan(0.9);
      expect(summary.health).not.toBe("healthy");
    });

    it("does not flag stable memory as a leak", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 100 * 1024,
        leakRSquaredThreshold: 0.7,
      });

      // Stable memory: all samples at ~50MB with tiny alternating jitter
      const base = 50 * MB;
      for (let i = 0; i < 10; i++) {
        if (i > 0) advanceClock(10_000);
        const jitter = (i % 2 === 0 ? 1 : -1) * 100;
        tracker.recordSample("task-1", "Stable", 1234, base + jitter);
      }

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toEqual([]);
      expect(summary.health).toBe("healthy");
    });

    it("classifies severe leaks correctly", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 1024,
        leakRSquaredThreshold: 0.7,
      });

      // Severe: >1MB/s growth — 10 MB per 10s interval = 1 MB/s
      recordLinearGrowth(tracker, advanceClock, "task-1", 10, 50 * MB, 10 * MB, 10_000);

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toHaveLength(1);
      expect(summary.leaks[0]!.severity).toBe("severe");
      expect(summary.health).toBe("critical");
    });

    it("only analyzes active processes", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 1024,
        leakRSquaredThreshold: 0.7,
      });

      // Record a leaking process then complete it
      recordLinearGrowth(tracker, advanceClock, "task-1", 10, 50 * MB, 2 * MB, 10_000);
      tracker.markCompleted("task-1");

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toEqual([]);
      expect(summary.completedProcesses).toBe(1);
    });

    it("includes projected RSS at +1 hour", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 1024,
        leakRSquaredThreshold: 0.7,
      });

      recordLinearGrowth(tracker, advanceClock, "task-1", 10, 50 * MB, 2 * MB, 10_000);

      const summary = tracker.detectLeaks();
      const leak = summary.leaks[0]!;
      expect(leak.projectedRss1hBytes).toBeGreaterThan(leak.currentRssBytes);
    });
  });

  // -------------------------------------------------------------------------
  // getLeakAlerts()
  // -------------------------------------------------------------------------

  describe("getLeakAlerts()", () => {
    it("returns empty array when no leaks", () => {
      const { tracker } = createTracker();
      expect(tracker.getLeakAlerts()).toEqual([]);
    });

    it("returns leak reports when leaks detected", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 1024,
        leakRSquaredThreshold: 0.7,
      });

      recordLinearGrowth(tracker, advanceClock, "task-1", 10, 50 * MB, 2 * MB, 10_000);

      const alerts = tracker.getLeakAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.taskId).toBe("task-1");
    });
  });

  // -------------------------------------------------------------------------
  // Memory trend analysis
  // -------------------------------------------------------------------------

  describe("trend analysis", () => {
    it("returns undefined trend when insufficient samples", () => {
      const { tracker } = createTracker({
        minSamplesForLeakDetection: 6,
      });

      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      tracker.recordSample("task-1", "Test", 1234, 55 * MB);

      const history = tracker.getHistory("task-1");
      expect(history!.trend).toBeUndefined();
    });

    it("computes trend with description for growing memory", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 1024,
        leakRSquaredThreshold: 0.7,
      });

      recordLinearGrowth(tracker, advanceClock, "task-1", 10, 50 * MB, 2 * MB, 10_000);

      const history = tracker.getHistory("task-1");
      expect(history!.trend).toBeDefined();
      expect(history!.trend!.isLeaking).toBe(true);
      expect(history!.trend!.description).toContain("potential leak");
    });

    it("describes stable memory as within normal range", () => {
      const { tracker, advanceClock } = createTracker({
        minSamplesForLeakDetection: 6,
        leakSlopeThreshold: 100 * 1024, // 100 KB/s threshold
        leakRSquaredThreshold: 0.7,
      });

      // Slight growth under threshold: 1KB per 10s = 0.1 KB/s
      const base = 50 * MB;
      for (let i = 0; i < 10; i++) {
        if (i > 0) advanceClock(10_000);
        tracker.recordSample("task-1", "Test", 1234, base + i * 1024);
      }

      const history = tracker.getHistory("task-1");
      expect(history!.trend).toBeDefined();
      expect(history!.trend!.isLeaking).toBe(false);
      expect(history!.trend!.description).not.toContain("potential leak");
    });
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("clears all tracking data", () => {
      const { tracker } = createTracker();
      tracker.recordSample("task-1", "Test", 1234, 50 * MB);
      tracker.recordSample("task-2", "Test", 5678, 60 * MB);
      tracker.markCompleted("task-2");

      tracker.reset();

      expect(tracker.activeCount).toBe(0);
      expect(tracker.completedCount).toBe(0);
      expect(tracker.getHistory("task-1")).toBeUndefined();
      expect(tracker.getHistory("task-2")).toBeUndefined();
    });
  });
});
