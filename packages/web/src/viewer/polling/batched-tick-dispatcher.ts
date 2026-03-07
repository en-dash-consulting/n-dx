/**
 * Batched tick dispatcher for elapsed time state updates.
 *
 * Sits between the shared tick timer and individual `useTick` hook instances.
 * Instead of N separate `onTick` listeners each calling `setState` independently,
 * this dispatcher:
 *
 *   1. Subscribes to the tick timer **once** (regardless of how many components
 *      display elapsed time).
 *   2. On each tick, computes all new values synchronously (read-only phase).
 *   3. Filters out unchanged values via equality check (skip phase).
 *   4. Schedules a single `requestAnimationFrame` to apply all state updates
 *      in one synchronous block (write phase).
 *
 * This two-phase (compute → RAF write) approach ensures:
 *
 *   - All `setState` calls occur within the same synchronous execution context
 *     inside the RAF callback, allowing Preact to batch them into a single
 *     reconciliation pass.
 *   - State updates are aligned with the browser's paint cycle, eliminating
 *     wasted intermediate renders.
 *   - With 20+ visible task cards, the re-render count drops from N individual
 *     renders to one batched reconciliation per tick.
 *
 * Auto-lifecycle: subscribes to the tick timer when the first component
 * registers, unsubscribes when the last one unregisters. Zero overhead
 * when no elapsed time displays are mounted.
 *
 * Designed as a standalone module with zero framework dependencies —
 * the Preact integration lives in the `useTick` hook.
 */

import { onTick } from "./tick-timer.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Function that computes the current formatted elapsed time string. */
type ComputeFn = () => string;

/** Preact state setter for the display value. */
type SetDisplayFn = (value: string) => void;

/** Mutable ref object (matches Preact's useRef shape). */
interface MutableRef<T> {
  current: T;
}

/** Internal registration entry. */
interface Registration {
  readonly compute: ComputeFn;
  readonly setDisplay: SetDisplayFn;
  /** Shared with the hook — both sides read/write to skip redundant updates. */
  readonly lastValueRef: MutableRef<string>;
}

/** Read-only snapshot of the dispatcher's current state (for testing/monitoring). */
export interface BatchedTickDispatcherState {
  /** Number of active registrations. */
  readonly registrationCount: number;
  /** Whether a RAF callback is currently pending. */
  readonly hasPendingRAF: boolean;
  /** Number of state updates queued for the next RAF. */
  readonly pendingUpdateCount: number;
}

// ─── Module state ────────────────────────────────────────────────────────────

let registrations: Registration[] = [];
let tickUnsub: (() => void) | null = null;
let rafId: number | null = null;
let pendingBatch: Array<{ setDisplay: SetDisplayFn; value: string }> | null =
  null;

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Phase 1 (tick callback): compute values, filter unchanged, queue RAF. */
function onTickFired(): void {
  const batch: Array<{
    setDisplay: SetDisplayFn;
    value: string;
    reg: Registration;
  }> = [];

  // Snapshot registrations to protect against mid-iteration unregister.
  const snapshot = registrations.slice();

  for (const reg of snapshot) {
    try {
      const next = reg.compute();
      if (next !== reg.lastValueRef.current) {
        batch.push({ setDisplay: reg.setDisplay, value: next, reg });
      }
    } catch {
      // Swallow errors from individual computations to prevent one bad
      // registration from breaking all others.
    }
  }

  if (batch.length === 0) return;

  // Commit lastValueRef immediately so the next tick won't re-queue
  // the same update if RAF hasn't fired yet.
  for (const { reg, value } of batch) {
    reg.lastValueRef.current = value;
  }

  // Queue state updates for the next animation frame.
  // If a previous batch is still pending (unlikely at 1s intervals),
  // merge into it.
  if (pendingBatch) {
    for (const { setDisplay, value } of batch) {
      pendingBatch.push({ setDisplay, value });
    }
  } else {
    pendingBatch = batch.map(({ setDisplay, value }) => ({
      setDisplay,
      value,
    }));
  }

  if (rafId === null) {
    rafId = requestAnimationFrame(applyBatch);
  }
}

/** Phase 2 (RAF callback): apply all state updates in one synchronous block. */
function applyBatch(): void {
  rafId = null;
  const batch = pendingBatch;
  pendingBatch = null;

  if (!batch) return;

  // All setDisplay calls happen synchronously within this frame →
  // Preact batches them into a single reconciliation pass.
  for (const { setDisplay, value } of batch) {
    try {
      setDisplay(value);
    } catch {
      // Swallow errors from individual setters.
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register an elapsed time updater with the batched dispatcher.
 *
 * The dispatcher will call `compute()` on each tick, compare the result
 * against `lastValueRef.current`, and — if changed — schedule a batched
 * RAF update that calls `setDisplay(newValue)`.
 *
 * The `lastValueRef` is shared with the calling hook so that both the
 * dispatcher and the hook's immediate-update effect (for `startedAt`
 * prop changes) stay in sync.
 *
 * Returns an unregister function. When the last registration is removed,
 * the dispatcher unsubscribes from the tick timer automatically.
 *
 * @param compute      - Pure function returning the current formatted string.
 * @param setDisplay   - Preact state setter for the display value.
 * @param lastValueRef - Mutable ref tracking the last emitted value.
 * @returns Unregister function (safe to call multiple times).
 */
export function registerTickUpdater(
  compute: ComputeFn,
  setDisplay: SetDisplayFn,
  lastValueRef: MutableRef<string>,
): () => void {
  const reg: Registration = { compute, setDisplay, lastValueRef };
  registrations.push(reg);

  // Auto-start: subscribe to the tick timer on first registration.
  if (registrations.length === 1 && tickUnsub === null) {
    tickUnsub = onTick(onTickFired);
  }

  let removed = false;

  return () => {
    if (removed) return; // idempotent unregister
    removed = true;

    registrations = registrations.filter((r) => r !== reg);

    // Auto-stop: unsubscribe from tick timer when no registrations remain.
    if (registrations.length === 0) {
      if (tickUnsub) {
        tickUnsub();
        tickUnsub = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        pendingBatch = null;
      }
    }
  };
}

/**
 * Get the current state of the batched tick dispatcher (for testing/monitoring).
 */
export function getBatchedTickDispatcherState(): BatchedTickDispatcherState {
  return {
    registrationCount: registrations.length,
    hasPendingRAF: rafId !== null,
    pendingUpdateCount: pendingBatch?.length ?? 0,
  };
}

/**
 * Force-flush all pending RAF updates synchronously.
 * Cancels any pending RAF. No-op if nothing is pending.
 */
export function flushBatchedTicks(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  applyBatch();
}

/**
 * Reset all dispatcher state (for testing). Unsubscribes from the tick
 * timer, cancels pending RAF, and clears all registrations.
 */
export function resetBatchedTickDispatcher(): void {
  if (tickUnsub) {
    tickUnsub();
    tickUnsub = null;
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  registrations = [];
  pendingBatch = null;
}
