/**
 * Fixture: node --import preload for cli-ci-child-cleanup.test.js.
 *
 * Intercepts two kinds of child_process.spawn call:
 *
 *  1. Spawns of a sourcevision or rex CLI entry point, redirected to
 *     ci-child-double.mjs so the test can track their PIDs and control their
 *     lifecycle without running the real tools. These are what the suite asserts on.
 *
 *  2. The `pnpm docs:build` spawn from ci.js's documentation phase, redirected to
 *     docs-build-stub.mjs. That phase runs *before* the analysis phase, so its
 *     latency is charged against the test's deadline for seeing the first tracked
 *     PID — see the stub's header for the measurements and why this is a
 *     correctness fix rather than a speed-up.
 *
 * Environment variables consumed:
 *   NDX_TEST_CI_REDIRECT_SCRIPT    — absolute path to ci-child-double.mjs
 *   NDX_TEST_CI_DOCS_BUILD_SCRIPT  — absolute path to docs-build-stub.mjs
 *   NDX_TEST_CI_PID_FILE           — path where PIDs are appended (JSONL)
 *   NDX_TEST_CI_MODE               — "success" | "hang" (forwarded to double)
 */

import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const redirectScript = process.env.NDX_TEST_CI_REDIRECT_SCRIPT;
const docsBuildScript = process.env.NDX_TEST_CI_DOCS_BUILD_SCRIPT;

/**
 * True for the documentation phase's package-manager spawn.
 *
 * Matched on the basename so `pnpm`, an absolute path to it, and the Windows
 * `pnpm.CMD` shim all hit — ci.js passes a bare "pnpm" today, but a future
 * change to a resolved path should not silently stop this intercepting, which is
 * the failure mode that cost this fixture a `[\\/]` fix once already.
 */
function isDocsBuildSpawn(command, args) {
  if (typeof command !== "string" || !Array.isArray(args)) return false;
  const basename = command.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (basename !== "pnpm" && basename !== "pnpm.cmd" && basename !== "pnpm.exe") return false;
  return args[0] === "docs:build";
}

if (redirectScript || docsBuildScript) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function patchedSpawn(command, args = [], options) {
    if (
      redirectScript &&
      typeof command === "string" &&
      Array.isArray(args) &&
      typeof args[0] === "string" &&
      // `[\\/]` not `\/` — see the sourcevision-child-cleanup preload: Windows
      // resolves the CLI path with backslashes, so a forward-slash-only pattern
      // silently never intercepts.
      /(?:^|[\\/])(?:rex|sourcevision)[\\/]dist[\\/]cli[\\/]index\.js$/.test(args[0])
    ) {
      return originalSpawn.call(this, command, [redirectScript, ...args.slice(1)], options);
    }

    if (docsBuildScript && isDocsBuildSpawn(command, args)) {
      // Drop `shell` — the original spawn set it on win32 so the pnpm.CMD shim
      // could be found, and it is not only unnecessary for a direct node
      // invocation but would re-introduce a shell process into the tracked tree.
      const { shell: _shell, ...rest } = options ?? {};
      return originalSpawn.call(this, process.execPath, [docsBuildScript], rest);
    }

    return originalSpawn.call(this, command, args, options);
  };

  syncBuiltinESMExports();
}
