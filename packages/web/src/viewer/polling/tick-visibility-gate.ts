/**
 * Tick visibility gate — pauses elapsed time timer updates during tab inactivity.
 *
 * Bridges the Page Visibility API (via tab-visibility) to the tick timer's
 * suspend/resume lifecycle. When the browser tab is backgrounded, the tick
 * timer's shared setInterval is cleared to conserve CPU and battery. When the
 * tab returns to the foreground, the timer is resumed with an immediate
 * catch-up tick so elapsed time displays jump to the correct current value.
 *
 * Pipeline position:
 *
 *   tab-visibility → **tick-visibility-gate** → tick-timer → batched-tick-dispatcher → useTick → render
 *
 * When visible:  tick timer runs normally (1s interval)
 * When hidden:   tick timer is suspended (no interval, no ticks, zero CPU)
 * On resume:     immediate catch-up tick → restart interval
 *
 * Lifecycle:
 *
 *   Tab goes hidden:
 *     1. Immediately suspend the tick timer (clearInterval).
 *     2. No ticks fire while the tab is hidden — zero overhead.
 *
 *   Tab becomes visible (after resume debounce):
 *     1. Resume the tick timer — fires an immediate tick for catch-up,
 *        then restarts the 1-second interval.
 *     2. The immediate tick causes all elapsed time displays to recompute
 *        from their absolute startedAt timestamps, jumping to the correct
 *        current value without waiting up to 1 second.
 *
 * The resume is debounced (100ms default) to prevent thrashing during rapid
 * tab switching (e.g. quick alt-tab sequences). Suspension is always immediate
 * to stop unnecessary work as fast as possible.
 *
 * This module complements the polling-manager (which manages its own set of
 * registered pollers) and the DOM update gate (which gates state updates).
 * Together they form a complete tab-inactivity optimization pipeline.
 *
 * Designed as a standalone module with zero framework dependencies.
 */

import {
  onVisibilityChange,
  isTabVisible,
  type TabVisibilitySnapshot,
} from "./tab-visibility.js";
import { suspendTickTimer, resumeTickTimer } from "./tick-timer.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the tick visibility gate. */
export interface TickVisibilityGateConfig {
  /**
   * Debounce delay in milliseconds before resuming the tick timer after
   * the tab becomes visible. Prevents thrashing on rapid tab switches.
   * Default: 100ms (matches polling-manager and DOM update gate debounce).
   */
  resumeDebounceMs?: number | undefined;

  /**
   * Called when the tick timer is suspended (tab went hidden).
   * Optional — useful for monitoring and debugging.
   */
  onSuspend?: (() => void) | undefined;

  /**
   * Called when the tick timer is resumed (tab became visible, after debounce).
   * Optional — useful for monitoring and debugging.
   */
  onResume?: (() => void) | undefined;
}

/** Read-only snapshot of the gate's current state. */
export interface TickVisibilityGateSnapshot {
  /** Whether the tick timer is currently running (gate is open). */
  readonly isRunning: boolean;
  /** Number of times the timer has been suspended. */
  readonly suspensionCount: number;
  /** Number of times the timer has been resumed (after debounce). */
  readonly resumeCount: number;
  /** Whether the gate has been disposed. */
  readonly disposed: boolean;
}

/** A tick visibility gate instance. */
export interface TickVisibilityGate {
  /** Whether the tick timer is currently running. */
  isRunning(): boolean;

  /** Get a snapshot of the gate's current state. */
  getSnapshot(): TickVisibilityGateSnapshot;

  /** Dispose: unsubscribe from visibility events, clear debounce timer. */
  dispose(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_RESUME_DEBOUNCE_MS = 100;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new tick visibility gate.
 *
 * Usage:
 * ```ts
 * // During app initialization (after startTabVisibilityMonitor):
 * const gate = createTickVisibilityGate();
 *
 * // On app shutdown:
 * gate.dispose();
 * ```
 */
export function createTickVisibilityGate(
  config: TickVisibilityGateConfig = {},
): TickVisibilityGate {
  const resumeDebounceMs = config.resumeDebounceMs ?? DEFAULT_RESUME_DEBOUNCE_MS;
  const onSuspend = config.onSuspend;
  const onResume = config.onResume;

  let running = true;
  let suspensionCount = 0;
  let resumeCount = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // ─── Internal helpers ─────────────────────────────────────────────

  function clearResumeTimer(): void {
    if (resumeTimer !== null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  function suspend(): void {
    if (!running) return;

    running = false;
    suspensionCount++;

    suspendTickTimer();

    if (onSuspend) {
      try {
        onSuspend();
      } catch {
        // Swallow errors from the suspend callback.
      }
    }
  }

  function resume(): void {
    if (running) return;

    running = true;
    resumeCount++;

    resumeTickTimer();

    if (onResume) {
      try {
        onResume();
      } catch {
        // Swallow errors from the resume callback.
      }
    }
  }

  function handleVisibilityChange(snapshot: TabVisibilitySnapshot): void {
    if (disposed) return;

    if (snapshot.isVisible) {
      // Tab became visible — resume with debounce to prevent thrash.
      clearResumeTimer();
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        resume();
      }, resumeDebounceMs);
    } else {
      // Tab became hidden — suspend immediately.
      clearResumeTimer();
      suspend();
    }
  }

  // Subscribe to tab visibility changes.
  const unsubVisibility = onVisibilityChange(handleVisibilityChange);

  // If the tab is currently hidden, suspend immediately.
  if (!isTabVisible()) {
    suspend();
  }

  // ─── Public methods ─────────────────────────────────────────────────

  function isRunning(): boolean {
    return running;
  }

  function getSnapshot(): TickVisibilityGateSnapshot {
    return {
      isRunning: running,
      suspensionCount,
      resumeCount,
      disposed,
    };
  }

  function dispose(): void {
    disposed = true;
    clearResumeTimer();
    unsubVisibility();
  }

  return { isRunning, getSnapshot, dispose };
}
