/**
 * CLI output control — supports --quiet/--verbose/--debug modes for scripting
 * and diagnostics.
 *
 * Shared foundation for consistent output behavior across all packages.
 * Each package may extend this with additional output functions (spinners,
 * section headers, etc.) but the core mode primitives live here.
 *
 * In quiet mode, only essential output is emitted:
 * - Error messages (always via console.error)
 * - Final result identifiers (e.g. JSON, IDs, structured results)
 *
 * Informational messages (progress, hints, summaries) are suppressed.
 *
 * --verbose/--debug are the opposite direction: they surface additional
 * step-level progress (verbose) or timestamped internal diagnostics (debug)
 * so a long-running command can be told apart from a hung one.
 */

let _quiet = false;
let _verbose = false;
let _debug = false;

/** Enable or disable quiet mode. Call once at CLI entry. */
export function setQuiet(quiet: boolean): void {
  _quiet = quiet;
}

/** Returns true when quiet mode is active. */
export function isQuiet(): boolean {
  return _quiet;
}

/**
 * Enable or disable verbose mode. Call once at CLI entry, alongside setQuiet.
 * Debug mode implies verbose mode (isVerbose() is true whenever debug is on).
 */
export function setVerbose(verbose: boolean): void {
  _verbose = verbose;
}

/** Returns true when verbose or debug mode is active. */
export function isVerbose(): boolean {
  return _verbose || _debug;
}

/**
 * Enable or disable debug mode. Call once at CLI entry, alongside setQuiet.
 * Also sets process.env.NDX_DEBUG so existing NDX_DEBUG/NDX_DEBUG_LLM-gated
 * debug logging (e.g. LLM subprocess spawn tracing) turns on together with
 * this flag instead of needing separate wiring.
 */
export function setDebug(debugMode: boolean): void {
  _debug = debugMode;
  if (debugMode) {
    process.env.NDX_DEBUG = "1";
  }
}

/** Returns true when debug mode is active. */
export function isDebug(): boolean {
  return _debug;
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

/**
 * Print warning output. Suppressed in quiet mode.
 * Output goes to stderr to avoid polluting machine-readable stdout.
 * Use for non-fatal problems, deprecation notices, model-change alerts.
 */
export function warn(...args: unknown[]): void {
  if (!_quiet) console.error(...args);
}

/**
 * Print verbose progress output. Shown when --verbose or --debug is active.
 * Output goes to stderr (like warn) so stdout stays machine-readable.
 * Use for step-level "still working on X" signals during long operations —
 * the primary tool for telling a hung process from a slow one.
 */
export function verbose(...args: unknown[]): void {
  if (_verbose || _debug) console.error(...args);
}

/**
 * Print debug output. Shown only when --debug is active.
 * Output goes to stderr and is timestamped, since diagnosing a hang requires
 * comparing wall-clock time against the last thing printed.
 */
export function debug(...args: unknown[]): void {
  if (_debug) console.error(`[${new Date().toISOString()}]`, ...args);
}
