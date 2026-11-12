/**
 * Host-wide validation slot: one validation execution at a time per OS user,
 * across hench processes and worktrees.
 *
 * Each worktree's process limiter (`limiter.ts`) only sees its own checkout,
 * so N worktrees used to run N test gates at once. This slot lives in the
 * per-user ndx home instead (`validation-slot-dir.ts` resolves it), so every
 * checkout on the host queues behind the same holder. Capacity is 1.
 *
 * This module imports nothing but `node:` builtins, so a plain Node process
 * can load it with type stripping (the cross-process tests do) and
 * `scripts/lib/` can reimplement it without a build.
 *
 * ## On-disk protocol (version 1)
 *
 * Everything lives in one directory, `<slot dir>` (normally
 * `<ndx home>/validation-slot/<host>/`, created on first use). `<host>` names
 * the machine, not its network name, which macOS changes with the network:
 * `m-` and the first 16 hex characters of the SHA-256 of the machine id,
 * trimmed and lower-cased (Linux `/etc/machine-id`, else
 * `/var/lib/dbus/machine-id`; macOS `IOPlatformUUID` from
 * `ioreg -rd1 -c IOPlatformExpertDevice`; Windows `MachineGuid` under
 * `HKLM\SOFTWARE\Microsoft\Cryptography`), or `h-` and the same hash of the
 * trimmed, lower-cased `os.hostname()` when no machine id can be read. A
 * process reads it once. Liveness (rules 4 and 5) only holds on one host, so
 * hosts sharing an ndx home must never share a slot directory:
 *
 * - `holder.json` — present exactly while the slot is held. JSON object:
 *   ```json
 *   { "version": 1, "token": "<uuid>", "pid": 123,
 *     "child": null | { "pid": 456, "group": true },
 *     "startedAt": "<ISO-8601>", "bootedAt": 1762900000000,
 *     "projectDir": "/abs/project" }
 *   ```
 *   `pid` is the holding process. `child` is the validation command it
 *   launched, once launched; `group: true` means `pid` is a POSIX process
 *   group id (the child was spawned detached), `false` a plain pid.
 *   `bootedAt` is the host's boot time in epoch milliseconds when the record
 *   was written (`Date.now() - os.uptime() * 1000`).
 * - `reclaim.lock` — present only while some process removes a stale
 *   `holder.json`. JSON object `{ "pid": 123, "token": "<uuid>", "startedAt": "<ISO-8601>" }`.
 * - `.<random>.tmp` — scratch files for the writes below. Never read; a
 *   crash can leave one behind, and it is ignored.
 *
 * Rules:
 *
 * 1. **Acquire.** Write the record to a scratch file, then `link()` it to
 *    `holder.json`. The link is the atomic step: it fails with `EEXIST` when
 *    the slot is held, and a reader never sees a half-written record. Remove
 *    the scratch file either way.
 * 2. **Record the child.** The holder rewrites its own record (same token)
 *    through a scratch file and `rename()` over `holder.json`.
 * 3. **Release.** Read `holder.json`; unlink it only when its token is the
 *    releaser's. Never remove another holder's record.
 * 4. **Liveness.** A pid is alive when `kill(pid, 0)` succeeds or fails with
 *    `EPERM`; a group is alive when `kill(-pid, 0)` does (on Windows, which
 *    has no groups, the pid is checked instead). On Windows a holder's
 *    non-detached children end with it (libuv's kill-on-close job object),
 *    so a recorded child there never outlives its holder.
 * 5. **Stale recovery.** A record is stale when its `pid` is dead AND its
 *    `child` is absent or dead; a record that does not parse is stale too. A
 *    dead holder whose child still runs is NOT stale: its tests still load
 *    the machine. A record whose `bootedAt` differs from the current boot
 *    time by more than five minutes was written before a reboot and is stale
 *    whatever its pids say: they may since have been reused. To reclaim,
 *    create `reclaim.lock` as in rule 1 (if it exists and is stale — its pid
 *    dead, or rule 5a — unlink it and retry later), re-read `holder.json`,
 *    unlink it only if its bytes equal the stale bytes observed, then unlink
 *    `reclaim.lock` only if its bytes are still the reclaimer's own (another
 *    waiter may have judged it stale and replaced it meanwhile).
 *    5a. **Own pid.** A process knows the tokens it holds: its unreleased
 *    leases and the `reclaim.lock` it is writing. A `holder.json` or
 *    `reclaim.lock` naming this process's own pid with a token it does not
 *    hold names a dead process, whatever rule 4 says: the lock is stale, and
 *    the record is stale unless its `child` is alive (rule 5 still applies to
 *    the child). It was left by an earlier process whose pid the OS has since
 *    given to this one (Windows reuses pids within moments), or by this
 *    process's own failed release. A token is live from just before its file
 *    is created until its release starts. Other processes cannot tell such a
 *    record apart: they wait until it is reclaimed or its pid exits. A wedged
 *    slot is cleared by deleting the `holder.json` the wait report names,
 *    once no validation run is active.
 * 6. **Re-entrancy.** The holder exports its token to its children as
 *    `NDX_VALIDATION_SLOT` and its absolute slot directory as
 *    `NDX_VALIDATION_SLOT_DIR`. An acquire that finds the token in the
 *    `holder.json` of that directory (of its own directory when the variable
 *    is unset or not absolute), with a live `pid` (rules 4 and 5a), is
 *    nested: it returns at once, neither takes nor releases the slot, and
 *    passes both variables on unchanged. So a nested run stays on its
 *    parent's slot even when its own directory would resolve differently. A
 *    token for a dead holder, or for a holder in another directory, is
 *    ignored: the acquire takes its own directory's slot.
 *    The check reads `holder.json` before anything creates or writes in the
 *    directory, so a nested acquire needs read access only.
 * 7. **Waiting.** Poll at a bounded interval; report the holder (pid,
 *    project directory, since when, and the `holder.json` path) on the first
 *    wait and then periodically. Only the caller's abort signal stops a
 *    wait; there is no maximum wait.
 *
 * @module hench/process/validation-slot
 */

