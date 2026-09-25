/**
 * Monotonic progress reporting for long-running CLI commands.
 *
 * A command like `sourcevision analyze` or `hench run` moves through several
 * phases or batches, each of which naturally starts its own counter back at
 * 1 (batch 1/3, attempt 1/2, turn 1/10, ...). Printed as-is, the number a
 * user watches can appear to move backwards when a new phase or batch
 * begins, even though the command is still making forward progress.
 *
 * `ProgressReporter` tracks a running maximum across every phase seen so
 * far, so the number returned by `advance()` never decreases within the
 * life of the reporter — phase-qualified counters are automatically turned
 * into a running total.
 *
 * It also owns the single in-place "progress line" a command redraws on a
 * TTY, so a message printed elsewhere mid-command (an LLM provider's
 * rate-limit retry, deep inside a batch loop) can interrupt it with its own
 * line via `retryLine()` and have the progress line redrawn afterward
 * without the caller needing to know what that line currently says.
 */

/** Returns true when `stream` is an interactive TTY (supports `\r`/ANSI redraw). */
function isTTY(stream: NodeJS.WritableStream): boolean {
  return !!(stream as Partial<NodeJS.WriteStream>).isTTY;
}

/** Format a retry message in the standard `"retry n/m: <reason>"` form. */
export function formatRetryLine(attempt: number, maxAttempts: number, reason: string): string {
  return `retry ${attempt}/${maxAttempts}: ${reason}`;
}

export interface ProgressReporter {
  /**
   * Report progress within a named phase. `current`/`total` are local to
   * that phase (e.g. "file 3 of 10"). Returns the counter to display,
   * offset by every prior phase's final count so switching to a new phase
   * never shows a lower number than was already displayed — and clamped so
   * the return value never decreases even if `current` itself does.
   */
  advance(phase: string, current: number, total: number): number;

  /** Render `text` as the current progress line (redrawn in place on a TTY, one line per call otherwise). */
  render(text: string): void;

  /**
   * Print `"retry n/m: <reason>"` on its own line without disturbing the
   * progress line last passed to `render()`, then redraw that line.
   */
  retryLine(attempt: number, maxAttempts: number, reason: string): void;
}

/** Create a fresh {@link ProgressReporter} writing to `stream` (defaults to stderr). */
export function createProgressReporter(stream: NodeJS.WritableStream = process.stderr): ProgressReporter {
  let currentPhase: string | null = null;
  let phaseBase = 0;
  let runningMax = 0;
  let lastLine: string | null = null;

  return {
    advance(phase: string, current: number): number {
      if (phase !== currentPhase) {
        currentPhase = phase;
        phaseBase = runningMax;
      }
      const display = Math.max(runningMax, phaseBase + current);
      runningMax = display;
      return display;
    },

    render(text: string): void {
      lastLine = text;
      if (isTTY(stream)) {
        stream.write(`\r\x1b[K${text}`);
      } else {
        stream.write(`${text}\n`);
      }
    },

    retryLine(attempt: number, maxAttempts: number, reason: string): void {
      const line = formatRetryLine(attempt, maxAttempts, reason);
      if (isTTY(stream)) {
        stream.write(lastLine !== null ? `\n${line}\n` : `${line}\n`);
        if (lastLine !== null) stream.write(`\r\x1b[K${lastLine}`);
      } else {
        stream.write(`${line}\n`);
      }
    },
  };
}

// ── Active reporter registry ─────────────────────────────────────────────
//
// A command registers the reporter it creates as "active" for its
// duration so code far from the CLI entry point (an LLM provider's retry
// callback, deep inside a batch/attempt loop) can redraw the right
// progress line without the reporter being threaded through every call
// site — mirroring the existing quiet/verbose/debug module-level flags in
// `output.ts` that this module sits alongside.

let activeReporter: ProgressReporter | null = null;

/** Register the reporter for the currently-running command, or `null` to clear it. */
export function setActiveProgressReporter(reporter: ProgressReporter | null): void {
  activeReporter = reporter;
}

/** The reporter registered by the currently-running command, if any. */
export function getActiveProgressReporter(): ProgressReporter | null {
  return activeReporter;
}

/**
 * Print a `"retry n/m: <reason>"` line for the active progress reporter (if
 * one is registered), redrawing its progress line afterward. Falls back to
 * a plain line when no reporter is active.
 */
export function printRetryLine(attempt: number, maxAttempts: number, reason: string): void {
  if (activeReporter) {
    activeReporter.retryLine(attempt, maxAttempts, reason);
  } else {
    process.stderr.write(`${formatRetryLine(attempt, maxAttempts, reason)}\n`);
  }
}
