import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { resolve } from "node:path";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

const llmClientRoot = resolve(import.meta.dirname, "../llm-client");
const packagesRoot = resolve(import.meta.dirname, "..");
const sandboxBlocksNetwork = process.env["CODEX_SANDBOX_NETWORK_DISABLED"] === "1";

export default defineConfig({
  resolve: {
    alias: [
      ...hiddenChildProcessAlias,
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/llm-client$/, replacement: `${llmClientRoot}/src/public.ts` },
      // Map @n-dx/lang-kit and the @n-dx/lang-* packs to their source barrels the same way
      { find: /^@n-dx\/(lang-[a-z]+)$/, replacement: `${packagesRoot}/$1/src/index.ts` },
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
    setupFiles: [
      "../../tests/setup-color-env.js",
      "../../tests/setup-session-env.js",
      // Clears TYPESAFE_API_KEY so no test resolves a live judgment route.
      "../../tests/setup-judgment-env.js",
    ],
    include: [
      "tests/**/*.test.ts",
    ],
    exclude: [
      // Fixture repositories under tests/fixtures/ contain *.test.ts files that
      // exist to be detected by the sdlc-profile analyzer, not to run here.
      "tests/fixtures/**",
      ...(sandboxBlocksNetwork ? ["tests/e2e/cli-serve.test.ts"] : []),
    ],
    // Raised from 5000ms, matching hench and rex. Three suites
    // (branch-work-collector, pr-markdown, pr-markdown-reviewer-output) build
    // real git repos in a temp dir: each test spends 8-13 `git` spawns on
    // init/config/commit/checkout plus the collector's own rev-parse and
    // `git show` calls. Locally those tests run 230-540ms; on the Windows CI
    // runner, per-spawn process creation and on-access AV scanning of the temp
    // worktree multiply that by roughly an order of magnitude, which pushed
    // the heaviest three past 5 s while the rest of the suite stayed green.
    testTimeout: 30_000,
    // Never below testTimeout — Vitest's 10s default would give a setup hook
    // less time than the test it prepares, and these hooks build the same real
    // git repos the tests measure. See the root vitest.config.js.
    hookTimeout: 30_000,
    // Two projects over the same files: the ones that mock modules or globals
    // get a worker each, everything else shares workers. See
    // tests/vitest-isolation.mjs for the split and the numbers behind it.
    projects: isolationProjects({ root: import.meta.dirname, name: "sourcevision" }),
  },
});
