import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const llmClientRoot = resolve(import.meta.dirname, "../llm-client");
const sandboxBlocksNetwork = process.env["CODEX_SANDBOX_NETWORK_DISABLED"] === "1";

export default defineConfig({
  resolve: {
    alias: [
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/llm-client$/, replacement: `${llmClientRoot}/src/public.ts` },
      // Map local .js imports to .ts files (only relative paths)
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    // Shared: pin color detection so an ambient FORCE_COLOR in the developer's
    // shell cannot change test verdicts. See tests/setup-color-env.js.
    setupFiles: ["../../tests/setup-color-env.js", "../../tests/setup-session-env.js"],
    include: [
      "tests/**/*.test.ts",
    ],
    exclude: sandboxBlocksNetwork
      ? [
          "tests/e2e/cli-serve.test.ts",
        ]
      : [],
    // Raised from 5000ms, matching hench and rex. Three suites
    // (branch-work-collector, pr-markdown, pr-markdown-reviewer-output) build
    // real git repos in a temp dir: each test spends 8-13 `git` spawns on
    // init/config/commit/checkout plus the collector's own rev-parse and
    // `git show` calls. Locally those tests run 230-540ms; on the Windows CI
    // runner, per-spawn process creation and on-access AV scanning of the temp
    // worktree multiply that by roughly an order of magnitude, which pushed
    // the heaviest three past 5 s while the rest of the suite stayed green.
    testTimeout: 30_000,
  },
});
