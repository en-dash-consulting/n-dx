/**
 * Tests for shared tick timer service.
 *
 * Covers: subscription lifecycle, auto-start/stop, single interval,
 * listener notification, disposal, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  onTick,
  getTickTimerState,
  resetTickTimer,
  suspendTickTimer,
  resumeTickTimer,
  type TickListener,
} from "../../../src/viewer/tick-timer.js";

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  resetTickTimer();
});

afterEach(() => {
  resetTickTimer();
  vi.useRealTimers();
});

// ─── Initial state ──────────────────────────────────────────────────────────

describe("initial state", () => {
  it("starts with zero subscribers and not running", () => {
    const state = getTickTimerState();
    expect(state.subscriberCount).toBe(0);
    expect(state.running).toBe(false);
  });
});

// ─── Subscription lifecycle ─────────────────────────────────────────────────

describe("subscription lifecycle", () => {
  it("increments subscriber count on subscribe", () => {
    const unsub = onTick(vi.fn());
    expect(getTickTimerState().subscriberCount).toBe(1);
    unsub();
  });

  it("decrements subscriber count on unsubscribe", () => {
    const unsub = onTick(vi.fn());
    expect(getTickTimerState().subscriberCount).toBe(1);
    unsub();
    expect(getTickTimerState().subscriberCount).toBe(0);
  });

  it("tracks multiple subscribers independently", () => {
    const unsub1 = onTick(vi.fn());
    const unsub2 = onTick(vi.fn());
    const unsub3 = onTick(vi.fn());
    expect(getTickTimerState().subscriberCount).toBe(3);

    unsub2();
    expect(getTickTimerState().subscriberCount).toBe(2);

    unsub1();
    unsub3();
    expect(getTickTimerState().subscriberCount).toBe(0);
  });

  it("returns an unsubscribe function", () => {
    const unsub = onTick(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("double-unsubscribe is a no-op", () => {
    const unsub = onTick(vi.fn());
    unsub();
    unsub(); // should not throw or go negative
    expect(getTickTimerState().subscriberCount).toBe(0);
  });
});

// ─── Auto-start / auto-stop ────────────────────────────────────────────────

describe("auto-start and auto-stop", () => {
  it("starts the timer when first subscriber joins", () => {
    expect(getTickTimerState().running).toBe(false);
    const unsub = onTick(vi.fn());
    expect(getTickTimerState().running).toBe(true);
    unsub();
  });

  it("stops the timer when last subscriber leaves", () => {
    const unsub1 = onTick(vi.fn());
    const unsub2 = onTick(vi.fn());
    expect(getTickTimerState().running).toBe(true);

    unsub1();
    expect(getTickTimerState().running).toBe(true); // still one subscriber

    unsub2();
    expect(getTickTimerState().running).toBe(false); // all gone
  });

  it("restarts the timer when a new subscriber joins after all left", () => {
    const unsub1 = onTick(vi.fn());
    unsub1();
    expect(getTickTimerState().running).toBe(false);

    const unsub2 = onTick(vi.fn());
    expect(getTickTimerState().running).toBe(true);
    unsub2();
  });
});

// ─── Single interval ────────────────────────────────────────────────────────

describe("single interval", () => {
  it("uses a 1-second interval", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    // Not called immediately
    expect(listener).not.toHaveBeenCalled();

    // Called after 1 second
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    // Called again after another second
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });

  it("shares a single setInterval across multiple subscribers", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const initialCallCount = spy.mock.calls.length;

    const unsub1 = onTick(vi.fn());
    const unsub2 = onTick(vi.fn());
    const unsub3 = onTick(vi.fn());

    // Only one setInterval should have been created
    expect(spy.mock.calls.length - initialCallCount).toBe(1);

    unsub1();
    unsub2();
    unsub3();
    spy.mockRestore();
  });

  it("does not call listeners after they unsubscribe", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = onTick(listener1);
    const unsub2 = onTick(listener2);

    vi.advanceTimersByTime(1000);
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    unsub1(); // remove listener1

    vi.advanceTimersByTime(1000);
    expect(listener1).toHaveBeenCalledTimes(1); // unchanged
    expect(listener2).toHaveBeenCalledTimes(2); // still ticking

    unsub2();
  });
});

// ─── Listener notification ──────────────────────────────────────────────────

describe("listener notification", () => {
  it("passes the current timestamp (Date.now()) to each listener", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    vi.advanceTimersByTime(1000);

    expect(listener).toHaveBeenCalledTimes(1);
    const arg = listener.mock.calls[0][0];
    expect(typeof arg).toBe("number");
    expect(arg).toBeGreaterThan(0);

    unsub();
  });

  it("notifies all subscribers on each tick", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const listener3 = vi.fn();

    const unsub1 = onTick(listener1);
    const unsub2 = onTick(listener2);
    const unsub3 = onTick(listener3);

    vi.advanceTimersByTime(1000);

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener3).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
    unsub3();
  });

  it("all listeners receive the same timestamp per tick", () => {
    const timestamps: number[] = [];
    const listener1: TickListener = (now) => timestamps.push(now);
    const listener2: TickListener = (now) => timestamps.push(now);

    const unsub1 = onTick(listener1);
    const unsub2 = onTick(listener2);

    vi.advanceTimersByTime(1000);

    expect(timestamps).toHaveLength(2);
    expect(timestamps[0]).toBe(timestamps[1]);

    unsub1();
    unsub2();
  });
});

// ─── Error resilience ───────────────────────────────────────────────────────

describe("error resilience", () => {
  it("continues notifying other listeners if one throws", () => {
    const errorListener = vi.fn(() => {
      throw new Error("boom");
    });
    const goodListener = vi.fn();

    const unsub1 = onTick(errorListener);
    const unsub2 = onTick(goodListener);

    // Should not throw out of the tick handler
    vi.advanceTimersByTime(1000);

    expect(errorListener).toHaveBeenCalledTimes(1);
    expect(goodListener).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });
});

// ─── Reset ──────────────────────────────────────────────────────────────────

describe("resetTickTimer", () => {
  it("clears all subscribers and stops the timer", () => {
    onTick(vi.fn());
    onTick(vi.fn());
    expect(getTickTimerState().subscriberCount).toBe(2);
    expect(getTickTimerState().running).toBe(true);

    resetTickTimer();

    expect(getTickTimerState().subscriberCount).toBe(0);
    expect(getTickTimerState().running).toBe(false);
  });

  it("no longer calls previous listeners after reset", () => {
    const listener = vi.fn();
    onTick(listener);

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    resetTickTimer();

    vi.advanceTimersByTime(5000);
    expect(listener).toHaveBeenCalledTimes(1); // unchanged
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles rapid subscribe/unsubscribe cycles", () => {
    for (let i = 0; i < 100; i++) {
      const unsub = onTick(vi.fn());
      unsub();
    }
    expect(getTickTimerState().subscriberCount).toBe(0);
    expect(getTickTimerState().running).toBe(false);
  });

  it("handles subscribing during a tick callback", () => {
    let innerUnsub: (() => void) | null = null;
    const innerListener = vi.fn();

    const outerUnsub = onTick(() => {
      if (!innerUnsub) {
        innerUnsub = onTick(innerListener);
      }
    });

    // First tick — outer subscribes inner
    vi.advanceTimersByTime(1000);
    expect(getTickTimerState().subscriberCount).toBe(2);

    // Second tick — both should fire
    vi.advanceTimersByTime(1000);
    expect(innerListener).toHaveBeenCalled();

    outerUnsub();
    innerUnsub!();
  });
});

// ─── Suspend / Resume ────────────────────────────────────────────────────────

describe("suspendTickTimer", () => {
  it("stops the timer without removing subscribers", () => {
    const unsub = onTick(vi.fn());
    expect(getTickTimerState().running).toBe(true);
    expect(getTickTimerState().subscriberCount).toBe(1);

    suspendTickTimer();

    expect(getTickTimerState().running).toBe(false);
    expect(getTickTimerState().subscriberCount).toBe(1);

    unsub();
  });

  it("prevents ticks from firing after suspension", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    suspendTickTimer();
    listener.mockClear();

    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();

    unsub();
  });

  it("is a no-op when the timer is already stopped", () => {
    // No subscribers → timer not running
    expect(getTickTimerState().running).toBe(false);
    suspendTickTimer(); // should not throw
    expect(getTickTimerState().running).toBe(false);
  });
});

describe("resumeTickTimer", () => {
  it("restarts the timer after suspension", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    suspendTickTimer();
    expect(getTickTimerState().running).toBe(false);

    resumeTickTimer();
    expect(getTickTimerState().running).toBe(true);

    unsub();
  });

  it("fires an immediate tick on resume for catch-up", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    // Clear the initial timer state
    vi.advanceTimersByTime(1000);
    listener.mockClear();

    suspendTickTimer();

    // Advance time while suspended
    vi.advanceTimersByTime(60000);
    expect(listener).not.toHaveBeenCalled();

    // Resume — immediate tick fires
    resumeTickTimer();
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("resumes regular ticking at 1-second intervals after catch-up", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    suspendTickTimer();
    resumeTickTimer();
    listener.mockClear();

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
  });

  it("is a no-op when the timer is already running", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    expect(getTickTimerState().running).toBe(true);

    // Should not start a second interval
    resumeTickTimer();
    expect(getTickTimerState().running).toBe(true);

    // Verify only one tick fires per second (no double-interval)
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("is a no-op when there are no subscribers", () => {
    // No subscribers → resume should not start the timer
    resumeTickTimer();
    expect(getTickTimerState().running).toBe(false);
  });

  it("handles suspend/resume cycles cleanly", () => {
    const listener = vi.fn();
    const unsub = onTick(listener);

    // Cycle 1
    suspendTickTimer();
    resumeTickTimer();
    listener.mockClear();

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    // Cycle 2
    suspendTickTimer();
    vi.advanceTimersByTime(5000);
    resumeTickTimer();
    listener.mockClear();

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });
});
