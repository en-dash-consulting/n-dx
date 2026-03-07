/**
 * requestAnimationFrame-based update batching for rapid UI state changes.
 *
 * When multiple WebSocket messages trigger state updates in quick succession,
 * this module batches them into a single animation frame to prevent unnecessary
 * intermediate renders. All queued updaters are composed per-setter and applied
 * once within one RAF callback, preserving final state consistency.
 *
 * Two operating modes:
 *
 *   **Enabled (default)** — updaters are queued and applied in the next RAF.
 *   Multiple `schedule()` calls for the same setter are composed in arrival
 *   order so the setter is invoked exactly once per frame. Different setters
 *   are invoked independently within the same frame.
 *
 *   **Disabled** — updaters are applied synchronously on each `schedule()`
 *   call, bypassing RAF entirely. Useful for debugging and testing where
 *   immediate state visibility is needed.
 *
 * Pipeline position:
 *
 *   ... → coalescer.onMessage → updateBatcher.schedule(setter, updater) → RAF → render
 *
 * Designed as a standalone module with zero framework dependencies.
 * The Preact integration lives in the consumer (views/prd.ts etc.).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the update batcher. */
export interface UpdateBatcherConfig {
  /**
   * When true, bypasses RAF batching and applies updates synchronously.
   * Useful for debugging and testing.
   * Default: false.
   */
  disabled?: boolean | undefined;
}

/** An update batcher instance. */
export interface UpdateBatcher {
  /**
   * Schedule a state update to be applied in the next animation frame.
   *
   * Multiple updates for the same setter are composed in order: each updater
   * receives the result of the previous, and the setter is called once with
   * the final composed value — identical to sequential application.
   *
   * When batching is disabled, the setter is called immediately.
   */
  schedule<T>(
    setter: (updater: (prev: T) => T) => void,
    updater: (prev: T) => T,
  ): void;

  /**
   * Force-flush all pending updates synchronously. Cancels any pending RAF.
   * No-op if no updates are pending.
   */
  flush(): void;

  /** Whether updates are currently pending in the batch queue. */
  hasPending(): boolean;

  /** Dispose: cancel pending RAF, clear queue, ignore future schedules. */
  dispose(): void;
}

// ─── Internal types ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyUpdater = (prev: any) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySetter = (updater: (prev: any) => any) => void;

/** Per-setter queue entry: the setter function and its accumulated updaters. */
interface SetterEntry {
  setter: AnySetter;
  updaters: AnyUpdater[];
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new update batcher.
 *
 * Usage:
 * ```ts
 * const batcher = createUpdateBatcher();
 *
 * // In a WebSocket message handler:
 * coalescer.onMessage = (msg) => {
 *   if (msg.type === "rex:item-updated") {
 *     batcher.schedule(setData, (prev) => {
 *       const newItems = applyItemUpdate(prev.items, msg.itemId, msg.updates);
 *       return newItems === prev.items ? prev : { ...prev, items: newItems };
 *     });
 *   }
 * };
 *
 * // On component unmount:
 * batcher.dispose();
 * ```
 */
export function createUpdateBatcher(config?: UpdateBatcherConfig): UpdateBatcher {
  const disabled = config?.disabled ?? false;

  // Map from setter reference → array of updater functions.
  // Using a Map preserves insertion order for deterministic flush ordering.
  let queue = new Map<AnySetter, SetterEntry>();
  let rafId: number | null = null;
  let disposed = false;

  function applyAll(): void {
    const entries = queue;
    queue = new Map();
    rafId = null;

    for (const entry of entries.values()) {
      // Compose all updaters into a single function call.
      // Each updater receives the output of the previous one.
      const composed: AnyUpdater = (prev) => {
        let current = prev;
        for (const updater of entry.updaters) {
          current = updater(current);
        }
        return current;
      };

      entry.setter(composed);
    }
  }

  function scheduleRAF(): void {
    if (rafId !== null) return; // Already scheduled
    rafId = requestAnimationFrame(applyAll);
  }

  function cancelRAF(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function schedule<T>(
    setter: (updater: (prev: T) => T) => void,
    updater: (prev: T) => T,
  ): void {
    if (disposed) return;

    // Disabled mode: apply immediately, no batching.
    if (disabled) {
      setter(updater);
      return;
    }

    const key = setter as AnySetter;
    let entry = queue.get(key);
    if (!entry) {
      entry = { setter: key, updaters: [] };
      queue.set(key, entry);
    }
    entry.updaters.push(updater as AnyUpdater);

    scheduleRAF();
  }

  function flush(): void {
    if (disposed) return;
    if (queue.size === 0) return;

    cancelRAF();
    applyAll();
  }

  function hasPending(): boolean {
    return queue.size > 0;
  }

  function dispose(): void {
    disposed = true;
    cancelRAF();
    queue = new Map();
  }

  return { schedule, flush, hasPending, dispose };
}
