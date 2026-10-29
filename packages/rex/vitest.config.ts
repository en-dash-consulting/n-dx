import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { resolve } from "node:path";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

const claudeClientRoot = resolve(import.meta.dirname, "../claude-client");
const llmClientRoot = resolve(import.meta.dirname, "../llm-client");

export default defineConfig({
  resolve: {
    alias: [
      ...hiddenChildProcessAlias,
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/claude-client$/, replacement: `${claudeClientRoot}/src/public.ts` },
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/llm-client$/, replacement: `${llmClientRoot}/src/public.ts` },
      { find: /^@n-dx\/lang-kit$/, replacement: resolve(import.meta.dirname, "../lang-kit/src/index.ts") },
      // Map local .js imports to .ts files (only relative paths)
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
    setupFiles: ["../../tests/setup-color-env.js", "../../tests/setup-session-env.js", "../../tests/setup-exit-trace.js"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    // Never below testTimeout — Vitest's 10s default would give a setup hook
    // less time than the test it prepares. See the root vitest.config.js.
    hookTimeout: 30000,
    // Two projects over the same files: the ones that mock modules or globals
    // get a worker each, everything else shares workers. See
    // tests/vitest-isolation.mjs for the split and the numbers behind it.
    projects: isolationProjects({ root: import.meta.dirname, name: "rex" }),
  },
});
