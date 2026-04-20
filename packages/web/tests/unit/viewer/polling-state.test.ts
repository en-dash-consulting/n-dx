// @vitest-environment jsdom
/**
 * Tests for the centralized polling state manager.
 *
 * Covers: source registration/unregistration, global suspend/resume,
 * essential source exemption, generation tracking, disposal lifecycle,
 * state introspection, listener notifications, component remount safety,
 * and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerPollingSource,
  unregisterPollingSource,
  suspendAllSources,
  resumeAllSources,
  disposeAllSources,
  isGlobalSuspended,
  getGeneration,
  isSourceRegistered,
  getSourceInfo,
  getPollingState,
  onPollingStateChange,
  getSourceCount,
  isGenerationCurrent,
  resetPollingState,
  type PollingSourceCallbacks,
  type PollingSourceStatus,
} from "../../../src/viewer/polling/engine/polling-state.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock polling source with controllable status. */
function createMockSource(initialStatus: PollingSourceStatus = "active"): {
  callbacks: PollingSourceCallbacks;
  status: { current: PollingSourceStatus };
  calls: {
    suspend: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
} {
  const status = { current: initialStatus };
  const calls = {
    suspend: vi.fn(() => { status.current = "suspended"; }),
    resume: vi.fn(() => { status.current = "active"; }),
    dispose: vi.fn(() => { status.current = "disposed"; }),
  };

  return {
    callbacks: {
      suspend: calls.suspend,
      resume: calls.resume,
      dispose: calls.dispose,
      getStatus: () => status.current,
    },
    status,
    calls,
  };
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  resetPollingState();
});

afterEach(() => {
  resetPollingState();
});

// ─── Registration ────────────────────────────────────────────────────────────

describe("source registration", () => {
  it("registers a source and makes it queryable", () => {
    const { callbacks } = createMockSource();
    registerPollingSource("test", callbacks);

    expect(isSourceRegistered("test")).toBe(true);
    expect(getSourceCount()).toBe(1);
  });

  it("returns an unregister function that removes without calling dispose", () => {
    const { callbacks, calls } = createMockSource();
    const unregister = registerPollingSource("test", callbacks);

    expect(isSourceRegistered("test")).toBe(true);

    unregister();
    expect(isSourceRegistered("test")).toBe(false);
    // unregister does NOT call dispose — the source handles its own cleanup.
    expect(calls.dispose).not.toHaveBeenCalled();
  });

  it("replaces an existing source with the same key", () => {
    const first = createMockSource();
    const second = createMockSource();

    registerPollingSource("test", first.callbacks);
    registerPollingSource("test", second.callbacks);

    expect(getSourceCount()).toBe(1);
    expect(first.calls.dispose).toHaveBeenCalledTimes(1);
  });

  it("registers multiple sources with different keys", () => {
    registerPollingSource("a", createMockSource().callbacks);
    registerPollingSource("b", createMockSource().callbacks);
    registerPollingSource("c", createMockSource().callbacks);

    expect(getSourceCount()).toBe(3);
    expect(isSourceRegistered("a")).toBe(true);
    expect(isSourceRegistered("b")).toBe(true);
    expect(isSourceRegistered("c")).toBe(true);
  });

  it("unregistering a non-existent key is a no-op", () => {
    unregisterPollingSource("does-not-exist");
    expect(getSourceCount()).toBe(0);
  });
});

// ─── Unregistration ──────────────────────────────────────────────────────────

describe("source unregistration", () => {
  it("removes the source without calling dispose", () => {
    const { callbacks, calls } = createMockSource();
    registerPollingSource("test", callbacks);

    unregisterPollingSource("test");

    expect(isSourceRegistered("test")).toBe(false);
    expect(getSourceCount()).toBe(0);
    // unregister does NOT call dispose — the source handles its own cleanup.
    expect(calls.dispose).not.toHaveBeenCalled();
  });

  it("unregister function is idempotent", () => {
    const { callbacks } = createMockSource();
    const unregister = registerPollingSource("test", callbacks);

    unregister();
    unregister();

    // Second call is a no-op — source already removed.
    expect(getSourceCount()).toBe(0);
  });
});

// ─── Global suspend/resume ───────────────────────────────────────────────────

