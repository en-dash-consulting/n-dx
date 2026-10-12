/**
 * Types for tests/vitest-isolation.mjs, which the package vitest configs import.
 * The web package typechecks its vitest.config.ts (tsconfig.test.json), so the
 * module needs a declaration; the implementation stays plain JS so the root
 * config, which is JS, can import it too.
 */

/** Whether one test file's source asks for a worker of its own. */
export function needsIsolation(source: string): boolean;

export interface IsolationProjectsOptions {
  /** The package directory (the vitest config's `import.meta.dirname`). */
  root: string;
  /** Short package name, used as the project name prefix in reporter output. */
  name: string;
  /** Where the test files live, relative to `root`. Default "tests". */
  testsDir?: string;
  /** Default: `*.test.ts` / `*.test.js` / `*.test.mjs`. */
  isTestFile?: (fileName: string) => boolean;
}

export interface IsolationProject {
  extends: true;
  test: {
    name: string;
    isolate?: boolean;
    exclude: string[];
  };
}

/** The two `test.projects` entries for a package: `<name>:shared` and `<name>:isolated`. */
export function isolationProjects(opts: IsolationProjectsOptions): IsolationProject[];
