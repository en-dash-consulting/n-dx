/**
 * `ndx <name>` for a name no built-in command owns: find the extension command
 * that claims it and run that command's `bin` as a child process
 * (docs/architecture/extensions.md, "CLI delegation").
 *
 * ## Spawned, never imported
 *
 * Nothing here loads extension code. Resolution reads what discovery read
 * (`package.json` files) and checks that the `bin` exists; running it spawns
 * n-dx's own Node on that path. The spawn function is the caller's, so this
 * module needs no `child_process` of its own and cli.js keeps tracking the
 * child for cleanup. `tests/e2e/architecture-policy.test.js` holds the
 * extension modules to that.
 *
 * ## Built-ins win
 *
 * A built-in name never resolves to an extension, whatever is installed. The
 * validator already refuses a manifest that claims one; the check here holds
 * even for a cache written by an older n-dx with fewer built-ins.
 *
 * @module n-dx/extension-dispatch
 */

import * as nodeFs from "node:fs";
import { constants as osConstants } from "node:os";
import { join, resolve } from "node:path";
import { discoverExtensions, EXTENSIONS_CACHE_FILE } from "./extension-discovery.js";
import { extensionState, readExtensionsFile, stateKey } from "./extension-state.js";
import { treeKillSpawnOptions } from "./child-lifecycle.js";

/** Exit code for an extension command that exists but cannot run. */
export const EXTENSION_REFUSED_EXIT_CODE = 2;

/** The signals `ndx` passes on to a running extension command. */
export const FORWARDED_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);

/**
 * @typedef {import("./extension-discovery.js").DiscoveredExtension} DiscoveredExtension
 * @typedef {import("./extension-state.js").ExtensionStateName} ExtensionStateName
 */

/**
 * What `ndx <name>` resolves to.
 *
 * - `builtin` — a built-in owns the name; never dispatched.
 * - `none` — no installed extension claims it.
 * - `run` — an enabled extension's command; `bin` exists. `home` is the n-dx
 *   home discovery used, which the extension's environment names.
 * - `refused` — the command would run but must not yet: unapproved, or its
 *   `bin` is missing. `message` is one line naming the problem and the fix.
 * - `unavailable` — an extension claims the name but is disabled, incompatible,
 *   invalid or in conflict; `ndx` still reports an unknown command, and `hint`
 *   says why and what to run.
 *
 * @typedef {{kind: "builtin"} | {kind: "none"}
 *   | {kind: "run", ext: DiscoveredExtension, command: string, bin: string, home: string}
 *   | {kind: "refused", ext: DiscoveredExtension, message: string}
 *   | {kind: "unavailable", ext: DiscoveredExtension, state: ExtensionStateName, hint: string}} ExtensionResolution
 */

/**
 * @typedef {object} ResolveOptions
 * @property {Iterable<string>} builtinCommands  Every built-in `ndx` command and tool delegation.
 * @property {string} ndxVersion  The running n-dx.
 * @property {string} [cwd]  The project for the `project` source and its approvals; defaults to `process.cwd()`.
 * @property {string} [home]  The n-dx home; defaults to discovery's resolution.
 * @property {Record<string, string | undefined>} [env]
 * @property {string | null} [globalRoot]
 * @property {Pick<typeof nodeFs, "existsSync">} [fs]
 */

/**
 * Resolve `ndx <name>` against the installed extensions.
 *
 * @param {string} name
 * @param {ResolveOptions} options
 * @returns {ExtensionResolution}
 */
export function resolveExtensionCommand(name, options) {
  const builtins = new Set(options.builtinCommands);
  if (builtins.has(name)) return { kind: "builtin" };

  const projectDir = resolve(options.cwd ?? process.cwd());
  const discovery = discoverExtensions({
    builtinCommands: builtins,
    projectDir,
    home: options.home,
    env: options.env,
    globalRoot: options.globalRoot,
  });
  const ext = discovery.extensions.find((candidate) => claims(candidate, name));
  if (!ext) return { kind: "none" };

  // An unreadable extensions.json is among discovery's errors; with no
  // approvals readable, the extension resolves as unapproved.
  const unreadable = discovery.errors.some((e) => e.path === join(discovery.home, EXTENSIONS_CACHE_FILE));
  const file = unreadable ? {} : readExtensionsFile(discovery.home);
  const { state, reason } = extensionState(ext, { file, ndxVersion: options.ndxVersion, projectDir });
  const label = describe(ext);
  const key = stateKey(ext);

  if (state === "unapproved") {
    return {
      kind: "refused",
      ext,
      message: `Error: 'ndx ${name}' comes from ${label}, which is ${reason} — fix: ndx extensions enable ${key}`,
    };
  }
  if (state !== "enabled") {
    const fix = state === "disabled" ? `ndx extensions enable ${key}` : "ndx extensions doctor";
    return { kind: "unavailable", ext, state, hint: `${label} provides '${name}' but is ${state}: ${reason}. Run '${fix}'.` };
  }

  const command = ext.manifest?.commands?.find((c) => c.name === name);
  if (!command) return { kind: "none" };
  const bin = resolve(ext.dir, command.bin);
  if (!(options.fs ?? nodeFs).existsSync(bin)) {
    return {
      kind: "refused",
      ext,
      message: `Error: 'ndx ${name}' comes from ${label}, whose bin ${command.bin} does not exist — fix: ndx extensions doctor`,
    };
  }
  return { kind: "run", ext, command: name, bin, home: discovery.home };
}

