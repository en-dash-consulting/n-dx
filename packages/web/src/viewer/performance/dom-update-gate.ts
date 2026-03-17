/**
 * DOM update gate — prevents state updates and re-renders during tab inactivity.
 *
 * Wraps an UpdateBatcher to intercept `schedule()` calls when the tab is hidden.
 * Instead of creating RAF callbacks in background tabs (which still fire at
 * reduced frequency, wasting CPU and triggering unnecessary re-renders), the
 * gate queues all pending updaters per-setter and replays them in a single
 * batch when the tab becomes visible again.
 *
 * Pipeline position:
 *
 *   ... → coalescer.onMessage → **dom-update-gate**.schedule() → batcher → RAF → render
 *
 * When visible:  schedule() → batcher.schedule() (normal flow)
 * When hidden:   schedule() → internal queue (no RAF, no render)
 * On resume:     internal queue → batcher → flush → single render
 *
 * Lifecycle:
 *
 *   Tab goes hidden:
 *     1. Flush the underlying batcher (apply any pending updates immediately
 *        so state is consistent up to the point of suspension).
 *     2. Switch to queuing mode — all future schedule() calls are captured
 *        in an internal per-setter queue.
 *
 *   Tab becomes visible (after resume debounce):
 *     1. Replay all queued updaters through the batcher (preserving
 *        per-setter composition order).
 *     2. Immediately flush the batcher to apply them in one RAF frame.
 *     3. Call onResume if any updates were deferred.
 *
 * This module complements the response-buffer-gate (which drops WebSocket
 * messages during suspension) by also gating the DOM update pathway. Without
 * this, polling callbacks, optimistic updates, or any late-arriving schedule()
 * calls would still trigger RAF and re-renders in background tabs.
 *
 * Designed as a standalone module with zero framework dependencies.
 * The Preact integration lives in the consumer (views/prd.ts etc.).
 */

import {
  onVisibilityChange,
  isTabVisible,
  type TabVisibilitySnapshot,
} from "../polling/index.js";
import type { UpdateBatcher } from "./update-batcher.js";

// ─── Types ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyUpdater = (prev: any) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySetter = (updater: (prev: any) => any) => void;

/** Per-setter queue entry: the setter function and its accumulated updaters. */
interface QueuedEntry {
  setter: AnySetter;
  updaters: AnyUpdater[];
}

/** Configuration for the DOM update gate. */
export interface DomUpdateGateConfig {
  /**
   * The underlying batcher to delegate to when the gate is open.
   * The gate does NOT own this batcher — the caller is responsible
   * for disposal of the batcher separately.
   */
  batcher: UpdateBatcher;

  /**
   * Called when the gate re-opens after suspension, but only if updates
   * were deferred while the gate was closed. Use this to trigger any
   * additional reconciliation work needed after deferred updates are applied.
   *
   * Optional — most consumers rely on the deferred updates themselves.
   */
  onResume?: (() => void) | undefined;

  /**
   * Debounce delay in milliseconds before re-opening the gate after the
   * tab becomes visible. Prevents thrashing on rapid tab switches.
   * Default: 100ms (matches polling-manager and buffer-gate debounce).
   */
  resumeDebounceMs?: number | undefined;
}

/** Read-only snapshot of the gate's current state. */
export interface DomUpdateGateSnapshot {
  /** Whether the gate is currently open (delegating to the batcher). */
  readonly isOpen: boolean;
  /** Number of updaters queued during the current or most recent suspension. */
  readonly queuedCount: number;
  /** Total updaters deferred across all suspensions since creation. */
  readonly totalDeferred: number;
  /** Number of times the gate has been suspended. */
  readonly suspensionCount: number;
}

/** A DOM update gate instance. Extends UpdateBatcher with visibility gating. */
export interface DomUpdateGate {
  /**
   * Schedule a state update.
   *
   * When the gate is open (tab visible): delegates to the underlying batcher.
   * When the gate is closed (tab hidden): queues the updater internally.
   * Multiple updates for the same setter are composed in order on replay.
   */
  schedule<T>(
    setter: (updater: (prev: T) => T) => void,
    updater: (prev: T) => T,
  ): void;

  /**
   * Force-flush all pending updates synchronously.
   *
   * When the gate is open: flushes the underlying batcher.
   * When the gate is closed: composes queued updaters per-setter and applies
   * them directly (bypassing the batcher), then flushes the batcher.
   */
  flush(): void;

  /** Whether updates are pending (in the batcher or in the deferred queue). */
  hasPending(): boolean;

  /** Whether the gate is currently open (tab visible, accepting updates). */
  isOpen(): boolean;

  /** Get a snapshot of the gate's current state. */
  getSnapshot(): DomUpdateGateSnapshot;

