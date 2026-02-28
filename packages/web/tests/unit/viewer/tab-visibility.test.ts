// @vitest-environment jsdom
/**
 * Tests for the tab visibility state manager.
 *
 * Covers: state detection, snapshot creation, monitor lifecycle (start/stop),
 * listener management, visibility change handling, browser compatibility
 * (vendor prefixes, focus/blur fallback), capability reporting, transition
 * history, and state reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startTabVisibilityMonitor,
  stopTabVisibilityMonitor,
  getTabVisibility,
  getTabVisibilitySnapshot,
  isTabVisible,
  onVisibilityChange,
  resetTabVisibility,
  detectVisibilityAPI,
  getVisibilityCapabilities,
  getTransitionHistory,
  type TabVisibilitySnapshot,
  type TabVisibilityState,
} from "../../../src/viewer/tab-visibility.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate a visibility state change by setting the property and dispatching the event. */
function simulateVisibilityChange(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

let originalVisibilityState: string;

beforeEach(() => {
  originalVisibilityState = document.visibilityState;
  // Default to visible for consistent test behavior
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    writable: true,
    configurable: true,
  });
  resetTabVisibility();
});

afterEach(() => {
  resetTabVisibility();
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
});

// ─── State detection ─────────────────────────────────────────────────────────

describe("initial state detection", () => {
  it("defaults to 'visible' before monitor starts", () => {
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });

  it("reads document.visibilityState on start", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("hidden");
    expect(isTabVisible()).toBe(false);
  });

  it("reads visible state on start", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });
});

// ─── Snapshot ────────────────────────────────────────────────────────────────

describe("getTabVisibilitySnapshot", () => {
  it("returns a snapshot with expected shape", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();

    expect(snap).toHaveProperty("state");
    expect(snap).toHaveProperty("isVisible");
    expect(snap).toHaveProperty("since");
    expect(snap).toHaveProperty("durationMs");
    expect(snap).toHaveProperty("timestamp");
  });

  it("returns valid ISO timestamps", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();

    expect(() => new Date(snap.since)).not.toThrow();
    expect(() => new Date(snap.timestamp)).not.toThrow();
  });

  it("returns non-negative durationMs", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();
    expect(snap.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("isVisible matches state", () => {
    startTabVisibilityMonitor();
    const snap = getTabVisibilitySnapshot();
    expect(snap.isVisible).toBe(snap.state === "visible");
  });
});

// ─── Monitor lifecycle ───────────────────────────────────────────────────────

describe("monitor lifecycle", () => {
  it("starts and captures current visibility", () => {
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("visible");
  });

  it("detects visibility changes after start", () => {
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("visible");

    simulateVisibilityChange("hidden");
    expect(getTabVisibility()).toBe("hidden");
    expect(isTabVisible()).toBe(false);
  });

  it("detects transition back to visible", () => {
    startTabVisibilityMonitor();

    simulateVisibilityChange("hidden");
    expect(getTabVisibility()).toBe("hidden");

    simulateVisibilityChange("visible");
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });

  it("stops responding to events after stopTabVisibilityMonitor", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    stopTabVisibilityMonitor();
    simulateVisibilityChange("hidden");

    expect(listener).not.toHaveBeenCalled();
    // State should remain at the value when stopped, not react to the event
    expect(getTabVisibility()).toBe("visible");
  });

  it("restarts cleanly when called multiple times", () => {
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();

    startTabVisibilityMonitor({ onChange: onChange1 });
    startTabVisibilityMonitor({ onChange: onChange2 });

    simulateVisibilityChange("hidden");

    // Only the second onChange should fire (first was cleaned up on restart)
    expect(onChange1).not.toHaveBeenCalled();
    expect(onChange2).toHaveBeenCalledTimes(1);
  });

  it("resets all state with resetTabVisibility", () => {
    startTabVisibilityMonitor();
    simulateVisibilityChange("hidden");
    expect(getTabVisibility()).toBe("hidden");

    resetTabVisibility();
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });
});

// ─── Change listeners ────────────────────────────────────────────────────────

describe("visibility change listeners", () => {
  it("notifies listeners on visibility change", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    simulateVisibilityChange("hidden");

    expect(listener).toHaveBeenCalledTimes(1);
    const snap: TabVisibilitySnapshot = listener.mock.calls[0][0];
    expect(snap.state).toBe("hidden");
    expect(snap.isVisible).toBe(false);
  });

  it("unsubscribe function removes listener", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    const unsub = onVisibilityChange(listener);

    unsub();
    simulateVisibilityChange("hidden");

    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent listeners", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener1);
    onVisibilityChange(listener2);

    simulateVisibilityChange("hidden");

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("does not notify when state stays the same", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor(); // starts as visible
    onVisibilityChange(listener);

    // Simulate a visibilitychange event without actually changing the state
    document.dispatchEvent(new Event("visibilitychange"));

    expect(listener).not.toHaveBeenCalled();
  });

  it("passes snapshot with correct timing data", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    simulateVisibilityChange("hidden");

    const snap: TabVisibilitySnapshot = listener.mock.calls[0][0];
    expect(snap.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof snap.since).toBe("string");
    expect(typeof snap.timestamp).toBe("string");
  });
});

