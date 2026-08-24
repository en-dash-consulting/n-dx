/**
 * Per-operation debug tracing for hot per-file loops (component parsing,
 * route detection, server-route detection).
 *
 * The throttled --verbose progress ticks used elsewhere (e.g. "parsing
 * components (12/40) — file.tsx") only print *between* loop iterations —
 * if a single file's parse blocks the event loop for a long time, no tick
 * fires until it finishes, so the loop looks hung with no way to tell
 * which file or which sub-step (read, JSDoc scan, AST parse...) is
 * responsible. debugTimed/debugTimedAsync wrap an individual operation
 * with timestamped start/elapsed-ms end lines so --debug output pinpoints
 * exactly what was running when things slowed down. Only active under
 * --debug (isDebug()) — --verbose alone stays at the coarser per-file tick.
 *
 * Gap detection: wrapping every operation we thought to instrument still
 * leaves a blind spot — any code we *didn't* wrap (a stray regex, a call
 * we missed) runs silently between two checkpoints, and from the log alone
 * a real multi-minute stall there looks identical to totally normal
 * back-to-back fast operations, because each printed duration is only ever
 * for the operation it brackets, not for the gap before it. Every call
 * here checks the wall-clock time since the last checkpoint (across every
 * debugTimed/debugTimedAsync call in the process — components.ts and
 * server-route-detection.ts share this module) and calls out any gap past
 * the threshold by name, so an un-instrumented stall surfaces on its own
 * instead of requiring a guess about which line to wrap next.
 *
 * Live runtime ticker: gap detection and the start/elapsed-ms end line
 * both only report *after the fact* — while an operation is genuinely
 * still running, nothing prints. debugTimed/debugTimedAsync also start a
 * worker-thread-backed ticker (debug-stopwatch.ts) that prints "current
 * operation runtime: Xms" every 250ms for as long as the operation is
 * still in flight, so a slow operation shows visible, incrementing
 * progress instead of silence — including during a fully synchronous,
 * non-yielding block, which a same-thread timer cannot do.
 */
import { isDebug, debug } from "@n-dx/llm-client";
import { startStopwatch, stopStopwatch } from "./debug-stopwatch.js";

export { isDebug };

/** Gaps at or above this are almost certainly a real stall, not scheduling noise. */
const GAP_WARN_THRESHOLD_MS = 250;

let lastCheckpointMs: number | null = null;
let lastCheckpointLabel: string | null = null;

/**
 * Record a checkpoint and, if the wall-clock gap since the previous one
 * exceeds the threshold, log it — naming the last known checkpoint so the
 * silent stretch is bounded to "somewhere after X, before Y" instead of
 * being invisible.
 */
function noteCheckpoint(label: string): void {
  const now = Date.now();
  if (lastCheckpointMs !== null) {
    const gap = now - lastCheckpointMs;
    if (gap >= GAP_WARN_THRESHOLD_MS) {
      debug(`    ⚠ ${gap}ms with no logging since last checkpoint ("${lastCheckpointLabel}") — likely spent in un-instrumented code`);
    }
  }
  lastCheckpointMs = Date.now();
  lastCheckpointLabel = label;
}

/**
 * Record a standalone checkpoint (e.g. a phase-transition marker) in the
 * same gap-detection timeline as debugTimed/debugTimedAsync, without
 * timing an operation itself. Lets coarser "moved from step A to step B"
 * log lines close gaps too, not just the per-file hot-loop wraps.
 */
export function checkpoint(label: string): void {
  if (!isDebug()) return;
  noteCheckpoint(label);
}

/** Wrap a synchronous operation with debug start/elapsed-ms tracing, gap detection, and a live runtime ticker. */
export function debugTimed<T>(label: string, fn: () => T): T {
  if (!isDebug()) return fn();
  noteCheckpoint(label);
  const start = Date.now();
  debug(`    → ${label}`);
  startStopwatch(label);
  try {
    return fn();
  } finally {
    stopStopwatch();
    debug(`    ← ${label} (${Date.now() - start}ms)`);
    noteCheckpoint(label);
  }
}

/** Wrap an async operation with debug start/elapsed-ms tracing, gap detection, and a live runtime ticker. */
export async function debugTimedAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!isDebug()) return fn();
  noteCheckpoint(label);
  const start = Date.now();
  debug(`    → ${label}`);
  startStopwatch(label);
  try {
    return await fn();
  } finally {
    stopStopwatch();
    debug(`    ← ${label} (${Date.now() - start}ms)`);
    noteCheckpoint(label);
  }
}