describe("global suspend", () => {
  it("suspends all non-essential sources", () => {
    const a = createMockSource();
    const b = createMockSource();
    registerPollingSource("a", a.callbacks);
    registerPollingSource("b", b.callbacks);

    suspendAllSources();

    expect(isGlobalSuspended()).toBe(true);
    expect(a.calls.suspend).toHaveBeenCalledTimes(1);
    expect(b.calls.suspend).toHaveBeenCalledTimes(1);
  });

  it("skips essential sources during suspension", () => {
    const essential = createMockSource();
    const normal = createMockSource();
    registerPollingSource("mem-monitor", essential.callbacks, { essential: true });
    registerPollingSource("dom-perf", normal.callbacks);

    suspendAllSources();

    expect(essential.calls.suspend).not.toHaveBeenCalled();
    expect(normal.calls.suspend).toHaveBeenCalledTimes(1);
    expect(essential.status.current).toBe("active");
    expect(normal.status.current).toBe("suspended");
  });

  it("is idempotent when already suspended", () => {
    const { callbacks, calls } = createMockSource();
    registerPollingSource("test", callbacks);

    suspendAllSources();
    const genAfterFirst = getGeneration();
    suspendAllSources();

    expect(calls.suspend).toHaveBeenCalledTimes(1);
    expect(getGeneration()).toBe(genAfterFirst);
  });

  it("suspends newly registered non-essential sources while globally suspended", () => {
    suspendAllSources();

    const { callbacks, calls } = createMockSource();
    registerPollingSource("late-joiner", callbacks);

    expect(calls.suspend).toHaveBeenCalledTimes(1);
  });

  it("does not suspend newly registered essential sources while globally suspended", () => {
    suspendAllSources();

    const { callbacks, calls } = createMockSource();
    registerPollingSource("essential-late", callbacks, { essential: true });

    expect(calls.suspend).not.toHaveBeenCalled();
  });
});

describe("global resume", () => {
  it("resumes all non-essential sources", () => {
    const a = createMockSource();
    const b = createMockSource();
    registerPollingSource("a", a.callbacks);
    registerPollingSource("b", b.callbacks);

    suspendAllSources();
    resumeAllSources();

    expect(isGlobalSuspended()).toBe(false);
    expect(a.calls.resume).toHaveBeenCalledTimes(1);
    expect(b.calls.resume).toHaveBeenCalledTimes(1);
  });

  it("skips essential sources during resume (they were never suspended)", () => {
    const essential = createMockSource();
    registerPollingSource("mem-monitor", essential.callbacks, { essential: true });

    suspendAllSources();
    resumeAllSources();

    expect(essential.calls.resume).not.toHaveBeenCalled();
  });

  it("is a no-op when not suspended", () => {
    const { callbacks, calls } = createMockSource();
    registerPollingSource("test", callbacks);

    resumeAllSources();

    expect(calls.resume).not.toHaveBeenCalled();
  });
});

// ─── Generation tracking ─────────────────────────────────────────────────────

describe("generation tracking", () => {
  it("starts at generation 0", () => {
    expect(getGeneration()).toBe(0);
  });

  it("increments on suspend", () => {
    suspendAllSources();
    expect(getGeneration()).toBe(1);
  });

  it("increments on resume", () => {
    suspendAllSources();
    resumeAllSources();
    expect(getGeneration()).toBe(2);
  });

  it("increments on disposeAll", () => {
    disposeAllSources();
    expect(getGeneration()).toBe(1);
  });

  it("tracks multiple suspend/resume cycles", () => {
    const { callbacks } = createMockSource();
    registerPollingSource("test", callbacks);

    suspendAllSources();
    expect(getGeneration()).toBe(1);
    resumeAllSources();
    expect(getGeneration()).toBe(2);
    suspendAllSources();
    expect(getGeneration()).toBe(3);
    resumeAllSources();
    expect(getGeneration()).toBe(4);
  });

  it("isGenerationCurrent detects stale generation", () => {
    const gen = getGeneration();
    expect(isGenerationCurrent(gen)).toBe(true);

    suspendAllSources();
    expect(isGenerationCurrent(gen)).toBe(false);
    expect(isGenerationCurrent(getGeneration())).toBe(true);
  });

  it("idempotent suspend does not increment generation", () => {
    suspendAllSources();
    const gen = getGeneration();
    suspendAllSources();
    expect(getGeneration()).toBe(gen);
  });

  it("idempotent resume does not increment generation", () => {
    const gen = getGeneration();
    resumeAllSources();
    expect(getGeneration()).toBe(gen);
  });
});

