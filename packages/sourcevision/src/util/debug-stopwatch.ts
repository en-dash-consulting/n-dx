/**
 * Live "Current operation runtime" ticker for --debug mode.
 *
 * debugTimed()/debugTimedAsync() (see debug-timing.ts) already print a
 * start line and an end line with the operation's total elapsed time —
 * but for a genuinely slow, fully-synchronous operation (the exact
 * scenario that originally looked like a hang: a blocking TypeScript AST
 * parse with zero yield points), nothing can print *during* it from the
 * main thread — a normal timer literally cannot fire while the event
 * loop is blocked running synchronous JS.
 *
 * This runs the ticker on a real OS thread via worker_threads, so it
 * keeps incrementing and printing independently of whatever the main
 * thread is doing. Verified directly: a worker thread continues to fire
 * and write to stderr while the main thread spends 2.5 seconds in a
 * fully synchronous busy-loop with no await/yield points at all.
 *
 * Only ticks once an operation has actually run past one tick interval —
 * the vast majority of operations finish in well under that, so nothing
 * prints for them (matching the "quiet unless something is unusually
 * slow" design of the rest of --debug's output). Only active under
 * --debug; the worker is created lazily on first use and unref()'d so it
 * never keeps the process alive on its own.
 */
import { Worker } from "node:worker_threads";
import { isDebug } from "@n-dx/llm-client";

const TICK_INTERVAL_MS = 250;

// Inlined (via { eval: true }) rather than a separate compiled file so the
// worker doesn't depend on dist/ path resolution across dev/npm-installed
// layouts. Kept intentionally tiny — its only job is "tick and print."
const WORKER_SOURCE = `
  const { parentPort } = require("node:worker_threads");
  const { writeSync } = require("node:fs");

  let currentLabel = null;
  let startedAtMs = null;

  setInterval(() => {
    if (currentLabel !== null) {
      const elapsed = Date.now() - startedAtMs;
      writeSync(2, "    Current operation runtime: " + elapsed + "ms (" + currentLabel + ")\\n");
    }
  }, ${TICK_INTERVAL_MS}).unref();

  parentPort.on("message", (msg) => {
    if (msg && msg.type === "start") {
      currentLabel = msg.label;
      startedAtMs = msg.atMs;
    } else if (msg && msg.type === "stop") {
      currentLabel = null;
    }
  });
`;

let worker: Worker | null = null;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(WORKER_SOURCE, { eval: true });
    worker.unref();
    worker.on("error", () => {
      // Non-fatal — losing the live ticker beats crashing (or noisily
      // logging over) the analysis it's meant to help debug.
      worker = null;
    });
  } catch {
    worker = null;
  }
  return worker;
}

/** Start (or restart) the live runtime ticker for a new operation. No-op unless --debug is active. */
export function startStopwatch(label: string): void {
  if (!isDebug()) return;
  try {
    getWorker()?.postMessage({ type: "start", label, atMs: Date.now() });
  } catch {
    // Non-fatal
  }
}

/** Stop the live runtime ticker — the current operation has finished. */
export function stopStopwatch(): void {
  if (!isDebug()) return;
  try {
    worker?.postMessage({ type: "stop" });
  } catch {
    // Non-fatal
  }
}
