/**
 * Heartbeat writer — periodic `lastActivityAt` updates during agent execution.
 *
 * Both the API and CLI loops update `lastActivityAt` at the end of each turn,
 * but long-running tool calls (compilation, test suites, large file operations)
 * can cause gaps that make a healthy run appear stale. The heartbeat timer
 * writes `lastActivityAt` to disk at a fixed interval, independent of the
 * turn cycle, so the web dashboard always has a recent timestamp to check.
 *
 * Usage:
 *   const hb = startHeartbeat(henchDir, run);
 *   // ... run agent loop ...
 *   hb.stop();
 *
 * @module
 */

import type { RunRecord } from "../../schema/index.js";
import { saveRun } from "../../store/index.js";

/** Default heartbeat interval: 30 seconds. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface Heartbeat {
  /** Stop the heartbeat timer. Call this when the run ends. */
  stop: () => void;
  /** Peak RSS observed during heartbeat sampling (bytes). */
  peakRssBytes: number;
}

/**
 * Start a periodic heartbeat that updates `run.lastActivityAt` and persists
 * the run record to disk. The heartbeat fires every {@link HEARTBEAT_INTERVAL_MS}
 * milliseconds.
 *
 * The timer uses `setInterval` with `unref()` so it does not prevent the
 * Node.js process from exiting.
 *
 * @param henchDir - Path to the .hench directory (for saveRun).
 * @param run      - The live RunRecord. The function mutates `lastActivityAt` in place.
 * @param intervalMs - Override the default interval (mainly for testing).
 */
export function startHeartbeat(
  henchDir: string,
  run: RunRecord,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): Heartbeat {
  // Initialize peak RSS with current value
  let peakRss = process.memoryUsage().rss;

  const timer = setInterval(async () => {
    // Only beat while the run is still active
    if (run.status !== "running") {
      clearInterval(timer);
      return;
    }

    // Sample RSS on each tick
    const currentRss = process.memoryUsage().rss;
    if (currentRss > peakRss) {
      peakRss = currentRss;
    }

    run.lastActivityAt = new Date().toISOString();
    try {
      await saveRun(henchDir, run);
    } catch {
      // Heartbeat is best-effort — don't crash the agent on write failure
    }
  }, intervalMs);

  // Don't keep the process alive just for heartbeats
  if (timer.unref) {
    timer.unref();
  }

  return {
    stop() {
      clearInterval(timer);
    },
    get peakRssBytes() {
      // Final sample on read to catch any RSS growth since last tick
      const currentRss = process.memoryUsage().rss;
      if (currentRss > peakRss) {
        peakRss = currentRss;
      }
      return peakRss;
    },
  };
}
