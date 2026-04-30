import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const claudeClientRoot = resolve(import.meta.dirname, "../claude-client");
const llmClientRoot = resolve(import.meta.dirname, "../llm-client");

export default defineConfig({
  resolve: {
    alias: [
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/claude-client$/, replacement: `${claudeClientRoot}/src/public.ts` },
      // Map @n-dx/llm-client to source public.ts for vitest
      { find: /^@n-dx\/llm-client$/, replacement: `${llmClientRoot}/src/public.ts` },
      // Map local .js imports to .ts files (only relative paths)
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
