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
