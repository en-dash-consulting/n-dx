/**
 * Loaded through NODE_OPTIONS=--import. When NDX_TEST_CHILD_ENV_LOG is set,
 * redirects every spawn of the rex, hench or sourcevision CLI to the child
 * double, which records the environment it was given.
 */
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const DOUBLE = fileURLToPath(new URL("./child-double.mjs", import.meta.url));
const TOOL_CLI = /(?:^|[\\/])(rex|hench|sourcevision)[\\/]dist[\\/]cli[\\/]index\.js$/;

if (process.env.NDX_TEST_CHILD_ENV_LOG) {
  const originalSpawn = childProcess.spawn;

  childProcess.spawn = function patchedSpawn(command, args = [], options) {
    const match = Array.isArray(args) && typeof args[0] === "string" ? TOOL_CLI.exec(args[0]) : null;
    if (match) {
      return originalSpawn.call(this, command, [DOUBLE, match[1], ...args.slice(1)], options);
    }
    return originalSpawn.call(this, command, args, options);
  };

  syncBuiltinESMExports();
}
