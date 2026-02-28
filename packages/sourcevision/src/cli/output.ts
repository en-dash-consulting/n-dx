/**
 * CLI output control — supports --quiet mode for scripting.
 *
 * Re-exports the shared foundation primitives from @n-dx/llm-client.
 * All existing consumers import from this file — the re-export preserves
 * their import paths while consolidating the implementation.
 */

export { setQuiet, isQuiet, info, result } from "@n-dx/llm-client";

import { isQuiet, info } from "@n-dx/llm-client";
import ora from "ora";

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
