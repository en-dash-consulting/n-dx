/**
 * Push a running `sv analyze`'s progress to dashboard sockets.
 *
 * The analyzing process — started from a terminal or by the dashboard —
 * writes `.sourcevision/.cache/analyze-progress.json` as it moves through
 * phases, passes and batches. This polls that file and broadcasts an
 * `sv:analyze-progress` frame carrying the full report whenever it changes.
 *
 * Polling rather than `fs.watch`, for three reasons:
 * - `.cache/` usually does not exist when the server starts (the first
 *   analysis creates it), and a watch cannot be placed on a missing path.
 * - The existing `.sourcevision/` watch is not recursive, and recursive
 *   watches are not available everywhere.
 * - A run killed outright never touches the file again, so only re-checking
 *   its pid notices that it has stopped. While a run is live the file is
 *   re-read every tick for exactly that reason; otherwise a tick is one stat.
 *
 * {@link ANALYZE_PROGRESS_POLL_MS} keeps a change on the socket within about
 * a second of the writer making it.
 *
 * @module web/server/analyze-progress-watcher
 */

import { statSync } from "node:fs";
import { readAnalyzeProgress, analyzeProgressPath } from "./domain-gateway.js";
import type { AnalyzeProgressReport, ProcessCommandLine } from "./domain-gateway.js";
import type { WebSocketBroadcaster } from "./websocket.js";

export const ANALYZE_PROGRESS_POLL_MS = 1000;

export interface AnalyzeProgressWatchOptions {
  /** Liveness check for the recorded pid; injectable for tests. */
  isPidAlive?: (pid: number) => boolean;
  /** The recorded pid's command line; injectable for tests. */
  processCommandLine?: ProcessCommandLine;
}

/** Frame broadcast on every change. */
export interface AnalyzeProgressFrame {
  type: "sv:analyze-progress";
  progress: AnalyzeProgressReport | null;
  timestamp: string;
}

/**
 * Start polling `svDir`'s progress file. The state found at startup is the
 * baseline and is not broadcast. Returns the (unref'd) interval; clear it to
 * stop.
 */
export function watchAnalyzeProgress(
  svDir: string,
  broadcast: WebSocketBroadcaster,
  options: AnalyzeProgressWatchOptions = {},
): ReturnType<typeof setInterval> {
  const path = analyzeProgressPath(svDir);
  const read = () => readAnalyzeProgress(svDir, { isPidAlive: options.isPidAlive, processCommandLine: options.processCommandLine });

  let fileKey = statKey(path);
  let last = read();
  let lastSignature = signature(last);

  const timer = setInterval(() => {
    const key = statKey(path);
    if (key === fileKey && !last?.running) return;
    fileKey = key;
    const report = read();
    const sig = signature(report);
    last = report;
    if (sig === lastSignature) return;
    lastSignature = sig;
    const frame: AnalyzeProgressFrame = { type: "sv:analyze-progress", progress: report, timestamp: new Date().toISOString() };
    broadcast(frame);
  }, ANALYZE_PROGRESS_POLL_MS);
  timer.unref();
  return timer;
}

/** Identity of the file on disk, or "missing". */
function statKey(path: string): string {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "missing";
  }
}

/** What makes two reports different to a viewer: a write, or a liveness verdict. */
function signature(report: AnalyzeProgressReport | null): string {
  return report ? `${report.startedAt}|${report.updatedAt}|${report.status}` : "none";
}
