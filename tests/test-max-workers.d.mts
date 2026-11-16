/**
 * Types for tests/test-max-workers.mjs, which the package vitest configs
 * import. The web package typechecks its vitest.config.ts, so the module needs
 * a declaration; the implementation stays plain JS for the root config.
 */

/** The environment variable that carries the cap. */
export declare const TEST_MAX_WORKERS_ENV: "NDX_TEST_MAX_WORKERS";

/** A positive integer cap from `NDX_TEST_MAX_WORKERS`, or undefined for vitest's default. */
export declare function testMaxWorkers(
  env?: Record<string, string | undefined>,
  warn?: (message: string) => void,
): number | undefined;
