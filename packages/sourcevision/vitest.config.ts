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
