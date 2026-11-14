/**
 * The host-wide validation slot, for the repository's own test runner.
 *
 * A plain-JS implementation of the on-disk protocol (version 1) documented in
 * the header of packages/hench/src/process/validation-slot.ts. Scripts cannot
 * import hench, so the protocol is implemented twice; the two must agree
 * byte for byte on the files they write and read.
 * tests/e2e/validation-slot-parity.test.js runs a holder through one
 * implementation against a contender through the other, both ways round,
 * and is in ROOT_DRIFT_TEST_FILES so a change to either selects it.
 *
 * The slot directory (`<ndx home>/validation-slot/<host>/`) mirrors hench's
 * packages/hench/src/process/validation-slot-dir.ts: same machine-id sources
 * in the same order, same hash, same lookup timeout, same caching rule.
 *
 * Change the protocol in hench's header first, then here.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir, uptime } from "node:os";
import { isAbsolute, join } from "node:path";
import { resolveNdxHome } from "../../packages/core/layout.js";

/** The environment variable a holder exports its token to children under. */
export const VALIDATION_SLOT_ENV = "NDX_VALIDATION_SLOT";

/** The environment variable a holder exports its absolute slot directory under (rule 6). */
export const VALIDATION_SLOT_DIR_ENV = "NDX_VALIDATION_SLOT_DIR";

/** The PID namespaces enclosing this process, outermost first (rule 4a). */
export const OUTER_PID_NAMESPACES_ENV = "NDX_OUTER_PID_NAMESPACES";

/** The slot root's name inside the ndx home; each host's slot is a subdirectory. */
export const VALIDATION_SLOT_DIRNAME = "validation-slot";
const HOLDER_FILE = "holder.json";
const RECLAIM_FILE = "reclaim.lock";
const PROTOCOL_VERSION = 1;

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MIN_POLL_INTERVAL_MS = 10;
const MAX_POLL_INTERVAL_MS = 10_000;
const DEFAULT_REPORT_INTERVAL_MS = 30_000;
/** Two boot-time readings this close name one boot (see hench's module). */
const BOOT_TIME_TOLERANCE_MS = 5 * 60_000;
/** Rename retries for Windows, where a reader holding the file open blocks a replace. */
const RENAME_ATTEMPTS = 5;

/**
 * @typedef {{ pid: number, group: boolean }} ValidationSlotChild
 * @typedef {{
 *   version: number, token: string, pid: number, child: ValidationSlotChild | null,
 *   startedAt: string, bootedAt: number, projectDir: string,
 *   pidNamespace: string | null, outerPidNamespaces: string[],
 * }} ValidationSlotHolder
 * @typedef {{ pidNamespace: string | null, outerPidNamespaces: string[] }} PidNamespacePlace
 * @typedef {PidNamespacePlace & { procRoot: string }} PidNamespaceView
 * @typedef {{ holder: ValidationSlotHolder, holderAlive: boolean, waitedMs: number, holderPath: string }} ValidationSlotWait
 * @typedef {{
 *   slotDir: string, token: string, nested: boolean, queueWaitMs: number,
 *   childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv,
 *   recordChild(pid: number, options?: { group?: boolean }): Promise<void>,
 *   release(): Promise<void>,
 * }} ValidationSlotLease
 */

/** Thrown when the abort signal fires while waiting for the slot. */
export class ValidationSlotAbortedError extends Error {
  /**
   * @param {number} queueWaitMs
   * @param {unknown} reason
   */
  constructor(queueWaitMs, reason) {
    super(`Gave up waiting for the validation slot after ${queueWaitMs} ms`, { cause: reason });
    this.name = "ValidationSlotAbortedError";
    this.queueWaitMs = queueWaitMs;
  }
}

/** Thrown when a holder finds its record replaced or gone. */
export class ValidationSlotLostError extends Error {
  /** @param {string} slotDir */
  constructor(slotDir) {
    super(`This process no longer holds the validation slot in ${slotDir}`);
    this.name = "ValidationSlotLostError";
  }
}

// Slot directory (hench's validation-slot-dir.ts)

