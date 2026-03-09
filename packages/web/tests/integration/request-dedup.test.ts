/**
 * Integration tests for request deduplication across the full fetch pipeline.
 *
 * Validates that the four-layer pipeline used in prd.ts correctly prevents
 * duplicate API calls under realistic timing scenarios:
 *
 *   raw WS → messageThrottle → messageCoalescer → callRateLimiter → requestDedup
 *
 * Acceptance criteria:
 *   1. No duplicate API calls during overlapping fetch operations
 *   2. WebSocket message arrival during active polling doesn't trigger extra calls
 *   3. Request cleanup after completion and errors allows fresh requests
 *
 * Unlike unit tests that verify each module in isolation, these tests wire up
 * the full subsystem and verify they cooperate correctly through multi-step
 * timing scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequestDedup } from "../../src/viewer/messaging/request-dedup.js";
import { createCallRateLimiter } from "../../src/viewer/messaging/call-rate-limiter.js";
import { createMessageCoalescer } from "../../src/viewer/messaging/message-coalescer.js";
import { createMessageThrottle } from "../../src/viewer/messaging/message-throttle.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a controllable async function with explicit resolve/reject handles.
 * Allows tests to hold a request in-flight and release it at a precise moment.
 */
function createControllable<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const fn = vi.fn(
    () =>
      new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return {
    fn,
    resolve: (value?: T) => resolve((value ?? undefined) as T),
    reject: (err: unknown) => reject(err),
  };
}

/** Build a mock WebSocket message of the given type. */
function wsMsg(type: string, extra?: Record<string, unknown>) {
  return { type, ...extra };
}

/**
 * Wire up the full four-layer pipeline matching the prd.ts pattern:
 *
 *   throttle → coalescer → rateLimiter → dedup → underlying fn
 *
 * Returns handles to all layers so tests can drive each independently.
 */
function createPipeline<T = void>(
  fn: () => Promise<T>,
  opts?: { minIntervalMs?: number; coalescerWindowMs?: number; throttleDelayMs?: number },
) {
  const minIntervalMs = opts?.minIntervalMs ?? 500;
  const coalescerWindowMs = opts?.coalescerWindowMs ?? 150;
  const throttleDelayMs = opts?.throttleDelayMs ?? 250;

  const dedup = createRequestDedup(fn);

  const rateLimiter = createCallRateLimiter(
    async () => {
      await dedup.execute();
    },
    { minIntervalMs },
  );

  const fetchData = async () => {
    await rateLimiter.execute();
  };

  const coalescer = createMessageCoalescer({
    onFlush: () => {
      fetchData();
    },
    windowMs: coalescerWindowMs,
  });

  const throttle = createMessageThrottle({
    onMessage: (msg) => coalescer.push(msg),
    defaultDelayMs: throttleDelayMs,
    throttledTypes: ["rex:prd-changed", "rex:item-updated", "rex:item-deleted"],
  });

  function dispose() {
    throttle.dispose();
    coalescer.dispose();
    rateLimiter.dispose();
    dedup.dispose();
  }

  return { dedup, rateLimiter, coalescer, throttle, fetchData, dispose };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. No duplicate API calls during overlapping fetch operations ──────────

describe("overlapping fetch deduplication", () => {
  it("concurrent fetchData calls share a single underlying API call", async () => {
    const { fn, resolve } = createControllable();
    // minIntervalMs: 0 — all calls pass directly to dedup (no rate-limit queuing)
    const { fetchData, dispose } = createPipeline(fn.bind(null), { minIntervalMs: 0 });

    // Fire three overlapping fetches
    const p1 = fetchData();
    const p2 = fetchData();
    const p3 = fetchData();

    // Only one underlying call — dedup shares the in-flight promise
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await Promise.all([p1, p2, p3]);
    dispose();
  });

  it("rate limiter queues second call but dedup still prevents duplicate in-flight", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, dedup, dispose } = createPipeline(fn, { minIntervalMs: 200 });

    // First call — immediate
    const p1 = fetchData();
    await p1;
    expect(fn).toHaveBeenCalledTimes(1);

    // Second call within 200ms — queued by rate limiter
    const p2 = fetchData();
    expect(fn).toHaveBeenCalledTimes(1); // Still 1 — queued

    // Third call — deduplicates to the already-queued promise
    const p3 = fetchData();

    // Advance past rate limit cooldown
    vi.advanceTimersByTime(200);
    await p2;
    await p3;

    // Only 2 calls total: the immediate one + the single queued one
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("rapid burst of direct fetchData calls collapses to minimal API calls", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, dispose } = createPipeline(fn, { minIntervalMs: 500 });

    // Simulate a rapid burst: 20 calls
    const first = fetchData();
    const burstPromises: Promise<void>[] = [];
    for (let i = 0; i < 19; i++) {
      burstPromises.push(fetchData());
    }

    await first;
    expect(fn).toHaveBeenCalledTimes(1);

    // All queued promises are deduplicated — one timer fires
    vi.advanceTimersByTime(500);
    await Promise.all(burstPromises);

    // At most 2 calls: initial + 1 queued
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });
});

