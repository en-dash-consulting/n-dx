/**
 * Project-directory resolution for the orchestrator's best-effort reads.
 *
 * `cli.js` has two different needs that look alike. A command handler resolves
 * the directory the user asked it to operate on, from args that no longer
 * contain the command — `resolveDir` handles that, and taking the last
 * positional is right there.
 *
 * `main()` needs something weaker: a directory to *look in* before dispatch, so
 * it can read `.n-dx.json` and check whether the project is initialized. Its
 * args still carry the subcommand for a tool-delegation call, so the
 * last-positional rule picks the wrong thing:
 *
 *   ndx hench record --task=X --status=completed
 *     → command "hench", rest ["record", "--task=X", "--status=completed"]
 *     → every trailing arg is a flag, so the scan reaches "record"
 *     → the project directory resolves to ./record
 *
 * `checkProjectStaleness` then reports "Project setup incomplete" in a fully
 * initialized project, and `loadProjectConfig` reads `.n-dx.json` from a path
 * that does not exist and silently falls back to `{}` — so command timeouts and
 * experimental flags stop applying. Nothing fails loudly; the settings just
 * quietly do not take effect. The same misfire hits any non-path positional,
 * e.g. `ndx rex add "some description"`.
 *
 * The rule below accepts a positional only when it really is a directory. That
 * is safe *for this call site specifically* because the result is never an
 * operation target — it only says where to look for config. A path that does
 * not exist has no config to read, so falling back to the cwd loses nothing.
 * Do not reuse this for a handler that must honor a directory the user intends
 * to create; that is what `resolveDir` is for.
 *
 * @module n-dx/resolve-existing-dir
 */

import { statSync } from "fs";
import { isAbsolute, resolve } from "path";

/**
 * Resolve the directory to read project config and initialization state from.
 *
 * Scans `args` from the end and returns the first positional that names an
 * existing directory. Returns `cwd` when there is none.
 *
 * `options.skip` lets a caller rule out positionals that only LOOK like
 * directories. The one known case: `ndx config hench` in a project that also
 * contains a `hench/` subdirectory. The config handler's `isConfigKey`
 * tiebreaker says a known key beats a directory (a key is an exact match
 * against a closed set; a directory name is arbitrary) — this layer must
 * agree, or config reads and the staleness check point at `./hench` while the
 * handler operates on the key: timeouts and experimental flags silently stop
 * applying and a fully initialized project reports "Project setup incomplete".
 * `./hench` stays unambiguous (its root segment is empty, never a key).
 *
 * @param {string[]} args  Arguments after the command, possibly including a subcommand.
 * @param {string} [cwd]   Directory to fall back to. Defaults to `process.cwd()`.
 * @param {{skip?: (arg: string) => boolean}} [options]  Positionals to never treat as directories.
 * @returns {string} The argument as written, or `cwd`.
 */
export function resolveExistingDir(args, cwd = process.cwd(), options = {}) {
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];
    if (arg.startsWith("-")) continue;
    if (options.skip?.(arg)) continue;
    if (isDirectory(arg, cwd)) return arg;
  }
  return cwd;
}

/**
 * True when `arg`, resolved against `cwd`, is an existing directory.
 *
 * @param {string} arg
 * @param {string} cwd
 * @returns {boolean}
 */
function isDirectory(arg, cwd) {
  try {
    const target = isAbsolute(arg) ? arg : resolve(cwd, arg);
    return statSync(target).isDirectory();
  } catch {
    // Missing path, permission error, invalid name on this platform — all mean
    // "not a directory we can use", and none of them should throw out of arg
    // parsing.
    return false;
  }
}
