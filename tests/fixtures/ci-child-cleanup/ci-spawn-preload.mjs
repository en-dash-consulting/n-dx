/**
 * Fixture: node --import preload for cli-ci-child-cleanup.test.js.
 *
 * Intercepts the docs build plus every child_process.spawn call whose first
 * argument is the Node.js executable and whose second argument (the script
 * path) looks like a sourcevision or rex CLI entry point. Those spawns are
 * redirected to ci-child-double.mjs so the test can track their PIDs and
 * control their lifecycle without running the real tools.
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
    const isCiTool =
      typeof command === "string" &&
      Array.isArray(args) &&
      typeof args[0] === "string" &&
      // `[\\/]` not `\/` — see the sourcevision-child-cleanup preload: Windows
      // resolves the CLI path with backslashes, so a forward-slash-only pattern
      // silently never intercepts.
      /(?:^|[\\/])(?:rex|sourcevision)[\\/]dist[\\/]cli[\\/]index\.js$/.test(args[0]);
    const isDocsBuild = command === "pnpm" && args[0] === "docs:build";

    if (isCiTool || isDocsBuild) {
      // `pnpm docs:build` is the first asynchronous CI child. Replacing it
      // with a Node double avoids spending the PID-record deadline on an
      // unrelated VitePress build while preserving a real tracked child spawn.
      const childCommand = isDocsBuild ? process.execPath : command;
      const childArgs = isDocsBuild ? args : args.slice(1);
      return originalSpawn.call(this, childCommand, [redirectScript, ...childArgs], options);
    }

    return originalSpawn.call(this, command, args, options);
  };

  syncBuiltinESMExports();
}
