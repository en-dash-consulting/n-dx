// @vitest-environment jsdom
/**
 * Tests for the useDOMPerformanceMonitor hook.
 *
 * Verifies hook lifecycle: monitor started on mount, stopped on unmount,
 * and ref changes trigger re-subscription. The underlying utility module
 * is tested separately in dom-performance-monitor.test.ts — these tests
 * focus on the Preact integration layer.
 *
 * @see ./dom-performance-monitor.test.ts — utility tests
 * @see ../../../src/viewer/hooks/use-dom-performance-monitor.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useRef } from "preact/hooks";
import type { RefObject } from "preact";
import {
  resetDOMPerformanceMonitor,
  getLatestDOMSnapshot,
  getObservedContainer,
  getRenderTimings,
  getUpdateComparisons,
  getDOMSnapshotHistory,
} from "../../../src/viewer/performance/dom-performance-monitor.js";
import {
  useDOMPerformanceMonitor,
  type UseDOMPerformanceMonitorResult,
} from "../../../src/viewer/hooks/use-dom-performance-monitor.js";

// ── Test harness ─────────────────────────────────────────────────────────────

let hookResult: UseDOMPerformanceMonitorResult | null = null;

interface HarnessProps {
  enabled?: boolean;
  intervalMs?: number;
  maxSnapshots?: number;
  /** When true, the ref points at a container with tree items. */
  withContent?: boolean;
}

function TestHarness(props: HarnessProps) {
  const { enabled, intervalMs, maxSnapshots, withContent = true } = props;
  const ref = useRef<HTMLDivElement>(null);

  const result = useDOMPerformanceMonitor(ref, {
    enabled,
    intervalMs,
    maxSnapshots,
  });
  hookResult = result;

  if (withContent) {
    return h(
      "div",
      { ref },
      h("div", { role: "treeitem" }, "Item 1"),
      h("div", { role: "treeitem" }, "Item 2"),
      h("div", { role: "treeitem" }, "Item 3"),
    );
  }

  return h("div", { ref });
}

/** Build a simple container element with tree items for ref-swap tests. */
function createTreeContainer(itemCount: number): HTMLDivElement {
  const container = document.createElement("div");
  for (let i = 0; i < itemCount; i++) {
    const item = document.createElement("div");
    item.setAttribute("role", "treeitem");
    item.textContent = `Item ${i}`;
    container.appendChild(item);
  }
  return container;
}

/**
 * Helper: render the harness inside act(), then advance timers by one
 * interval tick (default 0ms) to flush Preact's deferred effects and
 * the subsequent state update from the snapshot callback.
 */
