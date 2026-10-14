/**
 * `node:child_process` with `windowsHide` defaulted on, for tests.
 *
 * On Windows a child that gets its own console gets its own **window**, and
 * that window takes focus. A test suite that spawns hundreds of CLIs therefore
 * steals the machine for the length of the run, which makes the suite unusable
 * while anything else is happening — and makes a watch-mode run actively
 * hostile. `windowsHide: true` suppresses the console allocation; nothing else
 * about the child changes, on Windows or anywhere else.
 *
 * Production code passes the flag at each call site, enforced by
 * `tests/e2e/windows-hide-policy.test.js`. Test code cannot reasonably do the
 * same: there are ~790 spawn sites across ~250 files, most of them one-off
 * `spawnSync(process.execPath, …)` calls written inline, and a rule that has
 * to be remembered at every one of them is a rule that decays. So the default
 * moves into the module itself: every vitest config aliases
 * `node:child_process` here, and a call that wants a visible window has to ask
 * for one explicitly with `windowsHide: false`.
 *
 * The real module is loaded through `createRequire`, with the bare specifier,
 * so the alias cannot resolve back to this file.
 *
 * @see tests/e2e/windows-hide-policy.test.js — the production-code gate
 * @see scripts/lib/windows-hide-scan.mjs — its scanner
 */
import { createRequire } from "node:module";
import { promisify } from "node:util";

const real = createRequire(import.meta.url)("child_process");

/** Marker so a test can assert the alias is actually in play. */
export const __hiddenChildProcess = true;

/**
 * `options` with `windowsHide` on unless the caller said otherwise.
 *
 * `undefined` counts as "did not say": only an explicit `false` opts out, so a
 * helper that spreads a partial options object does not lose the default.
 *
 * @param {unknown} options
 * @returns {unknown}
 */
export function hidden(options) {
  if (options === null || typeof options !== "object") return { windowsHide: true };
  return "windowsHide" in options ? options : { ...options, windowsHide: true };
}

/**
 * The last argument is an options bag when it is a plain object — for every
 * signature here the only object-shaped argument is `options`, except the
 * trailing callback of the async forms, which is a function.
 *
 * @param {unknown[]} args
 * @returns {number}
 */
export function optionsIndex(args) {
  let last = args.length - 1;
  if (typeof args[last] === "function") last -= 1;
  const candidate = args[last];
  if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
    return last;
  }
  return -1;
}

/**
 * `args` with `windowsHide` applied to its options bag, inserting one when the
 * call passed none.
 *
 * @param {unknown[]} args
 * @param {number} minArgs how many leading arguments precede `options`
 * @returns {unknown[]}
 */
function applyHidden(args, minArgs) {
  const at = optionsIndex(args);
  if (at >= minArgs) {
    args[at] = hidden(args[at]);
  } else {
    const insertAt = typeof args[args.length - 1] === "function" ? args.length - 1 : args.length;
    args.splice(insertAt, 0, hidden(undefined));
  }
  return args;
}

/**
 * Wrap a `child_process` function so its spawn is hidden.
 *
 * The wrapper has to carry `util.promisify.custom` across. `exec` and
 * `execFile` each define that symbol, and Node's version of it resolves to
 * `{ stdout, stderr }`; a plain wrapper without it sends `promisify` down its
 * callback path, which resolves with only the first callback value — so
 * `(await execFileAsync(...)).stdout` is `undefined` and the caller sees empty
 * output rather than an error. The custom implementation here hides the spawn
 * the same way before delegating, so promisified callers are covered too.
 *
 * @param {Function} fn
 * @param {number} minArgs how many leading arguments the signature takes before `options`
 * @returns {Function}
 */
function withHidden(fn, minArgs) {
  const wrapped = function (...args) {
    return fn.apply(this, applyHidden(args, minArgs));
  };

  const custom = fn[promisify.custom];
  if (typeof custom === "function") {
    Object.defineProperty(wrapped, promisify.custom, {
      value: function (...args) {
        return custom.apply(this, applyHidden(args, minArgs));
      },
      configurable: true,
    });
  }

  return wrapped;
}

export const spawn = withHidden(real.spawn, 1);
export const spawnSync = withHidden(real.spawnSync, 1);
export const exec = withHidden(real.exec, 1);
export const execSync = withHidden(real.execSync, 1);
export const execFile = withHidden(real.execFile, 1);
export const execFileSync = withHidden(real.execFileSync, 1);
export const fork = withHidden(real.fork, 1);

export const { ChildProcess } = real;

export default {
  ...real,
  spawn,
  spawnSync,
  exec,
  execSync,
  execFile,
  execFileSync,
  fork,
  __hiddenChildProcess,
};