import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { uptime } from "node:os";
import { isAbsolute, join } from "node:path";

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

/** The environment variable a holder exports its token to children under. */
export const VALIDATION_SLOT_ENV = "NDX_VALIDATION_SLOT";

/** The environment variable a holder exports its absolute slot directory under (rule 6). */
export const VALIDATION_SLOT_DIR_ENV = "NDX_VALIDATION_SLOT_DIR";

/** The slot root's name inside the ndx home; each host's slot is a subdirectory. */
export const VALIDATION_SLOT_DIRNAME = "validation-slot";

/** The file present exactly while the slot is held. */
export const VALIDATION_SLOT_HOLDER_FILE = "holder.json";

/** The file that serializes stale-record removal. */
export const VALIDATION_SLOT_RECLAIM_FILE = "reclaim.lock";

/** The protocol version written into every holder record. */
export const VALIDATION_SLOT_PROTOCOL_VERSION = 1;

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MIN_POLL_INTERVAL_MS = 10;
const MAX_POLL_INTERVAL_MS = 10_000;
const DEFAULT_REPORT_INTERVAL_MS = 30_000;

/**
 * How far two boot-time readings may drift apart and still name one boot.
 * The reading follows the wall clock, so a clock correction moves it; five
 * minutes absorbs those, and a reboot only slips under it when the previous
 * boot was younger than that when its record was written.
 */
const BOOT_TIME_TOLERANCE_MS = 5 * 60_000;

/** Rename retries for Windows, where a reader holding the file open blocks a replace. */
const RENAME_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The validation command a holder launched. */
export interface ValidationSlotChild {
  pid: number;
  /** `pid` is a POSIX process group id (the child was spawned detached). */
  group: boolean;
}

/** The contents of `holder.json`. */
export interface ValidationSlotHolder {
  version: number;
  token: string;
  pid: number;
  child: ValidationSlotChild | null;
  startedAt: string;
  /** The host's boot time, epoch ms, when the record was written. */
  bootedAt: number;
  projectDir: string;
}

