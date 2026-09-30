/**
 * CLI output control — supports --quiet mode for scripting.
 *
 * Core primitives (setQuiet, isQuiet, info, result, warn) are shared from
 * @n-dx/llm-client. Rex-specific extension (startSpinner) is defined
 * here and uses the shared isQuiet() state.
 *
 * In quiet mode, only essential output is emitted:
 * - JSON output (--format=json)
 * - Error messages (always via console.error)
 * - Final result identifiers (e.g. created item IDs)
 *
 * Informational messages (progress, next-steps hints, summaries) are suppressed.
 */

// Re-export shared foundation primitives.
export {
  setQuiet, isQuiet,
  setVerbose, isVerbose,
  setDebug, isDebug,
  info, result, warn, verbose, debug,
} from "@n-dx/llm-client";

import ora from "ora";
import {
  isQuiet, info,
  formatRetryLine,
  createProgressReporter,
  getActiveProgressReporter, setActiveProgressReporter,
} from "@n-dx/llm-client";
import type { ProgressReporter } from "@n-dx/llm-client";

// ── Whole-command progress reporter ───────────────────────────────────

/**
 * Run `fn` with a command-scoped {@link ProgressReporter} registered as active,
 * so every spinner and every LLM retry inside it reports through one reporter
 * and its counters stay monotonic across phase boundaries.
 *
 * Nested calls reuse the outer reporter rather than starting a second one —
 * `rex analyze` invoked from `ndx plan` must not reset a count the caller is
 * already displaying. Mirrors `sv analyze`'s ownership check so both domain
 * CLIs share one reporter contract.
 */
export async function withCommandProgressReporter<T>(fn: () => Promise<T>): Promise<T> {
  const owns = getActiveProgressReporter() === null;
  if (owns) setActiveProgressReporter(createProgressReporter());
  try {
    return await fn();
  } finally {
    if (owns) setActiveProgressReporter(null);
  }
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

  // While this spinner owns the terminal line it is the active progress
  // reporter, so a rate-limit retry raised deep inside @n-dx/llm-client pauses
  // the spinner, prints its own line and resumes — instead of interleaving
  // with the spinner's in-place redraw and corrupting it. `advance()`
  // delegates to whatever reporter was active before (the whole-command
  // reporter from withCommandProgressReporter) so counters stay monotonic
  // across spinners, not just within one. Same contract as sourcevision's
  // startSpinner.
  const outerReporter = getActiveProgressReporter();
  const spinnerReporter: ProgressReporter = {
    advance(phase, current, total) {
      return outerReporter ? outerReporter.advance(phase, current, total) : current;
    },
    render(text) {
      if (!stopped) spinner.text = text;
    },
    retryLine(attempt, maxAttempts, reason) {
      const line = formatRetryLine(attempt, maxAttempts, reason);
      const wasSpinning = !stopped && spinner.isSpinning;
      const resumeText = spinner.text;
      if (wasSpinning) spinner.stop();
      process.stderr.write(`${line}\n`);
      if (wasSpinning) spinner.start(resumeText);
    },
  };
  setActiveProgressReporter(spinnerReporter);

  return {
    update(msg: string) {
      if (stopped) return;
      spinner.text = msg;
    },
    stop(finalMessage?: string) {
      if (stopped) return;
      stopped = true;
      spinner.stop();
      setActiveProgressReporter(outerReporter);
      if (finalMessage) info(finalMessage);
    },
  };
}
