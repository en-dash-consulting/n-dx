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
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { discoverExtensions, EXTENSIONS_CACHE_FILE } from "./extension-discovery.js";
import { escapeControlCharacters } from "./extension-manifest.js";
import {
  describeForApproval,
  extensionState,
  readExtensionsFile,
  recordApproval,
  stateKey,
  updateExtensionsFile,
} from "./extension-state.js";

/** Exit code for an extension command that exists but cannot run. */
export const EXTENSION_REFUSED_EXIT_CODE = 2;

/**
 * The signals `ndx` passes on to a running extension command, by pid. Windows
 * forwards SIGTERM alone: closing the console ends every process on it.
 */
export const FORWARDED_SIGNALS = Object.freeze(["SIGTERM", "SIGHUP"]);

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
 *   When the only problem is the missing approval, `approval` carries what
 *   {@link approveOnFirstRun} needs to ask for it.
 * - `unavailable` — an extension claims the name but is disabled, incompatible,
 *   invalid or in conflict; `ndx` still reports an unknown command, and `hint`
 *   says why and what to run.
 *
 * @typedef {{kind: "builtin"} | {kind: "none"}
 *   | {kind: "run", ext: DiscoveredExtension, command: string, bin: string, home: string}
 *   | {kind: "refused", ext: DiscoveredExtension, message: string, approval?: PendingApproval}
 *   | {kind: "unavailable", ext: DiscoveredExtension, state: ExtensionStateName, hint: string}} ExtensionResolution
 */

/**
 * An unapproved extension's approval, as `ndx <name>` would record it.
 *
 * @typedef {object} PendingApproval
 * @property {string} reason  Why it is unapproved.
 * @property {string} home  The n-dx home holding `extensions.json`.
 * @property {string} projectDir  The project a project-source approval is for.
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

  const { discovery, file, projectDir } = discoverWithApprovals(builtins, options);
  const ext = claimant(discovery.extensions, (candidate) => claims(candidate, name));
  if (!ext) return { kind: "none" };

  const { state, reason } = extensionState(ext, { file, ndxVersion: options.ndxVersion, projectDir });
  const label = describe(ext);
  const key = stateKey(ext);

  if (state === "unapproved") {
    return {
      kind: "refused",
      ext,
      message: `Error: 'ndx ${name}' comes from ${label}, which is ${reason} — fix: ndx extensions enable ${key}`,
      approval: { reason, home: discovery.home, projectDir },
    };
  }
  if (state !== "enabled") {
    const fix = state === "disabled" ? `ndx extensions enable ${key}` : "ndx extensions doctor";
    return { kind: "unavailable", ext, state, hint: `${label} provides '${name}' but is ${state}: ${reason}. Run '${fix}'.` };
  }

  const command = ext.manifest?.commands?.find((c) => c.name === name);
  if (!command) return { kind: "none" };
  const bin = packageFile(ext.dir, command.bin);
  if (bin === null) {
    return {
      kind: "refused",
      ext,
      message: `Error: 'ndx ${name}' comes from ${label}, whose bin ${command.bin} is outside the package — fix: ndx extensions doctor`,
    };
  }
  if (!(options.fs ?? nodeFs).existsSync(bin)) {
    return {
      kind: "refused",
      ext,
      message: `Error: 'ndx ${name}' comes from ${label}, whose bin ${command.bin} does not exist — fix: ndx extensions doctor`,
    };
  }
  return { kind: "run", ext, command: name, bin, home: discovery.home };
}

/** Polled for a 200 before the hub proxies, when the manifest names no `health`. */
export const DEFAULT_SIDECAR_HEALTH = "/";

/** Minutes without traffic before the hub stops a sidecar, when the manifest says nothing. */
export const DEFAULT_SIDECAR_IDLE_STOP_MINUTES = 15;

/** The sidecar's output, under its state folder: what the hub's 503 names. */
export const SIDECAR_LOG_DIRNAME = "logs";
export const SIDECAR_LOG_FILENAME = "sidecar.log";

/**
 * What the hub's `/x/<name>/` resolves to (docs/architecture/extensions.md,
 * "Sidecar lifecycle").
 *
 * - `run` — an enabled extension declaring a sidecar whose `bin` exists, with
 *   the manifest's `health` and `idleStopMinutes` filled in from the defaults.
 * - `none` — no installed extension of that name declares a sidecar.
 * - `refused` — it would run but must not: not enabled (unapproved, disabled,
 *   incompatible…) or its `bin` is missing. `message` names the fix, and
 *   `state` is the extension's (`enabled` when only the bin is missing).
 *   Nothing asks here: the hub has no terminal, so approval is
 *   `ndx extensions enable`.
 *
 * @typedef {{kind: "none", message: string}
 *   | {kind: "refused", ext: DiscoveredExtension, state: ExtensionStateName, message: string}
 *   | {kind: "run", ext: DiscoveredExtension, bin: string, home: string, health: string, idleStopMinutes: number}} SidecarResolution
 */

