/**
 * The test worker cap hench hands to the commands it runs.
 *
 * `hench.testGate.maxWorkers` becomes `NDX_TEST_MAX_WORKERS`, which every
 * vitest config in a project that opts in reads (see `tests/test-max-workers.mjs`
 * in the n-dx repository). Hench sets it on the gate and its re-run, post-task
 * tests, the completion check's test run, requirement validation commands and
 * the agent session's shell.
 *
 * Applied after the environment is sanitized, so a `guard.env` deny glob
 * cannot drop it. That is safe to take from repository config: the value can
 * only lower how many workers a suite starts, never widen what runs.
 *
 * @module hench/process/test-workers
 */

/** The variable the vitest configs read. */
export const TEST_MAX_WORKERS_ENV = "NDX_TEST_MAX_WORKERS";

/**
 * `env` with `NDX_TEST_MAX_WORKERS` set to `maxWorkers`, or `env` itself
 * when no cap is configured, so an unset cap changes nothing.
 */
export function withTestMaxWorkers(env: NodeJS.ProcessEnv, maxWorkers: number | undefined): NodeJS.ProcessEnv {
  if (maxWorkers === undefined) return env;
  return { ...env, [TEST_MAX_WORKERS_ENV]: String(maxWorkers) };
}
