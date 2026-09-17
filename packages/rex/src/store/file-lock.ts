/**
 * Advisory file lock for preventing concurrent PRD writes.
 *
 * Two layers:
 *   1. An in-process mutex (promise queue per lock path) — callers within the
 *      same process serialize deterministically and never contend on the file,
 *      so a live in-process holder can never be misjudged as stale no matter
 *      how long its critical section runs.
 *   2. An exclusive lock path with PID + ownership token + timestamp guarding
 *      against other processes. Complete lock content is published atomically
 *      through a hard link, with an atomic directory fallback on filesystems
 *      without hard-link support. Locks not owned by this acquisition are
 *      never unlinked automatically: even a confirmed dead owner can be
 *      replaced between inspection and path-based deletion. Such locks fail
 *      loudly with manual-cleanup guidance. Release is compare-and-delete on
 *      the ownership token, so a holder whose lock was taken over can never
 *      unlink the new holder's lock.
 *
 * @module store/file-lock
 */

import {link, mkdir, readFile, rename, rmdir, stat, unlink, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
// ── Constants ────────────────────────────────────────────────────────

/** Delay between lock acquisition retries. */
const RETRY_DELAY_MS = 50;

/** Maximum time to wait for a lock before giving up. */
const ACQUIRE_TIMEOUT_MS = 10_000;

/**
 * How long a malformed lock file gets to become valid before it is judged a
 * corpse. `tryAcquire` creates the lock with two syscalls (open, then write),
 * so a reader landing between them sees an empty file — indistinguishable, at
 * that instant, from a crashed writer's truncated leftovers. The difference is
 * time: a mid-creation lock is valid microseconds later, a corpse never is.
 * The delay only has to outlive a single write syscall on a saturated disk;
 * it is paid only on the rare malformed sighting, never on the happy path.
 */
const MALFORMED_LOCK_GRACE_MS = 100;

/** Hard-link failures that require the directory-backed publication path. */
const UNSUPPORTED_LINK_CODES = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM", "EXDEV"]);
const FALLBACK_OWNER_FILE = "owner.json";

// ── Options ──────────────────────────────────────────────────────────

/** Timing overrides — production callers use the defaults; tests inject small values. */
export interface LockOptions {
  /** Maximum time to wait for the lock before throwing. */
  acquireTimeoutMs?: number;
  /** Delay between file-lock acquisition retries. */
  retryDelayMs?: number;
}

// ── Lock file contents ───────────────────────────────────────────────

interface LockInfo {
  pid: number;
  token: string;
  timestamp: string;
}

type LockBackend = "hard-link" | "directory";

function encodeLock(token: string): string {
  return JSON.stringify({ pid: process.pid, token, timestamp: new Date().toISOString() });
}

function decodeLock(content: string): LockInfo | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed.pid === "number" && typeof parsed.timestamp === "string") {
      // Legacy lock files have no token — normalize to an empty token that
      // can never match a live holder's randomUUID.
      return { pid: parsed.pid, token: typeof parsed.token === "string" ? parsed.token : "", timestamp: parsed.timestamp };
    }
  } catch {
    // Malformed lock file
  }
  return null;
}

/** Check if a PID is still running. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = existence check, no actual signal sent
    return true;
  } catch {
    return false;
  }
}

function hasErrorCode(err: unknown, code: string): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as {code: string}).code === code);
}

function isUnsupportedLinkError(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err &&
    UNSUPPORTED_LINK_CODES.has((err as {code: string}).code),
  );
}

// ── In-process mutex ─────────────────────────────────────────────────

/** Tail of the wait queue per lock path. */
const inProcessQueues = new Map<string, Promise<void>>();

/**
 * Wait for our turn on the in-process queue for `lockPath`.
 *
 * Returns a release function that hands the queue to the next waiter. If the
 * current holder does not finish within `timeoutMs`, throws — and frees the
 * abandoned queue slot when its turn eventually arrives, so later waiters
 * are not blocked behind it.
 */
function acquireInProcess(lockPath: string, timeoutMs: number): Promise<() => void> {
  const prev = inProcessQueues.get(lockPath) ?? Promise.resolve();

  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const tail = prev.then(() => held);
  inProcessQueues.set(lockPath, tail);
  void tail.then(() => {
    if (inProcessQueues.get(lockPath) === tail) inProcessQueues.delete(lockPath);
  });

  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Abandon our slot: release it as soon as our turn comes up.
      void prev.then(() => release());
      reject(new Error(
        `Could not acquire PRD lock within ${timeoutMs}ms. ` +
        `Held by this process. Another operation may be writing to the PRD.`,
      ));
    }, timeoutMs);
  });

  return Promise.race([prev.then(() => release), timeout])
    .finally(() => clearTimeout(timer));
}

