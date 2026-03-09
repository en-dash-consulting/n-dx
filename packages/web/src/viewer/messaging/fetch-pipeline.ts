/**
 * Fetch pipeline — composed request dedup + call rate limiter.
 *
 * Wraps an async function with two layers of protection:
 *   1. **Rate limiter** — caps execution frequency (e.g. max 2 calls/sec).
 *   2. **Request dedup** — concurrent callers share one in-flight request.
 *
 * This module captures the pattern used by `usePRDData` for both PRD and
 * task-usage fetching, reducing the coupling surface from two individual
 * messaging imports to one composed import.
 *
 * Standalone module with zero framework dependencies.
 */

import { createCallRateLimiter, type CallRateLimiter, type CallRateLimiterConfig } from "./call-rate-limiter.js";
import { createRequestDedup, type RequestDedup } from "./request-dedup.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the fetch pipeline. */
export interface FetchPipelineConfig {
  /**
   * Minimum milliseconds between execution starts.
   * Default: 500 (allows max 2 calls per second).
   */
  minIntervalMs?: number;
}

/** A composed fetch pipeline (rate limiter + request dedup). */
export interface FetchPipeline<T = void> {
  /**
   * Execute the wrapped function. Rate-limited and deduplicated:
   * - If within the rate limit cooldown, the call is queued.
   * - If a request is already in-flight, returns the existing promise.
   */
  execute(): Promise<T>;

  /** Whether the underlying function is currently executing. */
  isExecuting(): boolean;

  /** Whether a call is queued waiting for the rate limit cooldown. */
  isPending(): boolean;

  /** Whether a request is currently in-flight (dedup layer). */
  isInFlight(): boolean;

  /** Clean up timers and pending state. Safe to call multiple times. */
  dispose(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a fetch pipeline that rate-limits and deduplicates an async function.
 *
 * Usage:
 * ```ts
 * const fetchPRD = createFetchPipeline(
 *   async () => {
 *     const res = await fetch("/data/prd.json");
 *     return res.json();
 *   },
 *   { minIntervalMs: 500 },
 * );
 *
 * // All three calls resolve to the same result — one actual fetch:
 * fetchPRD.execute();
 * fetchPRD.execute();
 * fetchPRD.execute();
 * ```
 */
export function createFetchPipeline<T = void>(
  fn: () => Promise<T>,
  config?: FetchPipelineConfig,
): FetchPipeline<T> {
  const dedup: RequestDedup<T> = createRequestDedup(fn);
  const rateLimiter: CallRateLimiter<T> = createCallRateLimiter(
    () => dedup.execute(),
    { minIntervalMs: config?.minIntervalMs } satisfies CallRateLimiterConfig,
  );

  return {
    execute(): Promise<T> {
      return rateLimiter.execute();
    },

    isExecuting(): boolean {
      return rateLimiter.isExecuting();
    },

    isPending(): boolean {
      return rateLimiter.isPending();
    },

    isInFlight(): boolean {
      return dedup.isInFlight();
    },

    dispose(): void {
      rateLimiter.dispose();
      dedup.dispose();
    },
  };
}
