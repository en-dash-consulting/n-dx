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
    setupFiles: ["../../tests/setup-color-env.js"],
    include: [
      "tests/**/*.test.ts",
    ],
    exclude: sandboxBlocksNetwork
      ? [
          "tests/e2e/cli-serve.test.ts",
        ]
      : [],
  },
});
