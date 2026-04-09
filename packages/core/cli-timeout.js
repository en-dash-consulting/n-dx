/**
 * Command-level timeout enforcement for the n-dx CLI.
 *
 * Provides a configurable timeout that wraps each top-level CLI command.
 * The default is 30 minutes — long enough for real workloads but short
 * enough to surface stalled commands.
 *
 * Config keys (stored in .n-dx.json under the "cli" section):
 *   cli.timeoutMs          — global default timeout in milliseconds
 *   cli.timeouts.<command> — per-command override (0 = no timeout)
 */

/**
 * Default command timeout: 30 minutes.
 * Long enough for real workloads (sourcevision analysis, hench runs, etc.)
 * while ensuring stalled commands are eventually surfaced.
 */
export const DEFAULT_TIMEOUT_MS = 1800000;

/**
 * Commands that run indefinitely by design (servers, dev watchers).
 * These receive no default timeout — they can only be bounded if the user
 * explicitly sets cli.timeouts.<command> in .n-dx.json.
 */
const NO_DEFAULT_TIMEOUT_COMMANDS = new Set(["start", "web", "dev"]);

/**
 * Resolve the effective timeout for a CLI command.
 *
 * Priority (highest first):
 *  1. cli.timeouts.<command> in project config (per-command override)
 *  2. cli.timeoutMs in project config (global override)
 *  3. DEFAULT_TIMEOUT_MS (for bounded commands)
 *  4. 0 / no timeout (for long-running server commands)
 *
 * A return value of 0 means "no timeout" — the command may run indefinitely.
 *
 * @param {string} command - CLI command name (e.g. "analyze", "work")
 * @param {object} projectConfig - Parsed .n-dx.json content (or empty object)
 * @returns {number} Timeout in milliseconds, or 0 for no timeout
 */
export function resolveCommandTimeout(command, projectConfig) {
  const cli = projectConfig?.cli ?? {};

  // 1. Per-command override takes highest precedence
  const perCommand = cli.timeouts?.[command];
  if (typeof perCommand === "number") {
    // Explicit 0 means "no timeout"; positive value is a timeout in ms
    return perCommand >= 0 ? perCommand : DEFAULT_TIMEOUT_MS;
  }

  // 2. Global CLI timeout override
  const global = cli.timeoutMs;
  if (typeof global === "number" && global >= 0) {
    return global;
  }

  // 3. Long-running server commands have no built-in default timeout
  if (NO_DEFAULT_TIMEOUT_COMMANDS.has(command)) {
    return 0;
  }

  // 4. Apply the default timeout for all other commands
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Wrap an async function with a wall-clock timeout.
 *
 * If `fn` completes before `timeoutMs` elapses, the returned promise
 * resolves with the same value. If the timer fires first, the returned
 * promise rejects with an Error whose `.suggestion` property contains
 * a ready-to-paste config command.
 *
 * @param {string} command - Command name, used in the error message
 * @param {number} timeoutMs - Timeout in milliseconds (must be > 0)
 * @param {() => Promise<unknown>} fn - Async function to execute
 * @returns {Promise<unknown>}
 */
export function withCommandTimeout(command, timeoutMs, fn) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const elapsedMin = Math.round(timeoutMs / 60000);
      const err = new Error(
        `Command "${command}" timed out after ${elapsedMin} min (${timeoutMs}ms).`,
      );
      err.suggestion = `Increase the limit with: ndx config cli.timeouts.${command} <ms>`;
      reject(err);
    }, timeoutMs);

    // Allow the process to exit naturally once the command finishes —
    // prevents the timer from holding the Node.js event loop open.
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    Promise.resolve(fn()).then(
      (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      },
    );
  });
}
