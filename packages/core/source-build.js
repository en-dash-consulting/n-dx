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

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
 * A lock held longer than any rebuild may take is stale whatever its pid
 * says. The lock sits in `node_modules/`, so it outlives a reboot, and the pid
 * of a build that died with the machine can belong to an unrelated process.
 */
export const REBUILD_LOCK_STALE_MS = REBUILD_TIMEOUT_MS + 2 * 60_000;

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

/** A lock directory's `owner.json`, or null when it is missing or half-written. */
function readLockOwner(dir) {
  try {
    const owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"));
    return owner && typeof owner === "object" ? owner : null;
  } catch {
    return null;
  }
}

/**
 * Whether the lock in `dir` is stale: its owner is gone, it is older than any
 * rebuild may take ({@link REBUILD_LOCK_STALE_MS}), or it has had no readable
 * owner for 30s (its taker died between `mkdir` and writing the owner).
 */
function lockIsStale(dir, isAlive, now) {
  const owner = readLockOwner(dir);
  if (!owner || !Number.isInteger(owner.pid)) {
    const mtime = statSync(dir, { throwIfNoEntry: false })?.mtimeMs;
    return mtime !== undefined && now - mtime > 30_000;
  }
  const started = Date.parse(owner.startedAt);
  if (Number.isFinite(started) && now - started > REBUILD_LOCK_STALE_MS) return true;
  return !isAlive(owner.pid);
}

/**
 * Take a stale lock out of the way, so that only one of several waiters that
 * all judged it stale does. Renaming is atomic: the waiter whose rename
 * succeeds holds what was at `dir`, and judges it again — another waiter may
 * have claimed the stale lock and taken a fresh one in its place since this
 * one looked. A fresh lock is put back; a stale one is deleted.
 *
 * Returns whether to try for the lock again at once: false when the lock
 * could not be moved (Windows refuses while a handle is open in it), so the
 * caller waits and polls instead of spinning.
 */
function claimStaleLock(dir, isAlive) {
  const tomb = `${dir}.stale.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    renameSync(dir, tomb);
  } catch (err) {
    // ENOENT: another waiter claimed it first, or its owner released it.
    return /** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT";
  }
  if (lockIsStale(tomb, isAlive, Date.now())) {
    rmSync(tomb, { recursive: true, force: true });
    return true;
  }
  try {
    renameSync(tomb, dir);
  } catch {
    // A third taker holds `dir` already. The lock moved aside is its owner's
    // no longer: that owner's release finds another token and leaves `dir` be.
    rmSync(tomb, { recursive: true, force: true });
  }
  return true;
}

/**
 * Take the checkout's rebuild lock, waiting for another n-dx process's build
 * to finish first. Two builds writing one `dist/` at once corrupt it.
 *
 * The lock is a directory (`mkdir` is atomic) holding its owner's pid and a
 * token of its own. One whose owner is gone, or that is older than any rebuild
 * may take, is claimed with an atomic rename ({@link claimStaleLock}), so two
 * waiters never both take it over. The release function removes the lock only
 * while it is still this taker's. Returns the release function, or null when
 * the wait ran out.
 *
 * @param {string} checkoutRoot
 * @param {{ waitMs?: number, pollMs?: number, onWait?: () => void, isAlive?: (pid: number) => boolean }} [options]
 * @returns {Promise<(() => void) | null>}
 */
export async function acquireRebuildLock(checkoutRoot, { waitMs = REBUILD_LOCK_WAIT_MS, pollMs = 500, onWait = () => {}, isAlive = pidAlive } = {}) {
  const dir = join(checkoutRoot, "node_modules", REBUILD_LOCK_DIRNAME);
  const deadline = Date.now() + waitMs;
  let announced = false;
  for (;;) {
    const token = randomBytes(8).toString("hex");
    try {
      mkdirSync(dirname(dir), { recursive: true });
      mkdirSync(dir);
      writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
      return () => {
        if (readLockOwner(dir)?.token === token) rmSync(dir, { recursive: true, force: true });
      };
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code;
      // ENOENT: the new lock was claimed as stale before its owner was written. Try again.
      if (code !== "EEXIST" && code !== "ENOENT") throw err;
    }
    if (lockIsStale(dir, isAlive, Date.now()) && claimStaleLock(dir, isAlive)) continue;
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
 * Only a missing build is fatal. When the built file is there and merely
 * lags its source, a rebuild that fails — a type error mid-edit, a broken
 * branch — or one another process still holds after the bounded wait leaves
 * the command running on the build it has: `ok: true` with `failed`, the
 * message (with the build's output) for the caller to print as a warning.
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
 * @param {number} [options.lockWaitMs]     How long to wait for another process's rebuild of the same checkout.
 * @returns {Promise<{ ok: true, rebuilt: boolean, failed?: string } | { ok: false, message: string, reinstall?: boolean }>}
 */
export async function ensureSourceBuild(entry, {
  checkLag = false,
  force = false,
  err = (line) => console.error(line),
  facts = buildFacts,
  rebuild = runRebuild,
  lock = acquireRebuildLock,
  lockWaitMs = REBUILD_LOCK_WAIT_MS,
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

  // A build that is there carries on when the rebuild cannot be had; a missing one cannot.
  const settle = (message) => (need.reason === "missing" ? { ok: false, message } : { ok: true, rebuilt: false, failed: message });
  const release = await lock(need.checkoutRoot, {
    waitMs: lockWaitMs,
    onWait: () => err(`Waiting for another n-dx process to finish rebuilding ${need.name}…`),
  });
  if (!release) {
    return settle(`Another n-dx process was still rebuilding ${need.name} in ${need.checkoutRoot} after ${Math.round(lockWaitMs / 1000)}s.`);
  }
  try {
    // The build waited on may have been this one.
    if (!force) need = judge();
    if (need.action === "none") return { ok: true, rebuilt: false };
    if (need.action === "reinstall") return { ok: false, reinstall: true, message: reinstallMessage(need, entry) };
    err(rebuildNotice(need));
    const started = Date.now();
    const result = rebuild(need);
    if (!result.ok) return settle(rebuildFailureMessage(need, result));
    if (!existsSync(entry)) {
      return { ok: false, message: `The rebuild of ${need.name} finished, but ${entry} is still missing.\n${result.output.trim()}` };
    }
    err(`Rebuilt ${need.name} (${Math.max(1, Math.round((Date.now() - started) / 1000))}s).`);
    return { ok: true, rebuilt: true };
  } finally {
    release();
  }
}