// ─── Dispose all ─────────────────────────────────────────────────────────────

describe("disposeAllSources", () => {
  it("disposes all sources and clears the registry", () => {
    const a = createMockSource();
    const b = createMockSource();
    registerPollingSource("a", a.callbacks);
    registerPollingSource("b", b.callbacks);

    disposeAllSources();

    expect(getSourceCount()).toBe(0);
    expect(a.calls.dispose).toHaveBeenCalledTimes(1);
    expect(b.calls.dispose).toHaveBeenCalledTimes(1);
    expect(isGlobalSuspended()).toBe(false);
  });

  it("disposes essential sources too", () => {
    const essential = createMockSource();
    registerPollingSource("mem-monitor", essential.callbacks, { essential: true });

    disposeAllSources();

    expect(essential.calls.dispose).toHaveBeenCalledTimes(1);
    expect(getSourceCount()).toBe(0);
  });

  it("allows new registrations after dispose", () => {
    const first = createMockSource();
    registerPollingSource("test", first.callbacks);
    disposeAllSources();

    const second = createMockSource();
    registerPollingSource("test", second.callbacks);
    expect(getSourceCount()).toBe(1);
    expect(isSourceRegistered("test")).toBe(true);
  });

  it("clears global suspended state", () => {
    suspendAllSources();
    expect(isGlobalSuspended()).toBe(true);

    disposeAllSources();
    expect(isGlobalSuspended()).toBe(false);
  });
});

// ─── State introspection ─────────────────────────────────────────────────────

describe("state introspection", () => {
  it("getSourceInfo returns null for unknown key", () => {
    expect(getSourceInfo("unknown")).toBeNull();
  });

  it("getSourceInfo returns correct data", () => {
    const { callbacks } = createMockSource("active");
    registerPollingSource("test", callbacks, { essential: true });

    const info = getSourceInfo("test");
    expect(info).not.toBeNull();
    expect(info!.key).toBe("test");
    expect(info!.status).toBe("active");
    expect(info!.essential).toBe(true);
    expect(info!.registeredAt).toBeTruthy();
  });

  it("getPollingState returns a complete snapshot", () => {
    const active = createMockSource("active");
    const suspended = createMockSource("suspended");
    registerPollingSource("active", active.callbacks);
    registerPollingSource("suspended", suspended.callbacks);

    suspendAllSources();

    const state = getPollingState();
    expect(state.sourceCount).toBe(2);
    expect(state.globalSuspended).toBe(true);
    expect(state.generation).toBe(1);
    expect(state.sources).toHaveLength(2);
  });

  it("snapshot counts active and suspended sources", () => {
    const ess = createMockSource("active");
    const normal = createMockSource("active");
    registerPollingSource("essential", ess.callbacks, { essential: true });
    registerPollingSource("normal", normal.callbacks);

    suspendAllSources();

    const state = getPollingState();
    expect(state.activeCount).toBe(1); // essential remains active
    expect(state.suspendedCount).toBe(1); // normal was suspended
  });
});

// ─── Listener notifications ──────────────────────────────────────────────────

