import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const rexRoot = resolve(import.meta.dirname, "../rex");
const svRoot = resolve(import.meta.dirname, "../sourcevision");
const henchRoot = resolve(import.meta.dirname, "../hench");
const llmClientRoot = resolve(import.meta.dirname, "../llm-client");

export default defineConfig({
  resolve: {
    alias: [
      // Map bare package imports to their source public.ts barrels for vitest,
      // as hench and web do, so tests run against src rather than a stale dist.
      { find: /^@n-dx\/rex$/, replacement: `${rexRoot}/src/public.ts` },
      { find: /^@n-dx\/rex\/dist\/(.+)\.js$/, replacement: `${rexRoot}/src/$1.ts` },
      { find: /^@n-dx\/sourcevision$/, replacement: `${svRoot}/src/public.ts` },
      { find: /^@n-dx\/sourcevision\/dist\/(.+)\.js$/, replacement: `${svRoot}/src/$1.ts` },
      { find: /^@n-dx\/hench$/, replacement: `${henchRoot}/src/public.ts` },
      { find: /^@n-dx\/llm-client$/, replacement: `${llmClientRoot}/src/public.ts` },
      // Map local .js imports to .ts files
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    setupFiles: ["../../tests/setup-color-env.js", "../../tests/setup-session-env.js"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
