import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const redirectScript = process.env.NDX_TEST_SOURCEVISION_REDIRECT_SCRIPT;

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
