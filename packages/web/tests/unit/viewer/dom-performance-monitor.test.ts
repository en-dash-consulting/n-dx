// @vitest-environment jsdom
/**
 * Tests for the DOM performance monitoring module.
 *
 * Covers: DOM node counting, render timing recording, update comparisons,
 * memory reading, formatting utilities, monitor lifecycle (start/stop/poll),
 * listener management, history ring buffers, summary computation, and
 * the measureOperation wrapper.
 *
 * @see ../../../src/viewer/dom-performance-monitor.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  countDOMNodes,
  readHeapUsage,
  formatDuration,
  formatNodeCount,
  formatDelta,
  recordRender,
  recordUpdate,
  measureOperation,
  takeDOMSnapshot,
  computeSummary,
  startDOMPerformanceMonitor,
  stopDOMPerformanceMonitor,
  onDOMSnapshot,
  getLatestDOMSnapshot,
  getDOMSnapshotHistory,
  getRenderTimings,
  getUpdateComparisons,
  setObservedContainer,
  getObservedContainer,
  resetDOMPerformanceMonitor,
  type DOMNodeSnapshot,
  type RenderTiming,
  type UpdateComparison,
  type PerformanceSummary,
} from "../../../src/viewer/performance/dom-performance-monitor.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a DOM tree with known structure for testing. */
function createTestTree(options: {
  treeItems?: number;
  depth?: number;
  textNodes?: boolean;
} = {}): HTMLDivElement {
  const { treeItems = 5, depth = 2, textNodes = true } = options;
  const root = document.createElement("div");
  root.setAttribute("role", "tree");

  function addChildren(parent: Element, currentDepth: number, itemsLeft: { count: number }): void {
    if (currentDepth >= depth || itemsLeft.count <= 0) return;

    const childCount = Math.min(3, itemsLeft.count);
    for (let i = 0; i < childCount; i++) {
      if (itemsLeft.count <= 0) break;

      const item = document.createElement("div");
      item.setAttribute("role", "treeitem");
      item.setAttribute("data-node-id", `node-${treeItems - itemsLeft.count}`);

      if (textNodes) {
        item.appendChild(document.createTextNode(`Item ${i}`));
      }

      const label = document.createElement("span");
      label.textContent = `Label ${i}`;
      item.appendChild(label);

      parent.appendChild(item);
      itemsLeft.count--;

      addChildren(item, currentDepth + 1, itemsLeft);
    }
  }

  addChildren(root, 0, { count: treeItems });
  return root;
}

/** Mock performance.memory for heap usage testing. */
function mockPerformanceMemory(usedBytes: number): void {
  Object.defineProperty(performance, "memory", {
    value: {
      usedJSHeapSize: usedBytes,
      totalJSHeapSize: usedBytes * 1.2,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    },
    writable: true,
    configurable: true,
  });
}

