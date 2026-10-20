import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

const packagesRoot = resolve(import.meta.dirname, "..");

export default defineConfig({
  resolve: {
    alias: [
      ...hiddenChildProcessAlias,
      // Map @n-dx/lang-kit and @n-dx/lang-runtime to their source barrels, as
      // sourcevision does: the relative-import rule below would otherwise
      // rewrite their dist imports to .ts
      { find: /^@n-dx\/(lang-[a-z]+)$/, replacement: `${packagesRoot}/$1/src/index.ts` },
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
    projects: isolationProjects({ root: import.meta.dirname, name: "lang-terraform" }),
  },
});
