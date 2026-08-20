/**
 * On-demand benchmark config — NOT part of `pnpm test`.
 *
 * The default config's `include` is `tests/**\/*.test.ts`, so `*.bench-manual.ts`
 * files are invisible to the pass/fail suite by construction. This config picks
 * them up for deliberate runs:
 *
 *     pnpm --filter @n-dx/rex bench
 *
 * A separate config rather than a CLI flag because vitest's `--include` is a
 * config-only option, and passing a glob on the command line would be quoted by
 * the shell — cmd.exe does not strip single quotes, so it would break on Windows.
 *
 * fileParallelism is off and a single fork is used so timings measure the code
 * rather than contention with sibling test files. testTimeout is generous because
 * the fixtures build 20-, 200- and 1000-item trees.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

const config = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      fileParallelism: false,
      testTimeout: 300_000,
      hookTimeout: 300_000,
    },
  }),
);

// Assigned AFTER the merge, not inside it: mergeConfig CONCATENATES arrays, so
// passing `include` through it appends to the base pattern instead of replacing
// it — which ran all 202 test files alongside the benchmark. Verified by the file
// count dropping from 202 to 1.
config.test.include = ["tests/**/*.bench-manual.ts"];

export default config;
