import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const rexRoot = resolve(import.meta.dirname, "../rex");
const svRoot = resolve(import.meta.dirname, "../sourcevision");
const claudeClientRoot = resolve(import.meta.dirname, "../claude-client");

export default defineConfig({
  resolve: {
    alias: [
      // Map bare "rex" import to source public.ts barrel for vitest
      { find: /^rex$/, replacement: `${rexRoot}/src/public.ts` },
      // Map rex subpath imports to source .ts files for vitest
      { find: /^rex\/dist\/(.+)\.js$/, replacement: `${rexRoot}/src/$1.ts` },
      // Map bare "sourcevision" import to source public.ts barrel for vitest
      { find: /^sourcevision$/, replacement: `${svRoot}/src/public.ts` },
      // Map sourcevision subpath imports to source .ts files for vitest
      { find: /^sourcevision\/dist\/(.+)\.js$/, replacement: `${svRoot}/src/$1.ts` },
      // Map @n-dx/llm-client to source public.ts for vitest (transitive dep of rex)
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