/**
 * @typedef {{ kind: "machine" | "hostname", id: string }} HostIdentity
 * @typedef {
 *   | { kind: "exited", exitCode: number, stdout: string }
 *   | { kind: "missing" }
 *   | { kind: "failed", reason: string }
 * } LookupRun
 * @typedef {{
 *   platform: NodeJS.Platform,
 *   readFile(path: string): Promise<string>,
 *   run(file: string, args: string[]): Promise<LookupRun>,
 *   hostname(): string,
 * }} HostIdentitySources
 * @typedef {
 *   | { kind: "found", id: string }
 *   | { kind: "none" }
 *   | { kind: "transient", lookup: string, reason: string }
 * } MachineIdOutcome
 */

/** A machine-id lookup that failed in a way that may not recur. Not cached; never the hostname. */
export class HostIdentityLookupError extends Error {
  /**
   * @param {string} lookup
   * @param {string} reason
   */
  constructor(lookup, reason) {
    super(`could not read this host's machine id (${lookup}: ${reason}); the next validation retries it`);
    this.name = "HostIdentityLookupError";
  }
}

/** Linux machine-id files, in lookup order. */
export const LINUX_MACHINE_ID_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"];

/** How long a platform lookup command may run (see hench's module header). */
export const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Run a lookup command without a shell and say how it ended: hench's
 * `runLookup` over llm-client's `exec`. A timeout kills it and is a failure.
 * @returns {Promise<LookupRun>}
 */
export function runLookup(file, args, timeoutMs = LOOKUP_TIMEOUT_MS) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(file, args, { cwd: tmpdir(), stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch (err) {
      resolvePromise(err?.code === "ENOENT" ? { kind: "missing" } : { kind: "failed", reason: err?.message ?? String(err) });
      return;
    }
    const chunks = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", (err) => {
      clearTimeout(timer);
      resolvePromise(err?.code === "ENOENT" ? { kind: "missing" } : { kind: "failed", reason: err?.message ?? String(err) });
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (timedOut) resolvePromise({ kind: "failed", reason: `Command timed out after ${timeoutMs}ms: ${[file, ...args].join(" ")}` });
      else if (exitCode !== null) resolvePromise({ kind: "exited", exitCode, stdout: Buffer.concat(chunks).toString("utf-8") });
      else resolvePromise({ kind: "failed", reason: `Command was killed with ${signal}: ${[file, ...args].join(" ")}` });
    });
  });
}

/** @type {HostIdentitySources} */
const DEFAULT_SOURCES = {
  platform: process.platform,
  readFile: (path) => readFile(path, "utf-8"),
  run: (file, args) => runLookup(file, args),
  hostname,
};

/** @type {MachineIdOutcome} */
const NONE = { kind: "none" };

/** @returns {Promise<MachineIdOutcome>} */
async function readMachineIdFile(sources, path) {
  let id;
  try {
    id = (await sources.readFile(path)).trim();
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return NONE;
    return { kind: "transient", lookup: `reading ${path}`, reason: err instanceof Error ? err.message : String(err) };
  }
  // An unset id ("" or "uninitialized" during first boot) is not one.
  return /^[0-9a-f]{32}$/i.test(id) ? { kind: "found", id } : NONE;
}

/** @returns {Promise<MachineIdOutcome>} */
async function linuxMachineId(sources) {
  let transient;
  for (const path of LINUX_MACHINE_ID_FILES) {
    const outcome = await readMachineIdFile(sources, path);
    if (outcome.kind === "found") return outcome;
    if (outcome.kind === "transient") transient ??= outcome;
  }
  return transient ?? NONE;
}

/** @returns {Promise<MachineIdOutcome>} */
async function commandMatch(sources, file, args, pattern) {
  const lookup = `running ${[file, ...args].join(" ")}`;
  const run = await sources.run(file, args);
  if (run.kind === "missing") return NONE;
  if (run.kind === "failed") return { kind: "transient", lookup, reason: run.reason };
  const id = pattern.exec(run.stdout)?.[1]?.trim();
  if (id) return { kind: "found", id };
  return run.exitCode === 0 ? NONE : { kind: "transient", lookup, reason: `exited with code ${run.exitCode}` };
}

