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
  opts?: {
    startTime?: number;
    maxSamples?: number;
    maxCompletedHistories?: number;
    rssWarningBytes?: number;
  },
): { tracker: ProcessMemoryTracker; advanceClock: (ms: number) => void } {
  let currentTime = opts?.startTime ?? 1_700_000_000_000;

  const tracker = new ProcessMemoryTracker(
    {
      maxSamples: opts?.maxSamples,
      maxCompletedHistories: opts?.maxCompletedHistories,
      rssWarningBytes: opts?.rssWarningBytes,
    },
    { now: () => currentTime },
  );

  return {
    tracker,
    advanceClock: (ms: number) => { currentTime += ms; },
  };
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
      expect(tracker.config.maxCompletedHistories).toBe(
        DEFAULT_PROCESS_MEMORY_TRACKER_CONFIG.maxCompletedHistories,
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
      expect(cfg.maxCompletedHistories).toBe(20);
      expect(cfg.rssWarningBytes).toBe(512 * MB);
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
  // Leak detection (RSS threshold)
  // -------------------------------------------------------------------------

  describe("detectLeaks()", () => {
    it("returns healthy when no processes are tracked", () => {
      const { tracker } = createTracker();
      const summary = tracker.detectLeaks();

      expect(summary.activeProcesses).toBe(0);
      expect(summary.leaks).toEqual([]);
      expect(summary.health).toBe("healthy");
    });

    it("returns healthy when RSS is below threshold", () => {
      const { tracker } = createTracker({ rssWarningBytes: 512 * MB });

      tracker.recordSample("task-1", "Test", 1234, 100 * MB);

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toEqual([]);
      expect(summary.health).toBe("healthy");
    });

    it("flags process when RSS exceeds threshold", () => {
      const { tracker } = createTracker({ rssWarningBytes: 256 * MB });

      tracker.recordSample("task-1", "Test", 1234, 300 * MB);

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toHaveLength(1);
      expect(summary.leaks[0]!.taskId).toBe("task-1");
      expect(summary.leaks[0]!.trend.isLeaking).toBe(true);
      expect(summary.leaks[0]!.trend.description).toContain("exceeds");
      expect(summary.health).toBe("warning");
    });

    it("does not flag stable low-memory process", () => {
      const { tracker, advanceClock } = createTracker({ rssWarningBytes: 512 * MB });

      // Stable memory well below threshold
      for (let i = 0; i < 10; i++) {
        if (i > 0) advanceClock(10_000);
        tracker.recordSample("task-1", "Stable", 1234, 50 * MB);
      }

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toEqual([]);
      expect(summary.health).toBe("healthy");
    });

    it("only analyzes active processes", () => {
      const { tracker } = createTracker({ rssWarningBytes: 256 * MB });

      // Record a high-RSS process then complete it
      tracker.recordSample("task-1", "Test", 1234, 300 * MB);
      tracker.markCompleted("task-1");

      const summary = tracker.detectLeaks();
      expect(summary.leaks).toEqual([]);
      expect(summary.completedProcesses).toBe(1);
    });

    it("includes tracking duration in report", () => {
      const { tracker, advanceClock } = createTracker({ rssWarningBytes: 256 * MB });

      tracker.recordSample("task-1", "Test", 1234, 300 * MB);
      advanceClock(60_000); // 60 seconds
      tracker.recordSample("task-1", "Test", 1234, 350 * MB);

      const summary = tracker.detectLeaks();
      const leak = summary.leaks[0]!;
      expect(leak.trackingDurationSec).toBe(60);
    });
  });

  // -------------------------------------------------------------------------
  // getLeakAlerts()
  // -------------------------------------------------------------------------

  describe("getLeakAlerts()", () => {
    it("returns empty array when no warnings", () => {
      const { tracker } = createTracker();
      expect(tracker.getLeakAlerts()).toEqual([]);
    });

    it("returns reports when RSS exceeds threshold", () => {
      const { tracker } = createTracker({ rssWarningBytes: 256 * MB });

      tracker.recordSample("task-1", "Test", 1234, 300 * MB);

      const alerts = tracker.getLeakAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.taskId).toBe("task-1");
    });
  });

  // -------------------------------------------------------------------------
  // Memory trend
  // -------------------------------------------------------------------------

  describe("trend", () => {
    it("returns trend showing normal range for low RSS", () => {
      const { tracker } = createTracker({ rssWarningBytes: 512 * MB });

      tracker.recordSample("task-1", "Test", 1234, 50 * MB);

      const history = tracker.getHistory("task-1");
      expect(history!.trend).toBeDefined();
      expect(history!.trend!.isLeaking).toBe(false);
      expect(history!.trend!.description).toContain("normal range");
    });

    it("returns trend showing warning for high RSS", () => {
      const { tracker } = createTracker({ rssWarningBytes: 256 * MB });

      tracker.recordSample("task-1", "Test", 1234, 300 * MB);

      const history = tracker.getHistory("task-1");
      expect(history!.trend).toBeDefined();
      expect(history!.trend!.isLeaking).toBe(true);
      expect(history!.trend!.description).toContain("exceeds");
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
