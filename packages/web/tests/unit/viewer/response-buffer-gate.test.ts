// @vitest-environment jsdom
/**
 * Tests for response buffer gate module.
 *
 * Covers: gate open/close lifecycle, message dropping during suspension,
 * downstream buffer flushing, debounced resume, reconciliation on resume,
 * multiple suspension cycles, snapshot tracking, and disposal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createResponseBufferGate,
} from "../../../src/viewer/performance/response-buffer-gate.js";
import {
  startTabVisibilityMonitor,
  resetTabVisibility,
} from "../../../src/viewer/polling/tab-visibility.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Save the original visibility state for restoration after each test. */
let originalVisibilityState: string;

/**
 * Simulate tab visibility change by setting the property and dispatching the event.
 * Follows the same pattern as tab-visibility.test.ts.
 */
function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  originalVisibilityState = document.visibilityState;
  // Default to visible for consistent test behavior
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
  resetTabVisibility();
  startTabVisibilityMonitor();
});

afterEach(() => {
  resetTabVisibility();
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
  vi.useRealTimers();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createResponseBufferGate", () => {
  it("returns an object with accept, isOpen, getSnapshot, and dispose methods", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });
    expect(typeof gate.accept).toBe("function");
    expect(typeof gate.isOpen).toBe("function");
    expect(typeof gate.getSnapshot).toBe("function");
    expect(typeof gate.dispose).toBe("function");
    gate.dispose();
  });

  it("starts with the gate open when tab is visible", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });
    expect(gate.isOpen()).toBe(true);
    expect(gate.accept()).toBe(true);
    gate.dispose();
  });
});

describe("gate suspension on tab hide", () => {
  it("closes the gate immediately when tab becomes hidden", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });

    expect(gate.isOpen()).toBe(true);

    simulateVisibilityChange("hidden");

    expect(gate.isOpen()).toBe(false);
    gate.dispose();
  });

  it("drops messages when the gate is closed", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });

    simulateVisibilityChange("hidden");

    expect(gate.accept()).toBe(false);
    expect(gate.accept()).toBe(false);
    expect(gate.accept()).toBe(false);

    const snapshot = gate.getSnapshot();
    expect(snapshot.droppedCount).toBe(3);
    expect(snapshot.totalDropped).toBe(3);
    gate.dispose();
  });

  it("flushes downstream buffers when tab becomes hidden", () => {
    const flush1 = vi.fn();
    const flush2 = vi.fn();
    const flush3 = vi.fn();

    const gate = createResponseBufferGate({
      flushDownstream: [flush1, flush2, flush3],
      onResume: vi.fn(),
    });

    simulateVisibilityChange("hidden");

    expect(flush1).toHaveBeenCalledTimes(1);
    expect(flush2).toHaveBeenCalledTimes(1);
    expect(flush3).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it("swallows errors from downstream flush functions", () => {
    const flush1 = vi.fn(() => { throw new Error("flush error"); });
    const flush2 = vi.fn();

    const gate = createResponseBufferGate({
      flushDownstream: [flush1, flush2],
      onResume: vi.fn(),
    });

    // Should not throw
    simulateVisibilityChange("hidden");

    expect(flush1).toHaveBeenCalledTimes(1);
    expect(flush2).toHaveBeenCalledTimes(1);
    expect(gate.isOpen()).toBe(false);
    gate.dispose();
  });
});

describe("gate resume on tab show", () => {
  it("re-opens the gate after debounce when tab becomes visible", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
      resumeDebounceMs: 100,
    });

    simulateVisibilityChange("hidden");
    expect(gate.isOpen()).toBe(false);

    simulateVisibilityChange("visible");

    // Not yet open — debounce hasn't fired
    expect(gate.isOpen()).toBe(false);

    vi.advanceTimersByTime(100);

    // Now open
    expect(gate.isOpen()).toBe(true);
    gate.dispose();
  });

  it("calls onResume when messages were dropped during suspension", () => {
    const onResume = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume,
      resumeDebounceMs: 50,
    });

    simulateVisibilityChange("hidden");

    // Drop some messages
    gate.accept();
    gate.accept();

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(onResume).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it("does NOT call onResume when no messages were dropped", () => {
    const onResume = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume,
      resumeDebounceMs: 50,
    });

    simulateVisibilityChange("hidden");
    // No messages dropped — tab was hidden but no WS traffic

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(onResume).not.toHaveBeenCalled();
    gate.dispose();
  });

  it("accepts messages after gate re-opens", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
      resumeDebounceMs: 50,
    });

    simulateVisibilityChange("hidden");
    expect(gate.accept()).toBe(false);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(gate.accept()).toBe(true);
    gate.dispose();
  });
});

