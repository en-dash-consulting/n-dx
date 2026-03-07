/**
 * Tests for execution panel polling + WebSocket coordination via the
 * FetchPipeline (rate limiter → request dedup).
 *
 * Verifies that the execution panel's 3-second polling and WebSocket-triggered
 * reconciliation fetches share a single in-flight request through the
 * `createFetchPipeline` wrapper, guaranteeing at most one concurrent
 * `/api/rex/execute/status` request at any time.
 *
 * Acceptance criteria:
 *   1. Polling respects in-flight requests from WebSocket handlers
 *   2. WebSocket handlers respect in-flight requests from polling loop
 *   3. Maximum one /api/rex/execute/status request active at any time
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFetchPipeline } from "../../../src/viewer/messaging/fetch-pipeline.js";

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

/**
 * Simulate the execution panel's two fetch sources (polling + WS handler)
 * sharing one `FetchPipeline` instance, matching the component's architecture:
 *
 *   statusPipeline = createFetchPipeline(rawFetch)
 *   fetchStatus = () => statusPipeline.execute()   // wrapped with try/catch
 *   polling     → fetchStatus() every 3s
 *   WS handler  → fetchStatus() on rex:execution-progress
 */
function createExecutionPanelPipeline<T = void>(fn: () => Promise<T>) {
  const pipeline = createFetchPipeline(fn, { minIntervalMs: 0 });

  // Mirrors the component's fetchStatus callback
  async function fetchStatus(): Promise<void> {
    try {
      await pipeline.execute();
    } catch {
      // Silently fail — mirrors component behavior
    }
  }

  function dispose() {
    pipeline.dispose();
  }

  return { pipeline, fetchStatus, dispose };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. Polling respects in-flight requests from WebSocket handlers ─────────

describe("polling respects in-flight WS requests", () => {
  it("polling call during WS-triggered in-flight request shares the same promise", async () => {
    const { fn, resolve } = createControllable();
    const { fetchStatus, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // WS handler triggers a fetch
    const wsPromise = fetchStatus();
    expect(fn).toHaveBeenCalledTimes(1);

    // Polling fires while WS fetch is in-flight
    const pollPromise = fetchStatus();
    // Still only one underlying API call
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await Promise.all([wsPromise, pollPromise]);
    dispose();
  });

  it("polling waits for WS-initiated request to complete before starting fresh", async () => {
    const { fn, resolve } = createControllable();
    const { fetchStatus, pipeline, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // WS handler triggers a fetch
    const wsPromise = fetchStatus();
    expect(pipeline.isInFlight()).toBe(true);

    // Polling fires — shares the in-flight promise
    const pollPromise = fetchStatus();

    // Complete the request
    resolve();
    await Promise.all([wsPromise, pollPromise]);
    expect(pipeline.isInFlight()).toBe(false);

    // Next poll starts a fresh request
    const nextPoll = fetchStatus();
    expect(fn).toHaveBeenCalledTimes(2);
    resolve();
    await nextPoll;
    dispose();
  });
});

// ─── 2. WebSocket handlers respect in-flight requests from polling ──────────

describe("WS handlers respect in-flight polling requests", () => {
  it("WS reconciliation during in-flight poll shares the same request", async () => {
    const { fn, resolve } = createControllable();
    const { fetchStatus, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // Polling fires
    const pollPromise = fetchStatus();
    expect(fn).toHaveBeenCalledTimes(1);

    // WS message arrives and triggers reconciliation fetch
    const wsPromise = fetchStatus();
    // Dedup prevents a second API call
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await Promise.all([pollPromise, wsPromise]);
    dispose();
  });

  it("WS handler does not block — shares the polling promise transparently", async () => {
    const { fn, resolve } = createControllable();
    const { fetchStatus, pipeline, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // Polling starts
    const pollPromise = fetchStatus();
    expect(pipeline.isInFlight()).toBe(true);

    // Multiple WS messages arrive — all share the same in-flight request
    const ws1 = fetchStatus();
    const ws2 = fetchStatus();
    const ws3 = fetchStatus();

    // Still just one underlying call
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await Promise.all([pollPromise, ws1, ws2, ws3]);
    expect(pipeline.isInFlight()).toBe(false);
    dispose();
  });
});

// ─── 3. Maximum one concurrent request ──────────────────────────────────────

describe("maximum one concurrent /api/rex/execute/status request", () => {
  it("rapid interleaving of poll + WS triggers produces exactly one API call while in-flight", async () => {
    const { fn, resolve } = createControllable();
    const { fetchStatus, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // Simulate rapid interleaving: poll, WS, poll, WS, poll
    const promises = [
      fetchStatus(), // poll
      fetchStatus(), // WS
      fetchStatus(), // poll
      fetchStatus(), // WS
      fetchStatus(), // poll
    ];

    // Only one underlying API call
    expect(fn).toHaveBeenCalledTimes(1);

    resolve();
    await Promise.all(promises);
    dispose();
  });

  it("after in-flight completes, the next trigger starts a fresh single request", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => ++callCount);
    const { fetchStatus, pipeline, dispose } = createExecutionPanelPipeline(fn);

    // Round 1: poll + WS overlap
    const p1 = fetchStatus();
    const p2 = fetchStatus();
    await Promise.all([p1, p2]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(pipeline.isInFlight()).toBe(false);

    // Round 2: fresh request
    await fetchStatus();
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("error in the shared request is received by all callers", async () => {
    const { fn, reject } = createControllable();
    const { fetchStatus, pipeline, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // Both poll and WS trigger share the same request
    const pollPromise = fetchStatus();
    const wsPromise = fetchStatus();
    expect(fn).toHaveBeenCalledTimes(1);

    reject(new Error("network error"));

    // Both callers handle the error (fetchStatus catches silently)
    await pollPromise; // should not throw — caught internally
    await wsPromise;   // should not throw — caught internally
    expect(pipeline.isInFlight()).toBe(false);
    dispose();
  });

  it("after error, next call starts a fresh request", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("transient failure");
      return callCount;
    });
    const { fetchStatus, pipeline, dispose } = createExecutionPanelPipeline(fn);

    // First call fails (caught by fetchStatus)
    await fetchStatus();
    expect(pipeline.isInFlight()).toBe(false);

    // Second call starts fresh
    await fetchStatus();
    expect(fn).toHaveBeenCalledTimes(2);
    dispose();
  });
});

// ─── 4. Cleanup ─────────────────────────────────────────────────────────────

describe("pipeline cleanup on unmount", () => {
  it("dispose clears in-flight tracking state", () => {
    const { fn } = createControllable();
    const { fetchStatus, pipeline, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // Start a request
    fetchStatus();
    expect(pipeline.isInFlight()).toBe(true);

    // Dispose (simulates component unmount cleanup)
    dispose();
    expect(pipeline.isInFlight()).toBe(false);
  });

  it("after dispose, new calls to pipeline reject cleanly", async () => {
    const { fn } = createControllable();
    const { pipeline, dispose } = createExecutionPanelPipeline(fn.bind(null));

    // Start and dispose
    pipeline.execute();
    expect(fn).toHaveBeenCalledTimes(1);
    dispose();

    // New call after dispose rejects (rate limiter is disposed)
    await expect(pipeline.execute()).rejects.toThrow("disposed");
    // Underlying fn was NOT called again
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
