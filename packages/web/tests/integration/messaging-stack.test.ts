/**
 * Integration test for the composed messaging stack.
 *
 * Validates that the two composed pipelines (WSPipeline and FetchPipeline)
 * work together end-to-end under realistic conditions:
 *
 *   WSPipeline (throttle → coalescer) ──onFlush──→ FetchPipeline (rate limiter → dedup)
 *
 * Unlike the unit tests (which verify each pipeline in isolation) and the
 * request-dedup integration test (which wires up raw primitives manually),
 * this test instantiates the composed factories from the messaging barrel
 * and verifies the full stack cooperates correctly.
 *
 * Acceptance criteria:
 *   1. Rate limiting caps outbound API calls when WS messages arrive rapidly.
 *   2. Throttling debounces per-type messages before they reach the coalescer.
 *   3. The FetchPipeline is not bypassed — all WS-triggered fetches go through it.
 *   4. Dispose tears down the entire stack cleanly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createWSPipeline,
  createFetchPipeline,
  type WSPipeline,
  type FetchPipeline,
  type CoalescedBatch,
  type ParsedWSMessage,
} from "../../src/viewer/messaging/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msg(type: string, extra: Record<string, unknown> = {}): ParsedWSMessage {
  return { type, ...extra };
}

/**
 * Wire up the full composed messaging stack:
 *   WSPipeline ──onFlush──→ FetchPipeline.execute()
 *
 * The onFlush callback from the WSPipeline triggers the FetchPipeline,
 * mirroring how the viewer's hooks connect these layers.
 */
function createComposedStack<T = void>(
  fn: () => Promise<T>,
  opts?: {
    minIntervalMs?: number;
    coalescerWindowMs?: number;
    throttleDelayMs?: number;
    throttledTypes?: string[];
  },
) {
  const minIntervalMs = opts?.minIntervalMs ?? 500;
  const coalescerWindowMs = opts?.coalescerWindowMs ?? 150;
  const throttleDelayMs = opts?.throttleDelayMs ?? 250;
  const throttledTypes = opts?.throttledTypes ?? [
    "rex:prd-changed",
    "rex:item-updated",
    "rex:item-deleted",
  ];

  const onMessage = vi.fn();
  const flushSpy = vi.fn();

  const fetchPipeline: FetchPipeline<T> = createFetchPipeline(fn, { minIntervalMs });

  const wsPipeline: WSPipeline = createWSPipeline({
    onMessage,
    onFlush: (batch: CoalescedBatch) => {
      flushSpy(batch);
      fetchPipeline.execute();
    },
    throttledTypes,
    defaultDelayMs: throttleDelayMs,
    coalescerWindowMs,
  });

  function dispose() {
    wsPipeline.dispose();
    fetchPipeline.dispose();
  }

  return { wsPipeline, fetchPipeline, onMessage, flushSpy, dispose };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. Rate limiting caps outbound API calls ────────────────────────────────

describe("rate limiting through composed stack", () => {
  it("rapid WS messages produce at most 2 API calls (initial + 1 queued)", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { wsPipeline, dispose } = createComposedStack(fn, {
      minIntervalMs: 500,
      throttleDelayMs: 50,
      coalescerWindowMs: 50,
    });

    // Push a burst of WS messages through the full stack
    for (let i = 0; i < 10; i++) {
      wsPipeline.push(msg("rex:item-updated", { id: String(i) }));
    }

    // Advance past throttle delay (50ms) — messages flow to coalescer
    vi.advanceTimersByTime(50);

    // Advance past coalescer window (50ms) — triggers FetchPipeline.execute()
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);

    // First call executes immediately
    expect(fn).toHaveBeenCalledTimes(1);

    // Push another burst while rate limiter is in cooldown
    for (let i = 0; i < 5; i++) {
      wsPipeline.push(msg("rex:item-updated", { id: `second-${i}` }));
    }

    // Advance through throttle + coalescer again
    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);

    // Still 1 — within rate limiter cooldown, call is queued
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past rate limiter cooldown
    vi.advanceTimersByTime(400);
    await vi.advanceTimersByTimeAsync(0);

    // Queued call fires — exactly 2 total
    expect(fn).toHaveBeenCalledTimes(2);

    dispose();
  });

  it("FetchPipeline deduplicates concurrent in-flight requests", async () => {
    let resolvePromise!: (value: string) => void;
    let callCount = 0;
    const fn = vi.fn(() => {
      callCount++;
      return new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });
    });

    const { fetchPipeline, wsPipeline, dispose } = createComposedStack(fn, {
      minIntervalMs: 0, // No rate limiting — dedup only
      throttleDelayMs: 10,
      coalescerWindowMs: 10,
      throttledTypes: [], // All pass through immediately
    });

    // First WS message triggers fetch — holds in-flight
    wsPipeline.push(msg("info"));
    vi.advanceTimersByTime(10); // coalescer fires
    await vi.advanceTimersByTimeAsync(0);

    expect(callCount).toBe(1);
    expect(fetchPipeline.isInFlight()).toBe(true);

    // Second WS message while first fetch is in-flight
    wsPipeline.push(msg("info"));
    vi.advanceTimersByTime(10);
    await vi.advanceTimersByTimeAsync(0);

    // Dedup prevents second API call
    expect(callCount).toBe(1);

    resolvePromise("done");
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchPipeline.isInFlight()).toBe(false);
    dispose();
  });
});