// ─── 2. WebSocket message arrival during active polling ──────────────────────

describe("WebSocket messages during active polling", () => {
  it("WS flush during in-flight fetch does not trigger a second API call", async () => {
    const { fn, resolve } = createControllable();
    const { fetchData, coalescer, dispose } = createPipeline(fn.bind(null), {
      minIntervalMs: 500,
      coalescerWindowMs: 100,
    });

    // Simulate polling fetch — holds in-flight
    const pollingPromise = fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // While the polling fetch is in-flight, a coalesced WS flush arrives.
    // Push a message into the coalescer and force-flush.
    coalescer.push(wsMsg("rex:prd-changed"));
    coalescer.flush();

    // The coalescer flush triggers fetchData, which hits the rate limiter.
    // Rate limiter queues it (within cooldown). The dedup layer would share
    // the in-flight promise — no new underlying call.
    expect(fn).toHaveBeenCalledTimes(1);

    // Complete the original request
    resolve();
    await pollingPromise;

    // Advance past rate limiter cooldown to fire the queued call
    vi.advanceTimersByTime(500);

    // Queued call fires — new underlying request now
    // Wait for microtask queue to settle
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("multiple WS messages during in-flight polling coalesce into one fetch", async () => {
    const { fn, resolve } = createControllable();
    const { fetchData, coalescer, dispose } = createPipeline(fn.bind(null), {
      minIntervalMs: 500,
      coalescerWindowMs: 100,
    });

    // Start a polling fetch
    const pollingPromise = fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // Simulate a burst of WS messages arriving during the fetch
    coalescer.push(wsMsg("rex:item-updated", { itemId: "a" }));
    coalescer.push(wsMsg("rex:item-updated", { itemId: "b" }));
    coalescer.push(wsMsg("rex:prd-changed"));

    // Let the coalescer's trailing-edge debounce fire (100ms)
    vi.advanceTimersByTime(100);

    // Still only the original API call — the coalesced flush triggered
    // fetchData, but rate limiter + dedup prevent a second call.
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await pollingPromise;

    // Now let the queued rate-limited call fire
    vi.advanceTimersByTime(500);
    await vi.advanceTimersByTimeAsync(0);

    // Only 2 total: original polling + 1 coalesced WS-triggered
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("full pipeline: throttle → coalescer → rate limiter → dedup", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, throttle, dispose } = createPipeline(fn, {
      minIntervalMs: 500,
      coalescerWindowMs: 100,
      throttleDelayMs: 200,
    });

    // Start a polling fetch (simulates usePolling timer firing)
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // Simulate rapid WS messages flowing through the full pipeline:
    // raw WS → throttle → coalescer → rateLimiter → dedup
    throttle.push(wsMsg("rex:item-updated", { itemId: "1" }));
    throttle.push(wsMsg("rex:item-updated", { itemId: "2" }));
    throttle.push(wsMsg("rex:item-updated", { itemId: "3" }));
    throttle.push(wsMsg("rex:prd-changed"));

    // Throttle debounces each type independently.
    // rex:item-updated (200ms delay) — pending
    // rex:prd-changed (200ms delay) — pending
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past throttle delay (200ms) — both types flush to coalescer
    vi.advanceTimersByTime(200);

    // Coalescer accumulates throttle output, trailing-edge debounce (100ms) pending
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past coalescer window (100ms) — triggers coalesced flush → fetchData
    vi.advanceTimersByTime(100);

    // fetchData hits rate limiter, which is within cooldown (500ms total not elapsed
    // from the initial call). So it queues the call.
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past the remaining cooldown
    vi.advanceTimersByTime(200);
    await vi.advanceTimersByTimeAsync(0);

    // Now the queued call fires — exactly 2 calls total
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("WS messages arriving after fetch completes trigger a new fresh request", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, coalescer, dispose } = createPipeline(fn, {
      minIntervalMs: 100,
      coalescerWindowMs: 50,
    });

    // Complete a fetch
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // Wait for rate limiter cooldown
    vi.advanceTimersByTime(100);

    // Now a WS message arrives — should start a fresh fetch
    coalescer.push(wsMsg("rex:prd-changed"));
    vi.advanceTimersByTime(50); // coalescer window
    await vi.advanceTimersByTimeAsync(0);

    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });
});

// ─── 3. Request cleanup after completion and errors ──────────────────────────

describe("request cleanup after completion and errors", () => {
  it("dedup clears tracking after successful completion — next call starts fresh", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, dedup, dispose } = createPipeline(fn, { minIntervalMs: 0 });

    await fetchData();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(dedup.isInFlight()).toBe(false);

    await fetchData();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(dedup.isInFlight()).toBe(false);
    dispose();
  });

  it("dedup clears tracking after error — next call starts fresh", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("network error");
      return callCount;
    });
    const { dedup, dispose } = createPipeline(fn, { minIntervalMs: 0 });

    // First call fails
    await expect(dedup.execute()).rejects.toThrow("network error");
    expect(dedup.isInFlight()).toBe(false);

    // Second call succeeds — tracking was properly cleaned up
    const result = await dedup.execute();
    expect(result).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("rate limiter allows new execution after error clears", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("server error");
      return callCount;
    });
    const { fetchData, dispose } = createPipeline(fn, { minIntervalMs: 100 });

    // First call — errors propagate through both layers
    await expect(fetchData()).rejects.toThrow("server error");

    // Advance past cooldown
    vi.advanceTimersByTime(100);

    // Second call should work — both layers cleaned up
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("shared callers all receive the rejection when dedup request fails", async () => {
    const { fn, reject } = createControllable();
    // minIntervalMs: 0 — all calls pass directly to dedup (no rate-limit queuing)
    const { fetchData, dispose } = createPipeline(fn.bind(null), { minIntervalMs: 0 });

    const p1 = fetchData();
    const p2 = fetchData();

    reject(new Error("timeout"));

    await expect(p1).rejects.toThrow("timeout");
    await expect(p2).rejects.toThrow("timeout");
    dispose();
  });

  it("WS-triggered fetch after error recovery succeeds", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("transient failure");
      return callCount;
    });
    const { fetchData, coalescer, dispose } = createPipeline(fn, {
      minIntervalMs: 100,
      coalescerWindowMs: 50,
    });

    // First call fails
    await expect(fetchData()).rejects.toThrow("transient failure");
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past rate limiter cooldown
    vi.advanceTimersByTime(100);

    // WS message triggers a new fetch — should succeed now
    coalescer.push(wsMsg("rex:prd-changed"));
    vi.advanceTimersByTime(50); // coalescer window
    await vi.advanceTimersByTimeAsync(0);

    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("dispose prevents any further API calls from all pipeline layers", async () => {
    const fn = vi.fn(async () => {});
    const { fetchData, coalescer, throttle, dispose } = createPipeline(fn, {
      minIntervalMs: 100,
      coalescerWindowMs: 50,
      throttleDelayMs: 50,
    });

    // Initial call
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // Dispose everything
    dispose();

    // WS messages after dispose should be ignored
    throttle.push(wsMsg("rex:prd-changed"));
    coalescer.push(wsMsg("rex:item-updated"));
    vi.advanceTimersByTime(500);
    await vi.advanceTimersByTimeAsync(0);

    // Still only 1 call — nothing leaked through after dispose
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── 4. Timing edge cases ───────────────────────────────────────────────────

describe("timing edge cases", () => {
  it("fetch completing exactly at rate limit boundary allows immediate next call", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, dispose } = createPipeline(fn, { minIntervalMs: 200 });

    await fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance exactly to the rate limit boundary
    vi.advanceTimersByTime(200);

    // Should execute immediately — not queued
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("interleaved polling and WS triggers converge to minimal API calls", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, coalescer, dispose } = createPipeline(fn, {
      minIntervalMs: 500,
      coalescerWindowMs: 100,
    });

    // T=0: Polling fetch fires
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // T=100: WS message arrives, starts coalescer debounce
    vi.advanceTimersByTime(100);
    coalescer.push(wsMsg("rex:prd-changed"));

    // T=150: Another WS message resets coalescer debounce
    vi.advanceTimersByTime(50);
    coalescer.push(wsMsg("rex:item-updated"));

    // T=250: Coalescer fires (100ms after last push at T=150)
    vi.advanceTimersByTime(100);
    // This triggers fetchData → rate limiter queues it (within 500ms cooldown)

    // T=300: Another polling tick arrives
    vi.advanceTimersByTime(50);
    fetchData(); // Also queued — deduplicates with the WS-triggered one

    // T=500: Rate limiter cooldown expires, queued call fires
    vi.advanceTimersByTime(200);
    await vi.advanceTimersByTimeAsync(0);

    // Total: 2 calls (initial + 1 queued from coalesced WS + polling)
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("back-to-back completions with intervening WS messages stay coordinated", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchData, coalescer, dispose } = createPipeline(fn, {
      minIntervalMs: 100,
      coalescerWindowMs: 50,
    });

    // Round 1: poll
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(1);

    // Wait for cooldown
    vi.advanceTimersByTime(100);

    // Round 2: WS message triggers fetch
    coalescer.push(wsMsg("rex:item-updated"));
    vi.advanceTimersByTime(50);
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(2);

    // Wait for cooldown
    vi.advanceTimersByTime(100);

    // Round 3: poll again
    await fetchData();
    expect(fn).toHaveBeenCalledTimes(3);

    // All three rounds executed cleanly — no leaked state
    dispose();
  });
});

