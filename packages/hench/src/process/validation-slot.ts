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
 * `<ndx home>/validation-slot/`, created on first use):
 *
 * - `holder.json` — present exactly while the slot is held. JSON object:
 *   ```json
 *   { "version": 1, "token": "<uuid>", "pid": 123,
 *     "child": null | { "pid": 456, "group": true },
 *     "startedAt": "<ISO-8601>", "projectDir": "/abs/project" }
 *   ```
 *   `pid` is the holding process. `child` is the validation command it
 *   launched, once launched; `group: true` means `pid` is a POSIX process
 *   group id (the child was spawned detached), `false` a plain pid.
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
 *    has no groups, the pid is checked instead).
 * 5. **Stale recovery.** A record is stale when its `pid` is dead AND its
 *    `child` is absent or dead; a record that does not parse is stale too. A
 *    dead holder whose child still runs is NOT stale: its tests still load
 *    the machine. To reclaim, create `reclaim.lock` as in rule 1 (if it
 *    exists and its pid is dead, unlink it and retry later), re-read
 *    `holder.json`, unlink it only if its bytes equal the stale bytes
 *    observed, then unlink `reclaim.lock`.
 * 6. **Re-entrancy.** The holder exports its token to its children as
 *    `NDX_VALIDATION_SLOT`. An acquire that finds that variable naming the
 *    token in this directory's `holder.json`, with a live `pid`, is nested:
 *    it returns at once and neither takes nor releases the slot. A token for
 *    a dead holder or another directory's holder is ignored.
 * 7. **Waiting.** Poll at a bounded interval; report the holder (pid,
 *    project directory, since when) on the first wait and then periodically;
 *    stop when the caller's abort signal fires.
 *
 * @module hench/process/validation-slot
 */

import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

/** The environment variable a holder exports its token to children under. */
export const VALIDATION_SLOT_ENV = "NDX_VALIDATION_SLOT";

/** The slot directory's name inside the ndx home. */
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
  projectDir: string;
}

/** What a waiting acquire reports about the slot's current holder. */
export interface ValidationSlotWait {
  holder: ValidationSlotHolder;
  /** False when the holder process is gone but its validation child still runs. */
  holderAlive: boolean;
  /** Milliseconds this acquire has waited so far. */
  waitedMs: number;
}

export interface AcquireValidationSlotOptions {
  /** The slot directory; see `resolveValidationSlotDir`. */
  slotDir: string;
  /** The project this validation runs for; recorded for whoever waits. */
  projectDir: string;
  /** Environment to read `NDX_VALIDATION_SLOT` from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Stops waiting (Ctrl-C, the run's deadline). */
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
  /** `base` with `NDX_VALIDATION_SLOT` set, for the validation command's children. */
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
    projectDir: r.projectDir,
  };
}

/** Whether a record still occupies the slot (rule 5). */
export function isValidationSlotHolderStale(holder: ValidationSlotHolder): boolean {
  if (isPidAlive(holder.pid)) return false;
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
  const lock = JSON.stringify({ pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() });
  if (!(await createExclusive(slotDir, lockPath, lock))) {
    // Another process is reclaiming. If it died doing so, clear its lock; the
    // next poll retries.
    const raw = await readIfExists(lockPath);
    if (raw === null) return true;
    let pid: unknown;
    try {
      pid = (JSON.parse(raw) as { pid?: unknown }).pid;
    } catch {
      pid = undefined; // An unreadable lock has no live owner.
    }
    if (!isPositiveInt(pid) || !isPidAlive(pid)) {
      await unlinkIfExists(lockPath);
      return true;
    }
    return false;
  }
  try {
    const current = await readIfExists(holderPath(slotDir));
    if (current === staleRaw) await unlinkIfExists(holderPath(slotDir));
  } finally {
    await unlinkIfExists(lockPath);
  }
  return true;
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

function withToken(base: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  return { ...base, [VALIDATION_SLOT_ENV]: token };
}

function nestedLease(slotDir: string, token: string): ValidationSlotLease {
  return {
    slotDir,
    token,
    nested: true,
    queueWaitMs: 0,
    childEnv: (base) => withToken(base, token),
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
    childEnv: (base) => withToken(base, record.token),
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
      const current = await readValidationSlotHolder(slotDir);
      if (current?.token === record.token) await unlinkIfExists(holderPath(slotDir));
    },
  };
}

/**
 * Take the host's validation slot, waiting while another process holds it.
 *
 * Returns at once as a nested lease when `env` carries the token of this
 * slot's live holder (rule 6). Otherwise waits until the slot is free or
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

  await mkdir(slotDir, { recursive: true });

  const inherited = env[VALIDATION_SLOT_ENV];
  if (inherited) {
    const current = await readValidationSlotHolder(slotDir);
    if (current?.token === inherited && isPidAlive(current.pid)) return nestedLease(slotDir, inherited);
  }

  const record: ValidationSlotHolder = {
    version: VALIDATION_SLOT_PROTOCOL_VERSION,
    token: randomUUID(),
    pid: process.pid,
    child: null,
    startedAt: new Date(started).toISOString(),
    projectDir,
  };

  let lastReport: number | undefined;
  for (;;) {
    if (signal?.aborted) throw new ValidationSlotAbortedError(now() - started, signal.reason);

    record.startedAt = new Date(now()).toISOString();
    if (await createExclusive(slotDir, holderPath(slotDir), JSON.stringify(record))) {
      return heldLease(slotDir, { ...record }, now() - started);
    }

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
      onWait({ holder: observed.holder, holderAlive: isPidAlive(observed.holder.pid), waitedMs });
    }
    await sleep(pollIntervalMs, signal);
  }
}