function clearPerformanceMemory(): void {
  Object.defineProperty(performance, "memory", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// countDOMNodes
// ═══════════════════════════════════════════════════════════════════════════════

describe("countDOMNodes", () => {
  it("counts total nodes including text nodes", () => {
    const tree = createTestTree({ treeItems: 3, textNodes: true });
    const snapshot = countDOMNodes(tree);

    // Root + treeitem elements + span elements + text nodes
    expect(snapshot.totalNodes).toBeGreaterThan(3);
    expect(snapshot.elementNodes).toBeGreaterThan(0);
  });

  it("counts tree item elements accurately", () => {
    const tree = createTestTree({ treeItems: 5 });
    const snapshot = countDOMNodes(tree);

    expect(snapshot.treeItemCount).toBe(5);
  });

  it("counts tree items for various sizes", () => {
    for (const count of [1, 3, 10]) {
      const tree = createTestTree({ treeItems: count, depth: 4 });
      const snapshot = countDOMNodes(tree);
      expect(snapshot.treeItemCount).toBe(count);
    }
  });

  it("handles empty container", () => {
    const empty = document.createElement("div");
    const snapshot = countDOMNodes(empty);

    expect(snapshot.totalNodes).toBe(1); // Just the container itself
    expect(snapshot.elementNodes).toBe(1);
    expect(snapshot.treeItemCount).toBe(0);
    expect(snapshot.maxDepth).toBe(0);
  });

  it("tracks maximum depth correctly", () => {
    const tree = createTestTree({ treeItems: 10, depth: 4 });
    const snapshot = countDOMNodes(tree);

    // Depth should be at least 2 (container → treeitem → children)
    expect(snapshot.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it("returns valid ISO timestamp", () => {
    const tree = createTestTree({ treeItems: 1 });
    const snapshot = countDOMNodes(tree);

    expect(() => new Date(snapshot.timestamp)).not.toThrow();
    expect(new Date(snapshot.timestamp).toISOString()).toBe(snapshot.timestamp);
  });

  it("element nodes are a subset of total nodes", () => {
    const tree = createTestTree({ treeItems: 5, textNodes: true });
    const snapshot = countDOMNodes(tree);

    expect(snapshot.elementNodes).toBeLessThanOrEqual(snapshot.totalNodes);
    // With text nodes, total should be greater than element count
    expect(snapshot.totalNodes).toBeGreaterThan(snapshot.elementNodes);
  });

  it("handles deeply nested structures without stack overflow", () => {
    // Create a very deep chain (non-recursive implementation should handle this)
    const root = document.createElement("div");
    let current: Element = root;
    for (let i = 0; i < 200; i++) {
      const child = document.createElement("div");
      current.appendChild(child);
      current = child;
    }

    const snapshot = countDOMNodes(root);
    expect(snapshot.totalNodes).toBe(201); // 200 nested + root
    expect(snapshot.maxDepth).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// readHeapUsage
// ═══════════════════════════════════════════════════════════════════════════════

describe("readHeapUsage", () => {
  afterEach(() => {
    clearPerformanceMemory();
  });

  it("returns -1 when performance.memory is unavailable", () => {
    clearPerformanceMemory();
    expect(readHeapUsage()).toBe(-1);
  });

  it("returns heap size when performance.memory is available", () => {
    mockPerformanceMemory(100 * 1024 * 1024); // 100 MB
    expect(readHeapUsage()).toBe(100 * 1024 * 1024);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting utilities
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatDuration", () => {
  it("formats sub-millisecond as microseconds", () => {
    expect(formatDuration(0.5)).toBe("500 µs");
    expect(formatDuration(0.001)).toBe("1 µs");
  });

  it("formats milliseconds correctly", () => {
    expect(formatDuration(1)).toBe("1.0 ms");
    expect(formatDuration(12.345)).toBe("12.3 ms");
    expect(formatDuration(999.9)).toBe("999.9 ms");
  });

  it("formats seconds correctly", () => {
    expect(formatDuration(1000)).toBe("1.00 s");
    expect(formatDuration(2500)).toBe("2.50 s");
  });

  it("returns N/A for negative values", () => {
    expect(formatDuration(-1)).toBe("N/A");
  });
});

describe("formatNodeCount", () => {
  it("formats small numbers without separator", () => {
    expect(formatNodeCount(42)).toBe("42");
  });

  it("formats large numbers with thousands separator", () => {
    expect(formatNodeCount(1234)).toBe("1,234");
    expect(formatNodeCount(1000000)).toBe("1,000,000");
  });

  it("returns N/A for negative values", () => {
    expect(formatNodeCount(-1)).toBe("N/A");
  });

  it("handles zero", () => {
    expect(formatNodeCount(0)).toBe("0");
  });
});

describe("formatDelta", () => {
  it("formats positive deltas with + prefix", () => {
    expect(formatDelta(42)).toBe("+42");
    expect(formatDelta(1500)).toBe("+1,500");
  });

  it("formats negative deltas with − prefix", () => {
    expect(formatDelta(-18)).toBe("−18");
    expect(formatDelta(-2000)).toBe("−2,000");
  });

  it("formats zero without sign", () => {
    expect(formatDelta(0)).toBe("0");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// recordRender
// ═══════════════════════════════════════════════════════════════════════════════

describe("recordRender", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
  });

  it("stores render timing", () => {
    recordRender("test-render", 12.5, 100);

    const timings = getRenderTimings();
    expect(timings).toHaveLength(1);
    expect(timings[0].label).toBe("test-render");
    expect(timings[0].durationMs).toBe(12.5);
    expect(timings[0].nodeCountAfter).toBe(100);
  });

  it("accumulates multiple timings", () => {
    recordRender("render-1", 10, 50);
    recordRender("render-2", 20, 100);
    recordRender("render-3", 5, 75);

    expect(getRenderTimings()).toHaveLength(3);
  });

  it("caps timing history at configured maximum", () => {
    // Reset with small max for testing
    resetDOMPerformanceMonitor();
    const container = document.createElement("div");
    startDOMPerformanceMonitor(container, { maxTimings: 5 });
    stopDOMPerformanceMonitor();

    for (let i = 0; i < 10; i++) {
      recordRender(`render-${i}`, i, i * 10);
    }

    const timings = getRenderTimings();
    expect(timings.length).toBeLessThanOrEqual(5);
    // Should retain the most recent entries
    expect(timings[timings.length - 1].label).toBe("render-9");
  });

  it("includes valid timestamp", () => {
    recordRender("timed", 1, 10);
    const timing = getRenderTimings()[0];
    expect(() => new Date(timing.timestamp)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// recordUpdate
// ═══════════════════════════════════════════════════════════════════════════════

describe("recordUpdate", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
  });

  it("stores update comparison with correct delta", () => {
    recordUpdate("test-update", 5.0, 100, 80);

    const comparisons = getUpdateComparisons();
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].label).toBe("test-update");
    expect(comparisons[0].nodesBefore).toBe(100);
    expect(comparisons[0].nodesAfter).toBe(80);
    expect(comparisons[0].nodeDelta).toBe(-20);
    expect(comparisons[0].durationMs).toBe(5.0);
  });

  it("computes positive delta for node growth", () => {
    recordUpdate("growth", 1, 50, 150);
    expect(getUpdateComparisons()[0].nodeDelta).toBe(100);
  });

  it("computes zero delta when nodes unchanged", () => {
    recordUpdate("no-change", 1, 100, 100);
    expect(getUpdateComparisons()[0].nodeDelta).toBe(0);
  });

  it("records memory before/after when provided", () => {
    const memBefore = 100 * 1024 * 1024;
    const memAfter = 120 * 1024 * 1024;
    recordUpdate("with-memory", 5, 100, 80, memBefore, memAfter);

    const comp = getUpdateComparisons()[0];
    expect(comp.memoryBefore).toBe(memBefore);
    expect(comp.memoryAfter).toBe(memAfter);
    expect(comp.memoryDelta).toBe(20 * 1024 * 1024);
  });

  it("uses -1 for memory when not provided", () => {
    recordUpdate("no-memory", 5, 100, 80);

    const comp = getUpdateComparisons()[0];
    expect(comp.memoryBefore).toBe(-1);
    expect(comp.memoryAfter).toBe(-1);
    expect(comp.memoryDelta).toBe(-1);
  });

  it("caps comparison history at configured maximum", () => {
    const container = document.createElement("div");
    startDOMPerformanceMonitor(container, { maxComparisons: 3 });
    stopDOMPerformanceMonitor();

    for (let i = 0; i < 10; i++) {
      recordUpdate(`update-${i}`, i, i * 10, i * 10 + 5);
    }

    const comparisons = getUpdateComparisons();
    expect(comparisons.length).toBeLessThanOrEqual(3);
    expect(comparisons[comparisons.length - 1].label).toBe("update-9");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// measureOperation
// ═══════════════════════════════════════════════════════════════════════════════

describe("measureOperation", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
    clearPerformanceMemory();
  });

  it("returns the function result", () => {
    const container = createTestTree({ treeItems: 3 });
    setObservedContainer(container);

    const result = measureOperation("test", () => 42);
    expect(result).toBe(42);
  });

  it("records timing and comparison", () => {
    const container = createTestTree({ treeItems: 3 });
    setObservedContainer(container);

    measureOperation("measured-op", () => {
      // Simulate work
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += i;
      return sum;
    });

    expect(getRenderTimings()).toHaveLength(1);
    expect(getRenderTimings()[0].label).toBe("measured-op");
    expect(getUpdateComparisons()).toHaveLength(1);
    expect(getUpdateComparisons()[0].label).toBe("measured-op");
  });

  it("captures node count before and after", () => {
    const container = document.createElement("div");
    container.innerHTML = "<div>initial</div>";
    setObservedContainer(container);

    measureOperation("dom-change", () => {
      container.innerHTML = "<div>a</div><div>b</div><div>c</div>";
    });

    const comp = getUpdateComparisons()[0];
    // Before: container(1) + div(1) + text(1) = 3
    // After: container(1) + div(1)+text(1) + div(1)+text(1) + div(1)+text(1) = 7
    expect(comp.nodesBefore).toBeGreaterThan(0);
    expect(comp.nodesAfter).toBeGreaterThan(0);
    expect(comp.nodeDelta).not.toBe(0);
  });

  it("captures memory metrics when available", () => {
    mockPerformanceMemory(50 * 1024 * 1024);
    const container = document.createElement("div");
    setObservedContainer(container);

    measureOperation("mem-op", () => {});

    const comp = getUpdateComparisons()[0];
    expect(comp.memoryBefore).toBe(50 * 1024 * 1024);
  });

  it("works without observed container (records timing only)", () => {
    setObservedContainer(null);

    const result = measureOperation("no-container", () => "ok");
    expect(result).toBe("ok");

    // Should still record render timing
    expect(getRenderTimings()).toHaveLength(1);
    // But no comparison (no container to count)
    expect(getUpdateComparisons()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeSummary
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeSummary", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
  });

  it("returns zero summary with no data", () => {
    const summary = computeSummary();
    expect(summary.avgRenderMs).toBe(0);
    expect(summary.peakRenderMs).toBe(0);
    expect(summary.avgNodeCount).toBe(0);
    expect(summary.peakNodeCount).toBe(0);
    expect(summary.renderCount).toBe(0);
    expect(summary.updateCount).toBe(0);
    expect(summary.snapshotCount).toBe(0);
  });

  it("computes correct averages from render timings", () => {
    recordRender("a", 10, 100);
    recordRender("b", 20, 200);
    recordRender("c", 30, 300);

    const summary = computeSummary();
    expect(summary.avgRenderMs).toBe(20);
    expect(summary.peakRenderMs).toBe(30);
    expect(summary.renderCount).toBe(3);
  });

  it("computes peak node count from snapshots", () => {
    const container = createTestTree({ treeItems: 10 });
    startDOMPerformanceMonitor(container, { intervalMs: 100 });
    // Initial snapshot is taken immediately
    stopDOMPerformanceMonitor();

    const summary = computeSummary();
    expect(summary.snapshotCount).toBeGreaterThan(0);
    expect(summary.peakNodeCount).toBeGreaterThan(0);
    expect(summary.avgNodeCount).toBeGreaterThan(0);
  });

  it("counts update comparisons", () => {
    recordUpdate("u1", 5, 100, 80);
    recordUpdate("u2", 3, 80, 60);

    const summary = computeSummary();
    expect(summary.updateCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Monitor lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("monitor lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
    vi.useRealTimers();
  });

  it("starts and captures initial snapshot", () => {
    expect(getLatestDOMSnapshot()).toBeNull();

    const container = createTestTree({ treeItems: 5 });
    startDOMPerformanceMonitor(container);

    expect(getLatestDOMSnapshot()).not.toBeNull();
    expect(getLatestDOMSnapshot()!.treeItemCount).toBe(5);
  });

  it("polls on interval", () => {
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 1000 });

    expect(getDOMSnapshotHistory()).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(getDOMSnapshotHistory()).toHaveLength(4); // initial + 3
  });

  it("stops polling on stopDOMPerformanceMonitor", () => {
    const listener = vi.fn();
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 1000 });
    onDOMSnapshot(listener);
    listener.mockClear();

    stopDOMPerformanceMonitor();

    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("restarts cleanly when called multiple times", () => {
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 2000 });

    // Restart with different interval
    startDOMPerformanceMonitor(container, { intervalMs: 500 });

    const listener = vi.fn();
    onDOMSnapshot(listener);
    listener.mockClear();

    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("sets observed container on start", () => {
    expect(getObservedContainer()).toBeNull();

    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container);

    expect(getObservedContainer()).toBe(container);
  });

  it("resets all state with resetDOMPerformanceMonitor", () => {
    const container = createTestTree({ treeItems: 5 });
    startDOMPerformanceMonitor(container);
    recordRender("test", 10, 50);
    recordUpdate("test", 5, 50, 40);

    resetDOMPerformanceMonitor();

    expect(getLatestDOMSnapshot()).toBeNull();
    expect(getDOMSnapshotHistory()).toHaveLength(0);
    expect(getRenderTimings()).toHaveLength(0);
    expect(getUpdateComparisons()).toHaveLength(0);
    expect(getObservedContainer()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshot listeners
// ═══════════════════════════════════════════════════════════════════════════════

describe("snapshot listeners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
    vi.useRealTimers();
  });

  it("notifies listeners on each poll", () => {
    const listener = vi.fn();
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 1000 });
    onDOMSnapshot(listener);
    listener.mockClear();

    vi.advanceTimersByTime(3000);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("unsubscribe function removes listener", () => {
    const listener = vi.fn();
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 1000 });
    const unsub = onDOMSnapshot(listener);
    listener.mockClear();

    unsub();
    vi.advanceTimersByTime(3000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent listeners", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 1000 });
    onDOMSnapshot(listener1);
    onDOMSnapshot(listener2);
    listener1.mockClear();
    listener2.mockClear();

    vi.advanceTimersByTime(1000);
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("passes DOMNodeSnapshot to listener", () => {
    const listener = vi.fn();
    const container = createTestTree({ treeItems: 5 });
    startDOMPerformanceMonitor(container, { intervalMs: 1000 });
    onDOMSnapshot(listener);
    listener.mockClear();

    vi.advanceTimersByTime(1000);

    const snap = listener.mock.calls[0][0] as DOMNodeSnapshot;
    expect(snap).toHaveProperty("totalNodes");
    expect(snap).toHaveProperty("elementNodes");
    expect(snap).toHaveProperty("treeItemCount");
    expect(snap).toHaveProperty("maxDepth");
    expect(snap).toHaveProperty("timestamp");
    expect(snap.treeItemCount).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Snapshot history ring buffer
// ═══════════════════════════════════════════════════════════════════════════════

describe("snapshot history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
    vi.useRealTimers();
  });

  it("accumulates snapshots in history", () => {
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 100 });
    expect(getDOMSnapshotHistory()).toHaveLength(1); // initial

    vi.advanceTimersByTime(300);
    expect(getDOMSnapshotHistory()).toHaveLength(4); // initial + 3
  });

  it("caps history at configured maximum", () => {
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container, { intervalMs: 100, maxSnapshots: 10 });

    // Generate 20 poll cycles
    vi.advanceTimersByTime(100 * 20);
    expect(getDOMSnapshotHistory().length).toBeLessThanOrEqual(10);
  });

  it("returns readonly array", () => {
    const container = createTestTree({ treeItems: 3 });
    startDOMPerformanceMonitor(container);
    const history = getDOMSnapshotHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// takeDOMSnapshot
// ═══════════════════════════════════════════════════════════════════════════════

describe("takeDOMSnapshot", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
  });

  it("returns null when no container is set", () => {
    expect(takeDOMSnapshot()).toBeNull();
  });

  it("returns snapshot when container is set", () => {
    const container = createTestTree({ treeItems: 7 });
    setObservedContainer(container);

    const snapshot = takeDOMSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.treeItemCount).toBe(7);
  });

  it("reflects live DOM changes", () => {
    const container = document.createElement("div");
    setObservedContainer(container);

    const before = takeDOMSnapshot();
    expect(before!.totalNodes).toBe(1);

    // Add children
    for (let i = 0; i < 5; i++) {
      const child = document.createElement("div");
      child.setAttribute("role", "treeitem");
      container.appendChild(child);
    }

    const after = takeDOMSnapshot();
    expect(after!.totalNodes).toBe(6); // container + 5 children
    expect(after!.treeItemCount).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setObservedContainer
// ═══════════════════════════════════════════════════════════════════════════════

describe("setObservedContainer", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
  });

  it("sets the container for snapshot operations", () => {
    const container = document.createElement("div");
    setObservedContainer(container);
    expect(getObservedContainer()).toBe(container);
  });

  it("can be set to null to clear", () => {
    const container = document.createElement("div");
    setObservedContainer(container);
    setObservedContainer(null);
    expect(getObservedContainer()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Performance characteristics
// ═══════════════════════════════════════════════════════════════════════════════

describe("counting performance", () => {
  it("counts 1000-element tree under 50ms", () => {
    const root = document.createElement("div");
    for (let i = 0; i < 1000; i++) {
      const el = document.createElement("div");
      el.setAttribute("role", "treeitem");
      el.textContent = `Item ${i}`;
      root.appendChild(el);
    }

    const start = performance.now();
    const snapshot = countDOMNodes(root);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(snapshot.treeItemCount).toBe(1000);
    expect(snapshot.totalNodes).toBeGreaterThan(1000); // text nodes add to count
  });

  it("counting scales linearly (not quadratically)", () => {
    function createFlat(count: number): HTMLDivElement {
      const root = document.createElement("div");
      for (let i = 0; i < count; i++) {
        const el = document.createElement("div");
        el.setAttribute("role", "treeitem");
        root.appendChild(el);
      }
      return root;
    }

    const small = createFlat(200);
    const large = createFlat(800);

    // Use median of multiple runs to avoid flaky sub-millisecond timing
    function median(fn: () => void, n = 20): number {
      fn(); fn(); // warmup
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        const s = performance.now();
        fn();
        times.push(performance.now() - s);
      }
      times.sort((a, b) => a - b);
      return times[Math.floor(times.length / 2)];
    }

    const time1 = median(() => countDOMNodes(small));
    const time2 = median(() => countDOMNodes(large));

    // If O(n), large ~4× small. If O(n²), large ~16× small.
    // Accept up to 8× with constant factor.
    const ratio = (time2 + 0.01) / (time1 + 0.01);
    expect(ratio).toBeLessThan(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Before/after comparison integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("before/after comparison integration", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
    clearPerformanceMemory();
  });

  it("tracks DOM reduction from node culling simulation", () => {
    const container = document.createElement("div");
    // Simulate initial render with many nodes
    for (let i = 0; i < 100; i++) {
      const node = document.createElement("div");
      node.setAttribute("role", "treeitem");
      node.textContent = `Node ${i}`;
      container.appendChild(node);
    }
    setObservedContainer(container);

    const beforeSnapshot = countDOMNodes(container);
    const nodesBefore = beforeSnapshot.totalNodes;

    // Simulate culling: remove most nodes, leave placeholders
    while (container.childNodes.length > 20) {
      container.removeChild(container.lastChild!);
    }

    const afterSnapshot = countDOMNodes(container);
    const nodesAfter = afterSnapshot.totalNodes;

    recordUpdate("cull-simulation", 5, nodesBefore, nodesAfter);

    const comp = getUpdateComparisons()[0];
    expect(comp.nodeDelta).toBeLessThan(0); // Nodes were removed
    expect(comp.nodesBefore).toBeGreaterThan(comp.nodesAfter);
  });

  it("tracks DOM growth from progressive loading simulation", () => {
    const container = document.createElement("div");
    // Start with few nodes
    for (let i = 0; i < 10; i++) {
      container.appendChild(document.createElement("div"));
    }
    setObservedContainer(container);

    const beforeCount = countDOMNodes(container).totalNodes;

    // Simulate loading more chunks
    for (let i = 0; i < 50; i++) {
      container.appendChild(document.createElement("div"));
    }

    const afterCount = countDOMNodes(container).totalNodes;

    recordUpdate("progressive-load", 15, beforeCount, afterCount);

    const comp = getUpdateComparisons()[0];
    expect(comp.nodeDelta).toBeGreaterThan(0); // Nodes were added
    expect(comp.nodesAfter).toBeGreaterThan(comp.nodesBefore);
  });

  it("captures memory delta for tree operations", () => {
    mockPerformanceMemory(100 * 1024 * 1024);
    const memBefore = readHeapUsage();

    mockPerformanceMemory(115 * 1024 * 1024);
    const memAfter = readHeapUsage();

    recordUpdate("memory-test", 10, 500, 600, memBefore, memAfter);

    const comp = getUpdateComparisons()[0];
    expect(comp.memoryBefore).toBe(100 * 1024 * 1024);
    expect(comp.memoryAfter).toBe(115 * 1024 * 1024);
    expect(comp.memoryDelta).toBe(15 * 1024 * 1024);
  });

  it("measureOperation provides complete end-to-end tracking", () => {
    const container = document.createElement("div");
    for (let i = 0; i < 10; i++) {
      container.appendChild(document.createElement("div"));
    }
    setObservedContainer(container);

    const result = measureOperation("full-measure", () => {
      // Add 20 more nodes
      for (let i = 0; i < 20; i++) {
        container.appendChild(document.createElement("div"));
      }
      return "done";
    });

    expect(result).toBe("done");

    const comp = getUpdateComparisons()[0];
    expect(comp.label).toBe("full-measure");
    expect(comp.nodesAfter).toBeGreaterThan(comp.nodesBefore);
    expect(comp.durationMs).toBeGreaterThanOrEqual(0);

    const timing = getRenderTimings()[0];
    expect(timing.label).toBe("full-measure");
    expect(timing.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  beforeEach(() => {
    resetDOMPerformanceMonitor();
  });

  afterEach(() => {
    resetDOMPerformanceMonitor();
  });

  it("handles container with only text content", () => {
    const container = document.createElement("div");
    container.textContent = "Hello world";

    const snapshot = countDOMNodes(container);
    expect(snapshot.totalNodes).toBe(2); // container + text node
    expect(snapshot.elementNodes).toBe(1); // only container
    expect(snapshot.treeItemCount).toBe(0);
  });

  it("handles container with comment nodes", () => {
    const container = document.createElement("div");
    container.appendChild(document.createComment("test comment"));
    container.appendChild(document.createElement("span"));

    const snapshot = countDOMNodes(container);
    expect(snapshot.totalNodes).toBe(3); // container + comment + span
    expect(snapshot.elementNodes).toBe(2); // container + span
  });

  it("handles zero-duration operations", () => {
    recordRender("instant", 0, 10);
    recordUpdate("instant", 0, 10, 10);

    expect(getRenderTimings()[0].durationMs).toBe(0);
    expect(getUpdateComparisons()[0].durationMs).toBe(0);
    expect(getUpdateComparisons()[0].nodeDelta).toBe(0);
  });

  it("handles very large node counts", () => {
    recordUpdate("huge", 100, 1000000, 999000);

    const comp = getUpdateComparisons()[0];
    expect(comp.nodeDelta).toBe(-1000);
    expect(comp.nodesBefore).toBe(1000000);
  });
});