  /** Dispose: unsubscribe from visibility events, clear queue, clear timers. */
  dispose(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_RESUME_DEBOUNCE_MS = 100;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new DOM update gate.
 *
 * Usage:
 * ```ts
 * const batcher = createUpdateBatcher();
 * const gate = createDomUpdateGate({ batcher });
 *
 * // Use gate.schedule() instead of batcher.schedule()
 * coalescer.onMessage = (msg) => {
 *   if (msg.type === "rex:item-updated") {
 *     gate.schedule(setData, (prev) => applyItemUpdate(prev, msg));
 *   }
 * };
 *
 * // On component unmount:
 * gate.dispose();
 * batcher.dispose();
 * ```
 */
export function createDomUpdateGate(config: DomUpdateGateConfig): DomUpdateGate {
  const batcher = config.batcher;
  const onResume = config.onResume;
  const resumeDebounceMs = config.resumeDebounceMs ?? DEFAULT_RESUME_DEBOUNCE_MS;

  let open = true;
  let deferredQueue = new Map<AnySetter, QueuedEntry>();
  let queuedCount = 0;
  let totalDeferred = 0;
  let suspensionCount = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  // ─── Internal helpers ─────────────────────────────────────────────

  function clearResumeTimer(): void {
    if (resumeTimer !== null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  /**
   * Compose all queued updaters for a single setter into one function call.
   * Each updater receives the output of the previous — identical to
   * sequential application, just like the update-batcher's composition.
   */
  function composeUpdaters(updaters: AnyUpdater[]): AnyUpdater {
    return (prev) => {
      let current = prev;
      for (const updater of updaters) {
        current = updater(current);
      }
      return current;
    };
  }

  /**
   * Replay all queued updates through the batcher, then flush.
   * This ensures all deferred updates are applied in a single synchronous
   * block, producing exactly one re-render per setter.
   */
  function replayQueue(): void {
    const entries = deferredQueue;
    const hadDeferred = entries.size > 0;

    deferredQueue = new Map();
    queuedCount = 0;

    // Replay each setter's accumulated updaters through the batcher.
    for (const entry of entries.values()) {
      batcher.schedule(entry.setter, composeUpdaters(entry.updaters));
    }

    // Flush immediately to apply in one synchronous block.
    if (hadDeferred) {
      batcher.flush();
    }

    // Notify consumer that deferred updates were applied.
    if (hadDeferred && onResume) {
      try {
        onResume();
      } catch {
        // Swallow errors from the resume callback.
      }
    }
  }

  /** Close the gate: flush the batcher and switch to queuing mode. */
  function suspend(): void {
    if (!open) return;

    open = false;
    queuedCount = 0;
    suspensionCount++;

    // Flush the underlying batcher so any pending updates are applied
    // before we go into suspension. This ensures state is consistent
    // up to the point of the tab going hidden.
    batcher.flush();
  }

  /** Re-open the gate and replay any deferred updates. */
  function resume(): void {
    if (open) return;

    open = true;
    replayQueue();
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

  function schedule<T>(
    setter: (updater: (prev: T) => T) => void,
    updater: (prev: T) => T,
  ): void {
    if (disposed) return;

    if (open) {
      // Gate is open — delegate to the batcher (normal flow).
      batcher.schedule(setter, updater);
      return;
    }

    // Gate is closed — queue the updater for replay on resume.
    const key = setter as AnySetter;
    let entry = deferredQueue.get(key);
    if (!entry) {
      entry = { setter: key, updaters: [] };
      deferredQueue.set(key, entry);
    }
    entry.updaters.push(updater as AnyUpdater);
    queuedCount++;
    totalDeferred++;
  }

  function flush(): void {
    if (disposed) return;

    if (open) {
      // Gate is open — just flush the batcher.
      batcher.flush();
      return;
    }

    // Gate is closed — compose queued updaters per-setter and apply
    // them directly, bypassing the batcher (since we don't want to
    // schedule RAF in a background tab).
    const entries = deferredQueue;
    deferredQueue = new Map();
    queuedCount = 0;

    for (const entry of entries.values()) {
      entry.setter(composeUpdaters(entry.updaters));
    }

    // Also flush the batcher in case it has anything pending.
    batcher.flush();
  }

  function hasPending(): boolean {
    return deferredQueue.size > 0 || batcher.hasPending();
  }

  function isOpenFn(): boolean {
    return open;
  }

  function getSnapshot(): DomUpdateGateSnapshot {
    return {
      isOpen: open,
      queuedCount,
      totalDeferred,
      suspensionCount,
    };
  }

  function dispose(): void {
    disposed = true;
    clearResumeTimer();
    unsubVisibility();
    deferredQueue = new Map();
    queuedCount = 0;
  }

  return { schedule, flush, hasPending, isOpen: isOpenFn, getSnapshot, dispose };
}
