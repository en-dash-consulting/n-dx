/**
 * Per-type WebSocket message throttle with configurable debounce.
 *
 * Sits between the raw WebSocket and downstream handlers (e.g. the message
 * coalescer) to provide per-message-type trailing-edge debouncing. Each
 * configured type gets its own independent timer and delay, so different
 * message types can be throttled at different rates.
 *
 * Design decisions:
 *
 *   - **Trailing-edge debounce** — messages accumulate during the delay
 *     window and are forwarded once the timer fires. New messages of the
 *     same type reset the timer (like the coalescer, but per-type).
 *
 *   - **Per-type isolation** — timers are fully independent. A burst of
 *     rex:item-updated messages doesn't delay rex:prd-changed.
 *
 *   - **Bounded memory** — maxPendingPerType caps how many messages can
 *     accumulate per type before a force-flush, preventing unbounded growth
 *     during sustained bursts.
 *
 *   - **Pass-through** — message types not in the throttledTypes set are
 *     forwarded immediately with zero delay, preserving low-latency for
 *     types that don't need throttling.
 *
 * Standalone module with zero framework dependencies.
 * The Preact integration lives in the consumer (views/prd.ts etc.).
 */

import type { ParsedWSMessage } from "./message-coalescer.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the throttled message handler. */
export interface ThrottledHandlerConfig {
  /**
   * Called for each message after its type's debounce window expires.
   * For unthrottled types, called immediately.
   */
  onMessage: (msg: ParsedWSMessage) => void;

  /**
   * Default debounce delay in milliseconds for throttled types
   * that don't have an explicit entry in `delays`.
   * Default: 250ms.
   */
  defaultDelayMs?: number | undefined;

  /**
   * Per-message-type delay overrides. Keys are message type strings,
   * values are delay in milliseconds. Types not listed here fall back
   * to `defaultDelayMs`.
   */
  delays?: Partial<Record<string, number>> | undefined;

  /**
   * Message types to throttle. Types not in this set pass through
   * immediately to `onMessage`.
   *
   * If undefined (not provided), ALL types are throttled.
   * If an empty array/set, NO types are throttled (all pass through).
   */
  throttledTypes?: ReadonlySet<string> | readonly string[] | undefined;

  /**
   * Maximum pending messages per type before force-flushing.
   * Prevents unbounded memory growth during sustained bursts.
   * Default: 20.
   */
  maxPendingPerType?: number | undefined;
}

/** A throttled message handler instance. */
export interface MessageThrottle {
  /** Push a message through the throttle. */
  push(msg: ParsedWSMessage): void;
  /** Force-flush all pending messages across all types immediately. */
  flush(): void;
  /** Dispose: cancel all timers, clear all pending, ignore future pushes. */
  dispose(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_DELAY_MS = 250;
const DEFAULT_MAX_PENDING_PER_TYPE = 20;

// ─── Internal per-type state ─────────────────────────────────────────────────

interface TypeState {
  pending: ParsedWSMessage[];
  timer: ReturnType<typeof setTimeout> | null;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new per-type message throttle.
 *
 * Usage:
 * ```ts
 * const throttle = createMessageThrottle({
 *   onMessage: (msg) => coalescer.push(msg),
 *   defaultDelayMs: 250,
 *   delays: {
 *     "rex:prd-changed": 500,    // slow — heavy reconciliation
 *     "rex:item-updated": 150,   // fast — targeted updates
 *   },
 *   throttledTypes: ["rex:prd-changed", "rex:item-updated", "rex:item-deleted"],
 *   maxPendingPerType: 20,
 * });
 *
 * ws.onmessage = (event) => {
 *   const msg = JSON.parse(event.data);
 *   throttle.push(msg);
 * };
 * ```
 */
export function createMessageThrottle(config: ThrottledHandlerConfig): MessageThrottle {
  const onMessage = config.onMessage;
  const defaultDelayMs = config.defaultDelayMs ?? DEFAULT_DELAY_MS;
  const delays = config.delays ?? {};
  const maxPending = config.maxPendingPerType ?? DEFAULT_MAX_PENDING_PER_TYPE;

  // Normalize throttledTypes into a Set, or null to mean "all types throttled"
  const throttledTypes: Set<string> | null =
    config.throttledTypes === undefined
      ? null // all types throttled
      : config.throttledTypes instanceof Set
        ? config.throttledTypes as Set<string>
        : new Set(config.throttledTypes);

  // Per-type state map
  const stateByType = new Map<string, TypeState>();

  let disposed = false;

  function isThrottled(type: string): boolean {
    if (throttledTypes === null) return true; // all throttled
    return throttledTypes.has(type);
  }

  function getDelay(type: string): number {
    return delays[type] ?? defaultDelayMs;
  }

  function getOrCreateState(type: string): TypeState {
    let state = stateByType.get(type);
    if (!state) {
      state = { pending: [], timer: null };
      stateByType.set(type, state);
    }
    return state;
  }

  function clearTypeTimer(state: TypeState): void {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function flushType(type: string): void {
    const state = stateByType.get(type);
    if (!state || state.pending.length === 0) return;

    clearTypeTimer(state);

    // Forward all pending messages for this type
    const messages = state.pending;
    state.pending = [];

    for (const msg of messages) {
      onMessage(msg);
    }
  }

  function scheduleFlush(type: string, state: TypeState): void {
    clearTypeTimer(state);
    state.timer = setTimeout(() => {
      state.timer = null;
      flushType(type);
    }, getDelay(type));
  }

  function push(msg: ParsedWSMessage): void {
    if (disposed) return;

    const type = msg.type;

    // Pass-through for unthrottled types
    if (!isThrottled(type)) {
      onMessage(msg);
      return;
    }

    // Accumulate into the type's pending queue
    const state = getOrCreateState(type);
    state.pending.push(msg);

    // Force-flush if pending count exceeds the limit
    if (state.pending.length >= maxPending) {
      flushType(type);
      return;
    }

    // Reset the trailing-edge debounce timer for this type
    scheduleFlush(type, state);
  }

  function flush(): void {
    if (disposed) return;

    for (const type of stateByType.keys()) {
      flushType(type);
    }
  }

  function dispose(): void {
    disposed = true;

    for (const state of stateByType.values()) {
      clearTypeTimer(state);
      state.pending = [];
    }
    stateByType.clear();
  }

  return { push, flush, dispose };
}
