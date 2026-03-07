/**
 * Preact hook for visibility-aware polling.
 *
 * Wraps the polling manager to provide a simple hook interface for
 * components that need periodic data fetching. Pollers registered
 * through this hook are automatically suspended when the tab is
 * backgrounded and resumed when it regains focus.
 *
 * Usage:
 * ```tsx
 * // Replace:
 * //   useEffect(() => {
 * //     const id = setInterval(fetchData, 5000);
 * //     return () => clearInterval(id);
 * //   }, []);
 * //
 * // With:
 * usePolling("my-component", fetchData, 5000);
 * ```
 */

import { useEffect, useRef } from "preact/hooks";
import { registerPoller, unregisterPoller } from "../polling/index.js";

/**
 * Register a visibility-aware polling interval.
 *
 * The callback is called every `intervalMs` milliseconds while the tab
 * is visible. When the tab is backgrounded, the interval is suspended
 * and resumed on reactivation.
 *
 * The callback reference is kept up to date via a ref, so it's safe to
 * pass an inline function or a callback that changes on every render —
 * the interval timer is NOT recreated on callback changes.
 *
 * @param key - Unique identifier for this poller. Must be stable across
 *              renders (use a string literal or useMemo).
 * @param callback - Function to call on each tick. May be async.
 * @param intervalMs - Polling interval in milliseconds.
 * @param enabled - Optional flag to conditionally enable/disable polling.
 *                  Defaults to true. When false, the poller is unregistered.
 */
export function usePolling(
  key: string,
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true
): void {
  // Keep the callback ref current so the interval always calls the
  // latest version without needing to recreate the timer.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) {
      unregisterPoller(key);
      return;
    }

    const unregister = registerPoller(
      key,
      () => callbackRef.current(),
      intervalMs
    );

    return unregister;
  }, [key, intervalMs, enabled]);
}
