/**
 * WebSocket message coalescing for rapid sequential updates.
 *
 * When multiple WebSocket messages arrive in quick succession (e.g. a batch
 * of rex:item-updated events during a bulk operation), this module batches
 * them into a single flush to avoid redundant fetch calls.
 *
 * Two-callback design:
 *
 *   onMessage(msg)  — fires immediately for each message, enabling optimistic
 *                     UI updates with no delay.
 *   onFlush(batch)  — fires once per throttle window (trailing edge), after
 *                     messages stop arriving. The batch includes all message
 *                     types seen, counts per type, and the full ordered list.
 *                     Consumers use this to trigger a single reconciliation
 *                     (e.g. fetchPRDData + fetchTaskUsage) instead of N calls.
 *
 * Designed as a standalone module with zero framework dependencies.
 * The Preact integration lives in the consumer (views/prd.ts etc.).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** A parsed WebSocket message. Minimum requirement: a `type` string. */
export interface ParsedWSMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** The coalesced batch delivered to onFlush. */
export interface CoalescedBatch {
  /** Deduplicated set of message types in this batch. */
  readonly types: Set<string>;
  /** Per-type count of messages in this batch. */
  readonly countByType: Map<string, number>;
  /** All messages in arrival order — no data loss. */
  readonly messages: readonly ParsedWSMessage[];
  /** Total number of messages. Convenience alias for messages.length. */
  readonly size: number;
}

/** Configuration for the message coalescer. */
export interface MessageCoalescerConfig {
  /**
   * Called once per throttle window with the coalesced batch.
   * Use this to trigger reconciliation fetches.
   */
  onFlush: (batch: CoalescedBatch) => void;

  /**
   * Called immediately for each incoming message (before batching).
   * Use this for optimistic local state updates that should not be delayed.
   */
  onMessage?: ((msg: ParsedWSMessage) => void) | undefined;

  /**
   * Trailing-edge debounce window in milliseconds.
   * Messages arriving within this window are coalesced into one flush.
   * Default: 150ms.
   */
  windowMs?: number | undefined;

  /**
   * Maximum number of messages to accumulate before forcing a flush.
   * Prevents unbounded memory growth during sustained bursts.
   * Default: 50.
   */
  maxBatchSize?: number | undefined;
}

/** A message coalescer instance. */
export interface MessageCoalescer {
  /** Push a new message into the coalescer. */
  push(msg: ParsedWSMessage): void;
  /** Force-flush the current batch immediately. No-op if empty. */
  flush(): void;
  /** Dispose: cancel timers, clear batch, ignore future pushes. */
  dispose(): void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 150;
const DEFAULT_MAX_BATCH_SIZE = 50;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new message coalescer.
 *
 * Usage:
 * ```ts
 * const coalescer = createMessageCoalescer({
 *   onMessage: (msg) => {
 *     // Immediate optimistic update
 *     if (msg.type === "rex:item-updated") applyItemUpdate(msg);
 *   },
 *   onFlush: (batch) => {
 *     // Coalesced reconciliation — runs once per window
 *     if (batch.types.has("rex:item-updated") || batch.types.has("rex:prd-changed")) {
 *       fetchPRDData();
 *       fetchTaskUsage();
 *     }
 *   },
 * });
 *
 * ws.onmessage = (event) => {
 *   const msg = JSON.parse(event.data);
 *   coalescer.push(msg);
 * };
 * ```
 */
export function createMessageCoalescer(config: MessageCoalescerConfig): MessageCoalescer {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  const onFlush = config.onFlush;
  const onMessage = config.onMessage ?? null;

  let messages: ParsedWSMessage[] = [];
  let types = new Set<string>();
  let countByType = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function buildBatch(): CoalescedBatch {
    return {
      types,
      countByType,
      messages,
      size: messages.length,
    };
  }

  function resetBatch(): void {
    messages = [];
    types = new Set<string>();
    countByType = new Map<string, number>();
  }

  function doFlush(): void {
    clearTimer();
    if (messages.length === 0) return;

    const batch = buildBatch();
    resetBatch();
    onFlush(batch);
  }

  function scheduleFlush(): void {
    clearTimer();
    timer = setTimeout(doFlush, windowMs);
  }

  function push(msg: ParsedWSMessage): void {
    if (disposed) return;

    // Immediate per-message callback (for optimistic updates)
    if (onMessage) onMessage(msg);

    // Accumulate into the current batch
    messages.push(msg);
    types.add(msg.type);
    countByType.set(msg.type, (countByType.get(msg.type) ?? 0) + 1);

    // Force flush if batch size limit reached
    if (messages.length >= maxBatchSize) {
      doFlush();
      return;
    }

    // Reset the trailing-edge debounce timer
    scheduleFlush();
  }

  function flush(): void {
    if (disposed) return;
    doFlush();
  }

  function dispose(): void {
    disposed = true;
    clearTimer();
    resetBatch();
  }

  return { push, flush, dispose };
}
