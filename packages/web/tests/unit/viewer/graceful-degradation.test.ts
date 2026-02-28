/**
 * Tests for the graceful degradation module.
 *
 * Covers: tier computation, feature sets per tier, degradation lifecycle
 * (start/stop), listener management, state transitions, and reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  featuresForTier,
  summaryForTier,
  startDegradation,
  stopDegradation,
  onDegradationChange,
  isFeatureDisabled,
  getDegradationState,
  getCurrentTier,
  resetDegradation,
  type DegradableFeature,
} from "../../../src/viewer/graceful-degradation.js";
import {
  startMemoryMonitor,
  resetMemoryMonitor,
} from "../../../src/viewer/memory-monitor.js";

describe("featuresForTier", () => {
  it("returns empty set for normal tier", () => {
    const features = featuresForTier("normal");
    expect(features.size).toBe(0);
  });

  it("disables autoRefresh and deferredLoading at elevated tier", () => {
    const features = featuresForTier("elevated");
    expect(features.has("autoRefresh")).toBe(true);
    expect(features.has("deferredLoading")).toBe(true);
    expect(features.size).toBe(2);
  });

  it("disables graphRendering and animations at warning tier (cumulative)", () => {
    const features = featuresForTier("warning");
    expect(features.has("autoRefresh")).toBe(true);
    expect(features.has("deferredLoading")).toBe(true);
    expect(features.has("graphRendering")).toBe(true);
    expect(features.has("animations")).toBe(true);
    expect(features.size).toBe(4);
  });

  it("disables detailPanel at critical tier (cumulative)", () => {
    const features = featuresForTier("critical");
    expect(features.has("autoRefresh")).toBe(true);
    expect(features.has("deferredLoading")).toBe(true);
    expect(features.has("graphRendering")).toBe(true);
    expect(features.has("animations")).toBe(true);
    expect(features.has("detailPanel")).toBe(true);
    expect(features.size).toBe(5);
  });
});

describe("summaryForTier", () => {
  it("returns empty string for normal tier", () => {
    expect(summaryForTier("normal")).toBe("");
  });

  it("returns a message for elevated tier", () => {
    const summary = summaryForTier("elevated");
    expect(summary).toContain("Auto-refresh");
    expect(summary).toContain("background data loading");
  });

  it("returns a message for warning tier", () => {
    const summary = summaryForTier("warning");
    expect(summary).toContain("graph view");
    expect(summary).toContain("animations");
  });

  it("returns a message for critical tier", () => {
    const summary = summaryForTier("critical");
    expect(summary).toContain("Critical");
    expect(summary).toContain("Refresh the page");
  });
});

describe("degradation lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMemoryMonitor();
    resetDegradation();
  });

  afterEach(() => {
    resetDegradation();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("starts with normal tier and no disabled features", () => {
    const state = getDegradationState();
    expect(state.tier).toBe("normal");
    expect(state.isDegraded).toBe(false);
    expect(state.disabledFeatures.size).toBe(0);
    expect(state.summary).toBe("");
  });

  it("returns current tier as normal by default", () => {
    expect(getCurrentTier()).toBe("normal");
  });

  it("reports no features disabled initially", () => {
    expect(isFeatureDisabled("autoRefresh")).toBe(false);
    expect(isFeatureDisabled("graphRendering")).toBe(false);
    expect(isFeatureDisabled("detailPanel")).toBe(false);
  });

  it("transitions to elevated when memory level reaches elevated", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;

    // Set up elevated memory usage (ratio ~0.55)
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.1 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.5 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    expect(getCurrentTier()).toBe("elevated");
    expect(isFeatureDisabled("autoRefresh")).toBe(true);
    expect(isFeatureDisabled("deferredLoading")).toBe(true);
    expect(isFeatureDisabled("graphRendering")).toBe(false);

    // Restore
    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });

  it("transitions to warning when memory level reaches warning", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;

    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.5 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.8 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024, // ratio = 0.75 → warning
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    expect(getCurrentTier()).toBe("warning");
    expect(isFeatureDisabled("graphRendering")).toBe(true);
    expect(isFeatureDisabled("animations")).toBe(true);
    expect(isFeatureDisabled("detailPanel")).toBe(false);

    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });

  it("transitions to critical when memory level reaches critical", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;

    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.8 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.9 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024, // ratio = 0.9 → critical
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();

    expect(getCurrentTier()).toBe("critical");
    expect(isFeatureDisabled("detailPanel")).toBe(true);

    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });

  it("recovers from degraded state when memory drops back to normal", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;

    // Start critical
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.8 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.9 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();
    expect(getCurrentTier()).toBe("critical");

    // Drop back to normal
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 200 * 1024 * 1024,
      totalJSHeapSize: 500 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024, // ratio = 0.1 → normal
    };

    vi.advanceTimersByTime(1000);
    expect(getCurrentTier()).toBe("normal");
    expect(isFeatureDisabled("autoRefresh")).toBe(false);
    expect(isFeatureDisabled("graphRendering")).toBe(false);
    expect(getDegradationState().isDegraded).toBe(false);

    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });

  it("resets all state with resetDegradation", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;

    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.8 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.9 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();
    expect(getCurrentTier()).toBe("critical");

    resetDegradation();
    expect(getCurrentTier()).toBe("normal");
    expect(getDegradationState().isDegraded).toBe(false);
    expect(getDegradationState().disabledFeatures.size).toBe(0);

    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });
});

describe("degradation listeners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMemoryMonitor();
    resetDegradation();
  });

  afterEach(() => {
    resetDegradation();
    resetMemoryMonitor();
    vi.useRealTimers();
  });

  it("notifies listeners on tier change", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;
    const listener = vi.fn();

    // Start normal
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 200 * 1024 * 1024,
      totalJSHeapSize: 500 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();
    onDegradationChange(listener);
    listener.mockClear();

    // Spike to critical
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.8 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.9 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    const state = listener.mock.calls[0][0];
    expect(state.tier).toBe("critical");
    expect(state.isDegraded).toBe(true);

    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });

  it("unsubscribe function removes listener", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;
    const listener = vi.fn();

    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 200 * 1024 * 1024,
      totalJSHeapSize: 500 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();
    const unsub = onDegradationChange(listener);
    listener.mockClear();

    unsub();

    // Spike to critical
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.8 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.9 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();

    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });

  it("does not notify when tier stays the same", () => {
    const listener = vi.fn();

    // Without performance.memory, level stays "normal" → no tier change
    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation();
    onDegradationChange(listener);
    listener.mockClear();

    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("calls onChange callback from config on tier transition", () => {
    const originalMemory = (performance as unknown as { memory?: unknown }).memory;
    const onChange = vi.fn();

    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 200 * 1024 * 1024,
      totalJSHeapSize: 500 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    startMemoryMonitor({ intervalMs: 1000 });
    startDegradation({ onChange });
    onChange.mockClear();

    // Spike to warning
    (performance as unknown as Record<string, unknown>).memory = {
      usedJSHeapSize: 1.5 * 1024 * 1024 * 1024,
      totalJSHeapSize: 1.8 * 1024 * 1024 * 1024,
      jsHeapSizeLimit: 2 * 1024 * 1024 * 1024,
    };

    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);

    const [state, previousTier] = onChange.mock.calls[0];
    expect(state.tier).toBe("warning");
    expect(previousTier).toBe("normal");

    if (originalMemory === undefined) {
      delete (performance as unknown as Record<string, unknown>).memory;
    } else {
      (performance as unknown as Record<string, unknown>).memory = originalMemory;
    }
  });
});

describe("getDegradationState", () => {
  beforeEach(() => {
    resetMemoryMonitor();
    resetDegradation();
  });

  afterEach(() => {
    resetDegradation();
    resetMemoryMonitor();
  });

  it("returns a frozen-like copy of the state", () => {
    const state = getDegradationState();
    expect(state.tier).toBe("normal");
    expect(state.isDegraded).toBe(false);
    expect(state.disabledFeatures).toBeInstanceOf(Set);
    expect(state.summary).toBe("");
  });

  it("disabledFeatures returns a new Set instance each call", () => {
    const a = getDegradationState().disabledFeatures;
    const b = getDegradationState().disabledFeatures;
    expect(a).not.toBe(b);
  });
});
