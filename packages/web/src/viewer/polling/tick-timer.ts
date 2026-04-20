/**
 * Shared tick timer service for elapsed time updates.
 *
 * Manages a single setInterval that fires every second and distributes
 * tick events to all subscribed components. This eliminates the need for
 * individual per-component timers, reducing CPU overhead when many task
 * cards are visible simultaneously.
 *
 * The timer automatically starts when the first subscriber joins and
 * stops when the last subscriber leaves, ensuring zero overhead when
 * no components need elapsed time updates.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact hook (`useTick`) is provided separately.
 */

import {
  registerPollingSource,
} from "./engine/index.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Callback invoked on each tick with the current timestamp (Date.now()). */
export type TickListener = (now: number) => void;

/** Read-only view of the tick timer's current state. */
export interface TickTimerState {
  /** Number of active subscribers. */
  readonly subscriberCount: number;
  /** Whether the shared interval is currently running. */
  readonly running: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Tick interval in milliseconds. */
const TICK_INTERVAL_MS = 1000;

/** Key used to register with the centralized polling state manager. */
const POLLING_STATE_KEY = "tick-timer";

// ─── Module state ────────────────────────────────────────────────────────────

let listeners: TickListener[] = [];
let timerId: ReturnType<typeof setInterval> | null = null;
let stateUnsub: (() => void) | null = null;

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Start the shared interval if not already running. */
function startTimer(): void {
  if (timerId !== null) return;
  timerId = setInterval(tick, TICK_INTERVAL_MS);

  // Register with centralized polling state when the timer starts.
  if (stateUnsub === null) {
    stateUnsub = registerPollingSource(
      POLLING_STATE_KEY,
      {
        suspend: () => clearTimer(),
        resume: () => {
          if (timerId === null && listeners.length > 0) {
            timerId = setInterval(tick, TICK_INTERVAL_MS);
          }
        },
        dispose: () => {
          clearTimer();
          stateUnsub = null;
        },
        getStatus: () => (timerId !== null ? "active" : "idle"),
      },
    );
  }
}

/** Clear the interval timer without touching polling-state registration. */
function clearTimer(): void {
  if (timerId === null) return;
  clearInterval(timerId);
  timerId = null;
}

/** Stop the shared interval and deregister from polling-state. */
function stopTimer(): void {
  clearTimer();

  // Deregister from centralized polling state when no subscribers remain.
  if (stateUnsub) {
    const unsub = stateUnsub;
    stateUnsub = null;
    unsub();
  }
}

/** Fire a tick event to all current listeners. */
function tick(): void {
  const now = Date.now();
  // Snapshot the listener array so that subscribe/unsubscribe during
  // iteration doesn't cause skips or double-fires within a single tick.
  const snapshot = listeners.slice();
  for (const listener of snapshot) {
    try {
      listener(now);
    } catch {
      // Swallow errors from individual listeners to prevent one bad
      // subscriber from breaking all others.
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Subscribe to 1-second tick events.
 *
 * The listener receives the current `Date.now()` timestamp on each tick.
 * The shared interval starts automatically when the first subscriber joins.
 *
 * Returns an unsubscribe function. When the last subscriber unsubscribes,
 * the shared interval is stopped.
 *
 * @param listener - Callback invoked on each tick.
 * @returns Unsubscribe function (safe to call multiple times).
 */
export function onTick(listener: TickListener): () => void {
  listeners.push(listener);

  // Start the timer if this is the first subscriber.
  if (listeners.length === 1) {
    startTimer();
  }

  let removed = false;

  return () => {
    if (removed) return; // idempotent unsubscribe
    removed = true;

    listeners = listeners.filter((l) => l !== listener);

    // Stop the timer if no subscribers remain.
    if (listeners.length === 0) {
      stopTimer();
    }
  };
}

/**
 * Suspend the tick timer.
 *
 * Clears the shared interval but keeps all listeners registered. The timer
 * can be resumed later with `resumeTickTimer()`. Used by the tick visibility
 * gate to pause elapsed time updates when the browser tab is hidden.
 *
 * No-op if the timer is already stopped.
 */
export function suspendTickTimer(): void {
  clearTimer();
}

/**
 * Resume a suspended tick timer.
 *
 * Restarts the shared interval if listeners exist. Fires an **immediate tick**
 * before restarting the interval so that elapsed time displays catch up to
 * the current wall-clock time without waiting up to 1 second for the next
 * regular tick.
 *
 * Used by the tick visibility gate to resume elapsed time updates when the
 * browser tab becomes visible again.
 *
 * No-op if the timer is already running or no listeners are registered.
 */
export function resumeTickTimer(): void {
  if (timerId !== null) return; // already running
  if (listeners.length === 0) return; // no subscribers

  // Fire an immediate tick for catch-up. Elapsed time formatters compute
  // from an absolute start timestamp, so a single tick is enough for all
  // displays to jump to the correct current value.
  tick();

  // Restart the periodic interval.
  timerId = setInterval(tick, TICK_INTERVAL_MS);
}

/**
 * Get the current state of the tick timer.
 */
export function getTickTimerState(): TickTimerState {
  return {
    subscriberCount: listeners.length,
    running: timerId !== null,
  };
}

/**
 * Reset all module state (for testing). Clears all listeners and
 * stops the interval.
 */
export function resetTickTimer(): void {
  stopTimer();
  listeners = [];
  stateUnsub = null;
}