/** @returns {Promise<MachineIdOutcome>} */
function machineId(sources) {
  switch (sources.platform) {
    case "linux":
      return linuxMachineId(sources);
    case "darwin":
      return commandMatch(sources, "ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], /"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    case "win32":
      return commandMatch(
        sources,
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        /MachineGuid\s+REG_SZ\s+(\S+)/i,
      );
    default:
      return Promise.resolve(NONE);
  }
}

/**
 * This host's identity, read now: its machine id, else its hostname when the
 * host has none. Rejects with `HostIdentityLookupError` on a transient failure.
 * @param {HostIdentitySources} [sources]
 * @returns {Promise<HostIdentity>}
 */
export async function readHostIdentity(sources = DEFAULT_SOURCES) {
  const outcome = await machineId(sources);
  switch (outcome.kind) {
    case "found":
      return { kind: "machine", id: outcome.id };
    case "none":
      return { kind: "hostname", id: sources.hostname() };
    case "transient":
      throw new HostIdentityLookupError(outcome.lookup, outcome.reason);
  }
}

/**
 * `readHostIdentity(sources)`, kept once it resolves. A rejected lookup is
 * forgotten, so the next call retries it.
 * @param {HostIdentitySources} sources
 * @returns {() => Promise<HostIdentity>}
 */
export function createHostIdentityCache(sources) {
  let cached;
  return () => {
    if (!cached) {
      const attempt = readHostIdentity(sources);
      cached = attempt;
      // The caller sees the rejection through `attempt`; this only forgets it.
      attempt.then(undefined, () => {
        if (cached === attempt) cached = undefined;
      });
    }
    return cached;
  };
}

/** This host's identity, read once per process; a transient failure is retried on the next call. */
export const hostIdentity = createHostIdentityCache(DEFAULT_SOURCES);

/**
 * The host directory's name: `m-` (machine id) or `h-` (hostname) and the
 * first 16 hex characters of the SHA-256 of the trimmed, lower-cased id.
 * @param {HostIdentity} identity
 */
export function validationSlotHostDirname(identity) {
  const digest = createHash("sha256").update(identity.id.trim().toLowerCase()).digest("hex");
  return `${identity.kind === "machine" ? "m" : "h"}-${digest.slice(0, 16)}`;
}

/** The slot root under the ndx home `env` resolves to; each host's slot is a subdirectory. */
export function validationSlotRootDir(env = process.env) {
  return join(resolveNdxHome({ env }), VALIDATION_SLOT_DIRNAME);
}

/**
 * This host's slot directory under the ndx home `env` resolves to: hench's `resolveValidationSlotDir`.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {HostIdentity} [identity]
 * @returns {Promise<string>}
 * @throws {HostIdentityLookupError} when the machine id could not be read this time.
 */
export async function resolveValidationSlotDir(env = process.env, identity) {
  return join(validationSlotRootDir(env), validationSlotHostDirname(identity ?? (await hostIdentity())));
}

// Liveness (rule 4)

function signalZero(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return err?.code === "EPERM";
  }
}

const isPositiveInt = (value) => typeof value === "number" && Number.isInteger(value) && value > 0;

/** Whether a process with this pid exists. */
export function isPidAlive(pid) {
  return isPositiveInt(pid) && signalZero(pid);
}

function currentBootTimeMs() {
  return Math.round(Date.now() - uptime() * 1000);
}

function isChildAlive(child) {
  if (child.group && process.platform !== "win32") return isPositiveInt(child.pid) && signalZero(-child.pid);
  return isPidAlive(child.pid);
}

// PID namespaces (rule 4a)

const PID_NAMESPACE_PATTERN = /^pid:\[\d+\]$/;

function readPidNamespace(procRoot, entry) {
  try {
    const ns = readlinkSync(join(procRoot, entry, "ns", "pid"));
    return PID_NAMESPACE_PATTERN.test(ns) ? ns : null;
  } catch {
    return null; // No procfs here (not Linux, or not mounted): rule 4 applies.
  }
}

/**
 * This process's place: its namespace from `procRoot`, the enclosing ones from `env`.
 * @returns {PidNamespaceView}
 */
