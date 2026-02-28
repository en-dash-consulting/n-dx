/**
 * CLI output control — supports --quiet mode for scripting.
 *
 * Shared foundation for consistent output behavior across all packages.
 * Each package may extend this with additional output functions (spinners,
 * section headers, etc.) but the core quiet-mode primitives live here.
 *
 * In quiet mode, only essential output is emitted:
 * - Error messages (always via console.error)
 * - Final result identifiers (e.g. JSON, IDs, structured results)
 *
 * Informational messages (progress, hints, summaries) are suppressed.
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
 * Print result output. Always shown, even in quiet mode.
 * Use for the primary data the user asked for: JSON, IDs, structured results.
 */
export function result(...args: unknown[]): void {
  console.log(...args);
}