// ── Lock acquisition ─────────────────────────────────────────────────

/** What a waiter should do about an existing lock file. */
type LockVerdict =
  /** Owned by a live writer — wait. */
  | { kind: "live" }
  /** File vanished while looking — retry the exclusive create. */
  | { kind: "gone" }
  /** Provably abandoned or malformed. Manual cleanup is required. */
  | { kind: "stale" };

/**
 * Judge an existing lock file.
 *
 * Same-PID lock files are always stale: the in-process mutex guarantees no
 * other live holder exists in this process while we are checking, so such a
 * file is an orphan (failed unlink, or a recycled PID from a dead process).
 * Another process's lock is stale only when that process is gone. Age is
 * deliberately not grounds: see the note at the liveness check below. This
 * observation must never authorize an unlink: another contender can replace
 * the inspected generation before path-based deletion executes.
 *
 * A malformed lock is re-read after {@link MALFORMED_LOCK_GRACE_MS}: it may be
 * a lock caught mid-creation rather than a corpse, and stealing a live
 * writer's lock over a transient read is exactly the interleaving this module
 * exists to prevent.
 */
async function assessLock(lockPath: string): Promise<LockVerdict> {
  let backend: LockBackend;
  try {
    backend = (await stat(lockPath)).isDirectory() ? "directory" : "hard-link";
  } catch {
    return { kind: "gone" };
  }

  const ownerPath = backend === "directory" ? `${lockPath}/${FALLBACK_OWNER_FILE}` : lockPath;
  let content: string;
  try {
    content = await readFile(ownerPath, "utf-8");
  } catch {
    // mkdir() publishes the directory before rename() publishes owner.json.
    // That in-flight directory is contended, never stale.
    if (backend === "directory") return { kind: "live" };
    return { kind: "gone" };
  }

  let info = decodeLock(content);
  if (!info) {
    // Possibly mid-creation — give the writer's content write time to land.
    await sleep(MALFORMED_LOCK_GRACE_MS);
    try {
      content = await readFile(ownerPath, "utf-8");
    } catch {
      if (backend === "directory") return { kind: "live" };
      return { kind: "gone" };
    }
    info = decodeLock(content);
    if (!info) return { kind: "stale" }; // Still garbage — manual cleanup required.
  }

  // Orphaned same-process lock (see doc comment)
  if (info.pid === process.pid) return { kind: "stale" };

  // Owner process is dead — the only grounds for taking someone else's lock.
  //
  // Age used to be sufficient as well, on the theory that a lock older than
  // `staleMs` belonged to a hung process. But a hung process and a merely
  // slow one look identical from the outside, and unlinking the lock of a
  // running writer does not fence it off — it just lets a second writer into
  // the critical section alongside it. That is a lost update, and it was
  // observed rather than theorised: two concurrent `rex import-bundle`
  // processes on a loaded machine, the second one's save rejected by the
  // stale-save guard for deleting an item the first had written moments
  // earlier. A 30-second threshold is nowhere near the runtime of a healthy
  // import when the whole test suite is competing for the disk.
  //
  // The cost of this is a lock whose owner died and whose PID has since been
  // recycled by an unrelated live process: nothing will reclaim it, and every
  // writer fails after `ACQUIRE_TIMEOUT_MS` with an error naming the holding
  // PID and the path to delete. That is loud, bounded and recoverable, which
  // a silently interleaved write is not.
  if (!isProcessAlive(info.pid)) return { kind: "stale" };

  return { kind: "live" };
}

/**
 * Publish a complete lock atomically. Hard links are the fast path; a directory
 * plus renamed owner file provides the same exclusivity where links are absent.
 *
 */
async function tryAcquire(lockPath: string, token: string): Promise<LockBackend | false> {
  const temporaryPath = `${lockPath}.${token}.tmp`;
  await writeFile(temporaryPath, encodeLock(token), { flag: "wx" });
  let acquired: LockBackend | false = false;
  let temporaryExists = true;

  try {
    try {
      await link(temporaryPath, lockPath);
      acquired = "hard-link";
      return acquired;
    } catch (err) {
      if (hasErrorCode(err, "EEXIST")) return false;
      if (!isUnsupportedLinkError(err)) throw err;
    }

    try {
      await mkdir(lockPath);
    } catch (err) {
      if (hasErrorCode(err, "EEXIST")) return false;
      throw err;
    }

    try {
      await rename(temporaryPath, `${lockPath}/${FALLBACK_OWNER_FILE}`);
      temporaryExists = false;
      acquired = "directory";
      return acquired;
    } catch (err) {
      await rmdir(lockPath).catch(() => {});
      throw err;
    }
  } finally {
    if (temporaryExists) {
      try {
        await unlink(temporaryPath);
      } catch (err) {
        if (!acquired) throw err;
      }
    }
  }
}

