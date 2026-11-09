/**
 * Rebuild a source-linked package's `dist/` before n-dx runs it.
 *
 * A source-linked checkout runs core from source, so core is always current,
 * but every other package runs from its `dist/`, which is only as current as
 * the last build. When that `dist/` is missing, or was last written before
 * the newest source edit, n-dx used to stop and print the `pnpm` command that
 * fixes it. It now runs that build itself, says so, and carries on; a build
 * that fails is reported with the build's own output and a non-zero exit.
 *
 * A published install ships `dist/` without `src/` and is not a pnpm
 * workspace, so it has nothing to rebuild from: a missing `dist/` there is an
 * incomplete install, and the only fix is to reinstall.
 *
 * What is decided ({@link judgeBuildNeed}) is pure and unit-tested apart from
 * what is done ({@link runRebuild}), which spawns `pnpm` through win-spawn.
 *
 * Node builtins plus core's own helpers only: core is the orchestration tier
 * and spawns, never imports, the packages it builds.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { packageBuildIdentity, packageRootOf } from "./build-identity.mjs";
import { spawnSyncCli } from "./win-spawn.js";

/** How long a rebuild may take before it is given up on. */
export const REBUILD_TIMEOUT_MS = 10 * 60_000;

/** How long to wait for another n-dx process's rebuild of the same checkout. */
export const REBUILD_LOCK_WAIT_MS = 12 * 60_000;

/** Name of the lock directory, inside the checkout's `node_modules/`. */
export const REBUILD_LOCK_DIRNAME = ".ndx-rebuild.lock";

/**
 * @typedef {object} BuildFacts
 * @property {boolean} entryExists       The file n-dx is about to run (or serve) exists.
 * @property {string | null} packageDir  The package that owns it.
 * @property {string | null} name        That package's name.
 * @property {boolean} hasSource         `src/` sits beside `dist/` — a checkout, not a published package.
 * @property {boolean | null} lagging    `dist/` was last written before the newest source edit (build-identity.mjs).
 * @property {string | null} checkoutRoot The pnpm workspace the package belongs to, or null.
 */

/**
 * @typedef {{ action: "none" }
 *   | { action: "rebuild", reason: "missing" | "lagging" | "older", name: string, packageDir: string, checkoutRoot: string }
 *   | { action: "reinstall", name: string | null, packageDir: string | null }} BuildNeed
 */

/**
 * What to do about the build behind an entry point. Pure.
 *
 * - The entry exists and its `dist/` does not lag its source: nothing.
 * - A source-linked package in a pnpm workspace whose entry is missing, or
 *   whose `dist/` lags: rebuild it.
 * - An entry that is missing anywhere else: the install is incomplete, and
 *   only a reinstall restores it.
 *
 * Only a `dist/` that *lags* is rebuilt, never one that merely lacks a
 * current stamp: a watch build (`pnpm dev`) keeps `dist/` current without
 * writing the stamp, and rebuilding under it on every command would fight it.
 *
 * @param {BuildFacts} facts
 * @returns {BuildNeed}
 */
export function judgeBuildNeed({ entryExists, packageDir, name, hasSource, lagging, checkoutRoot }) {
  const rebuildable = hasSource && !!checkoutRoot && !!packageDir && !!name;
  if (!entryExists) {
    return rebuildable
      ? { action: "rebuild", reason: "missing", name, packageDir, checkoutRoot }
      : { action: "reinstall", name, packageDir };
  }
  if (lagging === true && rebuildable) return { action: "rebuild", reason: "lagging", name, packageDir, checkoutRoot };
  return { action: "none" };
}

/**
 * The pnpm workspace `packageDir` sits in (`<root>/packages/<name>`), or null.
 *
 * @param {string | null} packageDir
 * @returns {string | null}
 */
export function checkoutRootOf(packageDir) {
  if (!packageDir) return null;
  const root = dirname(dirname(packageDir));
  return existsSync(join(root, "pnpm-workspace.yaml")) ? root : null;
}

/**
 * Gather {@link BuildFacts} for `entry` from disk.
 *
 * `checkLag` hashes the package's source to tell whether `dist/` lags it.
 * That is cheap once, before a server is spawned, but not on every sub-CLI a
 * command runs; without it only a missing entry is noticed.
 *
 * @param {string} entry
 * @param {{ checkLag?: boolean }} [options]
 * @returns {BuildFacts}
 */