export function pidNamespaceView(env = process.env, procRoot = process.platform === "linux" ? "/proc" : undefined) {
  const outerPidNamespaces = (env[OUTER_PID_NAMESPACES_ENV] ?? "").split(",").filter((ns) => PID_NAMESPACE_PATTERN.test(ns));
  return {
    procRoot: procRoot ?? "",
    pidNamespace: procRoot === undefined ? null : readPidNamespace(procRoot, "self"),
    outerPidNamespaces,
  };
}

function statusEntries(status, field) {
  const line = status.split("\n").find((l) => l.startsWith(`${field}:`));
  return line?.slice(field.length + 1).trim().split(/\s+/).filter(Boolean) ?? [];
}

function lastStatusEntry(status, field) {
  const last = statusEntries(status, field).pop();
  return last ? Number(last) : null;
}

/** Whether `/proc/<entry>` belongs to this user (a sandbox's processes always do), or cannot be told apart. */
function isOwnedByThisUser(procRoot, entry) {
  try {
    return process.getuid === undefined || statSync(join(procRoot, entry)).uid === process.getuid();
  } catch (err) {
    return err?.code !== "ENOENT";
  }
}

/**
 * Whether a process inside `ns`, visible below the reader's, has `pid` there. An entry
 * with a single `NSpid` entry is in the reader's namespace and skipped before `ns/pid`;
 * an unreadable nested (or status-less) entry of this user's counts as alive.
 */
function isAliveInInnerNamespace(procRoot, ns, pid, group) {
  let entries;
  try {
    entries = readdirSync(procRoot);
  } catch {
    return true; // Cannot look: unknown, so alive.
  }
  const field = group && process.platform !== "win32" ? "NSpgid" : "NSpid";
  let unreadable = false;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = readFileSync(join(procRoot, entry, "status"), "utf-8");
      // One NSpid entry: in the reader's namespace; its ns/pid may refuse this user anyway.
      if (statusEntries(status, "NSpid").length < 2) continue;
      if (readlinkSync(join(procRoot, entry, "ns", "pid")) !== ns) continue;
      if (lastStatusEntry(status, field) === pid) return true;
    } catch (err) {
      // Exited mid-scan, or another user's process: neither can be this user's sandbox.
      if (err?.code !== "ENOENT" && isOwnedByThisUser(procRoot, entry)) unreadable = true;
    }
  }
  return unreadable;
}

/** Whether `pid`, recorded at `place`, is alive as seen from `view` (rules 4 and 4a). */
function isRecordedPidAlive(place, pid, group, view) {
  const recorded = place.pidNamespace;
  const own = view.pidNamespace;
  if (recorded === null || own === null || recorded === own) {
    return group ? isChildAlive({ pid, group }) : isPidAlive(pid);
  }
  if (!isPositiveInt(pid)) return false;
  // The record's namespace lies inside the reader's, so its processes are visible.
  if (place.outerPidNamespaces.includes(own)) return isAliveInInnerNamespace(view.procRoot, recorded, pid, group);
  // Outside the reader's namespace, or beside it: invisible, so never judged
  // dead here. Hench clears such a record from the host (rule 4a).
  return true;
}

// Tokens this process holds (rule 5a)

/** Tokens of this process's unreleased leases. @type {Set<string>} */
const liveLeaseTokens = new Set();

/** Tokens of the `reclaim.lock` files this process is writing or holds. @type {Set<string>} */
const liveReclaimTokens = new Set();

/**
 * Whether a file names this process's pid with a token this process does not
 * hold: a leftover whose pid the OS reused, or this process's own failed
 * release (rule 5a). Only a file written in this process's own PID namespace
 * (or with either namespace unknown) can name this process (rule 4a).
 */
function isUnheldByThisProcess(place, pid, token, live, view) {
  if (pid !== process.pid) return false;
  const sameNamespace =
    place.pidNamespace === null || view.pidNamespace === null || place.pidNamespace === view.pidNamespace;
  return sameNamespace && !(typeof token === "string" && live.has(token));
}

/** Whether the holding process itself is alive, as seen from `view` (rules 4, 4a and 5a). */
function isHolderAlive(holder, view) {
  if (isUnheldByThisProcess(holder, holder.pid, holder.token, liveLeaseTokens, view)) return false;
  return isRecordedPidAlive(holder, holder.pid, false, view);
}

// Records