/**
 * Remove the lock file only if it still carries our ownership token.
 *
 * This is the one place in this module that deletes a lock, so it deletes only
 * on positive proof of ownership. Content that does not decode proves nothing:
 * it is not evidence the lock is ours, and a replacement published by a build
 * whose lock shape this one cannot parse would be unlinked out from under a
 * live holder. Anything we cannot read as our own token — a takeover, a
 * foreign format, an unreadable path — is left exactly where it is, to be
 * resolved by the same manual cleanup every other unowned lock gets.
 */
async function releaseIfOwner(lockPath: string, token: string, backend: LockBackend): Promise<void> {
  try {
    const ownerPath = backend === "directory" ? `${lockPath}/${FALLBACK_OWNER_FILE}` : lockPath;
    const info = decodeLock(await readFile(ownerPath, "utf-8"));
    if (info?.token !== token) return; // No longer provably ours
    await unlink(ownerPath);
    if (backend === "directory") await rmdir(lockPath);
  } catch {
    // Lock file already removed (e.g., by stale cleanup) — not an error
  }
}

async function lockAcquisitionError(lockPath: string, acquireTimeoutMs: number): Promise<Error> {
  let holder = "unknown process";
  let backend: LockBackend | undefined;
  try {
    backend = (await stat(lockPath)).isDirectory() ? "directory" : "hard-link";
    const ownerPath = backend === "directory" ? `${lockPath}/${FALLBACK_OWNER_FILE}` : lockPath;
    const content = await readFile(ownerPath, "utf-8");
    const info = decodeLock(content);
    if (info) holder = `PID ${info.pid} (since ${info.timestamp})`;
    else if (backend === "directory") holder = "a lock publication in progress";
  } catch {
    // An incomplete directory-backed lock is published before owner.json.
    // Its existence is contention, not an unknown or stale holder.
    if (backend === "directory") holder = "a lock publication in progress";
  }

  return new Error(
    `Could not acquire PRD lock within ${acquireTimeoutMs}ms. ` +
    `Held by ${holder}. Another command may be writing to the PRD. ` +
    `If this is stale, delete ${lockPath} manually.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Acquire an advisory file lock. Returns a release function.
 *
 * Same-process callers queue on an in-process mutex; the file lock guards
 * against other processes. If the lock is held by another live process,
 * retries with a short delay until the timeout expires. Locks that appear
 * abandoned are not reclaimed automatically because an unlink-by-path could
 * delete a replacement generation. They fail with manual-cleanup guidance.
 *
 * @param lockPath - Path to the lock file (e.g., `.rex/prd.json.lock`)
 * @throws If the lock cannot be acquired within the timeout
 */
export async function acquireLock(lockPath: string, options?: LockOptions): Promise<() => Promise<void>> {
  const acquireTimeoutMs = options?.acquireTimeoutMs ?? ACQUIRE_TIMEOUT_MS;
  const retryDelayMs = options?.retryDelayMs ?? RETRY_DELAY_MS;

  const releaseInProcess = await acquireInProcess(lockPath, acquireTimeoutMs);
  const token = randomUUID();

  try {
    const deadline = Date.now() + acquireTimeoutMs;

    while (Date.now() < deadline) {
      const backend = await tryAcquire(lockPath, token);
      if (backend) {
        // Lock acquired — return release function
        return async () => {
          try {
            await releaseIfOwner(lockPath, token, backend);
          } finally {
            releaseInProcess();
          }
        };
      }

      // Lock exists — held by another process (or orphaned). Judge it.
      const verdict = await assessLock(lockPath);
      if (verdict.kind === "stale") {
        throw await lockAcquisitionError(lockPath, acquireTimeoutMs);
      }
      if (verdict.kind === "gone") {
        continue; // Vanished while looking — retry the exclusive create
      }

      await sleep(retryDelayMs);
    }

    throw await lockAcquisitionError(lockPath, acquireTimeoutMs);
  } catch (err) {
    releaseInProcess();
    throw err;
  }
}

/**
 * Execute a function while holding the PRD file lock.
 * The lock is released after the function completes (or throws).
 */
export async function withLock<T>(lockPath: string, fn: () => Promise<T>, options?: LockOptions): Promise<T> {
  const release = await acquireLock(lockPath, options);
  try {
    return await fn();
  } finally {
    await release();
  }
}
