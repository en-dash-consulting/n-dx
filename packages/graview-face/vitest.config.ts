import { defineConfig } from "vitest/config";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";
import { testMaxWorkers } from "../../tests/test-max-workers.mjs";
import { coverageConfig } from "../../tests/vitest-coverage.mjs";

// Coverage floors for `test:coverage`: what this suite reached, rounded down, less one point.
// Raise them as coverage rises. See tests/vitest-coverage.mjs.
const COVERAGE_FLOORS = { statements: 28, branches: 9, functions: 21, lines: 28 };

// The tests are headless and need none of vite.config.ts (the door, the chunking), which stays importable without vitest.
export default defineConfig({
  resolve: { alias: [...hiddenChildProcessAlias] },
  test: { coverage: coverageConfig({ thresholds: COVERAGE_FLOORS }), maxWorkers: testMaxWorkers(), environment: "node", include: ["tests/**/*.test.ts"] },
});
