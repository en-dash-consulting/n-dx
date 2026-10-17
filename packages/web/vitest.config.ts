import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

const rexRoot = resolve(import.meta.dirname, "../rex");
const svRoot = resolve(import.meta.dirname, "../sourcevision");
const claudeClientRoot = resolve(import.meta.dirname, "../claude-client");
const llmClientRoot = resolve(import.meta.dirname, "../llm-client");
const packagesRoot = resolve(import.meta.dirname, "..");
const sandboxBlocksNetwork = process.env["CODEX_SANDBOX_NETWORK_DISABLED"] === "1";

export default defineConfig({
  resolve: {
    alias: [
      ...hiddenChildProcessAlias,
      // Map bare "@n-dx/rex" import to source public.ts barrel for vitest
      { find: /^@n-dx\/rex$/, replacement: `${rexRoot}/src/public.ts` },
      // Map rex subpath imports to source .ts files for vitest
      { find: /^@n-dx\/rex\/dist\/(.+)\.js$/, replacement: `${rexRoot}/src/$1.ts` },
      // Map bare "@n-dx/sourcevision" import to source public.ts barrel for vitest
      { find: /^@n-dx\/sourcevision$/, replacement: `${svRoot}/src/public.ts` },
      // Map sourcevision subpath imports to source .ts files for vitest
      { find: /^@n-dx\/sourcevision\/dist\/(.+)\.js$/, replacement: `${svRoot}/src/$1.ts` },
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/llm-client$/, replacement: `${llmClientRoot}/src/public.ts` },
      // Map @n-dx/lang-kit and the @n-dx/lang-* packs sourcevision loads to their
      // source barrels: their dist would hit the local .js → .ts rewrite below
      { find: /^@n-dx\/(lang-[a-z]+)$/, replacement: `${packagesRoot}/$1/src/index.ts` },
      // Map @n-dx/claude-client to source public.ts for vitest (transitive dep of rex)
      { find: /^@n-dx\/claude-client$/, replacement: `${claudeClientRoot}/src/public.ts` },
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
    include: [
      "tests/**/*.test.ts",
    ],
    setupFiles: [
      "tests/setup/local-storage.ts",
      "tests/setup/preact-frame-leak-guard.ts",
      "../../tests/setup-color-env.js",
      "../../tests/setup-session-env.js",
      "../../tests/setup-ndx-home.js",
    ],
    exclude: sandboxBlocksNetwork
      ? [
          "tests/unit/server/**/*.test.ts",
          "tests/integration/smart-add-dispatch.test.ts",
          "tests/integration/ws-health-integration.test.ts",
        ]
      : [],
    // Matches hench, rex and sourcevision, which raised these for the same
    // reason: server and worktree fixtures bind ports and spawn git, and on the
    // Windows CI runner process creation plus on-access AV scanning multiplies
    // their cost by roughly an order of magnitude. This suite was still on
    // Vitest's 5s/10s defaults and has failed that job (run 35761150216), so it
    // gets the same budget rather than the tightest one in the monorepo.
    // hookTimeout is never below testTimeout: a setup hook always gets at least
    // as long as the test it prepares.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Two projects over the same files: the ones that mock modules or
    // globals get a worker each, everything else shares workers and, for the
    // jsdom files, the environment. See tests/vitest-isolation.mjs for the
    // split and the numbers behind it.
    projects: isolationProjects({ root: import.meta.dirname, name: "web" }),
  },
});