/**
 * A holder record from `raw`, or null when it is not a valid version-1 record.
 * @returns {ValidationSlotHolder | null}
 */
function parseHolder(raw) {
  let r;
  try {
    r = JSON.parse(raw);
  } catch {
    return null; // Not JSON: the caller treats it as stale (rule 5).
  }
  if (typeof r !== "object" || r === null) return null;
  if (r.version !== PROTOCOL_VERSION) return null;
  if (typeof r.token !== "string" || r.token === "") return null;
  if (!isPositiveInt(r.pid)) return null;
  if (typeof r.startedAt !== "string" || typeof r.projectDir !== "string") return null;
  if (typeof r.bootedAt !== "number" || !Number.isFinite(r.bootedAt)) return null;
  let child = null;
  if (r.child !== null && r.child !== undefined) {
    const c = r.child;
    if (typeof c !== "object" || !isPositiveInt(c.pid) || typeof c.group !== "boolean") return null;
    child = { pid: c.pid, group: c.group };
  }
  const place = parsePidNamespacePlace(r);
  if (place === null) return null;
  return {
    version: PROTOCOL_VERSION,
    token: r.token,
    pid: r.pid,
    child,
    startedAt: r.startedAt,
    bootedAt: r.bootedAt,
    projectDir: r.projectDir,
    ...place,
  };
}

/**
 * The namespace fields of a record or lock; absent reads as null and `[]`, malformed as null.
 * @returns {PidNamespacePlace | null}
 */
function parsePidNamespacePlace(r) {
  const ns = r.pidNamespace ?? null;
  const outer = r.outerPidNamespaces ?? [];
  if (ns !== null && typeof ns !== "string") return null;
  if (!Array.isArray(outer) || !outer.every((o) => typeof o === "string")) return null;
  return { pidNamespace: ns, outerPidNamespaces: outer };
}

/** Whether a record no longer occupies the slot (rules 5 and 5a). */
function isStale(holder, view) {
  if (Math.abs(holder.bootedAt - currentBootTimeMs()) > BOOT_TIME_TOLERANCE_MS) return true;
  if (isHolderAlive(holder, view)) return false;
  return holder.child === null || !isRecordedPidAlive(holder, holder.child.pid, holder.child.group, view);
}

// Files

const holderPath = (slotDir) => join(slotDir, HOLDER_FILE);
const scratchPath = (slotDir) => join(slotDir, `.${randomUUID()}.tmp`);

