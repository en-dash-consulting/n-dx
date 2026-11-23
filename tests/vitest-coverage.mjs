/**
 * Shared coverage settings for every package vitest config.
 *
 * Coverage is off in an ordinary `vitest run`; `--coverage` (each package's
 * `test:coverage` script, or `pnpm test:coverage` at the root) turns it on.
 * Collecting it slows a run, and the per-file numbers only mean something
 * when the whole package suite ran, so a single-file run never fails a
 * threshold it could not have met.
 *
 * Reports land in `<package>/coverage/` (gitignored):
 *
 * - `index.html` — the browsable report. Each source line shows how many
 *   times the suite executed it (`12x`), and lines that never ran are red.
 * - `lcov.info` — the same per-line hit counts as `DA:<line>,<hits>`, for
 *   editor gutters and CI services.
 * - `coverage-final.json` — raw V8 counts per statement, function and branch;
 *   `node scripts/coverage-lines.mjs` reads it to print hit counts per line.
 * - `coverage-summary.json` — per-file and total percentages.
 *
 * Thresholds are floors, not targets: each package passes the numbers its
 * suite reached when they were set, rounded down and less one point (Windows
 * and Linux skip different tests), so coverage can rise
 * freely and a change that drops it fails `test:coverage`. Raise a floor when
 * a package's coverage has risen past it; lower one only with a reason in the
 * commit that does it.
 */

/**
 * @typedef {object} CoverageFloors
 * @property {number} statements
 * @property {number} branches
 * @property {number} functions
 * @property {number} lines
 */

/**
 * The `test.coverage` block for a package vitest config.
 *
 * @param {object} options
 * @param {CoverageFloors} options.thresholds  Minimum percentages for the whole package.
 * @param {string[]} [options.include]  Source globs, relative to the package; default `src/**`.
 * @param {string[]} [options.exclude]  Extra globs to leave out of the report.
 */
export function coverageConfig({ thresholds, include = ["src/**/*.{ts,tsx,js,mjs}"], exclude = [] }) {
  return {
    provider: /** @type {const} */ ("v8"),
    enabled: false,
    include,
    exclude: [
      "**/*.d.ts",
      "**/*.d.mts",
      ...exclude,
    ],
    reporter: ["text-summary", "html", "lcov", "json", "json-summary"],
    reportsDirectory: "coverage",
    // A failing suite still writes its report, so the lines it missed can be read.
    reportOnFailure: true,
    thresholds,
  };
}
