/**
 * CLI output control — supports --quiet mode for scripting.
 *
 * Core primitives (setQuiet, isQuiet, info, result) are shared from
 * @n-dx/llm-client. Rex-specific extensions (warn, startSpinner)
 * are defined here and use the shared isQuiet() state.
 *
 * In quiet mode, only essential output is emitted:
 * - JSON output (--format=json)
 * - Error messages (always via console.error)
 * - Final result identifiers (e.g. created item IDs)
 *
 * Informational messages (progress, next-steps hints, summaries) are suppressed.
 */

// Re-export shared foundation primitives.
export { setQuiet, isQuiet, info, result } from "@n-dx/llm-client";

import ora from "ora";
import { isQuiet, info } from "@n-dx/llm-client";

/**
 * Print warning output. Suppressed in quiet mode.
 * Use for quality issues, deprecation notices, non-fatal problems.
 */
export function warn(...args: unknown[]): void {
  if (!isQuiet()) console.error(...args);
}

// ── Progress spinner ──────────────────────────────────────────────────

export interface Spinner {
  /** Update the spinner message while it's running. */
  update(message: string): void;
  /** Stop the spinner and print a final message. */
  stop(finalMessage?: string): void;
}

/**
 * Start an animated progress spinner in the terminal.
 * Suppressed in quiet mode or non-TTY environments (falls back to a single info line).
 *
 * Usage:
 *   const spin = startSpinner("Analyzing...");
 *   await doWork();
 *   spin.stop("Done!");
 */
export function startSpinner(message: string): Spinner {
  // Non-interactive or quiet: print once and return a lightweight spinner
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