export function buildFacts(entry, { checkLag = false } = {}) {
  const entryExists = existsSync(entry);
  // Real path: a workspace package reached through a `node_modules/@n-dx/*`
  // link is still the checkout's own package, and only its real location
  // says which workspace it belongs to.
  const found = packageRootOf(dirname(entry));
  let packageDir = found;
  try {
    if (found) packageDir = realpathSync.native(found);
  } catch {
    // Unresolvable: judged by the path as given.
  }
  let name = null;
  if (packageDir) {
    try {
      const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
      name = typeof pkg.name === "string" ? pkg.name : null;
    } catch {
      // Unreadable manifest: nothing to filter a build by.
    }
  }
  const hasSource = !!packageDir && existsSync(join(packageDir, "src"));
  const lagging = checkLag && entryExists ? packageBuildIdentity(entry).lagging : null;
  return { entryExists, packageDir, name, hasSource, lagging, checkoutRoot: checkoutRootOf(packageDir) };
}

/**
 * The pnpm arguments that build `name` and every workspace package it depends
 * on. A package alone type-checks against its dependencies' `dist/` and runs
 * them at run time, so building only it fails or leaves them stale.
 *
 * @param {string} name
 * @returns {string[]}
 */
export function rebuildArgs(name) {
  return ["--filter", `${name}...`, "build"];
}

/**
 * What a rebuild says before it starts. Pure.
 *
 * @param {Extract<BuildNeed, { action: "rebuild" }>} need
 * @returns {string}
 */
export function rebuildNotice(need) {
  const dist = join(need.packageDir, "dist");
  const why = need.reason === "missing" ? `${dist} is missing a built file`
    : need.reason === "older" ? `${dist} is older than this ndx`
    : `${dist} is older than its source`;
  return `Rebuilding ${need.name} and the workspace packages it depends on, because ${why}…`;
}

/**
 * What a failed rebuild reports: the build's own output, after a line naming
 * what failed. Pure.
 *
 * @param {Extract<BuildNeed, { action: "rebuild" }>} need
 * @param {{ code: number | null, output: string }} result
 * @returns {string}
 */
export function rebuildFailureMessage(need, result) {
  const how = result.code === null ? "could not run" : `exited with code ${result.code}`;
  const output = result.output.trim();
  return `The automatic rebuild of ${need.name} in ${need.checkoutRoot} ${how}.` + (output ? `\n${output}` : "");
}

/**
 * What a published install missing a built file says. Pure.
 *
 * @param {Extract<BuildNeed, { action: "reinstall" }>} need
 * @param {string} entry
 * @returns {string}
 */
export function reinstallMessage(need, entry) {
  const pkg = need.name ?? "an n-dx package";
  return `${entry} is missing, and this n-dx install has no source to rebuild ${pkg} from. ` +
    "The install is incomplete: reinstall n-dx (npm install -g @n-dx/core).";
}

/**
 * Run the build for `need`, output captured so a success stays one line and a
 * failure can show what the build said.
 *
 * @param {Extract<BuildNeed, { action: "rebuild" }>} need
 * @param {{ spawnSync?: typeof spawnSyncCli, timeoutMs?: number }} [deps]
 * @returns {{ ok: boolean, code: number | null, output: string }}
 */
export function runRebuild(need, { spawnSync = spawnSyncCli, timeoutMs = REBUILD_TIMEOUT_MS } = {}) {
  let result;
  try {
    result = spawnSync("pnpm", rebuildArgs(need.name), {
      cwd: need.checkoutRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    return { ok: false, code: null, output: `pnpm could not be started: ${/** @type {Error} */ (err).message}` };
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) {
    return { ok: false, code: null, output: `${output}\npnpm could not be started: ${result.error.message}` };
  }
  return { ok: result.status === 0, code: result.status ?? null, output };
}

/** Whether a pid names a live process (EPERM: alive, someone else's). */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM";
  }
}