describe("listener notifications", () => {
  it("notifies on source registration", () => {
    const listener = vi.fn();
    onPollingStateChange(listener);

    registerPollingSource("test", createMockSource().callbacks);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCount: 1 }),
    );
  });

  it("notifies on source unregistration", () => {
    const { callbacks } = createMockSource();
    registerPollingSource("test", callbacks);

    const listener = vi.fn();
    onPollingStateChange(listener);

    unregisterPollingSource("test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCount: 0 }),
    );
  });

  it("notifies on suspend", () => {
    const listener = vi.fn();
    onPollingStateChange(listener);

    suspendAllSources();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ globalSuspended: true }),
    );
  });

  it("notifies on resume", () => {
    suspendAllSources();

    const listener = vi.fn();
    onPollingStateChange(listener);

    resumeAllSources();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ globalSuspended: false }),
    );
  });

  it("notifies on disposeAll", () => {
    registerPollingSource("test", createMockSource().callbacks);

    const listener = vi.fn();
    onPollingStateChange(listener);

    disposeAllSources();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCount: 0 }),
    );
  });

  it("unsubscribe function stops notifications", () => {
    const listener = vi.fn();
    const unsub = onPollingStateChange(listener);

    registerPollingSource("test", createMockSource().callbacks);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    registerPollingSource("test2", createMockSource().callbacks);
    expect(listener).toHaveBeenCalledTimes(1); // no additional call
  });

  it("swallows listener errors without affecting other listeners", () => {
    const errorListener = vi.fn(() => {
      throw new Error("boom");
    });
    const goodListener = vi.fn();

    onPollingStateChange(errorListener);
    onPollingStateChange(goodListener);

    registerPollingSource("test", createMockSource().callbacks);

    expect(goodListener).toHaveBeenCalledTimes(1);
  });
});

// ─── Error resilience ────────────────────────────────────────────────────────

describe("error resilience", () => {
  it("swallows errors from source.suspend during suspendAll", () => {
    const source = createMockSource();
    source.callbacks.suspend = () => { throw new Error("suspend boom"); };
    registerPollingSource("bad", source.callbacks);

    const good = createMockSource();
    registerPollingSource("good", good.callbacks);

    expect(() => suspendAllSources()).not.toThrow();
    expect(good.calls.suspend).toHaveBeenCalledTimes(1);
  });

  it("swallows errors from source.resume during resumeAll", () => {
    const source = createMockSource();
    registerPollingSource("bad", source.callbacks);

    suspendAllSources();

    // Replace resume with a throwing function
    source.callbacks.resume = () => { throw new Error("resume boom"); };

    const good = createMockSource();
    registerPollingSource("good", good.callbacks);
    // good was auto-suspended since global is suspended

    expect(() => resumeAllSources()).not.toThrow();
  });

  it("swallows errors from source.dispose during disposeAll", () => {
    const source = createMockSource();
    source.callbacks.dispose = () => { throw new Error("dispose boom"); };
    registerPollingSource("bad", source.callbacks);

    const good = createMockSource();
    registerPollingSource("good", good.callbacks);

    expect(() => disposeAllSources()).not.toThrow();
    expect(good.calls.dispose).toHaveBeenCalledTimes(1);
  });

  it("swallows errors from existing source.dispose on re-registration", () => {
    const first = createMockSource();
    first.callbacks.dispose = () => { throw new Error("dispose boom"); };
    registerPollingSource("test", first.callbacks);

    const second = createMockSource();
    expect(() => registerPollingSource("test", second.callbacks)).not.toThrow();
    expect(getSourceCount()).toBe(1);
  });
});

// ─── Component remount safety ────────────────────────────────────────────────

describe("component remount safety", () => {
  it("re-registration after unregister restores source cleanly", () => {
    const first = createMockSource();
    const unsub = registerPollingSource("component-poll", first.callbacks);
    unsub();

    expect(isSourceRegistered("component-poll")).toBe(false);

    const second = createMockSource();
    registerPollingSource("component-poll", second.callbacks);

    expect(isSourceRegistered("component-poll")).toBe(true);
    expect(second.status.current).toBe("active");
  });

  it("re-registration during suspension starts suspended", () => {
    const first = createMockSource();
    registerPollingSource("component-poll", first.callbacks);
    suspendAllSources();

    // Simulate component unmount
    unregisterPollingSource("component-poll");

    // Simulate component remount
    const second = createMockSource();
    registerPollingSource("component-poll", second.callbacks);

    // Should be suspended because global suspension is still active
    expect(second.calls.suspend).toHaveBeenCalledTimes(1);
    expect(second.status.current).toBe("suspended");
  });

  it("generation check prevents stale operations after remount", () => {
    const { callbacks } = createMockSource();
    registerPollingSource("test", callbacks);

    const gen = getGeneration();

    // Simulate a lifecycle change
    suspendAllSources();
    resumeAllSources();

    // Generation has changed — stale check fails
    expect(isGenerationCurrent(gen)).toBe(false);
  });

  it("multiple rapid register/unregister cycles do not leak sources", () => {
    for (let i = 0; i < 10; i++) {
      const { callbacks } = createMockSource();
      const unsub = registerPollingSource("rapid", callbacks);
      unsub();
    }

    expect(getSourceCount()).toBe(0);
    expect(isSourceRegistered("rapid")).toBe(false);
  });
});