describe("debounced resume prevents thrashing", () => {
  it("cancels pending resume when tab goes hidden again", () => {
    const onResume = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume,
      resumeDebounceMs: 100,
    });

    // Hide → drop messages → show → hide again before debounce fires
    simulateVisibilityChange("hidden");
    gate.accept(); // Drop one message

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50); // Halfway through debounce

    simulateVisibilityChange("hidden");

    vi.advanceTimersByTime(200); // Well past original debounce

    // Gate should still be closed, onResume should NOT have fired
    expect(gate.isOpen()).toBe(false);
    expect(onResume).not.toHaveBeenCalled();
    gate.dispose();
  });

  it("resets debounce timer on rapid show/hide/show", () => {
    const onResume = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume,
      resumeDebounceMs: 100,
    });

    simulateVisibilityChange("hidden");
    gate.accept(); // Drop a message

    // Rapid toggling: show → hide → show
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("hidden");
    vi.advanceTimersByTime(30);
    simulateVisibilityChange("visible");

    // Only 60ms total — debounce timer was reset on the last "visible"
    vi.advanceTimersByTime(50);
    expect(gate.isOpen()).toBe(false); // Still debouncing

    vi.advanceTimersByTime(50); // Total 100ms from last "visible"
    expect(gate.isOpen()).toBe(true);
    gate.dispose();
  });
});

describe("multiple suspension cycles", () => {
  it("tracks dropped count per suspension and total across all", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
      resumeDebounceMs: 50,
    });

    // First suspension: drop 3 messages
    simulateVisibilityChange("hidden");
    gate.accept();
    gate.accept();
    gate.accept();

    expect(gate.getSnapshot().droppedCount).toBe(3);

    // Resume
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // Second suspension: drop 2 messages
    simulateVisibilityChange("hidden");
    gate.accept();
    gate.accept();

    // droppedCount resets per suspension, totalDropped accumulates
    expect(gate.getSnapshot().droppedCount).toBe(2);
    expect(gate.getSnapshot().totalDropped).toBe(5);
    gate.dispose();
  });

  it("increments suspensionCount for each hide event", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
      resumeDebounceMs: 50,
    });

    expect(gate.getSnapshot().suspensionCount).toBe(0);

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(1);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    simulateVisibilityChange("hidden");
    expect(gate.getSnapshot().suspensionCount).toBe(2);
    gate.dispose();
  });

  it("calls onResume for each cycle where messages were dropped", () => {
    const onResume = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume,
      resumeDebounceMs: 50,
    });

    // Cycle 1: drop messages → onResume called
    simulateVisibilityChange("hidden");
    gate.accept();
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(onResume).toHaveBeenCalledTimes(1);

    // Cycle 2: no drops → onResume NOT called
    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(onResume).toHaveBeenCalledTimes(1); // Still 1

    // Cycle 3: drop messages → onResume called again
    simulateVisibilityChange("hidden");
    gate.accept();
    gate.accept();
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);
    expect(onResume).toHaveBeenCalledTimes(2);
    gate.dispose();
  });

  it("flushes downstream on each suspension", () => {
    const flush = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [flush],
      onResume: vi.fn(),
      resumeDebounceMs: 50,
    });

    simulateVisibilityChange("hidden");
    expect(flush).toHaveBeenCalledTimes(1);

    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    simulateVisibilityChange("hidden");
    expect(flush).toHaveBeenCalledTimes(2);
    gate.dispose();
  });
});

describe("snapshot", () => {
  it("provides accurate initial snapshot", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });

    const snapshot = gate.getSnapshot();
    expect(snapshot.isOpen).toBe(true);
    expect(snapshot.droppedCount).toBe(0);
    expect(snapshot.totalDropped).toBe(0);
    expect(snapshot.suspensionCount).toBe(0);
    gate.dispose();
  });

  it("reflects closed state during suspension", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });

    simulateVisibilityChange("hidden");

    const snapshot = gate.getSnapshot();
    expect(snapshot.isOpen).toBe(false);
    expect(snapshot.suspensionCount).toBe(1);
    gate.dispose();
  });
});