/**
 * Take the checkout's rebuild lock, waiting for another n-dx process's build
 * to finish first. Two builds writing one `dist/` at once corrupt it.
 *
 * The lock is a directory (`mkdir` is atomic) holding its owner's pid; one
 * whose owner is gone is taken over. Returns a release function, or null when
 * the wait ran out.
 *
 * @param {string} checkoutRoot
 * @param {{ waitMs?: number, pollMs?: number, onWait?: () => void }} [options]
 * @returns {Promise<(() => void) | null>}
 */
export async function acquireRebuildLock(checkoutRoot, { waitMs = REBUILD_LOCK_WAIT_MS, pollMs = 500, onWait = () => {} } = {}) {
  const dir = join(checkoutRoot, "node_modules", REBUILD_LOCK_DIRNAME);
  const owner = join(dir, "owner.json");
  const deadline = Date.now() + waitMs;
  let announced = false;
  for (;;) {
    try {
      mkdirSync(dirname(dir), { recursive: true });
      mkdirSync(dir);
      writeFileSync(owner, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      return () => rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== "EEXIST") throw err;
    }
    let holder = null;
    try {
      holder = JSON.parse(readFileSync(owner, "utf8"))?.pid ?? null;
    } catch {
      // Being written, or left half-written: judged by age below.
    }
    const stale = Number.isInteger(holder)
      ? !pidAlive(holder)
      : Date.now() - (statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 30_000;
    if (stale) {
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() >= deadline) return null;
    if (!announced) {
      announced = true;
      onWait();
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Make sure the build behind `entry` is there and current before n-dx runs or
 * serves it, rebuilding a source-linked package when it is not.
 *
 * Prints what it does on `err`. Never throws: the caller turns `ok: false`
 * into its own non-zero exit, with `message` as the error.
 *
 * @param {string} entry  The file about to be run or served.
 * @param {object} [options]
 * @param {boolean} [options.checkLag]       Also rebuild a `dist/` that lags its source ({@link buildFacts}).
 * @param {boolean} [options.force]          Rebuild a source-linked package even when its `dist/` does not
 *                                           look stale: it was just shown to be older than this ndx.
 * @param {(line: string) => void} [options.err]
 * @param {(entry: string, options: { checkLag?: boolean }) => BuildFacts} [options.facts]
 * @param {typeof runRebuild} [options.rebuild]
 * @param {typeof acquireRebuildLock} [options.lock]
 * @returns {Promise<{ ok: true, rebuilt: boolean } | { ok: false, message: string, reinstall?: boolean }>}
 */
export async function ensureSourceBuild(entry, {
  checkLag = false,
  force = false,
  err = (line) => console.error(line),
  facts = buildFacts,
  rebuild = runRebuild,
  lock = acquireRebuildLock,
} = {}) {
  const judge = () => {
    const found = facts(entry, { checkLag });
    if (!force || !found.entryExists) return judgeBuildNeed(found);
    const need = judgeBuildNeed({ ...found, lagging: true });
    return need.action === "rebuild" ? { ...need, reason: "older" } : need;
  };
  let need = judge();
  if (need.action === "none") return { ok: true, rebuilt: false };
  if (need.action === "reinstall") return { ok: false, reinstall: true, message: reinstallMessage(need, entry) };

  const release = await lock(need.checkoutRoot, {
    onWait: () => err(`Waiting for another n-dx process to finish rebuilding ${need.name}…`),
  });
  if (!release) {
    return { ok: false, message: `Another n-dx process is still rebuilding ${need.name} in ${need.checkoutRoot}; nothing was run.` };
  }
  try {
    // The build waited on may have been this one.
    if (!force) need = judge();
    if (need.action === "none") return { ok: true, rebuilt: false };
    if (need.action === "reinstall") return { ok: false, reinstall: true, message: reinstallMessage(need, entry) };
    err(rebuildNotice(need));
    const started = Date.now();
    const result = rebuild(need);
    if (!result.ok) return { ok: false, message: rebuildFailureMessage(need, result) };
    if (!existsSync(entry)) {
      return { ok: false, message: `The rebuild of ${need.name} finished, but ${entry} is still missing.\n${result.output.trim()}` };
    }
    err(`Rebuilt ${need.name} (${Math.max(1, Math.round((Date.now() - started) / 1000))}s).`);
    return { ok: true, rebuilt: true };
  } finally {
    release();
  }
}
