import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";

export default defineConfig({
  resolve: {
    alias: [
      // Map local .js imports to .ts files
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    silent: "passed-only",
    // Pin color and session env so ambient shell state cannot change verdicts.
    setupFiles: [
      "../../tests/setup-color-env.js",
      "../../tests/setup-session-env.js",
    ],
    include: ["tests/**/*.test.ts"],
    projects: isolationProjects({ root: import.meta.dirname, name: "lang-java" }),
  },
});
