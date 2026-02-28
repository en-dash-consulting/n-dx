/**
 * Preact hook for shared elapsed-time tick updates.
 *
 * Wraps the batched tick dispatcher to provide a simple hook interface for
 * components that display live elapsed durations (e.g. task cards with
 * running timers). All components share a single 1-second setInterval via
 * the tick timer, and state updates are batched into a single
 * requestAnimationFrame callback via the batched tick dispatcher.
 *
 * When 20+ task cards are visible simultaneously, this reduces re-renders
 * from N individual setState calls to one batched reconciliation per tick.
 *
 * Usage:
 * ```tsx
 * // Replace:
 * //   const [elapsed, setElapsed] = useState(() => formatElapsed(startedAt));
 * //   useEffect(() => {
 * //     const id = setInterval(() => setElapsed(formatElapsed(startedAt)), 1000);
 * //     return () => clearInterval(id);
 * //   }, [startedAt]);
 * //
 * // With:
 * const elapsed = useTick(startedAt, formatElapsed);
 * ```
 */

import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { registerTickUpdater } from "../batched-tick-dispatcher.js";

/**
 * Subscribe to batched 1-second tick updates and return a formatted
 * elapsed-time string that updates every second.
 *
 * State updates are batched across all `useTick` instances via RAF,
 * so Preact reconciles all elapsed time displays in a single pass.
 *
 * Includes an equality check to skip redundant re-renders when the
 * formatted value hasn't changed (e.g. timer precision edge cases,
 * or formatters that produce the same string across consecutive ticks).
 *
 * @param startedAt - ISO 8601 timestamp of when the timer began.
 * @param formatter - Pure function that converts a start timestamp to a
 *                    display string. Called once per tick.
 *                    Receives the ISO string and returns the formatted output.
 * @returns The current formatted elapsed-time string.
 */
export function useTick(
  startedAt: string,
  formatter: (startedAt: string) => string,
): string {
  // Keep refs current so the tick callback always uses the latest values
  // without resubscribing to the timer.
  const startedAtRef = useRef(startedAt);
  startedAtRef.current = startedAt;

  const formatterRef = useRef(formatter);
  formatterRef.current = formatter;

  const compute = useCallback(
    () => formatterRef.current(startedAtRef.current),
    [],
  );

  const [display, setDisplay] = useState(compute);

  // Track the last emitted value so we can skip redundant setState calls.
  // This ref is shared with the batched tick dispatcher — both sides
  // read and write it to stay in sync.
  const lastValueRef = useRef(display);

  // Re-compute immediately when startedAt changes.
  // This provides instant feedback (e.g. "0s" when a new task starts)
  // without waiting for the next tick cycle.
  useEffect(() => {
    const next = compute();
    if (next !== lastValueRef.current) {
      lastValueRef.current = next;
      setDisplay(next);
    }
  }, [startedAt, compute]);

  // Register with the batched tick dispatcher.
  // The dispatcher subscribes to onTick once and batches all registered
  // setState calls into a single RAF frame.
  useEffect(() => {
    return registerTickUpdater(compute, setDisplay, lastValueRef);
  }, [compute]);

  return display;
}