// ─── 2. Throttling debounces per-type messages ───────────────────────────────

describe("per-type throttling through composed stack", () => {
  it("different message types throttle independently", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { wsPipeline, flushSpy, dispose } = createComposedStack(fn, {
      minIntervalMs: 0, // No rate limiting for this test
      throttleDelayMs: 100,
      coalescerWindowMs: 50,
    });

    // Push two different throttled types
    wsPipeline.push(msg("rex:prd-changed"));
    wsPipeline.push(msg("rex:item-updated"));

    // At T=0, both types are pending in throttle
    expect(flushSpy).not.toHaveBeenCalled();

    // Advance past throttle delay (100ms) — both types flush to coalescer
    vi.advanceTimersByTime(100);

    // Coalescer accumulates, trailing-edge debounce pending
    expect(flushSpy).not.toHaveBeenCalled();

    // Advance past coalescer window (50ms) — single coalesced flush
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);

    // One flush with both message types
    expect(flushSpy).toHaveBeenCalledTimes(1);
    const batch: CoalescedBatch = flushSpy.mock.calls[0][0];
    expect(batch.types.has("rex:prd-changed")).toBe(true);
    expect(batch.types.has("rex:item-updated")).toBe(true);
    expect(batch.size).toBe(2);

    dispose();
  });

  it("unthrottled types pass through immediately to coalescer", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { wsPipeline, onMessage, flushSpy, dispose } = createComposedStack(fn, {
      minIntervalMs: 0,
      throttleDelayMs: 1000, // Throttled types have long delay
      coalescerWindowMs: 30,
      throttledTypes: ["rex:prd-changed"], // Only prd-changed is throttled
    });

    // "custom:fast" is not throttled — passes through immediately
    wsPipeline.push(msg("custom:fast"));

    // onMessage fires immediately (before any timers)
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0].type).toBe("custom:fast");

    // Advance past coalescer window only (30ms)
    vi.advanceTimersByTime(30);
    await vi.advanceTimersByTimeAsync(0);

    // Flush triggered — unthrottled message reached the API
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("throttle debounce resets on new messages of the same type", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { wsPipeline, flushSpy, dispose } = createComposedStack(fn, {
      minIntervalMs: 0,
      throttleDelayMs: 100,
      coalescerWindowMs: 30,
    });

    // Push first message
    wsPipeline.push(msg("rex:item-updated", { id: "1" }));

    // At T=80ms, push another — resets the 100ms debounce
    vi.advanceTimersByTime(80);
    wsPipeline.push(msg("rex:item-updated", { id: "2" }));

    // At T=130ms (only 50ms since reset) — throttle hasn't fired yet
    vi.advanceTimersByTime(50);
    expect(flushSpy).not.toHaveBeenCalled();

    // At T=180ms (100ms since reset) — throttle fires, then coalescer
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(30); // coalescer window
    await vi.advanceTimersByTimeAsync(0);

    // Both messages arrive in one batch
    expect(flushSpy).toHaveBeenCalledTimes(1);
    const batch: CoalescedBatch = flushSpy.mock.calls[0][0];
    expect(batch.size).toBe(2);

    dispose();
  });
});

// ─── 3. Full stack end-to-end scenarios ──────────────────────────────────────