// ─── 5. Dual-fetch deduplication (PRD + task usage pattern) ─────────────────

describe("dual-fetch deduplication (PRD + task usage)", () => {
  it("independent dedup instances allow concurrent PRD and usage fetches", async () => {
    const prdFn = vi.fn(async () => "prd-data");
    const usageFn = vi.fn(async () => "usage-data");

    const prdDedup = createRequestDedup(prdFn);
    const usageDedup = createRequestDedup(usageFn);

    // Both fire concurrently — independent pipelines
    const [prd, usage] = await Promise.all([
      prdDedup.execute(),
      usageDedup.execute(),
    ]);

    expect(prd).toBe("prd-data");
    expect(usage).toBe("usage-data");
    expect(prdFn).toHaveBeenCalledTimes(1);
    expect(usageFn).toHaveBeenCalledTimes(1);

    prdDedup.dispose();
    usageDedup.dispose();
  });

  it("WS flush triggers both fetches but each deduplicates independently", async () => {
    const { fn: prdFn, resolve: resolvePrd } = createControllable<string>();
    const { fn: usageFn, resolve: resolveUsage } = createControllable<string>();

    const prdDedup = createRequestDedup(prdFn.bind(null) as () => Promise<string>);
    const usageDedup = createRequestDedup(usageFn.bind(null) as () => Promise<string>);

    // Simulate coalesced WS flush calling both fetchPRDData and fetchTaskUsage
    const prdP1 = prdDedup.execute();
    const usageP1 = usageDedup.execute();

    // Second "trigger" (e.g. from an overlapping polling timer)
    const prdP2 = prdDedup.execute();
    const usageP2 = usageDedup.execute();

    // Each dedup layer only calls its underlying fn once
    expect(prdFn).toHaveBeenCalledTimes(1);
    expect(usageFn).toHaveBeenCalledTimes(1);

    resolvePrd("prd" as unknown as string);
    resolveUsage("usage" as unknown as string);

    await Promise.all([prdP1, prdP2, usageP1, usageP2]);

    prdDedup.dispose();
    usageDedup.dispose();
  });

  it("error in PRD fetch does not affect usage fetch deduplication", async () => {
    const prdFn = vi.fn(async () => {
      throw new Error("prd failed");
    });
    const usageFn = vi.fn(async () => "usage-ok");

    const prdDedup = createRequestDedup(prdFn);
    const usageDedup = createRequestDedup(usageFn);

    // Fire both concurrently
    const prdPromise = prdDedup.execute();
    const usagePromise = usageDedup.execute();

    await expect(prdPromise).rejects.toThrow("prd failed");
    await expect(usagePromise).resolves.toBe("usage-ok");

    // Both cleaned up — next calls start fresh
    expect(prdDedup.isInFlight()).toBe(false);
    expect(usageDedup.isInFlight()).toBe(false);

    prdDedup.dispose();
    usageDedup.dispose();
  });
});