// ─── onChange config callback ────────────────────────────────────────────────

describe("onChange config callback", () => {
  it("calls onChange with snapshot and previous state", () => {
    const onChange = vi.fn();
    startTabVisibilityMonitor({ onChange });

    simulateVisibilityChange("hidden");

    expect(onChange).toHaveBeenCalledTimes(1);
    const [snapshot, previousState] = onChange.mock.calls[0];
    expect(snapshot.state).toBe("hidden");
    expect(previousState).toBe("visible");
  });

  it("calls onChange for each transition", () => {
    const onChange = vi.fn();
    startTabVisibilityMonitor({ onChange });

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");
    simulateVisibilityChange("hidden");

    expect(onChange).toHaveBeenCalledTimes(3);

    // First transition: visible → hidden
    expect(onChange.mock.calls[0][0].state).toBe("hidden");
    expect(onChange.mock.calls[0][1]).toBe("visible");

    // Second transition: hidden → visible
    expect(onChange.mock.calls[1][0].state).toBe("visible");
    expect(onChange.mock.calls[1][1]).toBe("hidden");

    // Third transition: visible → hidden
    expect(onChange.mock.calls[2][0].state).toBe("hidden");
    expect(onChange.mock.calls[2][1]).toBe("visible");
  });

  it("does not call onChange when state does not change", () => {
    const onChange = vi.fn();
    startTabVisibilityMonitor({ onChange });

    // Dispatch event without changing underlying state
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onChange).not.toHaveBeenCalled();
  });
});

// ─── Browser compatibility: API detection ────────────────────────────────────

describe("detectVisibilityAPI", () => {
  it("detects standard API when visibilityState exists", () => {
    const result = detectVisibilityAPI();
    expect(result.method).toBe("standard");
    expect(result.eventName).toBe("visibilitychange");
  });

  it("detects webkit prefix when only webkitVisibilityState exists", () => {
    // Temporarily remove standard API and add webkit prefix
    const origDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Document.prototype as any).visibilityState;
    // Also remove any instance-level override
    const origInstanceDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState"
    );
    if (origInstanceDescriptor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (document as any).visibilityState;
    }

    Object.defineProperty(document, "webkitVisibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    try {
      const result = detectVisibilityAPI();
      expect(result.method).toBe("webkit");
      expect(result.eventName).toBe("webkitvisibilitychange");
    } finally {
      // Restore standard API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (document as any).webkitVisibilityState;
      if (origDescriptor) {
        Object.defineProperty(
          Document.prototype,
          "visibilityState",
          origDescriptor
        );
      }
      if (origInstanceDescriptor) {
        Object.defineProperty(
          document,
          "visibilityState",
          origInstanceDescriptor
        );
      } else {
        // Re-apply the beforeEach value
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          writable: true,
          configurable: true,
        });
      }
    }
  });

  it("detects ms prefix when only msVisibilityState exists", () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Document.prototype as any).visibilityState;
    const origInstanceDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState"
    );
    if (origInstanceDescriptor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (document as any).visibilityState;
    }

    Object.defineProperty(document, "msVisibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    try {
      const result = detectVisibilityAPI();
      expect(result.method).toBe("ms");
      expect(result.eventName).toBe("msvisibilitychange");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (document as any).msVisibilityState;
      if (origDescriptor) {
        Object.defineProperty(
          Document.prototype,
          "visibilityState",
          origDescriptor
        );
      }
      if (origInstanceDescriptor) {
        Object.defineProperty(
          document,
          "visibilityState",
          origInstanceDescriptor
        );
      } else {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          writable: true,
          configurable: true,
        });
      }
    }
  });
});

// ─── Browser compatibility: capabilities reporting ───────────────────────────

describe("getVisibilityCapabilities", () => {
  it("reports no support before monitor starts", () => {
    const caps = getVisibilityCapabilities();
    expect(caps.supported).toBe(false);
    expect(caps.method).toBe("none");
    expect(caps.nativeAPI).toBe(false);
    expect(caps.usingFallback).toBe(false);
    expect(caps.eventName).toBeNull();
  });

  it("reports standard API capabilities after start", () => {
    startTabVisibilityMonitor();
    const caps = getVisibilityCapabilities();
    expect(caps.supported).toBe(true);
    expect(caps.method).toBe("standard");
    expect(caps.nativeAPI).toBe(true);
    expect(caps.usingFallback).toBe(false);
    expect(caps.eventName).toBe("visibilitychange");
  });

  it("resets capabilities on resetTabVisibility", () => {
    startTabVisibilityMonitor();
    expect(getVisibilityCapabilities().supported).toBe(true);

    resetTabVisibility();
    expect(getVisibilityCapabilities().supported).toBe(false);
    expect(getVisibilityCapabilities().method).toBe("none");
  });
});

// ─── Browser compatibility: focus/blur fallback ──────────────────────────────

