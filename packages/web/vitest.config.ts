import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const rexRoot = resolve(import.meta.dirname, "../rex");
const svRoot = resolve(import.meta.dirname, "../sourcevision");
const claudeClientRoot = resolve(import.meta.dirname, "../claude-client");
const llmClientRoot = resolve(import.meta.dirname, "../llm-client");

export default defineConfig({
  resolve: {
    alias: [
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
      // Map @n-dx/claude-client to source public.ts for vitest (transitive dep of rex)
      { find: /^@n-dx\/claude-client$/, replacement: `${claudeClientRoot}/src/public.ts` },
      // Map local .js imports to .ts files (only relative paths)
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    include: [
      "tests/**/*.test.ts",
    ],
  },
});
