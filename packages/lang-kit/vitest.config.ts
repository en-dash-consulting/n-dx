import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

export default defineConfig({
  resolve: {
    alias: [
      ...hiddenChildProcessAlias,
      // Map local .js imports to .ts files
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    silent: "passed-only",
    // Pin color and session env so ambient shell state cannot change verdicts.
    setupFiles: [
      "../../tests/setup-color-env.js",
      "../../tests/setup-session-env.js", "../../tests/setup-exit-trace.js",
    ],
    include: ["tests/**/*.test.ts"],
    projects: isolationProjects({ root: import.meta.dirname, name: "lang-kit" }),
  },
});