/**
 * Starts the extension's process. cli.js passes its tracked spawn, so the
 * child is cleaned up with every other child `ndx` started.
 *
 * @callback SpawnExtension
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} options
 * @returns {import("node:child_process").ChildProcess}
 */

/**
 * @typedef {object} RunOptions
 * @property {string} bin  Absolute path of the command's `bin`.
 * @property {string[]} args  Everything after `ndx <name>`.
 * @property {SpawnExtension} spawn
 * @property {Record<string, string | undefined>} [env]  Defaults to `process.env`.
 * @property {string} [execPath]  The Node to run; defaults to n-dx's own.
 * @property {NodeJS.Platform} [platform]
 * @property {Pick<NodeJS.Process, "on" | "removeListener" | "kill">} [processRef]
 */

/**
 * Run an extension command: n-dx's Node on `bin` with `args`, stdio inherited
 * and the working directory unchanged.
 *
 * While it runs, SIGINT and SIGTERM sent to `ndx` go to the extension, and
 * `ndx` waits for it rather than exiting. On POSIX the child leads its own
 * process group (so it can be tree-killed) and the signal goes to that group,
 * as a terminal's would. On Windows a console Ctrl+C already reaches every
 * process on the console, so SIGINT is not sent again — Node can only deliver
 * it there as a hard kill; SIGTERM is.
 *
 * Resolves to the extension's exit code, or 128 + the signal number when a
 * signal ended it.
 *
 * @param {RunOptions} options
 * @returns {Promise<number>}
 */
export function runExtensionCommand(options) {
  const platform = options.platform ?? process.platform;
  const processRef = options.processRef ?? process;
  const spawnOptions = { stdio: "inherit", env: options.env ?? process.env, ...treeKillSpawnOptions(platform) };

  return new Promise((resolvePromise, reject) => {
    const child = options.spawn(options.execPath ?? process.execPath, [options.bin, ...options.args], spawnOptions);

    /** @param {NodeJS.Signals} signal */
    const forward = (signal) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (platform === "win32") {
        if (signal !== "SIGINT") child.kill(signal);
        return;
      }
      try {
        processRef.kill(-(/** @type {number} */ (child.pid)), signal);
      } catch {
        // The group is gone or was never formed; the child itself may remain.
        child.kill(signal);
      }
    };
    /** @type {Map<NodeJS.Signals, () => void>} */
    const listeners = new Map(FORWARDED_SIGNALS.map((signal) => [signal, () => forward(signal)]));
    for (const [signal, listener] of listeners) processRef.on(signal, listener);
    const stopForwarding = () => {
      for (const [signal, listener] of listeners) processRef.removeListener(signal, listener);
    };

    child.on("error", (err) => {
      stopForwarding();
      reject(err);
    });
    child.on("close", (code, signal) => {
      stopForwarding();
      resolvePromise(code ?? 128 + (signal ? osConstants.signals[signal] ?? 0 : 0));
    });
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Whether `ext` claims the command `name`: one of its manifest's commands, or —
 * when the manifest was refused and has none to read — its own name or a name
 * it is in conflict over.
 *
 * @param {DiscoveredExtension} ext
 * @param {string} name
 */
function claims(ext, name) {
  if (ext.manifest) return (ext.manifest.commands ?? []).some((c) => c.name === name);
  return ext.name === name || ext.conflicts.some((c) => c.names.includes(name));
}

/** @param {DiscoveredExtension} ext */
function describe(ext) {
  const pkg = ext.version ? `${ext.packageName} ${ext.version}` : ext.packageName;
  return `extension ${ext.name ?? ext.packageName} (${pkg}, ${ext.source})`;
}
