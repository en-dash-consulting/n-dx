import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { resolve } from "node:path";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

const rexRoot = resolve(import.meta.dirname, "../rex");
const claudeClientRoot = resolve(import.meta.dirname, "../claude-client");
const llmClientRoot = resolve(import.meta.dirname, "../llm-client");

export default defineConfig({
  resolve: {
    alias: [
      ...hiddenChildProcessAlias,
      // Map bare "@n-dx/rex" import to source public.ts barrel for vitest
      { find: /^@n-dx\/rex$/, replacement: `${rexRoot}/src/public.ts` },
      // Map rex subpath imports to source .ts files for vitest
      { find: /^@n-dx\/rex\/dist\/(.+)\.js$/, replacement: `${rexRoot}/src/$1.ts` },
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/claude-client$/, replacement: `${claudeClientRoot}/src/public.ts` },
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/llm-client$/, replacement: `${llmClientRoot}/src/public.ts` },
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
    setupFiles: ["../../tests/setup-color-env.js", "../../tests/setup-session-env.js"],
    include: ["tests/**/*.test.ts"],
    // Raised from 5000ms: integration tests that spawn mocked CLIs, do dynamic
    // imports of @anthropic-ai/sdk, or call vi.resetModules() take 2-4 seconds
    // on their own. Under full-monorepo parallel load (pnpm -r test) the first
    // module-load per worker can push past 5 s, causing spurious timeouts.
    //
    // Raised again from 30s to match the root config's allowance for
    // integration work. 30s still failed on the Windows runner, and the test
    // it failed moved between runs — codex-resume-contract's five UNSAFE
    // cases and v2-task-less-change's beforeEach in one run, then
    // recovery-commands-shell-exec's powershell case in the next, on an
    // unchanged tree. None is hung: each passes standalone in seconds, and
    // the same suite passes on Linux in 4m31s against Windows' 15m24s. The
    // limit was below what a loaded Windows runner needs, not a symptom of a
    // test that stopped making progress. A genuine hang still fails, later.
    testTimeout: 120_000,
    // Never below testTimeout. Vitest defaults hookTimeout to 10s, which gave a
    // beforeEach a third of the budget of the test it prepares. These hooks run
    // mkdtemp plus initGitFixtureRepo's git init/add/commit as subprocesses; on
    // a loaded Windows CI runner that exceeds 10s, which is what produced
    // "Hook timed out in 10000ms" in the integration suites — and at 30s it
    // produced "Hook timed out in 30000ms" from the same hooks.
    hookTimeout: 120_000,
    // Two projects over the same files: the ones that mock modules or globals
    // get a worker each, everything else shares workers. See
    // tests/vitest-isolation.mjs for the split and the numbers behind it.
    projects: isolationProjects({ root: import.meta.dirname, name: "hench" }),
  },
});
