/**
 * Response buffer gate — suspends message pipeline during tab inactivity.
 *
 * Sits at the front of the WebSocket message pipeline to prevent memory
 * buildup from accumulating response data while the browser tab is hidden.
 * When the tab becomes inactive:
 *
 *   1. Flushes all pending data from downstream buffers (throttle, coalescer,
 *      batcher) so they release references immediately.
 *   2. Drops all subsequent incoming messages silently — no accumulation.
 *   3. Tracks that messages were dropped during suspension.
 *
 * When the tab becomes visible again:
 *
 *   1. Opens the gate to accept new messages normally.
 *   2. If any messages were dropped, calls `onResume` so the consumer can
 *      trigger a single full reconciliation (e.g. fetchPRDData + fetchTaskUsage)
 *      to restore data integrity.
 *
 * This module complements the polling-manager (which suspends fetch intervals)
 * by also stopping the *response processing* side. Without this, WebSocket
 * messages arriving during a background tab would still accumulate in the
 * message-throttle pending arrays, coalescer batch, and update-batcher queue.
 *
 * Pipeline position:
 *
 *   raw WebSocket → **response-buffer-gate** → throttle → coalescer → batcher → render
 *
 * Designed as a standalone module with zero framework dependencies.
 * The Preact integration lives in the consumer (views/prd.ts etc.).
 */

import {
  onVisibilityChange,
  isTabVisible,
  type TabVisibilitySnapshot,
} from "../polling/tab-visibility.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Flush callback for a downstream buffer (throttle, coalescer, or batcher). */
export type BufferFlushFn = () => void;

/** Configuration for the response buffer gate. */
export interface ResponseBufferGateConfig {
  /**
   * Downstream buffer flush functions. Called in order when the gate
   * closes (tab goes hidden) to release buffered data from memory.
   *
   * Typical order: throttle.flush → coalescer.flush → batcher.flush
   */
  flushDownstream: readonly BufferFlushFn[];

  /**
   * Called when the gate re-opens after suspension, but only if messages
   * were dropped while the gate was closed. Use this to trigger a single
   * reconciliation fetch that restores data integrity.
   */
  onResume: () => void;

  /**
   * Debounce delay in milliseconds before re-opening the gate after the
   * tab becomes visible. Prevents thrashing on rapid tab switches.
   * Default: 100ms (matches polling-manager's resume debounce).
   */
  resumeDebounceMs?: number | undefined;
}

/** Read-only snapshot of the gate's current state. */
export interface BufferGateSnapshot {
  /** Whether the gate is currently open (accepting messages). */
  readonly isOpen: boolean;
  /** Number of messages dropped during the current or most recent suspension. */
  readonly droppedCount: number;
  /** Total messages dropped across all suspensions since creation. */
  readonly totalDropped: number;
  /** Number of times the gate has been suspended. */
  readonly suspensionCount: number;
}

/** A response buffer gate instance. */
export interface ResponseBufferGate {
  /**
   * Check whether a message should be processed.
   * Returns `true` if the gate is open (message should be forwarded).
   * Returns `false` if the gate is closed (message is dropped).
   *
   * Increments the drop counter on each rejection.
   */
  accept(): boolean;

  /** Whether the gate is currently open. */
  isOpen(): boolean;

  /** Get a snapshot of the gate's current state. */
  getSnapshot(): BufferGateSnapshot;

  /** Dispose: unsubscribe from visibility events, clear timers. */
  dispose(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_RESUME_DEBOUNCE_MS = 100;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new response buffer gate.
 *
 * Usage:
 * ```ts
 * const gate = createResponseBufferGate({
 *   flushDownstream: [
 *     () => throttle.flush(),
 *     () => coalescer.flush(),
 *     () => batcher.flush(),
 *   ],
 *   onResume: () => {
 *     fetchPRDData();
 *     fetchTaskUsage();
 *   },
 * });
 *
 * ws.onmessage = (event) => {
 *   const msg = JSON.parse(event.data);
 *   if (!gate.accept()) return; // Dropped — tab is hidden
 *   throttle.push(msg);
 * };
 * ```
 */
export function createResponseBufferGate(
  config: ResponseBufferGateConfig,
): ResponseBufferGate {
  const flushDownstream = config.flushDownstream;
  const onResume = config.onResume;
  const resumeDebounceMs = config.resumeDebounceMs ?? DEFAULT_RESUME_DEBOUNCE_MS;

  // Start as visible; the initial-state check below may immediately suspend.
  let open = true;
  let droppedCount = 0;
  let totalDropped = 0;
  let suspensionCount = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearResumeTimer(): void {
    if (resumeTimer !== null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  /** Flush all downstream buffers to release buffered data from memory. */
  function flushAllDownstream(): void {
    for (const flush of flushDownstream) {
      try {
        flush();
      } catch {
        // Swallow errors from individual flushes.
      }
    }
  }

  /** Close the gate: flush downstream buffers and start dropping. */
  function suspend(): void {
    if (!open) return;

    open = false;
    droppedCount = 0;
    suspensionCount++;

    // Flush downstream buffers to release buffered data from memory.
    // This ensures the throttle's pending arrays, the coalescer's batch,
    // and the batcher's queue are all cleared immediately.
    flushAllDownstream();
  }

  /** Re-open the gate and trigger reconciliation if data was dropped. */
  function resume(): void {
    if (open) return;

    const hadDrops = droppedCount > 0;

    open = true;

    // Trigger reconciliation if any messages were lost during suspension.
    // This ensures the UI shows the latest state from the server.
    if (hadDrops) {
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

  // If the tab is currently hidden, suspend immediately. This runs the
  // full suspend path (flush + mark closed) even on initial creation.
  if (!isTabVisible()) {
    suspend();
  }

  // ─── Public methods ─────────────────────────────────────────────────

  function accept(): boolean {
    if (disposed) return false;

    if (!open) {
      droppedCount++;
      totalDropped++;
      return false;
    }

    return true;
  }

  function isOpenFn(): boolean {
    return open;
  }

  function getSnapshot(): BufferGateSnapshot {
    return {
      isOpen: open,
      droppedCount,
      totalDropped,
      suspensionCount,
    };
  }

  function dispose(): void {
    disposed = true;
    clearResumeTimer();
    unsubVisibility();
  }

  return { accept, isOpen: isOpenFn, getSnapshot, dispose };
}
