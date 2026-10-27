import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

export default defineConfig({
  resolve: {
    alias: [
      ...hiddenChildProcessAlias,
      // Map local .js imports to .ts files
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    // Console output is kept for failing tests and dropped for passing ones.
    // A green run of the monorepo printed 7500 lines from hench and 5300 from
    // rex (run 38193308009), every one of them from a test that passed; the
    // lines a failure needs are exactly the ones this still prints.
    silent: "passed-only",
    // Shared: pin color detection so an ambient FORCE_COLOR in the developer's
    // shell cannot change test verdicts. See tests/setup-color-env.js.
    setupFiles: [
      "../../tests/setup-color-env.js",
      "../../tests/setup-session-env.js", "../../tests/setup-exit-trace.js",
      // Clears TYPESAFE_API_KEY. askJev reads it from process.env by default,
      // so without this an ambient key turns any test that forgets to pass
      // `env` into a live, billed request. Moved here with the Jev client.
      "../../tests/setup-judgment-env.js",
    ],
    include: ["tests/**/*.test.ts"],
    // Two projects over the same files: the ones that mock modules or globals
    // get a worker each, everything else shares workers. See
    // tests/vitest-isolation.mjs for the split and the numbers behind it.
    projects: isolationProjects({ root: import.meta.dirname, name: "llm-client" }),
  },
});