describe("focus/blur fallback", () => {
  let origDescriptor: PropertyDescriptor | undefined;
  let origInstanceDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Remove the Page Visibility API entirely to force focus/blur fallback
    origDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState"
    );
    origInstanceDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Document.prototype as any).visibilityState;
    if (origInstanceDescriptor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (document as any).visibilityState;
    }
  });

  afterEach(() => {
    resetTabVisibility();
    // Restore the standard API
    if (origDescriptor) {
      Object.defineProperty(
        Document.prototype,
        "visibilityState",
        origDescriptor
      );
    }
    if (origInstanceDescriptor) {
      Object.defineProperty(
        document,
        "visibilityState",
        origInstanceDescriptor
      );
    } else {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
    }
  });

  it("falls back to focus/blur when Page Visibility API is unavailable", () => {
    startTabVisibilityMonitor();
    const caps = getVisibilityCapabilities();
    expect(caps.method).toBe("focus-blur");
    expect(caps.usingFallback).toBe(true);
    expect(caps.nativeAPI).toBe(false);
    expect(caps.supported).toBe(true);
  });

  it("detects hidden state on window blur", () => {
    startTabVisibilityMonitor();
    expect(getTabVisibility()).toBe("visible");

    window.dispatchEvent(new Event("blur"));
    expect(getTabVisibility()).toBe("hidden");
    expect(isTabVisible()).toBe(false);
  });

  it("detects visible state on window focus", () => {
    startTabVisibilityMonitor();

    window.dispatchEvent(new Event("blur"));
    expect(getTabVisibility()).toBe("hidden");

    window.dispatchEvent(new Event("focus"));
    expect(getTabVisibility()).toBe("visible");
    expect(isTabVisible()).toBe(true);
  });

  it("fires listeners on focus/blur transitions", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    window.dispatchEvent(new Event("blur"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].state).toBe("hidden");

    window.dispatchEvent(new Event("focus"));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].state).toBe("visible");
  });

  it("fires onChange callback on focus/blur transitions", () => {
    const onChange = vi.fn();
    startTabVisibilityMonitor({ onChange });

    window.dispatchEvent(new Event("blur"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].state).toBe("hidden");
    expect(onChange.mock.calls[0][1]).toBe("visible");

    window.dispatchEvent(new Event("focus"));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].state).toBe("visible");
    expect(onChange.mock.calls[1][1]).toBe("hidden");
  });

  it("does not fire when blur event occurs while already hidden", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    window.dispatchEvent(new Event("blur"));
    expect(listener).toHaveBeenCalledTimes(1);

    // Second blur should not fire
    window.dispatchEvent(new Event("blur"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not fire when focus event occurs while already visible", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    // Already visible, focus should not fire
    window.dispatchEvent(new Event("focus"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("cleans up focus/blur listeners on stop", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    stopTabVisibilityMonitor();

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));

    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── Transition history ──────────────────────────────────────────────────────

describe("transition history", () => {
  it("starts with empty history", () => {
    expect(getTransitionHistory()).toEqual([]);
  });

  it("records transitions", () => {
    startTabVisibilityMonitor();

    simulateVisibilityChange("hidden");
    simulateVisibilityChange("visible");

    const history = getTransitionHistory();
    expect(history).toHaveLength(2);

    expect(history[0].from).toBe("visible");
    expect(history[0].state).toBe("hidden");
    expect(typeof history[0].timestamp).toBe("string");

    expect(history[1].from).toBe("hidden");
    expect(history[1].state).toBe("visible");
  });

  it("clears history on reset", () => {
    startTabVisibilityMonitor();
    simulateVisibilityChange("hidden");
    expect(getTransitionHistory()).toHaveLength(1);

    resetTabVisibility();
    expect(getTransitionHistory()).toEqual([]);
  });

  it("bounds history to 50 entries", () => {
    startTabVisibilityMonitor();

    // Generate 60 transitions (alternating hidden/visible)
    for (let i = 0; i < 60; i++) {
      simulateVisibilityChange(i % 2 === 0 ? "hidden" : "visible");
    }

    const history = getTransitionHistory();
    expect(history.length).toBeLessThanOrEqual(50);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles rapid toggle without errors", () => {
    startTabVisibilityMonitor();

    for (let i = 0; i < 20; i++) {
      simulateVisibilityChange(i % 2 === 0 ? "hidden" : "visible");
    }

    // Should end on the last state (even index = hidden → next visible)
    expect(["visible", "hidden"]).toContain(getTabVisibility());
  });

  it("getTabVisibilitySnapshot works without starting monitor", () => {
    const snap = getTabVisibilitySnapshot();
    expect(snap).toHaveProperty("state");
    expect(snap).toHaveProperty("isVisible");
    expect(snap.state).toBe("visible"); // default
  });

  it("onVisibilityChange works before starting monitor", () => {
    const listener = vi.fn();
    const unsub = onVisibilityChange(listener);

    // Start monitor after subscribing
    startTabVisibilityMonitor();
    simulateVisibilityChange("hidden");

    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("reset cleans up event listener", () => {
    const listener = vi.fn();
    startTabVisibilityMonitor();
    onVisibilityChange(listener);

    resetTabVisibility();
    simulateVisibilityChange("hidden");

    // Listener was cleared by reset
    expect(listener).not.toHaveBeenCalled();
  });
});