/** What a waiting acquire reports about the slot's current holder. */
export interface ValidationSlotWait {
  holder: ValidationSlotHolder;
  /** False when the holder process is gone but its validation child still runs. */
  holderAlive: boolean;
  /** Milliseconds this acquire has waited so far. */
  waitedMs: number;
  /** The `holder.json` to delete by hand when the slot is wedged (rule 5a). */
  holderPath: string;
}

export interface AcquireValidationSlotOptions {
  /** The slot directory; see `resolveValidationSlotDir`. */
  slotDir: string;
  /** The project this validation runs for; recorded for whoever waits. */
  projectDir: string;
  /** Environment to read `NDX_VALIDATION_SLOT` and `NDX_VALIDATION_SLOT_DIR` from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** The only thing that stops a wait (Ctrl-C, SIGTERM); there is no maximum wait. */
  signal?: AbortSignal;
  /** Poll interval while waiting; clamped to 10 ms – 10 s. Default 1 s. */
  pollIntervalMs?: number;
  /** How often to report the holder again while waiting. Default 30 s. */
  reportIntervalMs?: number;
  /** Called on the first wait and then every `reportIntervalMs`. */
  onWait?: (wait: ValidationSlotWait) => void;
  /** Clock, for tests. Default `Date.now`. */
  now?: () => number;
}

/** A held (or nested) slot. */
export interface ValidationSlotLease {
  readonly slotDir: string;
  readonly token: string;
  /** Acquired through an enclosing holder's token; release does nothing. */
  readonly nested: boolean;
  /** Milliseconds spent waiting for the slot. 0 when nested. */
  readonly queueWaitMs: number;
  /** `base` with `NDX_VALIDATION_SLOT` and `NDX_VALIDATION_SLOT_DIR` set, for the validation command's children. */
  childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  /** Record the launched validation command so a crash cannot free the slot under it. */
  recordChild(pid: number, options?: { group?: boolean }): Promise<void>;
  /** Give the slot back. Idempotent; a nested lease never releases. */
  release(): Promise<void>;
}

/** Thrown when the abort signal fires while waiting for the slot. */
export class ValidationSlotAbortedError extends Error {
  /** Milliseconds waited before the abort. */
  readonly queueWaitMs: number;

  constructor(queueWaitMs: number, reason: unknown) {
    super(`Gave up waiting for the validation slot after ${queueWaitMs} ms`, { cause: reason });
    this.name = "ValidationSlotAbortedError";
    this.queueWaitMs = queueWaitMs;
  }
}

/** Thrown when a holder finds its record replaced or gone. */
export class ValidationSlotLostError extends Error {
  constructor(slotDir: string) {
    super(`This process no longer holds the validation slot in ${slotDir}`);
    this.name = "ValidationSlotLostError";
  }
}

// ---------------------------------------------------------------------------
// Liveness (rule 4)
// ---------------------------------------------------------------------------

function signalZero(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a process with this pid exists. */
export function isPidAlive(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && signalZero(pid);
}

/** This boot's start, epoch ms. */
export function currentBootTimeMs(): number {
  return Math.round(Date.now() - uptime() * 1000);
}

function isChildAlive(child: ValidationSlotChild): boolean {
  if (child.group && process.platform !== "win32") {
    return Number.isInteger(child.pid) && child.pid > 0 && signalZero(-child.pid);
  }
  return isPidAlive(child.pid);
}

// ---------------------------------------------------------------------------
// Record parsing
// ---------------------------------------------------------------------------

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** A holder record from `raw`, or null when it is not a valid version-1 record. */
export function parseValidationSlotHolder(raw: string): ValidationSlotHolder | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null; // Not JSON: the caller treats it as stale (rule 5).
  }
  if (typeof data !== "object" || data === null) return null;
  const r = data as Record<string, unknown>;
  if (r.version !== VALIDATION_SLOT_PROTOCOL_VERSION) return null;
  if (typeof r.token !== "string" || r.token === "") return null;
  if (!isPositiveInt(r.pid)) return null;
  if (typeof r.startedAt !== "string" || typeof r.projectDir !== "string") return null;
  if (typeof r.bootedAt !== "number" || !Number.isFinite(r.bootedAt)) return null;
  let child: ValidationSlotChild | null = null;
  if (r.child !== null && r.child !== undefined) {
    const c = r.child as Record<string, unknown>;
    if (typeof c !== "object" || !isPositiveInt(c.pid) || typeof c.group !== "boolean") return null;
    child = { pid: c.pid, group: c.group };
  }
  return {
    version: VALIDATION_SLOT_PROTOCOL_VERSION,
    token: r.token,
    pid: r.pid,
    child,
    startedAt: r.startedAt,
    bootedAt: r.bootedAt,
    projectDir: r.projectDir,
  };
}