async function readIfExists(path) {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

async function unlinkIfExists(path) {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

/** Create `target` holding `content`, atomically; false when it already exists (rule 1). */
async function createExclusive(slotDir, target, content) {
  const scratch = scratchPath(slotDir);
  await writeFile(scratch, content, "utf-8");
  try {
    await link(scratch, target);
    return true;
  } catch (err) {
    if (err?.code === "EEXIST") return false;
    throw err;
  } finally {
    await unlinkIfExists(scratch);
  }
}

/** Replace `target` with `content` atomically (rule 2). */
async function replaceAtomically(slotDir, target, content) {
  const scratch = scratchPath(slotDir);
  await writeFile(scratch, content, "utf-8");
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(scratch, target);
      return;
    } catch (err) {
      const transient = err?.code === "EPERM" || err?.code === "EBUSY" || err?.code === "EACCES";
      if (!transient || attempt >= RENAME_ATTEMPTS) {
        await unlinkIfExists(scratch);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

async function readHolder(slotDir) {
  const raw = await readIfExists(holderPath(slotDir));
  if (raw === null) return null;
  return { raw, holder: parseHolder(raw) };
}

/**
 * The slot's current holder, or null when it is free or its record does not parse.
 * @returns {Promise<ValidationSlotHolder | null>}
 */
export async function readValidationSlotHolder(slotDir) {
  return (await readHolder(slotDir))?.holder ?? null;
}

/**
 * Remove `holder.json` if it still holds exactly `staleRaw` (rule 5). False
 * when another process holds the reclaim lock, so the caller waits a poll.
 */
async function reclaimStale(slotDir, staleRaw, view) {
  const lockPath = join(slotDir, RECLAIM_FILE);
  const token = randomUUID();
  const lock = JSON.stringify({
    pid: process.pid,
    token,
    startedAt: new Date().toISOString(),
    pidNamespace: view.pidNamespace,
    outerPidNamespaces: view.outerPidNamespaces,
  });
  // Live before the lock exists, so a concurrent reclaim in this process
  // never takes it for a leftover (rule 5a).
  liveReclaimTokens.add(token);
  try {
    if (!(await createExclusive(slotDir, lockPath, lock))) {
      // Another reclaimer holds the lock. If it died doing so, or left it
      // under a pid this process now has, clear it; the next poll retries.
      const raw = await readIfExists(lockPath);
      if (raw === null) return true;
      if (isReclaimLockStale(raw, view)) {
        await unlinkIfExists(lockPath);
        return true;
      }
      return false;
    }
    try {
      const current = await readIfExists(holderPath(slotDir));
      if (current === staleRaw) await unlinkIfExists(holderPath(slotDir));
    } finally {
      // A waiter that judged this lock stale may have replaced it; that lock
      // is its owner's to remove, not this process's.
      if ((await readIfExists(lockPath)) === lock) await unlinkIfExists(lockPath);
    }
    return true;
  } finally {
    liveReclaimTokens.delete(token);
  }
}

/** Whether a `reclaim.lock` has no live owner (rules 4a, 5 and 5a). */
function isReclaimLockStale(raw, view) {
  let owner;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return true;
    owner = parsed;
  } catch {
    return true; // An unreadable lock has no live owner.
  }
  const place = parsePidNamespacePlace(owner);
  if (place === null || !isPositiveInt(owner.pid)) return true;
  if (!isRecordedPidAlive(place, owner.pid, false, view)) return true;
  return isUnheldByThisProcess(place, owner.pid, owner.token, liveReclaimTokens, view);
}

// Waiting

function clampPollInterval(ms) {
  if (ms === undefined || !Number.isFinite(ms)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, ms));
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Leases

const withToken = (base, slotDir, token) => ({ ...base, [VALIDATION_SLOT_ENV]: token, [VALIDATION_SLOT_DIR_ENV]: slotDir });

/** @returns {ValidationSlotLease} */
function nestedLease(slotDir, token) {
  return {
    slotDir,
    token,
    nested: true,
    queueWaitMs: 0,
    childEnv: (base) => withToken(base, slotDir, token),
    // The enclosing holder owns the record and its child.
    recordChild: async () => {},
    release: async () => {},
  };
}

/** @returns {ValidationSlotLease} */
function heldLease(slotDir, record, queueWaitMs) {
  let released = false;
  return {
    slotDir,
    token: record.token,
    nested: false,
    queueWaitMs,
    childEnv: (base) => withToken(base, slotDir, record.token),
    async recordChild(pid, options = {}) {
      if (released) throw new ValidationSlotLostError(slotDir);
      const current = await readValidationSlotHolder(slotDir);
      if (current?.token !== record.token) throw new ValidationSlotLostError(slotDir);
      const updated = { ...current, child: { pid, group: options.group ?? false } };
      await replaceAtomically(slotDir, holderPath(slotDir), JSON.stringify(updated));
    },
    async release() {
      if (released) return;
      released = true;
      // No longer live even if the unlink below fails: a record left on disk
      // is then this process's own to reclaim (rule 5a).
      liveLeaseTokens.delete(record.token);
      const current = await readValidationSlotHolder(slotDir);
      if (current?.token === record.token) await unlinkIfExists(holderPath(slotDir));
    },
  };
}

/**
 * Take the host's validation slot, waiting while another process holds it.
 *
 * Returns at once as a nested lease when `env` carries the token of the live
 * holder of the slot `NDX_VALIDATION_SLOT_DIR` names, or of `slotDir` when it
 * names none (rule 6); that lease's `slotDir` is the holder's. Otherwise waits until the slot is free or
 * stale, takes it, and reports the time spent waiting as `queueWaitMs`.
 *
 * @param {{
 *   slotDir: string, projectDir: string, env?: NodeJS.ProcessEnv, signal?: AbortSignal,
 *   pollIntervalMs?: number, reportIntervalMs?: number,
 *   onWait?: (wait: ValidationSlotWait) => void, now?: () => number, procRoot?: string,
 * }} options
 * @returns {Promise<ValidationSlotLease>}
 * @throws {ValidationSlotAbortedError} when `signal` fires while waiting.
 */
export async function acquireValidationSlot(options) {
  const { slotDir, projectDir, signal, onWait } = options;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const pollIntervalMs = clampPollInterval(options.pollIntervalMs);
  const reportIntervalMs = options.reportIntervalMs ?? DEFAULT_REPORT_INTERVAL_MS;
  const started = now();
  const view = pidNamespaceView(env, options.procRoot);

  // Nesting first, by a read alone: a nested acquire needs no write access to
  // the slot directory (rule 6).
  const inherited = env[VALIDATION_SLOT_ENV];
  if (inherited) {
    const inheritedDir = env[VALIDATION_SLOT_DIR_ENV];
    const parentDir = inheritedDir && isAbsolute(inheritedDir) ? inheritedDir : slotDir;
    const current = await readValidationSlotHolder(parentDir);
    if (current?.token === inherited && isHolderAlive(current, view)) return nestedLease(parentDir, inherited);
  }

  await mkdir(slotDir, { recursive: true });

  const record = {
    version: PROTOCOL_VERSION,
    token: randomUUID(),
    pid: process.pid,
    child: null,
    startedAt: new Date(started).toISOString(),
    bootedAt: currentBootTimeMs(),
    projectDir,
    pidNamespace: view.pidNamespace,
    outerPidNamespaces: view.outerPidNamespaces,
  };

  let lastReport;
  for (;;) {
    if (signal?.aborted) throw new ValidationSlotAbortedError(now() - started, signal.reason);

    record.startedAt = new Date(now()).toISOString();
    // Live before the record exists, so a concurrent acquire in this process
    // waits on it rather than reclaiming it (rule 5a).
    liveLeaseTokens.add(record.token);
    let created = false;
    try {
      created = await createExclusive(slotDir, holderPath(slotDir), JSON.stringify(record));
    } finally {
      if (!created) liveLeaseTokens.delete(record.token);
    }
    if (created) return heldLease(slotDir, { ...record }, now() - started);

    const observed = await readHolder(slotDir);
    if (observed === null) continue; // Released between the create and the read.
    const { holder } = observed;
    if (holder === null || isStale(holder, view)) {
      // Retry at once when this process cleared the record; another
      // reclaimer's record is waited out like a holder.
      if (await reclaimStale(slotDir, observed.raw, view)) continue;
      await sleep(pollIntervalMs, signal);
      continue;
    }

    const waitedMs = now() - started;
    if (onWait && (lastReport === undefined || waitedMs - lastReport >= reportIntervalMs)) {
      lastReport = waitedMs;
      onWait({ holder, holderAlive: isHolderAlive(holder, view), waitedMs, holderPath: holderPath(slotDir) });
    }
    await sleep(pollIntervalMs, signal);
  }
}

/**
 * The lines the runner warns with when it cannot take the slot. A permission
 * error almost always means a sandbox that does not grant the slot directory:
 * n-dx's own sandbox grants it (packages/llm-client/src/sandbox.ts), a
 * vendor's or an operator's may not.
 * @param {unknown} err
 * @param {string} slotDir
 * @returns {string[]}
 */
export function describeValidationSlotFailure(err, slotDir) {
  const code = /** @type {{ code?: unknown }} */ (err)?.code;
  const message = /** @type {{ message?: unknown }} */ (err)?.message ?? err;
  const lines = [`Could not take the validation slot in ${slotDir}: ${message}`];
  if (code === "EPERM" || code === "EACCES") {
    lines.push(
      `This process may not read or write ${slotDir}. If it runs inside a sandbox ` +
        "(an n-dx tool or agent sandbox, or the vendor CLI's own), that sandbox must grant this directory read and write access.",
    );
  }
  return lines;
}

/** The line printed while waiting; the same words as hench's `describeValidationSlotWait`. */
export function describeValidationSlotWait(wait) {
  const { holder } = wait;
  const who = wait.holderAlive ? `pid ${holder.pid}` : `pid ${holder.pid} (exited; its tests still run)`;
  return `Waiting for the validation slot held by ${who} in ${holder.projectDir} since ${holder.startedAt} (${wait.holderPath})`;
}
