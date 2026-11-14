/**
 * The test worker cap hench hands to the commands it runs.
 *
 * `hench.testGate.maxWorkers` becomes `NDX_TEST_MAX_WORKERS`, which every
 * vitest config in a project that opts in reads (see `tests/test-max-workers.mjs`
 * in the n-dx repository). Hench sets it on the gate and its re-run, post-task
 * tests, the completion check's test run, requirement validation commands and
 * the agent session's shell.
 *
 * The lower value wins: a valid inherited `NDX_TEST_MAX_WORKERS` below the
 * configured cap is kept, so repository config can only lower how many
 * workers a suite starts, never raise a cap the user exported. Vitest does
 * not clamp the value to the core count, so overwriting it could widen a run.
 *
 * Applied after the environment is sanitized, so a `guard.env` deny glob
 * cannot drop it. The inherited cap is read from the parent environment
 * before sanitizing (`source`), because a repository's `guard.env.deny`
 * always applies: reading the sanitized copy would let a repository strip the
 * user's cap and then raise it.
 *
 * @module hench/process/test-workers
 */

/** The variable the vitest configs read. */
export const TEST_MAX_WORKERS_ENV = "NDX_TEST_MAX_WORKERS";

/**
 * A positive integer cap from `raw`, parsed as `tests/test-max-workers.mjs`
 * parses it, or undefined when it is absent or invalid.
 */
function parseInheritedCap(raw: string | undefined): number | undefined {
  const trimmed = (raw ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const cap = Number(trimmed);
  return cap > 0 && Number.isSafeInteger(cap) ? cap : undefined;
}

/**
 * `env` with `NDX_TEST_MAX_WORKERS` set to the lower of `maxWorkers` and a
 * valid value in `source`, or `env` itself when no cap is configured, so an
 * unset cap changes nothing. `source` is the unsanitized parent environment
 * `env` was built from.
 */
export function withTestMaxWorkers(
  env: NodeJS.ProcessEnv,
  maxWorkers: number | undefined,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (maxWorkers === undefined) return env;
  const inherited = parseInheritedCap(source[TEST_MAX_WORKERS_ENV]);
  const cap = inherited === undefined ? maxWorkers : Math.min(inherited, maxWorkers);
  return { ...env, [TEST_MAX_WORKERS_ENV]: String(cap) };
}
