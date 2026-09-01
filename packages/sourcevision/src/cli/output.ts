/**
 * CLI output control — supports --quiet mode for scripting.
 *
 * Re-exports the shared foundation primitives from @n-dx/llm-client.
 * All existing consumers import from this file — the re-export preserves
 * their import paths while consolidating the implementation.
 */

export {
  setQuiet, isQuiet,
  setVerbose, isVerbose,
  setDebug, isDebug,
  info, result, verbose, debug,
} from "@n-dx/llm-client";

import { isQuiet, isVerbose, info, verbose } from "@n-dx/llm-client";
import ora from "ora";

/**
 * Await a long-running operation, printing a periodic "still running" tick
 * under --verbose so a slow step can be told apart from a hung one. No-op
 * (besides awaiting) unless verbose mode is active.
 */
export async function withHeartbeat<T>(label: string, promise: Promise<T>, intervalMs = 15_000): Promise<T> {
  if (!isVerbose()) return promise;
  const startMs = Date.now();
  const interval = setInterval(() => {
    verbose(`  … ${label} (${Math.round((Date.now() - startMs) / 1000)}s elapsed)`);
  }, intervalMs);
  try {
    return await promise;
  } finally {
    clearInterval(interval);
  }
}

export interface Spinner {
  /** Update the spinner message while it's running. */
  update(message: string): void;
  /** Stop the spinner and print a final message. */
  stop(finalMessage?: string): void;
}

/**
 * Start an animated progress spinner in the terminal.
 * Suppressed in quiet mode or non-TTY environments (falls back to a single info line).
 */
export function startSpinner(message: string): Spinner {
  if (isQuiet() || !process.stderr.isTTY) {
    info(message);
    let stopped = false;
    return {
      update(_msg: string) { /* noop */ },
      stop(final?: string) {
        if (stopped) return;
        stopped = true;
        if (final) info(final);
      },
    };
  }

  const spinner = ora({ text: message, stream: process.stderr }).start();
  let stopped = false;

  return {
    update(msg: string) {
      if (stopped) return;
      spinner.text = msg;
    },
    stop(finalMessage?: string) {
      if (stopped) return;
      stopped = true;
      spinner.stop();
      if (finalMessage) info(finalMessage);
    },
  };
}
