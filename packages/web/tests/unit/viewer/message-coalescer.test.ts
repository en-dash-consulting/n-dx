/**
 * Tests for WebSocket message coalescing module.
 *
 * Covers: throttle window batching, same-type deduplication, mixed-type
 * batching, ordering semantics, batch size limits, immediate per-message
 * callbacks, flush behaviour, disposal, and reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMessageCoalescer,
  type MessageCoalescer,
  type CoalescedBatch,
  type ParsedWSMessage,
} from "../../../src/viewer/messaging/message-coalescer.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function msg(type: string, extra: Record<string, unknown> = {}): ParsedWSMessage {
  return { type, ...extra };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createMessageCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an object with push, flush, and dispose methods", () => {
    const coalescer = createMessageCoalescer({ onFlush: vi.fn() });
    expect(typeof coalescer.push).toBe("function");
    expect(typeof coalescer.flush).toBe("function");
    expect(typeof coalescer.dispose).toBe("function");
    coalescer.dispose();
  });
});

describe("immediate onMessage callback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onMessage immediately for each pushed message", () => {
    const onMessage = vi.fn();
    const coalescer = createMessageCoalescer({
      onFlush: vi.fn(),
      onMessage,
    });

    const m = msg("rex:item-updated", { itemId: "a", updates: { status: "done" } });
    coalescer.push(m);

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(m);
    coalescer.dispose();
  });

  it("calls onMessage for every message even during a batch window", () => {
    const onMessage = vi.fn();
    const coalescer = createMessageCoalescer({
      onFlush: vi.fn(),
      onMessage,
      windowMs: 200,
    });

    coalescer.push(msg("rex:item-updated", { itemId: "a" }));
    coalescer.push(msg("rex:item-updated", { itemId: "b" }));
    coalescer.push(msg("rex:prd-changed"));

    expect(onMessage).toHaveBeenCalledTimes(3);
    coalescer.dispose();
  });
});

describe("throttle window batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call onFlush before the window expires", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 200 });

    coalescer.push(msg("rex:prd-changed"));

    expect(onFlush).not.toHaveBeenCalled();
    coalescer.dispose();
  });

  it("calls onFlush once after the window expires", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 200 });

    coalescer.push(msg("rex:prd-changed"));
    vi.advanceTimersByTime(200);

    expect(onFlush).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });

  it("extends the window when new messages arrive (trailing-edge debounce)", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 200 });

    coalescer.push(msg("rex:item-updated", { itemId: "a" }));
    vi.advanceTimersByTime(100);

    // Push another message before window expires — resets the timer
    coalescer.push(msg("rex:item-updated", { itemId: "b" }));
    vi.advanceTimersByTime(100);

    // Original 200ms window would have expired, but the second push reset it
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onFlush).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });
});

describe("same-type coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces multiple messages of the same type into one batch", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    coalescer.push(msg("rex:item-updated", { itemId: "a" }));
    coalescer.push(msg("rex:item-updated", { itemId: "b" }));
    coalescer.push(msg("rex:item-updated", { itemId: "c" }));

    vi.advanceTimersByTime(100);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.types).toEqual(new Set(["rex:item-updated"]));
    expect(batch.messages).toHaveLength(3);
    coalescer.dispose();
  });

  it("reports the correct message count per type", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    coalescer.push(msg("rex:item-updated", { itemId: "a" }));
    coalescer.push(msg("rex:item-updated", { itemId: "b" }));

    vi.advanceTimersByTime(100);

    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.countByType.get("rex:item-updated")).toBe(2);
    coalescer.dispose();
  });
});

describe("mixed message types", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches different message types together", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    coalescer.push(msg("rex:item-updated", { itemId: "a" }));
    coalescer.push(msg("rex:item-deleted", { itemId: "b" }));
    coalescer.push(msg("rex:prd-changed"));

    vi.advanceTimersByTime(100);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.types).toEqual(new Set([
      "rex:item-updated",
      "rex:item-deleted",
      "rex:prd-changed",
    ]));
    expect(batch.messages).toHaveLength(3);
    coalescer.dispose();
  });

  it("no data loss — all messages present in arrival order", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    const m1 = msg("rex:item-updated", { itemId: "a" });
    const m2 = msg("rex:prd-changed");
    const m3 = msg("rex:item-updated", { itemId: "b" });

    coalescer.push(m1);
    coalescer.push(m2);
    coalescer.push(m3);

    vi.advanceTimersByTime(100);

    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.messages[0]).toBe(m1);
    expect(batch.messages[1]).toBe(m2);
    expect(batch.messages[2]).toBe(m3);
    coalescer.dispose();
  });
});

describe("message ordering semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves insertion order in the batch", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    const messages = [
      msg("rex:item-updated", { itemId: "1" }),
      msg("rex:item-deleted", { itemId: "2" }),
      msg("rex:item-updated", { itemId: "3" }),
      msg("rex:prd-changed"),
      msg("hench:run-changed"),
    ];

    for (const m of messages) {
      coalescer.push(m);
    }

    vi.advanceTimersByTime(100);

    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    for (let i = 0; i < messages.length; i++) {
      expect(batch.messages[i]).toBe(messages[i]);
    }
    coalescer.dispose();
  });
});

describe("batch size limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forces a flush when maxBatchSize is reached", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({
      onFlush,
      windowMs: 500,
      maxBatchSize: 5,
    });

    // Push exactly maxBatchSize messages
    for (let i = 0; i < 5; i++) {
      coalescer.push(msg("rex:item-updated", { itemId: String(i) }));
    }

    // Should flush immediately without waiting for the window
    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.messages).toHaveLength(5);
    coalescer.dispose();
  });

  it("starts a new batch after forced flush", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({
      onFlush,
      windowMs: 500,
      maxBatchSize: 3,
    });

    // Push 5 messages — first 3 should flush, last 2 start new batch
    for (let i = 0; i < 5; i++) {
      coalescer.push(msg("rex:item-updated", { itemId: String(i) }));
    }

    // First batch flushed on push #3
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].messages).toHaveLength(3);

    // Remaining 2 messages are in a new batch — wait for window
    vi.advanceTimersByTime(500);
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1][0].messages).toHaveLength(2);
    coalescer.dispose();
  });

  it("does not accumulate unbounded messages", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({
      onFlush,
      windowMs: 1000,
      maxBatchSize: 10,
    });

    // Push 100 messages rapidly
    for (let i = 0; i < 100; i++) {
      coalescer.push(msg("rex:item-updated", { itemId: String(i) }));
    }

    // Should have flushed 10 times (100 / 10)
    expect(onFlush).toHaveBeenCalledTimes(10);

    // No leftover messages in any batch
    const totalMessages = onFlush.mock.calls.reduce(
      (sum: number, call: [CoalescedBatch]) => sum + call[0].messages.length,
      0,
    );
    expect(totalMessages).toBe(100);
    coalescer.dispose();
  });
});

describe("manual flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes the current batch immediately", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 500 });

    coalescer.push(msg("rex:prd-changed"));
    coalescer.flush();

    expect(onFlush).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });

  it("does nothing when batch is empty", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush });

    coalescer.flush();

    expect(onFlush).not.toHaveBeenCalled();
    coalescer.dispose();
  });

  it("cancels the pending timer after manual flush", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 200 });

    coalescer.push(msg("rex:prd-changed"));
    coalescer.flush();

    // Advance past the original window — should NOT double-flush
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });
});

describe("dispose", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels pending timers", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 200 });

    coalescer.push(msg("rex:prd-changed"));
    coalescer.dispose();

    vi.advanceTimersByTime(200);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("clears the batch without flushing", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 200 });

    coalescer.push(msg("rex:prd-changed"));
    coalescer.dispose();

    // Manual flush after dispose should do nothing
    coalescer.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("ignores pushes after disposal", () => {
    const onMessage = vi.fn();
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, onMessage, windowMs: 200 });

    coalescer.dispose();
    coalescer.push(msg("rex:prd-changed"));

    expect(onMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onFlush).not.toHaveBeenCalled();
  });
});

describe("sequential batches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates independent batches across windows", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    // First batch
    coalescer.push(msg("rex:item-updated", { itemId: "a" }));
    vi.advanceTimersByTime(100);

    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch1: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch1.messages).toHaveLength(1);
    expect(batch1.types).toEqual(new Set(["rex:item-updated"]));

    // Second batch
    coalescer.push(msg("rex:prd-changed"));
    coalescer.push(msg("hench:run-changed"));
    vi.advanceTimersByTime(100);

    expect(onFlush).toHaveBeenCalledTimes(2);
    const batch2: CoalescedBatch = onFlush.mock.calls[1][0];
    expect(batch2.messages).toHaveLength(2);
    expect(batch2.types).toEqual(new Set(["rex:prd-changed", "hench:run-changed"]));
    coalescer.dispose();
  });
});

describe("default configuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses sensible defaults when no config provided", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush });

    coalescer.push(msg("rex:prd-changed"));

    // Default window is 150ms
    vi.advanceTimersByTime(149);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });
});

describe("batch metadata", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes size in the batch", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    coalescer.push(msg("rex:item-updated"));
    coalescer.push(msg("rex:item-updated"));
    coalescer.push(msg("rex:prd-changed"));

    vi.advanceTimersByTime(100);

    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.size).toBe(3);
    coalescer.dispose();
  });

  it("includes countByType map", () => {
    const onFlush = vi.fn();
    const coalescer = createMessageCoalescer({ onFlush, windowMs: 100 });

    coalescer.push(msg("rex:item-updated"));
    coalescer.push(msg("rex:item-updated"));
    coalescer.push(msg("rex:item-deleted"));
    coalescer.push(msg("rex:prd-changed"));
    coalescer.push(msg("rex:prd-changed"));
    coalescer.push(msg("rex:prd-changed"));

    vi.advanceTimersByTime(100);

    const batch: CoalescedBatch = onFlush.mock.calls[0][0];
    expect(batch.countByType.get("rex:item-updated")).toBe(2);
    expect(batch.countByType.get("rex:item-deleted")).toBe(1);
    expect(batch.countByType.get("rex:prd-changed")).toBe(3);
    coalescer.dispose();
  });
});
