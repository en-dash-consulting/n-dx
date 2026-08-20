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
      // `[\\/]` not `\/`: on Windows the resolved CLI path uses backslashes
      // (`…\packages\sourcevision\dist\cli\index.js`), so a forward-slash-only
      // pattern never matches, the spawn is never redirected to the double, and
      // every test in this file times out waiting for a PID record that is
      // never written.
      /(?:^|[\\/])(?:@n-dx[\\/])?sourcevision[\\/]dist[\\/]cli[\\/]index\.js$/.test(args[0])
    ) {
      return originalSpawn.call(this, command, [redirectScript, ...args.slice(1)], options);
    }

    return originalSpawn.call(this, command, args, options);
  };

  syncBuiltinESMExports();
}