function renderAndFlush(
  root: HTMLDivElement,
  props: HarnessProps | null = null,
): void {
  act(() => {
    render(h(TestHarness, props), root);
    // Preact defers useEffect — advance timers to flush it, which
    // triggers the initial poll() → setSnapshot → re-render.
    vi.advanceTimersByTime(0);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Hook lifecycle
// ═════════════════════════════════════════════════════════════════════════════

describe("useDOMPerformanceMonitor", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    resetDOMPerformanceMonitor();
    hookResult = null;
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    if (root.parentNode) root.parentNode.removeChild(root);
    resetDOMPerformanceMonitor();
    vi.useRealTimers();
  });

  // ─── Mount ───────────────────────────────────────────────────────────────

  describe("mount", () => {
    it("starts the monitor on mount", () => {
      expect(getLatestDOMSnapshot()).toBeNull();

      renderAndFlush(root);

      // Module-level state confirms the monitor is running
      expect(getLatestDOMSnapshot()).not.toBeNull();
      expect(getObservedContainer()).not.toBeNull();
    });

    it("takes an initial snapshot with correct tree item count", () => {
      renderAndFlush(root);

      // The initial poll captures the container's DOM structure
      const snapshot = getLatestDOMSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.treeItemCount).toBe(3);
    });

    it("populates history with the initial snapshot", () => {
      renderAndFlush(root);

      expect(getDOMSnapshotHistory()).toHaveLength(1);
      expect(hookResult!.history).toHaveLength(1);
    });

    it("provides empty timings and comparisons initially", () => {
      renderAndFlush(root);

      expect(hookResult!.timings).toHaveLength(0);
      expect(hookResult!.comparisons).toHaveLength(0);
    });

    it("provides a summary reflecting snapshot data after poll", () => {
      renderAndFlush(root, { intervalMs: 500 });

      // Advance one interval to trigger a re-render with populated history.
      // computeSummary() is evaluated during render, so we need a render
      // that occurs after snapshots exist in history.
      act(() => { vi.advanceTimersByTime(500); });

      const summary = hookResult!.summary;
      expect(summary.snapshotCount).toBeGreaterThanOrEqual(1);
      expect(summary.avgNodeCount).toBeGreaterThan(0);
    });
  });

  // ─── Polling ─────────────────────────────────────────────────────────────

  describe("polling", () => {
    it("accumulates snapshots as timers advance", () => {
      renderAndFlush(root, { intervalMs: 500 });
      const baseline = getDOMSnapshotHistory().length;
      expect(baseline).toBeGreaterThanOrEqual(1);

      // After several intervals, snapshot count should grow
      act(() => { vi.advanceTimersByTime(2000); });
      const after2s = getDOMSnapshotHistory().length;
      expect(after2s).toBeGreaterThan(baseline);

      // Additional time produces more snapshots
      act(() => { vi.advanceTimersByTime(2000); });
      expect(getDOMSnapshotHistory().length).toBeGreaterThan(after2s);
    });

    it("shorter interval produces snapshots faster", () => {
      // Mount with 200ms interval
      renderAndFlush(root, { intervalMs: 200 });
      const shortBaseline = getDOMSnapshotHistory().length;

      act(() => { vi.advanceTimersByTime(1000); });
      const shortCount = getDOMSnapshotHistory().length - shortBaseline;

      // Reset and mount with 500ms interval
      act(() => { render(null, root); });
      resetDOMPerformanceMonitor();
      renderAndFlush(root, { intervalMs: 500 });
      const longBaseline = getDOMSnapshotHistory().length;

      act(() => { vi.advanceTimersByTime(1000); });
      const longCount = getDOMSnapshotHistory().length - longBaseline;

      // Shorter interval should produce more snapshots
      expect(shortCount).toBeGreaterThan(longCount);
    });
  });

  // ─── Unmount ─────────────────────────────────────────────────────────────

  describe("unmount", () => {
    it("stops the monitor on unmount", () => {
      renderAndFlush(root, { intervalMs: 500 });
      expect(getDOMSnapshotHistory()).toHaveLength(1);

      // Unmount the component
      act(() => { render(null, root); });

      // Advance timers — no new snapshots should be added
      const countAfterUnmount = getDOMSnapshotHistory().length;
      act(() => { vi.advanceTimersByTime(5000); });
      expect(getDOMSnapshotHistory()).toHaveLength(countAfterUnmount);
    });

    it("cleans up polling timer on unmount", () => {
      renderAndFlush(root, { intervalMs: 100 });
      const baseline = getDOMSnapshotHistory().length;

      // Verify polling works — at least 1 tick
      act(() => { vi.advanceTimersByTime(100); });
      const afterTick = getDOMSnapshotHistory().length;
      expect(afterTick).toBeGreaterThan(baseline);

      // Unmount
      act(() => { render(null, root); });

      // No more snapshots after unmount
      const countAfterUnmount = getDOMSnapshotHistory().length;
      act(() => { vi.advanceTimersByTime(1000); });
      expect(getDOMSnapshotHistory()).toHaveLength(countAfterUnmount);
    });
  });

  // ─── enabled option ──────────────────────────────────────────────────────

  describe("enabled option", () => {
    it("does not start monitor when enabled=false", () => {
      renderAndFlush(root, { enabled: false });

      expect(getLatestDOMSnapshot()).toBeNull();
      expect(hookResult!.snapshot).toBeNull();
    });

    it("starts monitor when enabled changes from false to true", () => {
      // Render disabled
      renderAndFlush(root, { enabled: false });
      expect(getLatestDOMSnapshot()).toBeNull();

      // Re-render enabled
      renderAndFlush(root, { enabled: true });
      expect(getLatestDOMSnapshot()).not.toBeNull();
    });

    it("stops monitor when enabled changes from true to false", () => {
      renderAndFlush(root, { enabled: true, intervalMs: 500 });
      expect(getDOMSnapshotHistory()).toHaveLength(1);

      // Disable
      renderAndFlush(root, { enabled: false, intervalMs: 500 });

      // No new snapshots
      const count = getDOMSnapshotHistory().length;
      act(() => { vi.advanceTimersByTime(3000); });
      expect(getDOMSnapshotHistory()).toHaveLength(count);
    });
  });

  // ─── Ref change ──────────────────────────────────────────────────────────

  describe("ref change", () => {
    it("re-subscribes when the ref element changes", () => {
      const containerA = createTreeContainer(2);
      const containerB = createTreeContainer(5);
      document.body.appendChild(containerA);
      document.body.appendChild(containerB);

      // Use a stable ref object whose .current we swap between renders.
      // The hook's useEffect depends on containerRef.current, so changing
      // it triggers cleanup + re-start of the monitor.
      const stableRef: RefObject<Element> = { current: containerA };

      function SwapHarness() {
        const result = useDOMPerformanceMonitor(stableRef, { intervalMs: 500 });
        hookResult = result;
        return h("div", null);
      }

      // Mount with containerA
      act(() => {
        render(h(SwapHarness, null), root);
        vi.advanceTimersByTime(0);
      });
      expect(getObservedContainer()).toBe(containerA);
      expect(getLatestDOMSnapshot()!.treeItemCount).toBe(2);

      // Swap the ref target and force effect re-evaluation
      stableRef.current = containerB;
      act(() => {
        render(h(SwapHarness, null), root);
        vi.advanceTimersByTime(0);
      });

      // Monitor should now observe the new container
      expect(getObservedContainer()).toBe(containerB);
      expect(getLatestDOMSnapshot()!.treeItemCount).toBe(5);

      // Cleanup
      containerA.remove();
      containerB.remove();
    });
  });

  // ─── Wrapped operations ──────────────────────────────────────────────────

  describe("wrapped operations", () => {
    it("recordRender records timing and triggers re-read", () => {
      renderAndFlush(root);
      expect(getRenderTimings()).toHaveLength(0);

      hookResult!.recordRender("test-render", 12.5, 100);

      expect(getRenderTimings()).toHaveLength(1);
      expect(getRenderTimings()[0].label).toBe("test-render");
      expect(getRenderTimings()[0].durationMs).toBe(12.5);
    });

    it("recordUpdate records comparison and triggers re-read", () => {
      renderAndFlush(root);
      expect(getUpdateComparisons()).toHaveLength(0);

      hookResult!.recordUpdate("test-update", 5, 100, 80);

      expect(getUpdateComparisons()).toHaveLength(1);
      expect(getUpdateComparisons()[0].label).toBe("test-update");
      expect(getUpdateComparisons()[0].nodeDelta).toBe(-20);
    });

    it("measureOperation wraps a function and records metrics", () => {
      renderAndFlush(root);

      const result = hookResult!.measureOperation("measured", () => 42);
      expect(result).toBe(42);

      // Should have recorded at least a render timing
      expect(getRenderTimings()).toHaveLength(1);
      expect(getRenderTimings()[0].label).toBe("measured");
    });
  });

  // ─── maxSnapshots option ─────────────────────────────────────────────────

  describe("maxSnapshots option", () => {
    it("passes maxSnapshots to the monitor", () => {
      renderAndFlush(root, { intervalMs: 100, maxSnapshots: 5 });

      // Generate more snapshots than the cap
      act(() => { vi.advanceTimersByTime(100 * 10); });

      expect(getDOMSnapshotHistory().length).toBeLessThanOrEqual(5);
    });
  });
});
