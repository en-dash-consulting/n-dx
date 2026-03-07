/**
 * Tests for throttled WebSocket message handler.
 *
 * Covers: per-type debounce, configurable intervals, default delay,
 * memory bounding, force-flush on limit, manual flush, disposal,
 * pass-through for unthrottled types, and sequential batch independence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMessageThrottle,
  type MessageThrottle,
  type ThrottledHandlerConfig,
} from "../../../src/viewer/messaging/message-throttle.js";
import type { ParsedWSMessage } from "../../../src/viewer/messaging/message-coalescer.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msg(type: string, extra: Record<string, unknown> = {}): ParsedWSMessage {
  return { type, ...extra };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createMessageThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an object with push, flush, and dispose methods", () => {
    const throttle = createMessageThrottle({ onMessage: vi.fn() });
    expect(typeof throttle.push).toBe("function");
    expect(typeof throttle.flush).toBe("function");
    expect(typeof throttle.dispose).toBe("function");
    throttle.dispose();
  });
});

describe("default debounce behaviour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call onMessage before the default delay (250ms)", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.push(msg("rex:prd-changed"));

    expect(onMessage).not.toHaveBeenCalled();
    throttle.dispose();
  });

  it("calls onMessage once after the default delay expires", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.push(msg("rex:prd-changed"));
    vi.advanceTimersByTime(250);

    expect(onMessage).toHaveBeenCalledTimes(1);
    throttle.dispose();
  });

  it("forwards the latest message for a throttled type", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      throttledTypes: ["rex:item-updated"],
    });

    throttle.push(msg("rex:item-updated", { itemId: "a" }));
    throttle.push(msg("rex:item-updated", { itemId: "b" }));
    throttle.push(msg("rex:item-updated", { itemId: "c" }));
    vi.advanceTimersByTime(250);

    // All messages forwarded — they accumulate and flush together
    expect(onMessage).toHaveBeenCalledTimes(3);
    throttle.dispose();
  });
});

describe("trailing-edge debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets the timer when new messages arrive for the same type", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 200,
      throttledTypes: ["rex:item-updated"],
    });

    throttle.push(msg("rex:item-updated", { itemId: "a" }));
    vi.advanceTimersByTime(100);

    // Another message — resets the timer
    throttle.push(msg("rex:item-updated", { itemId: "b" }));
    vi.advanceTimersByTime(100);

    // Original 200ms window would have expired, but second push reset it
    expect(onMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onMessage).toHaveBeenCalledTimes(2); // both messages forwarded
    throttle.dispose();
  });

  it("debounces each type independently", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 200,
      throttledTypes: ["rex:item-updated", "rex:prd-changed"],
    });

    throttle.push(msg("rex:item-updated", { itemId: "a" }));
    vi.advanceTimersByTime(100);

    throttle.push(msg("rex:prd-changed"));
    vi.advanceTimersByTime(100);

    // rex:item-updated timer has expired (200ms since push)
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].type).toBe("rex:item-updated");

    vi.advanceTimersByTime(100);

    // rex:prd-changed timer has now expired (200ms since its push)
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage.mock.calls[1][0].type).toBe("rex:prd-changed");
    throttle.dispose();
  });
});

describe("per-type intervals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses type-specific intervals from the delays config", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 250,
      delays: {
        "rex:prd-changed": 500,
        "rex:item-updated": 100,
      },
      throttledTypes: ["rex:prd-changed", "rex:item-updated"],
    });

    throttle.push(msg("rex:prd-changed"));
    throttle.push(msg("rex:item-updated"));

    // At 100ms: item-updated should fire, prd-changed should not
    vi.advanceTimersByTime(100);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].type).toBe("rex:item-updated");

    // At 500ms: prd-changed should fire
    vi.advanceTimersByTime(400);
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage.mock.calls[1][0].type).toBe("rex:prd-changed");
    throttle.dispose();
  });

  it("falls back to defaultDelayMs for types without explicit delay", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 300,
      delays: {
        "rex:prd-changed": 100,
      },
      throttledTypes: ["rex:prd-changed", "rex:item-deleted"],
    });

    throttle.push(msg("rex:item-deleted"));

    vi.advanceTimersByTime(299);
    expect(onMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onMessage).toHaveBeenCalledTimes(1);
    throttle.dispose();
  });
});

describe("pass-through for unthrottled types", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards unthrottled message types immediately", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.push(msg("hench:run-changed"));

    // Unthrottled — should forward immediately
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].type).toBe("hench:run-changed");
    throttle.dispose();
  });

  it("throttles configured types while passing through others", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 200,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.push(msg("rex:prd-changed"));
    throttle.push(msg("hench:run-changed"));
    throttle.push(msg("viewer:reload"));

    // Unthrottled types forwarded immediately
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage.mock.calls[0][0].type).toBe("hench:run-changed");
    expect(onMessage.mock.calls[1][0].type).toBe("viewer:reload");

    // Throttled type arrives after delay
    vi.advanceTimersByTime(200);
    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onMessage.mock.calls[2][0].type).toBe("rex:prd-changed");
    throttle.dispose();
  });
});

describe("memory bounding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("force-flushes a type when maxPendingPerType is reached", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 1000,
      maxPendingPerType: 5,
      throttledTypes: ["rex:item-updated"],
    });

    for (let i = 0; i < 5; i++) {
      throttle.push(msg("rex:item-updated", { itemId: String(i) }));
    }

    // Should force-flush without waiting for timer
    expect(onMessage).toHaveBeenCalledTimes(5);
    throttle.dispose();
  });

  it("starts a new pending batch after force-flush", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 1000,
      maxPendingPerType: 3,
      throttledTypes: ["rex:item-updated"],
    });

    // Push 5 messages — first 3 force-flush, last 2 wait
    for (let i = 0; i < 5; i++) {
      throttle.push(msg("rex:item-updated", { itemId: String(i) }));
    }

    expect(onMessage).toHaveBeenCalledTimes(3);

    // Remaining 2 flush after timer
    vi.advanceTimersByTime(1000);
    expect(onMessage).toHaveBeenCalledTimes(5);
    throttle.dispose();
  });

  it("does not accumulate unbounded messages during sustained bursts", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 5000,
      maxPendingPerType: 10,
      throttledTypes: ["rex:item-updated"],
    });

    // Push 100 messages rapidly
    for (let i = 0; i < 100; i++) {
      throttle.push(msg("rex:item-updated", { itemId: String(i) }));
    }

    // Should have force-flushed 10 times (100 / 10)
    expect(onMessage).toHaveBeenCalledTimes(100);
    throttle.dispose();
  });

  it("force-flush only affects the specific type, not others", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 1000,
      maxPendingPerType: 3,
      throttledTypes: ["rex:item-updated", "rex:prd-changed"],
    });

    // Push 3 item-updated (triggers force-flush) + 1 prd-changed (stays pending)
    throttle.push(msg("rex:prd-changed"));
    for (let i = 0; i < 3; i++) {
      throttle.push(msg("rex:item-updated", { itemId: String(i) }));
    }

    expect(onMessage).toHaveBeenCalledTimes(3); // only item-updated force-flushed

    // prd-changed still pending — flushes after timer
    vi.advanceTimersByTime(1000);
    expect(onMessage).toHaveBeenCalledTimes(4);
    expect(onMessage.mock.calls[3][0].type).toBe("rex:prd-changed");
    throttle.dispose();
  });
});

describe("manual flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes all pending messages across all types immediately", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 500,
      throttledTypes: ["rex:item-updated", "rex:prd-changed"],
    });

    throttle.push(msg("rex:item-updated", { itemId: "a" }));
    throttle.push(msg("rex:prd-changed"));
    throttle.flush();

    expect(onMessage).toHaveBeenCalledTimes(2);
    throttle.dispose();
  });

  it("does nothing when no messages are pending", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.flush();
    expect(onMessage).not.toHaveBeenCalled();
    throttle.dispose();
  });

  it("cancels pending timers after manual flush", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 200,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.push(msg("rex:prd-changed"));
    throttle.flush();

    // Advance past original timer — should NOT double-flush
    vi.advanceTimersByTime(200);
    expect(onMessage).toHaveBeenCalledTimes(1);
    throttle.dispose();
  });
});

describe("dispose", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels all pending timers", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 200,
      throttledTypes: ["rex:item-updated", "rex:prd-changed"],
    });

    throttle.push(msg("rex:item-updated"));
    throttle.push(msg("rex:prd-changed"));
    throttle.dispose();

    vi.advanceTimersByTime(200);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("clears pending messages without flushing", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 200,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.push(msg("rex:prd-changed"));
    throttle.dispose();

    // Manual flush after dispose — no-op
    throttle.flush();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("ignores pushes after disposal", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      throttledTypes: ["rex:prd-changed"],
    });

    throttle.dispose();
    throttle.push(msg("rex:prd-changed"));

    vi.advanceTimersByTime(250);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe("sequential batches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates independent batches across debounce windows for the same type", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 100,
      throttledTypes: ["rex:item-updated"],
    });

    // First batch
    throttle.push(msg("rex:item-updated", { itemId: "a" }));
    vi.advanceTimersByTime(100);

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].itemId).toBe("a");

    // Second batch
    throttle.push(msg("rex:item-updated", { itemId: "b" }));
    throttle.push(msg("rex:item-updated", { itemId: "c" }));
    vi.advanceTimersByTime(100);

    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onMessage.mock.calls[1][0].itemId).toBe("b");
    expect(onMessage.mock.calls[2][0].itemId).toBe("c");
    throttle.dispose();
  });
});

describe("all three target types", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles rex:prd-changed, rex:item-updated, and rex:item-deleted", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 200,
      throttledTypes: ["rex:prd-changed", "rex:item-updated", "rex:item-deleted"],
    });

    throttle.push(msg("rex:prd-changed"));
    throttle.push(msg("rex:item-updated", { itemId: "a" }));
    throttle.push(msg("rex:item-deleted", { itemId: "b" }));

    // None should have fired yet
    expect(onMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    // All three should fire (one per type)
    expect(onMessage).toHaveBeenCalledTimes(3);
    const types = onMessage.mock.calls.map((c: [ParsedWSMessage]) => c[0].type);
    expect(types).toContain("rex:prd-changed");
    expect(types).toContain("rex:item-updated");
    expect(types).toContain("rex:item-deleted");
    throttle.dispose();
  });
});

describe("edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles empty throttledTypes — all messages pass through immediately", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      throttledTypes: [],
    });

    throttle.push(msg("rex:prd-changed"));
    throttle.push(msg("rex:item-updated"));

    expect(onMessage).toHaveBeenCalledTimes(2);
    throttle.dispose();
  });

  it("handles undefined throttledTypes — all types are throttled", () => {
    const onMessage = vi.fn();
    const throttle = createMessageThrottle({
      onMessage,
      defaultDelayMs: 100,
    });

    throttle.push(msg("rex:prd-changed"));
    throttle.push(msg("any:random:type"));

    expect(onMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onMessage).toHaveBeenCalledTimes(2);
    throttle.dispose();
  });
});
