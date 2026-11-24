import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { isolationProjects } from "../../tests/vitest-isolation.mjs";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";
import { testMaxWorkers } from "../../tests/test-max-workers.mjs";
import { coverageConfig } from "../../tests/vitest-coverage.mjs";

const packagesRoot = resolve(import.meta.dirname, "..");

// Coverage floors for `test:coverage`: what this suite reached, rounded down, less one point.
// Raise them as coverage rises. See tests/vitest-coverage.mjs.
const COVERAGE_FLOORS = { statements: 18, branches: 10, functions: 16, lines: 19 };

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
    coverage: coverageConfig({ thresholds: COVERAGE_FLOORS }),
    // NDX_TEST_MAX_WORKERS caps workers for every project; unset keeps vitest's default.
    maxWorkers: testMaxWorkers(),
    silent: "passed-only",
    // Pin color and session env so ambient shell state cannot change verdicts.
    setupFiles: [
      "../../tests/setup-color-env.js",
      "../../tests/setup-session-env.js", "../../tests/setup-exit-trace.js",
    ],
    include: ["tests/**/*.test.ts"],
    projects: isolationProjects({ root: import.meta.dirname, name: "lang-python" }),
  },
});