// ─── Mixed essential and non-essential sources ───────────────────────────────

describe("mixed essential and non-essential", () => {
  it("full suspend/resume cycle preserves essential sources", () => {
    const memMonitor = createMockSource();
    const domPerf = createMockSource();
    const tickTimer = createMockSource();
    const poller = createMockSource();

    registerPollingSource("memory-monitor", memMonitor.callbacks, { essential: true });
    registerPollingSource("dom-perf", domPerf.callbacks);
    registerPollingSource("tick-timer", tickTimer.callbacks);
    registerPollingSource("polling-manager", poller.callbacks);

    // Suspend all
    suspendAllSources();

    expect(memMonitor.status.current).toBe("active");
    expect(domPerf.status.current).toBe("suspended");
    expect(tickTimer.status.current).toBe("suspended");
    expect(poller.status.current).toBe("suspended");

    // Resume all
    resumeAllSources();

    expect(memMonitor.status.current).toBe("active");
    expect(domPerf.status.current).toBe("active");
    expect(tickTimer.status.current).toBe("active");
    expect(poller.status.current).toBe("active");

    // Verify essential was never touched
    expect(memMonitor.calls.suspend).not.toHaveBeenCalled();
    expect(memMonitor.calls.resume).not.toHaveBeenCalled();
  });

  it("disposeAll disposes essential sources too (full shutdown)", () => {
    const memMonitor = createMockSource();
    registerPollingSource("memory-monitor", memMonitor.callbacks, { essential: true });

    const poller = createMockSource();
    registerPollingSource("poller", poller.callbacks);

    disposeAllSources();

    expect(memMonitor.calls.dispose).toHaveBeenCalledTimes(1);
    expect(poller.calls.dispose).toHaveBeenCalledTimes(1);
    expect(getSourceCount()).toBe(0);
  });
});

// ─── Reset ───────────────────────────────────────────────────────────────────

describe("resetPollingState", () => {
  it("disposes all sources and resets generation", () => {
    const { callbacks, calls } = createMockSource();
    registerPollingSource("test", callbacks);
    suspendAllSources();

    resetPollingState();

    expect(getSourceCount()).toBe(0);
    expect(isGlobalSuspended()).toBe(false);
    expect(getGeneration()).toBe(0);
    expect(calls.dispose).toHaveBeenCalled();
  });

  it("clears all listeners", () => {
    const listener = vi.fn();
    onPollingStateChange(listener);

    resetPollingState();

    registerPollingSource("test", createMockSource().callbacks);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── Orphaned interval prevention ────────────────────────────────────────────

describe("orphaned interval prevention", () => {
  it("replacing a source disposes the old one first", () => {
    const old = createMockSource();
    registerPollingSource("shared-key", old.callbacks);

    const replacement = createMockSource();
    registerPollingSource("shared-key", replacement.callbacks);

    expect(old.calls.dispose).toHaveBeenCalledTimes(1);
    expect(old.status.current).toBe("disposed");
    expect(replacement.status.current).toBe("active");
    expect(getSourceCount()).toBe(1);
  });

  it("disposeAll prevents any source from continuing to run", () => {
    const sources = Array.from({ length: 5 }, () => createMockSource());
    sources.forEach((s, i) => registerPollingSource(`source-${i}`, s.callbacks));

    disposeAllSources();

    sources.forEach((s) => {
      expect(s.calls.dispose).toHaveBeenCalledTimes(1);
      expect(s.status.current).toBe("disposed");
    });
  });

  it("unregister function removes source even after global suspend", () => {
    const { callbacks } = createMockSource();
    const unsub = registerPollingSource("test", callbacks);

    suspendAllSources();
    unsub();

    // Source is removed from registry (dispose is NOT called — the
    // source's own stop function is responsible for cleanup).
    expect(isSourceRegistered("test")).toBe(false);
  });
});
