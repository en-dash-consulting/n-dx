/**
 * Types for tests/vitest-coverage.mjs, which the package vitest configs
 * import. The web package typechecks its vitest.config.ts, so the module needs
 * a declaration; the implementation stays plain JS like its siblings.
 */

/** Minimum whole-package percentages a `test:coverage` run must reach. */
export interface CoverageFloors {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

export interface CoverageOptions {
  thresholds: CoverageFloors;
  /** Source globs, relative to the package; default `src/**`. */
  include?: string[];
  /** Extra globs to leave out of the report. */
  exclude?: string[];
}

/** The `test.coverage` block for a package vitest config. */
export declare function coverageConfig(options: CoverageOptions): {
  provider: "v8";
  enabled: boolean;
  include: string[];
  exclude: string[];
  reporter: string[];
  reportsDirectory: string;
  reportOnFailure: boolean;
  thresholds: CoverageFloors;
};