// ---------------------------------------------------------------------------
// Tokens this process holds (rule 5a)
// ---------------------------------------------------------------------------

/** Tokens of this process's unreleased leases. */
const liveLeaseTokens = new Set<string>();

/** Tokens of the `reclaim.lock` files this process is writing or holds. */
const liveReclaimTokens = new Set<string>();

/**
 * Whether a file names this process's pid with a token this process does not
 * hold: a leftover whose pid the OS reused, or this process's own failed
 * release (rule 5a).
 */
function isUnheldByThisProcess(pid: unknown, token: unknown, live: ReadonlySet<string>): boolean {
  return pid === process.pid && !(typeof token === "string" && live.has(token));
}

/** Whether the process a record names still holds it (rules 4 and 5a). */
function isHolderProcessAlive(holder: ValidationSlotHolder): boolean {
  return !isUnheldByThisProcess(holder.pid, holder.token, liveLeaseTokens) && isPidAlive(holder.pid);
}

/** Whether a record no longer occupies the slot (rules 5 and 5a). */
export function isValidationSlotHolderStale(
  holder: ValidationSlotHolder,
  bootTimeMs: number = currentBootTimeMs(),
): boolean {
  // Written before a reboot: its pids may belong to unrelated processes now.
  if (Math.abs(holder.bootedAt - bootTimeMs) > BOOT_TIME_TOLERANCE_MS) return true;
  if (isHolderProcessAlive(holder)) return false;
  return holder.child === null || !isChildAlive(holder.child);
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function holderPath(slotDir: string): string {
  return join(slotDir, VALIDATION_SLOT_HOLDER_FILE);
}

function scratchPath(slotDir: string): string {
  return join(slotDir, `.${randomUUID()}.tmp`);
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** Read a file, or null when it does not exist. */
async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if (errCode(err) === "ENOENT") return null;
    throw err;
  }
}

/** Unlink a file; true when this call removed it, false when it was already gone. */
async function unlinkIfExists(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if (errCode(err) === "ENOENT") return false;
    throw err;
  }
}

/** Create `target` holding `content`, atomically; false when it already exists (rule 1). */
async function createExclusive(slotDir: string, target: string, content: string): Promise<boolean> {
  const scratch = scratchPath(slotDir);
  await writeFile(scratch, content, "utf-8");
  try {
    await link(scratch, target);
    return true;
  } catch (err) {
    if (errCode(err) === "EEXIST") return false;
    throw err;
  } finally {
    await unlinkIfExists(scratch);
  }
}

