/**
 * Call-level rate limiter with queue deduplication.
 *
 * Enforces a minimum interval between execution starts. Calls arriving
 * within the cooldown window are queued (deduplicated: only one pending
 * call exists at a time — subsequent callers share its promise).
 *
 * Designed to sit in front of `createRequestDedup`: the rate limiter
 * controls *when* calls happen, while the dedup handles concurrent
 * in-flight request sharing.
 *
 * Standalone module with zero framework dependencies.
 * Preact integration lives in the consumer (views/prd.ts).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CallRateLimiterConfig {
  /**
   * Minimum milliseconds between execution starts.
   * Default: 500 (allows max 2 calls per second).
   */
  minIntervalMs?: number;
}

/** A rate-limited, queue-deduplicated wrapper around an async function. */
export interface CallRateLimiter<T = void> {
  /**
   * Schedule execution. If within the rate limit cooldown, the call is
   * queued. Multiple callers hitting the queue share one promise (dedup).
   */
  execute(): Promise<T>;

  /** Whether the underlying function is currently executing. */
  isExecuting(): boolean;

  /** Whether a call is queued waiting for the rate limit cooldown. */
  isPending(): boolean;

  /** Clean up timers and pending state. Safe to call multiple times. */
  dispose(): void;
}

/** Default minimum interval — 500ms ≈ 2 calls/sec. */
const DEFAULT_MIN_INTERVAL_MS = 500;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a rate-limited, queue-deduplicated wrapper for an async function.
 *
 * Usage:
 * ```ts
 * const rateLimited = createCallRateLimiter(() => fetchData(), { minIntervalMs: 500 });
 *
 * rateLimited.execute(); // executes immediately (first call)
 * rateLimited.execute(); // queued — shares the same pending promise
 * rateLimited.execute(); // deduped to the already-queued call
 *
 * // After 500ms the queued call fires.
 * ```
 */
export function createCallRateLimiter<T = void>(
  fn: () => Promise<T>,
  config?: CallRateLimiterConfig,
): CallRateLimiter<T> {
  const minIntervalMs = config?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  let lastExecutionStartMs = 0;
  let executing = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolve: ((value: T) => void) | null = null;
  let pendingReject: ((reason: unknown) => void) | null = null;
  let pendingPromise: Promise<T> | null = null;
  let disposed = false;

  function executeNow(): Promise<T> {
    lastExecutionStartMs = Date.now();
    executing = true;
    return fn().then(
      (value) => {
        executing = false;
        return value;
      },
      (err) => {
        executing = false;
        throw err;
      },
    );
  }

  function execute(): Promise<T> {
    if (disposed) {
      return Promise.reject(new Error("CallRateLimiter has been disposed"));
    }

    const now = Date.now();
    const elapsed = now - lastExecutionStartMs;

    if (elapsed >= minIntervalMs) {
      // Enough time since last execution start — fire immediately.
      return executeNow();
    }

    // Within rate limit cooldown — queue (deduplicated).
    if (pendingPromise !== null) {
      // Already queued — return the existing promise (dedup).
      return pendingPromise;
    }

    // Create a new queued execution.
    pendingPromise = new Promise<T>((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject = reject;
    });

    const delay = minIntervalMs - elapsed;
    pendingTimer = setTimeout(() => {
      const resolve = pendingResolve!;
      const reject = pendingReject!;
      pendingTimer = null;
      pendingResolve = null;
      pendingReject = null;
      pendingPromise = null;

      executeNow().then(resolve, reject);
    }, delay);

    return pendingPromise;
  }

  function isExecuting(): boolean {
    return executing;
  }

  function isPending(): boolean {
    return pendingPromise !== null;
  }

  function dispose(): void {
    disposed = true;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingResolve = null;
    pendingReject = null;
    pendingPromise = null;
    executing = false;
  }

  return { execute, isExecuting, isPending, dispose };
}
