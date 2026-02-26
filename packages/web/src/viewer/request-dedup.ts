/**
 * In-flight request deduplication.
 *
 * Wraps an async function so that concurrent callers share a single in-flight
 * promise instead of triggering duplicate API calls. When the underlying
 * request completes (success or failure), tracking is cleared and the next
 * call starts a fresh request.
 *
 * Typical use: prevent duplicate `fetchPRDData` calls when a WebSocket
 * message arrives while a polling request is already in progress.
 *
 * Designed as a standalone module with zero framework dependencies.
 * The Preact integration lives in the consumer (views/prd.ts etc.).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** A deduplicating wrapper around an async function. */
export interface RequestDedup<T = void> {
  /**
   * Execute the wrapped function. If a request is already in-flight,
   * returns the existing promise instead of starting a new one.
   */
  execute(): Promise<T>;

  /** Whether a request is currently in-flight. */
  isInFlight(): boolean;

  /** Clear in-flight tracking state. Safe to call multiple times. */
  dispose(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a deduplicating wrapper for an async function.
 *
 * Usage:
 * ```ts
 * const dedupedFetch = createRequestDedup(() => fetch("/data/prd.json").then(r => r.json()));
 *
 * // These two calls share one underlying fetch:
 * dedupedFetch.execute();  // starts the request
 * dedupedFetch.execute();  // returns the same promise
 *
 * // After the request settles, the next call starts fresh:
 * await dedupedFetch.execute();
 * dedupedFetch.execute();  // new request
 * ```
 */
export function createRequestDedup<T = void>(
  fn: () => Promise<T>,
): RequestDedup<T> {
  let inflight: Promise<T> | null = null;

  function execute(): Promise<T> {
    if (inflight !== null) {
      return inflight;
    }

    inflight = fn().then(
      (value) => {
        inflight = null;
        return value;
      },
      (err) => {
        inflight = null;
        throw err;
      },
    );

    return inflight;
  }

  function isInFlight(): boolean {
    return inflight !== null;
  }

  function dispose(): void {
    inflight = null;
  }

  return { execute, isInFlight, dispose };
}
