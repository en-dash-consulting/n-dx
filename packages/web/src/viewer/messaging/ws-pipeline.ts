/**
 * WebSocket message processing pipeline — composed throttle + coalescer.
 *
 * Both `usePRDWebSocket` and `useProjectStatus` build the same two-layer
 * pipeline: per-type throttle → message coalescer. This module captures
 * that pattern as a single factory, reducing the coupling surface from
 * two individual messaging imports to one composed import.
 *
 * The pipeline handles:
 *   1. **Throttle** — per-type trailing-edge debounce with independent timers.
 *   2. **Coalescer** — batches throttled output into a single flush.
 *
 * Consumers configure which message types to throttle, their delays, and
 * provide an `onMessage` (immediate/optimistic) and `onFlush` (batched
 * reconciliation) callback.
 *
 * Standalone module with zero framework dependencies.
 */

import { createMessageThrottle, type MessageThrottle } from "./message-throttle.js";
import { createMessageCoalescer, type MessageCoalescer, type ParsedWSMessage, type CoalescedBatch } from "./message-coalescer.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the WebSocket message pipeline. */
export interface WSPipelineConfig {
  /**
   * Called once per debounce window with the coalesced batch.
   * Use this to trigger reconciliation fetches.
   */
  onFlush: (batch: CoalescedBatch) => void;

  /**
   * Called immediately for each incoming message (before throttling/batching).
   * Use this for optimistic local state updates.
   */
  onMessage?: ((msg: ParsedWSMessage) => void) | undefined;

  /**
   * Default throttle debounce delay in milliseconds.
   * Default: 250ms.
   */
  defaultDelayMs?: number | undefined;

  /**
   * Per-message-type delay overrides for the throttle layer.
   */
  delays?: Partial<Record<string, number>> | undefined;

  /**
   * Message types to throttle. Types not in this set pass through
   * to the coalescer immediately (zero delay).
   */
  throttledTypes?: readonly string[] | undefined;

  /**
   * Maximum pending messages per type before force-flushing the throttle.
   * Default: 20.
   */
  maxPendingPerType?: number | undefined;

  /**
   * The workspace this consumer shows: a worktree key, or `null` for the
   * anchor. When set, frames tagged for another workspace are dropped before
   * throttling (see {@link frameIsForWorkspace}). Leave undefined to accept
   * every frame.
   */
  workspace?: string | null | undefined;

  /**
   * Coalescer trailing-edge debounce window in milliseconds.
   * Default: 150ms.
   */
  coalescerWindowMs?: number | undefined;
}

/** A composed WebSocket message pipeline (throttle → coalescer). */
export interface WSPipeline {
  /** Push a parsed WebSocket message into the pipeline. */
  push(msg: ParsedWSMessage): void;
  /** Force-flush both throttle and coalescer. */
  flush(): void;
  /** Dispose all timers and state. Safe to call multiple times. */
  dispose(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a WebSocket message processing pipeline.
 *
 * Usage:
 * ```ts
 * const pipeline = createWSPipeline({
 *   onMessage: (msg) => applyOptimisticUpdate(msg),
 *   onFlush: (batch) => {
 *     if (batch.types.has("rex:prd-changed")) fetchPRDData();
 *   },
 *   throttledTypes: ["rex:prd-changed", "rex:item-updated"],
 *   delays: { "rex:prd-changed": 300, "rex:item-updated": 200 },
 * });
 *
 * ws.onmessage = (event) => {
 *   pipeline.push(JSON.parse(event.data));
 * };
 * ```
 */
/**
 * Whether a frame is meant for the workspace a viewer shows.
 *
 * One socket carries every worktree's frames; the server tags each with the
 * workspace it is about (`"*"` for process-wide frames such as socket health).
 * An untagged frame comes from a server that predates tags and meant the
 * anchor. So: no tag → anchor only; `"*"` → everyone; otherwise the keys must
 * match.
 */
export function frameIsForWorkspace(frame: Readonly<Record<string, unknown>>, current: string | null): boolean {
  const tag = frame["workspace"];
  if (tag === undefined || tag === null) return current === null;
  if (tag === "*") return true;
  return tag === current;
}

export function createWSPipeline(config: WSPipelineConfig): WSPipeline {
  const coalescer: MessageCoalescer = createMessageCoalescer({
    onMessage: config.onMessage,
    onFlush: config.onFlush,
    windowMs: config.coalescerWindowMs,
  });

  const throttle: MessageThrottle = createMessageThrottle({
    onMessage: (msg) => coalescer.push(msg),
    defaultDelayMs: config.defaultDelayMs,
    delays: config.delays,
    throttledTypes: config.throttledTypes,
    maxPendingPerType: config.maxPendingPerType,
  });

  const workspace = config.workspace;

  return {
    push(msg: ParsedWSMessage): void {
      if (workspace !== undefined && !frameIsForWorkspace(msg, workspace)) return;
      throttle.push(msg);
    },

    flush(): void {
      throttle.flush();
      coalescer.flush();
    },

    dispose(): void {
      throttle.dispose();
      coalescer.dispose();
    },
  };
}
