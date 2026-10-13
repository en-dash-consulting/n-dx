/**
 * Split a package's test files into the ones that can share a worker and the
 * ones that need a fresh one, for `test.projects` in each vitest config.
 *
 * WHY. With vitest's default `isolate: true`, every test file gets a fresh
 * worker: a new process under the forks pool, a new module graph, and for the
 * web package a new jsdom. That is the right default for a file that mocks a
 * module or mutates a global, and pure waste for the rest. On run 38193308009
 * the web suite spent 65% of its Windows wall time outside tests (environment
 * 35%, import 25%), and the other packages 13% to 34% on import alone; 762 of
 * the monorepo's 1342 test files finish in under 200 ms and are mostly paying
 * that fixed cost. Measured locally, the web viewer unit files run in 19 s
 * with isolation off against 31 s with it on.
 *
 * WHY A SCAN AND NOT A LIST. A file that calls `vi.mock` must not share a
 * worker: vitest hoists the mock to the top of the module graph for that
 * worker, and the next file in the same worker would import the mocked module
 * without asking for it. The same goes for `vi.doMock`, `vi.resetModules`,
 * `vi.stubGlobal`, `vi.stubEnv`, `vi.hoisted` and `process.chdir`. A checked-in
 * list of those files goes stale the first time someone adds a mock to a file
 * that is not on it, and the failure that follows is in a different file from
 * the one they edited. Reading the files at config time keeps the split
 * correct by construction; the cost is one synchronous read of each test
 * file when vitest starts, about 50 ms for the largest package.
 *
 * THE ESCAPE HATCH. A file can ask for a worker of its own by writing
 * `@vitest-isolate` in a comment, with the reason. The patterns above infer
 * isolation from a call the file makes, which covers mocks and `chdir` but not
 * a file whose correctness rests on process-wide state it only *reads* — the
 * inherited cwd, a module-level setter with no reset, a lock it races. Those
 * have no call to key on, and before the marker there was no way to say so.
 *
 * WHAT THE SCAN DOES NOT SEE. It reads each test file's own source and nothing
 * it imports, so a file that reaches these APIs only through a helper is read
 * as safe and lands in the shared project. `tests/helpers/viewer-boot.ts` calls
 * `vi.stubGlobal` and `vi.resetModules`, and the two files that use it —
 * `integration/pr-markdown-tab-parity.test.ts` and
 * `integration/token-usage-route-regression.test.ts` — are shared today.
 *
 * Following imports would mean resolving the module graph at config time, for
 * a case that is rare and that announces itself: the symptom is a neighbour in
 * the same worker failing, and `NDX_TEST_ISOLATE_ALL=1` separates a leak from
 * a real defect in one run. If a helper of this kind becomes common, the scan
 * should follow relative imports one level rather than stay as it is.
 *
 * WHY NOT FIX THE LEAK INSTEAD. The isolated project is for files whose
 * isolation is the point of the API they use. A file that only leaks state by
 * accident — a module-level singleton it forgets to reset — belongs in the
 * shared project with the leak fixed, so that the shared project stays the
 * large one. The scan does not look for those; the suite does, by failing.
 *
 * @module tests/vitest-isolation
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Calls whose presence means the file must own its worker.
 *
 * `vi.mock` and `vi.doMock` replace modules for the whole worker. `vi.hoisted`
 * exists only to feed a `vi.mock`. `vi.resetModules` drops the module cache,
 * which the next file would otherwise rebuild on top of. `vi.stubGlobal` and
 * `vi.stubEnv` are restored by `vi.unstubAllGlobals` / `vi.unstubAllEnvs`
 * only when the file remembers to call them. `process.chdir` moves the
 * worker's cwd, which every later relative path in that worker would resolve
 * against.
 */
const NEEDS_ISOLATION =
  /\bvi\.(mock|doMock|resetModules|stubGlobal|stubEnv|hoisted)\(|\bprocess\.chdir\(|@vitest-isolate\b/;

/** Whether one test file's source asks for a worker of its own. */
export function needsIsolation(source) {
  return NEEDS_ISOLATION.test(source);
}

/**
 * Every test file under `dir`, as paths relative to `root` with forward
 * slashes, so the result is usable as vitest `include` / `exclude` entries on
 * every platform.
 */
function listTestFiles(root, dir, isTestFile) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "fixtures") continue;
        walk(full);
      } else if (isTestFile(entry.name)) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) walk(dir);
  return out.sort();
}

/**
 * The two `test.projects` entries for a package.
 *
 * @param {object} opts
 * @param {string} opts.root        The package directory (the vitest config's `import.meta.dirname`).
 * @param {string} opts.name        Short package name, used as the project name prefix in reporter output.
 * @param {string} [opts.testsDir]  Where the test files live, relative to `root`. Default "tests".
 * @param {(name: string) => boolean} [opts.isTestFile]  Default: `*.test.ts` / `*.test.js`.
 * @returns {object[]} Project configs. Both `extends: true`, so the root config's
 *   setupFiles, aliases, timeouts and `silent` apply to each; the shared one
 *   adds `isolate: false`. Each project EXCLUDES the other's files rather than
 *   including its own: `extends` merges arrays by concatenation, so an
 *   `include` here would be appended to the inherited `tests/**` pattern and
 *   the project would run everything, whereas an appended `exclude` only
 *   narrows. (Observed: every file ran twice before this was exclude-only.)
 */
export function isolationProjects({ root, name, testsDir = "tests", isTestFile = defaultIsTestFile }) {
  // Escape hatch for diagnosing a suspected cross-file leak: with the variable
  // set, every file runs in its own worker as it did before the split. A
  // failure that disappears under it is a leak in the shared project; one
  // that stays is the test's own.
  // Extra excludes from the caller, as a newline-separated list.
  //
  // Not `--exclude`: each project below sets its own `exclude`, and a project's
  // list replaces the CLI flag rather than adding to it, so the patterns
  // `scripts/run-vitest-bind-aware.mjs` passes when loopback bind is
  // unavailable never reached a project at all — the network suites they name
  // ran anyway. Appending here is the only place both projects see them.
  const extraExclude = (process.env["NDX_TEST_EXTRA_EXCLUDE"] ?? "")
    .split("\n")
    .map((pattern) => pattern.trim())
    .filter(Boolean);

  if (process.env["NDX_TEST_ISOLATE_ALL"]) {
    return [{ extends: true, test: { name: `${name}:isolated`, exclude: [...extraExclude] } }];
  }
  const files = listTestFiles(root, join(root, testsDir), isTestFile);
  const isolated = new Set(files.filter((file) => needsIsolation(readFileSync(join(root, file), "utf-8"))));
  const shared = files.filter((file) => !isolated.has(file));
  return [
    {
      extends: true,
      test: {
        name: `${name}:shared`,
        isolate: false,
        exclude: [...isolated, ...extraExclude],
      },
    },
    {
      extends: true,
      test: {
        name: `${name}:isolated`,
        exclude: [...shared, ...extraExclude],
      },
    },
  ];
}

function defaultIsTestFile(fileName) {
  return /\.test\.(ts|js|mjs)$/.test(fileName);
}
