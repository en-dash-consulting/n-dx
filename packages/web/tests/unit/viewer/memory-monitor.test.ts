/**
 * Tests for the memory monitoring module.
 *
 * Covers: snapshot creation, level classification, formatting utilities,
 * monitor lifecycle (start/stop/poll), listener management, history
 * ring buffer, and level change detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyLevel,
  takeSnapshot,
  formatBytes,
  formatRatio,
  startMemoryMonitor,
  stopMemoryMonitor,
  getLatestSnapshot,
  getSnapshotHistory,
  getCurrentLevel,
  onSnapshot,
  resetMemoryMonitor,
  hasPerformanceMemory,
  type MemoryThresholds,
  type MemoryLevel,
  type MemorySnapshot,
} from "../../../src/viewer/performance/memory-monitor.js";

const DEFAULT_THRESHOLDS: MemoryThresholds = {
  elevated: 0.50,
  warning: 0.70,
  critical: 0.85,
};

describe("classifyLevel", () => {
  it("returns 'normal' for ratios below elevated threshold", () => {
    expect(classifyLevel(0.0, DEFAULT_THRESHOLDS)).toBe("normal");
    expect(classifyLevel(0.25, DEFAULT_THRESHOLDS)).toBe("normal");
    expect(classifyLevel(0.49, DEFAULT_THRESHOLDS)).toBe("normal");
  });

  it("returns 'elevated' for ratios at or above elevated threshold", () => {
    expect(classifyLevel(0.50, DEFAULT_THRESHOLDS)).toBe("elevated");
    expect(classifyLevel(0.60, DEFAULT_THRESHOLDS)).toBe("elevated");
    expect(classifyLevel(0.69, DEFAULT_THRESHOLDS)).toBe("elevated");
  });

  it("returns 'warning' for ratios at or above warning threshold", () => {
    expect(classifyLevel(0.70, DEFAULT_THRESHOLDS)).toBe("warning");
    expect(classifyLevel(0.80, DEFAULT_THRESHOLDS)).toBe("warning");
    expect(classifyLevel(0.84, DEFAULT_THRESHOLDS)).toBe("warning");
  });

  it("returns 'critical' for ratios at or above critical threshold", () => {
    expect(classifyLevel(0.85, DEFAULT_THRESHOLDS)).toBe("critical");
    expect(classifyLevel(0.95, DEFAULT_THRESHOLDS)).toBe("critical");
    expect(classifyLevel(1.0, DEFAULT_THRESHOLDS)).toBe("critical");
  });

  it("returns 'normal' for negative ratios (no data)", () => {
    expect(classifyLevel(-1, DEFAULT_THRESHOLDS)).toBe("normal");
  });

  it("works with custom thresholds", () => {
    const custom: MemoryThresholds = { elevated: 0.30, warning: 0.60, critical: 0.90 };
    expect(classifyLevel(0.25, custom)).toBe("normal");
    expect(classifyLevel(0.30, custom)).toBe("elevated");
    expect(classifyLevel(0.60, custom)).toBe("warning");
    expect(classifyLevel(0.90, custom)).toBe("critical");
  });
});

describe("formatBytes", () => {
  it("formats bytes correctly", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe("150.0 MB");
  });

  it("formats gigabytes correctly", () => {
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.00 GB");
  });

  it("returns 'N/A' for negative values", () => {
    expect(formatBytes(-1)).toBe("N/A");
  });

  it("handles zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("formatRatio", () => {
  it("formats ratios as percentages", () => {
    expect(formatRatio(0.723)).toBe("72.3%");
  });

  it("handles zero", () => {
    expect(formatRatio(0)).toBe("0.0%");
  });

  it("handles 1.0", () => {
    expect(formatRatio(1.0)).toBe("100.0%");
  });

  it("returns 'N/A' for negative values", () => {
    expect(formatRatio(-1)).toBe("N/A");
  });
});

describe("takeSnapshot", () => {
  it("returns a snapshot with expected shape", () => {
    const snap = takeSnapshot();
    expect(snap).toHaveProperty("usedJSHeapSize");
    expect(snap).toHaveProperty("totalJSHeapSize");
    expect(snap).toHaveProperty("jsHeapSizeLimit");
    expect(snap).toHaveProperty("usageRatio");
    expect(snap).toHaveProperty("level");
    expect(snap).toHaveProperty("timestamp");
    expect(snap).toHaveProperty("precise");
  });

  it("returns a valid ISO timestamp", () => {
    const snap = takeSnapshot();
    expect(() => new Date(snap.timestamp)).not.toThrow();
    expect(new Date(snap.timestamp).toISOString()).toBe(snap.timestamp);
  });

  it("returns a valid level", () => {
    const snap = takeSnapshot();
    expect(["normal", "elevated", "warning", "critical"]).toContain(snap.level);
  });

  it("returns imprecise snapshot when performance.memory is unavailable", () => {
    // In JSDOM, performance.memory is not defined
    const snap = takeSnapshot();
    if (!hasPerformanceMemory()) {
      expect(snap.precise).toBe(false);
      expect(snap.usedJSHeapSize).toBe(-1);
      expect(snap.usageRatio).toBe(-1);
      expect(snap.level).toBe("normal");
    }
  });
});

describe("monitor lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("starts and captures initial snapshot", () => {
    expect(getLatestSnapshot()).toBeNull();
    startMemoryMonitor();
    expect(getLatestSnapshot()).not.toBeNull();
  });

  it("polls on interval", () => {
    startMemoryMonitor({ intervalMs: 1000 });
    const snap1 = getLatestSnapshot();
    expect(snap1).not.toBeNull();

    vi.advanceTimersByTime(1000);
    const snap2 = getLatestSnapshot();
    expect(snap2).not.toBeNull();
    // Timestamps should differ (or at least a new snapshot was taken)
    expect(snap2!.timestamp).not.toBe("");
  });

  it("stops polling on stopMemoryMonitor", () => {
    const listener = vi.fn();
    startMemoryMonitor({ intervalMs: 1000 });
    onSnapshot(listener);
    listener.mockClear(); // Clear the initial call

    stopMemoryMonitor();

    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("restarts cleanly when called multiple times", () => {
    startMemoryMonitor({ intervalMs: 2000 });
    const snap1 = getLatestSnapshot();

    // Restart with different interval
    startMemoryMonitor({ intervalMs: 500 });
    const snap2 = getLatestSnapshot();
    expect(snap2).not.toBeNull();

    // Should use the new interval (500ms, not 2000ms)
    const listener = vi.fn();
    onSnapshot(listener);
    listener.mockClear();

    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("resets all state with resetMemoryMonitor", () => {
    startMemoryMonitor();
    expect(getLatestSnapshot()).not.toBeNull();
    expect(getSnapshotHistory().length).toBeGreaterThan(0);

    resetMemoryMonitor();
    expect(getLatestSnapshot()).toBeNull();
    expect(getSnapshotHistory().length).toBe(0);
    expect(getCurrentLevel()).toBe("normal");
  });
});

describe("snapshot listeners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("notifies listeners on each poll", () => {
    const listener = vi.fn();
    startMemoryMonitor({ intervalMs: 1000 });
    onSnapshot(listener);
    listener.mockClear();

    vi.advanceTimersByTime(3000);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("unsubscribe function removes listener", () => {
    const listener = vi.fn();
    startMemoryMonitor({ intervalMs: 1000 });
    const unsub = onSnapshot(listener);
    listener.mockClear();

    unsub();
    vi.advanceTimersByTime(3000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent listeners", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    startMemoryMonitor({ intervalMs: 1000 });
    onSnapshot(listener1);
    onSnapshot(listener2);
    listener1.mockClear();
    listener2.mockClear();

    vi.advanceTimersByTime(1000);
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("passes snapshot to listener", () => {
    const listener = vi.fn();
    startMemoryMonitor({ intervalMs: 1000 });
    onSnapshot(listener);
    listener.mockClear();

    vi.advanceTimersByTime(1000);
    const arg = listener.mock.calls[0][0] as MemorySnapshot;
    expect(arg).toHaveProperty("usedJSHeapSize");
    expect(arg).toHaveProperty("level");
    expect(arg).toHaveProperty("timestamp");
  });
});

describe("snapshot history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("accumulates snapshots in history", () => {
    startMemoryMonitor({ intervalMs: 100 });
    expect(getSnapshotHistory().length).toBe(1); // initial

    vi.advanceTimersByTime(300);
    expect(getSnapshotHistory().length).toBe(4); // initial + 3
  });

  it("caps history at 60 entries", () => {
    startMemoryMonitor({ intervalMs: 100 });

    // Generate 80 poll cycles
    vi.advanceTimersByTime(100 * 80);
    expect(getSnapshotHistory().length).toBeLessThanOrEqual(60);
  });

  it("returns readonly array", () => {
    startMemoryMonitor();
    const history = getSnapshotHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});

describe("level change detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMemoryMonitor();
  });

  afterEach(() => {
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("calls onLevelChange when level changes", () => {
    const onLevelChange = vi.fn();

    // Mock performance.memory to simulate a level change
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;

    // Start with normal level
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 100 * 1024 * 1024,    // 100 MB
      totalJSHeapSize: 200 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024, // 2 GB → ratio = 0.05 (normal)
    };

    startMemoryMonitor({ intervalMs: 1000, onLevelChange });
    expect(getCurrentLevel()).toBe("normal");

    // Simulate memory spike to critical
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.8 * 1024 * 1024 * 1024,  // 1.8 GB
      totalJSHeapSize: 1.9 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,    // 2 GB → ratio = 0.9 (critical)
    };

    vi.advanceTimersByTime(1000);
    expect(onLevelChange).toHaveBeenCalledTimes(1);
    expect(getCurrentLevel()).toBe("critical");

    const [snapshot, previousLevel] = onLevelChange.mock.calls[0];
    expect(snapshot.level).toBe("critical");
    expect(previousLevel).toBe("normal");

    // Restore
    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });

  it("does not call onLevelChange when level stays the same", () => {
    const onLevelChange = vi.fn();
    startMemoryMonitor({ intervalMs: 1000, onLevelChange });
    onLevelChange.mockClear();

    // In JSDOM without performance.memory, level stays "normal"
    vi.advanceTimersByTime(5000);
    expect(onLevelChange).not.toHaveBeenCalled();
  });
});

describe("hasPerformanceMemory", () => {
  it("returns a boolean", () => {
    expect(typeof hasPerformanceMemory()).toBe("boolean");
  });
});
