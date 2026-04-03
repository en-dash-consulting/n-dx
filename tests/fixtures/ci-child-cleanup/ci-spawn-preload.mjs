/**
 * Fixture: node --import preload for cli-ci-child-cleanup.test.js.
 *
 * Intercepts every child_process.spawn call whose first argument is the
 * Node.js executable and whose second argument (the script path) looks like a
 * sourcevision or rex CLI entry point.  Those spawns are redirected to
 * ci-child-double.mjs so the test can track their PIDs and control their
 * lifecycle without running the real tools.
 *
 * Environment variables consumed:
 *   NDX_TEST_CI_REDIRECT_SCRIPT — absolute path to ci-child-double.mjs
 *   NDX_TEST_CI_PID_FILE        — path where PIDs are appended (JSONL)
 *   NDX_TEST_CI_MODE            — "success" | "hang" (forwarded to double)
 */

import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const redirectScript = process.env.NDX_TEST_CI_REDIRECT_SCRIPT;

if (redirectScript) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function patchedSpawn(command, args = [], options) {
    if (
      typeof command === "string" &&
      Array.isArray(args) &&
      typeof args[0] === "string" &&
      /(?:^|\/)(?:rex|sourcevision)\/dist\/cli\/index\.js$/.test(args[0])
    ) {
      return originalSpawn.call(this, command, [redirectScript, ...args.slice(1)], options);
    }

    return originalSpawn.call(this, command, args, options);
  };

  syncBuiltinESMExports();
}