describe("full composed stack end-to-end", () => {
  it("WS burst → throttle → coalesce → rate-limited fetch (realistic timing)", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { wsPipeline, fetchPipeline, flushSpy, dispose } = createComposedStack(fn, {
      minIntervalMs: 500,
      throttleDelayMs: 200,
      coalescerWindowMs: 100,
    });

    // Simulate a realistic scenario: polling fetch is active, then WS messages arrive

    // T=0: Direct fetch (simulates polling timer)
    const pollingResult = fetchPipeline.execute();
    await pollingResult;
    expect(fn).toHaveBeenCalledTimes(1);

    // T=50: Burst of WS messages from server push
    vi.advanceTimersByTime(50);
    wsPipeline.push(msg("rex:item-updated", { id: "a" }));
    wsPipeline.push(msg("rex:item-updated", { id: "b" }));
    wsPipeline.push(msg("rex:prd-changed"));

    // T=250: Throttle delay fires (200ms from T=50)
    vi.advanceTimersByTime(200);
    expect(flushSpy).not.toHaveBeenCalled(); // Coalescer still accumulating

    // T=350: Coalescer window fires (100ms from throttle flush)
    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);

    // Coalescer flushed — triggered FetchPipeline.execute()
    expect(flushSpy).toHaveBeenCalledTimes(1);
    // But rate limiter queued it (within 500ms cooldown from T=0)
    expect(fn).toHaveBeenCalledTimes(1);

    // T=500: Rate limiter cooldown expires
    vi.advanceTimersByTime(150);
    await vi.advanceTimersByTimeAsync(0);

    // Queued call fires
    expect(fn).toHaveBeenCalledTimes(2);

    dispose();
  });

  it("sustained message stream stays bounded by rate limiter", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { wsPipeline, dispose } = createComposedStack(fn, {
      minIntervalMs: 500,
      throttleDelayMs: 50,
      coalescerWindowMs: 50,
      throttledTypes: [], // All pass through immediately (worst case for rate limiter)
    });

    // Simulate 5 seconds of continuous WS messages at 10/sec
    for (let sec = 0; sec < 5; sec++) {
      for (let i = 0; i < 10; i++) {
        wsPipeline.push(msg("rapid-update", { seq: sec * 10 + i }));
        vi.advanceTimersByTime(100); // 100ms between messages
      }
      await vi.advanceTimersByTimeAsync(0);
    }

    // Final flush to settle all pending timers
    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    // With 500ms rate limit over ~6 seconds, expect roughly 10-12 calls max
    // (not 50 coalescer flushes or 50 raw calls)
    expect(fn.mock.calls.length).toBeLessThanOrEqual(14);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);

    dispose();
  });

  it("mixed throttled and unthrottled types both route through FetchPipeline", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { wsPipeline, flushSpy, dispose } = createComposedStack(fn, {
      minIntervalMs: 0, // No rate limiting — focus on routing
      throttleDelayMs: 100,
      coalescerWindowMs: 50,
      throttledTypes: ["rex:prd-changed"],
    });

    // Push both throttled and unthrottled types
    wsPipeline.push(msg("custom:immediate")); // Not throttled — passes through
    wsPipeline.push(msg("rex:prd-changed"));  // Throttled — debounced

    // Advance past coalescer window for the immediate message
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);

    // First flush: unthrottled message
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past throttle delay + coalescer window for the throttled message
    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);

    // Second flush: throttled message (coalescer resets after first flush)
    expect(flushSpy).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledTimes(2);

    // Both types routed through the same FetchPipeline — no bypass
    dispose();
  });
});

// ─── 4. Dispose tears down the entire stack ──────────────────────────────────

describe("composed stack disposal", () => {
  it("dispose prevents WS messages from reaching the API", async () => {
    const fn = vi.fn(async () => {});
    const { wsPipeline, onMessage, dispose } = createComposedStack(fn, {
      minIntervalMs: 0,
      throttleDelayMs: 10,
      coalescerWindowMs: 10,
      throttledTypes: [],
    });

    // Verify working state first
    wsPipeline.push(msg("test"));
    vi.advanceTimersByTime(10);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Dispose everything
    dispose();

    // Further messages should be silently dropped
    wsPipeline.push(msg("after-dispose"));
    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    // onMessage should not have been called for the post-dispose message
    // (it was called once for "test" before dispose)
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("dispose during pending throttle does not leak timers", async () => {
    const fn = vi.fn(async () => {});
    const { wsPipeline, dispose } = createComposedStack(fn, {
      throttleDelayMs: 5000,
      coalescerWindowMs: 5000,
    });

    // Push a message — starts throttle timer
    wsPipeline.push(msg("rex:prd-changed"));

    // Dispose while throttle timer is pending
    dispose();

    // Advance well past all timers
    vi.advanceTimersByTime(15000);
    await vi.advanceTimersByTimeAsync(0);

    // No API call should have been made
    expect(fn).not.toHaveBeenCalled();
  });

  it("dispose is safe to call multiple times", () => {
    const fn = vi.fn(async () => {});
    const { dispose } = createComposedStack(fn);

    expect(() => {
      dispose();
      dispose();
      dispose();
    }).not.toThrow();
  });
});