/**
 * Resolve the sidecar the extension `name` declares.
 *
 * @param {string} name  The extension name, as in `/x/<name>/`.
 * @param {ResolveOptions} options
 * @returns {SidecarResolution}
 */
export function resolveExtensionSidecar(name, options) {
  const builtins = new Set(options.builtinCommands);
  const { discovery, file, projectDir } = discoverWithApprovals(builtins, options);
  const ext = claimant(discovery.extensions, (candidate) => candidate.name === name);
  if (!ext || (ext.manifest && !ext.manifest.sidecar)) {
    return { kind: "none", message: `Error: No installed extension named '${name}' declares a sidecar — fix: ndx extensions list` };
  }

  const { state, reason } = extensionState(ext, { file, ndxVersion: options.ndxVersion, projectDir });
  if (state !== "enabled") {
    const fix = state === "disabled" || state === "unapproved" ? `ndx extensions enable ${stateKey(ext)}` : "ndx extensions doctor";
    return { kind: "refused", ext, state, message: `Error: the sidecar of ${describe(ext)} is not started: it is ${state} (${reason}) — fix: ${fix}` };
  }

  const sidecar = /** @type {NonNullable<NonNullable<DiscoveredExtension["manifest"]>["sidecar"]>} */ (ext.manifest?.sidecar);
  const bin = packageFile(ext.dir, sidecar.bin);
  if (bin === null) {
    return { kind: "refused", ext, state, message: `Error: the sidecar of ${describe(ext)} is not started: its bin ${sidecar.bin} is outside the package — fix: ndx extensions doctor` };
  }
  if (!(options.fs ?? nodeFs).existsSync(bin)) {
    return { kind: "refused", ext, state, message: `Error: the sidecar of ${describe(ext)} is not started: its bin ${sidecar.bin} does not exist — fix: ndx extensions doctor` };
  }
  return {
    kind: "run",
    ext,
    bin,
    home: discovery.home,
    health: sidecar.health ?? DEFAULT_SIDECAR_HEALTH,
    idleStopMinutes: sidecar.idleStopMinutes ?? DEFAULT_SIDECAR_IDLE_STOP_MINUTES,
  };
}

/**
 * Asks a yes/no question on the terminal.
 *
 * @callback ConfirmApproval
 * @param {string} question
 * @returns {Promise<boolean>}
 */

/**
 * @typedef {object} FirstRunOptions
 * @property {ConfirmApproval} [confirm]  Omitted when there is no terminal to ask on.
 * @property {(line: string) => void} out
 * @property {Date} [now]
 */

/**
 * The first `ndx <name>` of an unapproved extension: show what would run —
 * package, version, source, commands and sidecar — and ask. A yes records the
 * approval exactly as `ndx extensions enable` does, so the command can run.
 *
 * Resolves to false, writing nothing, when the resolution is not waiting on an
 * approval, when there is no terminal to ask on, or when the answer is no; the
 * caller then reports the refusal, which names `ndx extensions enable`.
 *
 * @param {ExtensionResolution} resolution
 * @param {string} command  The `<name>` that was run.
 * @param {FirstRunOptions} options
 * @returns {Promise<boolean>} Whether the extension is now approved.
 */
export async function approveOnFirstRun(resolution, command, { confirm, out, now }) {
  if (resolution.kind !== "refused" || !resolution.approval || !confirm) return false;
  const { ext, approval } = resolution;
  for (const line of describeForApproval(ext, approval.reason)) out(line);
  if (!(await confirm(escapeControlCharacters(`Approve '${stateKey(ext)}' and run 'ndx ${command}'?`)))) return false;
  updateExtensionsFile(approval.home, (file) => recordApproval(file, ext, { projectDir: approval.projectDir, now }));
  return true;
}

/**
 * An enabled extension command, as `ndx --help` lists it.
 *
 * @typedef {{name: string, summary: string, extension: string}} ListedExtensionCommand
 */