describe("starting with hidden tab", () => {
  // Override the global beforeEach to start with hidden tab
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    resetTabVisibility();
    startTabVisibilityMonitor();
  });

  it("starts with the gate closed when tab is hidden", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });
    expect(gate.isOpen()).toBe(false);
    expect(gate.accept()).toBe(false);
    gate.dispose();
  });

  it("flushes downstream on creation when tab is hidden", () => {
    const flush = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [flush],
      onResume: vi.fn(),
    });
    expect(flush).toHaveBeenCalledTimes(1);
    gate.dispose();
  });
});

describe("dispose", () => {
  it("rejects all messages after disposal", () => {
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
    });

    gate.dispose();
    expect(gate.accept()).toBe(false);
  });

  it("cancels pending resume timer on disposal", () => {
    const onResume = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume,
      resumeDebounceMs: 100,
    });

    simulateVisibilityChange("hidden");
    gate.accept(); // Drop a message

    simulateVisibilityChange("visible");
    gate.dispose();

    // Advance past the debounce — onResume should NOT fire
    vi.advanceTimersByTime(200);
    expect(onResume).not.toHaveBeenCalled();
  });

  it("does not react to visibility changes after disposal", () => {
    const flush = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [flush],
      onResume: vi.fn(),
    });

    gate.dispose();

    // Visibility change after dispose — flush should NOT be called
    simulateVisibilityChange("hidden");
    expect(flush).not.toHaveBeenCalled();
  });
});

describe("integration: message pipeline gating", () => {
  it("prevents memory buildup by dropping messages during suspension", () => {
    const processedMessages: string[] = [];
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume: vi.fn(),
      resumeDebounceMs: 50,
    });

    // Process messages normally while gate is open
    const msgs = ["msg1", "msg2", "msg3", "msg4", "msg5"];
    for (const m of msgs.slice(0, 2)) {
      if (gate.accept()) processedMessages.push(m);
    }
    expect(processedMessages).toEqual(["msg1", "msg2"]);

    // Suspend
    simulateVisibilityChange("hidden");

    // These should be dropped
    for (const m of msgs.slice(2)) {
      if (gate.accept()) processedMessages.push(m);
    }
    expect(processedMessages).toEqual(["msg1", "msg2"]); // No new messages

    // Resume
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    // New messages should be accepted
    if (gate.accept()) processedMessages.push("msg6");
    expect(processedMessages).toEqual(["msg1", "msg2", "msg6"]);

    // Verify stats
    expect(gate.getSnapshot().totalDropped).toBe(3);
    gate.dispose();
  });

  it("triggers reconciliation exactly once on resume after drops", () => {
    const onResume = vi.fn();
    const gate = createResponseBufferGate({
      flushDownstream: [],
      onResume,
      resumeDebounceMs: 50,
    });

    // Drop several messages
    simulateVisibilityChange("hidden");
    for (let i = 0; i < 100; i++) {
      gate.accept();
    }

    // Resume — should trigger exactly one reconciliation, not 100
    simulateVisibilityChange("visible");
    vi.advanceTimersByTime(50);

    expect(onResume).toHaveBeenCalledTimes(1);
    gate.dispose();
  });

  it("coordinates with downstream flush to release memory", () => {
    // Simulate the message-throttle's pending array, coalescer's batch,
    // and batcher's queue being flushed
    let throttlePending = 10;
    let coalescerPending = 5;
    let batcherPending = 8;

    const gate = createResponseBufferGate({
      flushDownstream: [
        () => { throttlePending = 0; },
        () => { coalescerPending = 0; },
        () => { batcherPending = 0; },
      ],
      onResume: vi.fn(),
    });

    expect(throttlePending).toBe(10);
    expect(coalescerPending).toBe(5);
    expect(batcherPending).toBe(8);

    simulateVisibilityChange("hidden");

    // All downstream buffers should be cleared
    expect(throttlePending).toBe(0);
    expect(coalescerPending).toBe(0);
    expect(batcherPending).toBe(0);
    gate.dispose();
  });
});
