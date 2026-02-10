/**
 * CLI output control — supports --quiet mode for scripting.
 *
 * In quiet mode, only essential output is emitted:
 * - JSON output (--format=json)
 * - Error messages (always via console.error)
 * - Final result identifiers (e.g. created item IDs)
 *
 * Informational messages (progress, next-steps hints, summaries) are suppressed.
 */

let _quiet = false;

/** Enable or disable quiet mode. Call once at CLI entry. */
export function setQuiet(quiet: boolean): void {
  _quiet = quiet;
}

/** Returns true when quiet mode is active. */
export function isQuiet(): boolean {
  return _quiet;
}

/**
 * Print informational output. Suppressed in quiet mode.
 * Use for progress messages, hints, decorative output.
 */
export function info(...args: unknown[]): void {
  if (!_quiet) console.log(...args);
}

/**
 * Print warning output. Suppressed in quiet mode.
 * Use for quality issues, deprecation notices, non-fatal problems.
 */
export function warn(...args: unknown[]): void {
  if (!_quiet) console.error(...args);
}

/**
 * Print result output. Always shown, even in quiet mode.
 * Use for the primary data the user asked for: JSON, IDs, structured results.
 */
export function result(...args: unknown[]): void {
  console.log(...args);
}

// ── Progress spinner ──────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

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
  if (_quiet || !process.stderr.isTTY) {
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

  let frame = 0;
  let currentMessage = message;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    process.stderr.write(`\r${spinner} ${currentMessage}`);
    frame++;
  }, SPINNER_INTERVAL);

  // Prevent the timer from keeping the process alive
  if (timer.unref) timer.unref();

  return {
    update(msg: string) {
      currentMessage = msg;
    },
    stop(finalMessage?: string) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Clear the spinner line
      process.stderr.write("\r" + " ".repeat(currentMessage.length + 4) + "\r");
      if (finalMessage) {
        info(finalMessage);
      }
    },
  };
}