/** Replace `target` with `content` atomically (rule 2). */
async function replaceAtomically(slotDir: string, target: string, content: string): Promise<void> {
  const scratch = scratchPath(slotDir);
  await writeFile(scratch, content, "utf-8");
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(scratch, target);
      return;
    } catch (err) {
      const code = errCode(err);
      const transient = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!transient || attempt >= RENAME_ATTEMPTS) {
        await unlinkIfExists(scratch);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

/** The current holder, or null when the slot is free. A record that does not parse is returned raw. */
async function readHolder(slotDir: string): Promise<{ raw: string; holder: ValidationSlotHolder | null } | null> {
  const raw = await readIfExists(holderPath(slotDir));
  if (raw === null) return null;
  return { raw, holder: parseValidationSlotHolder(raw) };
}

/** The slot's current holder, or null when it is free or its record does not parse. */
export async function readValidationSlotHolder(slotDir: string): Promise<ValidationSlotHolder | null> {
  return (await readHolder(slotDir))?.holder ?? null;
}

/**
 * Remove `holder.json` if it still holds exactly `staleRaw` (rule 5). False
 * when another process holds the reclaim lock, so the caller waits a poll.
 */
async function reclaimStale(slotDir: string, staleRaw: string): Promise<boolean> {
  const lockPath = join(slotDir, VALIDATION_SLOT_RECLAIM_FILE);
  const token = randomUUID();
  const lock = JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() });
  // Live before the lock exists, so a concurrent reclaim in this process
  // never takes it for a leftover (rule 5a).
  liveReclaimTokens.add(token);
  try {
    if (!(await createExclusive(slotDir, lockPath, lock))) {
      // Another reclaimer holds the lock. If it died doing so, or left it
      // under a pid this process now has, clear it; the next poll retries.
      const raw = await readIfExists(lockPath);
      if (raw === null) return true;
      if (isReclaimLockStale(raw)) {
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

/** Whether a `reclaim.lock` has no live owner (rules 5 and 5a). */
function isReclaimLockStale(raw: string): boolean {
  let owner: { pid?: unknown; token?: unknown };
  try {
    owner = JSON.parse(raw) as typeof owner;
  } catch {
    return true; // An unreadable lock has no live owner.
  }
  if (typeof owner !== "object" || owner === null) return true;
  if (!isPositiveInt(owner.pid) || !isPidAlive(owner.pid)) return true;
  return isUnheldByThisProcess(owner.pid, owner.token, liveReclaimTokens);
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

function clampPollInterval(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, ms));
}

/** Sleep `ms`, or resolve at once when `signal` fires. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = (): void => {
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

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

function withToken(base: NodeJS.ProcessEnv, slotDir: string, token: string): NodeJS.ProcessEnv {
  return { ...base, [VALIDATION_SLOT_ENV]: token, [VALIDATION_SLOT_DIR_ENV]: slotDir };
}

function nestedLease(slotDir: string, token: string): ValidationSlotLease {
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

function heldLease(slotDir: string, record: ValidationSlotHolder, queueWaitMs: number): ValidationSlotLease {
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
      const updated: ValidationSlotHolder = { ...current, child: { pid, group: options.group ?? false } };
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
 * @throws {ValidationSlotAbortedError} when `signal` fires while waiting.
 */
export async function acquireValidationSlot(options: AcquireValidationSlotOptions): Promise<ValidationSlotLease> {
  const { slotDir, projectDir, signal, onWait } = options;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const pollIntervalMs = clampPollInterval(options.pollIntervalMs);
  const reportIntervalMs = options.reportIntervalMs ?? DEFAULT_REPORT_INTERVAL_MS;
  const started = now();

  // Nesting first, by a read alone: a nested acquire needs no write access to
  // the slot directory (rule 6).
  const inherited = env[VALIDATION_SLOT_ENV];
  if (inherited) {
    const inheritedDir = env[VALIDATION_SLOT_DIR_ENV];
    const parentDir = inheritedDir && isAbsolute(inheritedDir) ? inheritedDir : slotDir;
    const current = await readValidationSlotHolder(parentDir);
    if (current?.token === inherited && isHolderProcessAlive(current)) return nestedLease(parentDir, inherited);
  }

  await mkdir(slotDir, { recursive: true });

  const record: ValidationSlotHolder = {
    version: VALIDATION_SLOT_PROTOCOL_VERSION,
    token: randomUUID(),
    pid: process.pid,
    child: null,
    startedAt: new Date(started).toISOString(),
    bootedAt: currentBootTimeMs(),
    projectDir,
  };

  let lastReport: number | undefined;
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
    if (observed.holder === null || isValidationSlotHolderStale(observed.holder)) {
      // Retry at once when this process cleared the record; another
      // reclaimer's record is waited out like a holder.
      if (await reclaimStale(slotDir, observed.raw)) continue;
      await sleep(pollIntervalMs, signal);
      continue;
    }

    const waitedMs = now() - started;
    if (onWait && (lastReport === undefined || waitedMs - lastReport >= reportIntervalMs)) {
      lastReport = waitedMs;
      onWait({
        holder: observed.holder,
        holderAlive: isHolderProcessAlive(observed.holder),
        waitedMs,
        holderPath: holderPath(slotDir),
      });
    }
    await sleep(pollIntervalMs, signal);
  }
}
