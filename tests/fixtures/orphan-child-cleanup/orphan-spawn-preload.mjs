/**
 * NODE_OPTIONS=--import preload for orphan-cleanup tests.
 *
 * Patches child_process.spawn so that any node invocation of a sourcevision
 * CLI entry point is redirected to orphan-child-double.mjs, which will itself
 * spawn a grandchild process, enabling the test to verify that process-group
 * cleanup reaches all descendants.
 */

import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const redirectScript = process.env.NDX_TEST_ORPHAN_REDIRECT_SCRIPT;

if (redirectScript) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function patchedSpawn(command, args = [], options) {
    if (
      typeof command === "string" &&
      Array.isArray(args) &&
      typeof args[0] === "string" &&
      /(?:^|\/)(?:@n-dx\/)?sourcevision\/dist\/cli\/index\.js$/.test(args[0])
    ) {
      return originalSpawn.call(this, command, [redirectScript, ...args.slice(1)], options);
    }

    return originalSpawn.call(this, command, args, options);
  };

  syncBuiltinESMExports();
}
