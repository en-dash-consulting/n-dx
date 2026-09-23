import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    globalSetup: ["tests/e2e/verify-build.js"],
    // Runs inside each worker before it loads any test module — early enough to
    // beat the memoised color caches in help.js / cli.js. See the file header.
    setupFiles: ["tests/setup-color-env.js", "tests/setup-session-env.js"],
    // Must stay above the spawn guardrail in tests/e2e/e2e-helpers.js
    // (DEFAULT_TIMEOUT) so a hung CLI is reported as a precise spawn timeout
    // rather than an opaque "test timed out", and above the total budget of
    // suites that spawn several CLIs in one test.
    testTimeout: 120000,
    // Never below testTimeout. Vitest's default is 10s, so a beforeEach that
    // builds the fixture a test needs was being given a twelfth of the test's
    // own budget — an oversight rather than a policy. Hooks here do the same
    // spawning work the tests do (mkdtemp, git init/add/commit), which on a
    // loaded Windows runner legitimately outruns 10s.
    hookTimeout: 120000,
  },
});