/**
 * Every command of every enabled extension, sorted by name: what `ndx --help`
 * lists under its Extensions heading. Disabled, unapproved, incompatible,
 * invalid and conflicting extensions list nothing, and neither does a command
 * a built-in owns.
 *
 * @param {ResolveOptions} options
 * @returns {ListedExtensionCommand[]}
 */
export function listExtensionCommands(options) {
  const builtins = new Set(options.builtinCommands);
  const { discovery, file, projectDir } = discoverWithApprovals(builtins, options);
  /** @type {ListedExtensionCommand[]} */
  const listed = [];
  for (const ext of discovery.extensions) {
    if (!ext.manifest) continue;
    if (extensionState(ext, { file, ndxVersion: options.ndxVersion, projectDir }).state !== "enabled") continue;
    for (const command of ext.manifest.commands ?? []) {
      if (builtins.has(command.name)) continue;
      listed.push({ name: command.name, summary: command.summary, extension: ext.name ?? ext.packageName });
    }
  }
  return listed.sort((a, b) => a.name.localeCompare(b.name));
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
 * @property {Pick<NodeJS.Process, "on" | "removeListener">} [processRef]
 */

/**
 * Run an extension command: n-dx's Node on `bin` with `args`, stdio inherited
 * and the working directory unchanged.
 *
 * The child is spawned the way a shell runs a foreground command: never
 * detached, so on POSIX it stays in the terminal's session and process group.
 * It can open /dev/tty (an ssh or sudo prompt), and Ctrl+C, Ctrl+Z and a
 * closed terminal reach it directly. That is why SIGINT is not sent again;
 * `ndx` only ignores it and waits. SIGTERM and SIGHUP, which may be aimed at
 * `ndx` alone, are forwarded to the child's pid.
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
  // Explicit, because cli.js's tracked spawn defaults to detached on POSIX.
  const spawnOptions = { stdio: "inherit", env: options.env ?? process.env, detached: false };

  return new Promise((resolvePromise, reject) => {
    const child = options.spawn(options.execPath ?? process.execPath, [options.bin, ...options.args], spawnOptions);

    /** @param {NodeJS.Signals} signal */
    const forward = (signal) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
    };
    const forwarded = platform === "win32" ? FORWARDED_SIGNALS.filter((signal) => signal !== "SIGHUP") : FORWARDED_SIGNALS;
    /** @type {Map<NodeJS.Signals, () => void>} */
    const listeners = new Map([
      ["SIGINT", () => {}],
      ...forwarded.map((signal) => /** @type {const} */ ([signal, () => forward(signal)])),
    ]);
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
 * Discover the installed extensions and read their approvals.
 *
 * @param {Set<string>} builtins
 * @param {ResolveOptions} options
 */
function discoverWithApprovals(builtins, options) {
  const projectDir = resolve(options.cwd ?? process.cwd());
  const discovery = discoverExtensions({
    builtinCommands: builtins,
    projectDir,
    home: options.home,
    env: options.env,
    globalRoot: options.globalRoot,
  });
  // An unreadable extensions.json is among discovery's errors; with no
  // approvals readable, every extension is unapproved.
  const unreadable = discovery.errors.some((e) => e.path === join(discovery.home, EXTENSIONS_CACHE_FILE));
  const file = unreadable ? {} : readExtensionsFile(discovery.home);
  return { discovery, file, projectDir };
}

/**
 * The extension a name resolves to: the first in precedence order with a
 * readable manifest, else the first refused one. Discovery counts conflicts
 * only between readable manifests, so an invalid or incompatible package
 * sharing a name must not hide the one `ndx --help` lists.
 *
 * @param {DiscoveredExtension[]} extensions
 * @param {(ext: DiscoveredExtension) => boolean} matches
 * @returns {DiscoveredExtension | undefined}
 */
function claimant(extensions, matches) {
  return extensions.find((ext) => ext.manifest && matches(ext)) ?? extensions.find(matches);
}

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

/**
 * The absolute path of `path` inside the package folder `dir`, or `null` when
 * it resolves outside it. The manifest validator already refuses such paths;
 * this holds at spawn time too, where a drive-relative `D:cli.js` would
 * otherwise resolve against D:'s cwd on Windows.
 *
 * @param {string} dir
 * @param {string} path
 * @returns {string | null}
 */
export function packageFile(dir, path) {
  const file = resolve(dir, path);
  const rel = relative(dir, file);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return file;
}

/** @param {DiscoveredExtension} ext */
function describe(ext) {
  const pkg = ext.version ? `${ext.packageName} ${ext.version}` : ext.packageName;
  return `extension ${ext.name ?? ext.packageName} (${pkg}, ${ext.source})`;
}
