/**
 * The worker cap every vitest config in the repository applies, read from
 * `NDX_TEST_MAX_WORKERS`.
 *
 * WHY. With no `maxWorkers`, vitest starts one worker per core for every
 * suite, whoever runs it. Several worktrees validating at once then ask for
 * several times the machine. The variable lets the caller (hench's gate, a
 * reviewer, a human) bound one run without editing a config.
 *
 * Unset or empty returns undefined, so vitest keeps its own default and a solo
 * run behaves as it did before the cap existed. An invalid value is ignored
 * with a warning: a typo in a cap must not stop a test run.
 *
 * Set it at the top level of `test`. Vitest runs every project in one pool
 * sized by the root config, and `extends: true` projects inherit it too.
 *
 * @module tests/test-max-workers
 */

/** The environment variable that carries the cap. */
export const TEST_MAX_WORKERS_ENV = "NDX_TEST_MAX_WORKERS";

/**
 * @param {Record<string, string | undefined>} [env] Defaults to `process.env`.
 * @param {(message: string) => void} [warn] Where an invalid value is reported.
 * @returns {number | undefined} A positive integer cap, or undefined for vitest's default.
 */
export function testMaxWorkers(env = process.env, warn = (message) => console.warn(message)) {
  const raw = (env[TEST_MAX_WORKERS_ENV] ?? "").trim();
  if (raw === "") return undefined;
  if (/^\d+$/.test(raw)) {
    const cap = Number(raw);
    if (cap > 0 && Number.isSafeInteger(cap)) return cap;
  }
  warn(`${TEST_MAX_WORKERS_ENV}=${JSON.stringify(raw)} is not a positive integer; using vitest's default worker count.`);
  return undefined;
}
