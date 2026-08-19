import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    globalSetup: ["tests/e2e/verify-build.js"],
    // Must stay above the spawn guardrail in tests/e2e/e2e-helpers.js
    // (DEFAULT_TIMEOUT) so a hung CLI is reported as a precise spawn timeout
    // rather than an opaque "test timed out", and above the total budget of
    // suites that spawn several CLIs in one test.
    testTimeout: 120000,
  },
});
