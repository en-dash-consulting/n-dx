/**
 * Advisory file lock for preventing concurrent PRD writes.
 *
 * Two layers:
 *   1. An in-process mutex (promise queue per lock path) — callers within the
 *      same process serialize deterministically and never contend on the file,
 *      so a live in-process holder can never be misjudged as stale no matter
 *      how long its critical section runs.
 *   2. An exclusive lock file with PID + ownership token + timestamp guarding
 *      against other processes. A lock is considered potentially abandoned
 *      only when its owning process is gone — never merely because it is old,
 *      since a slow writer and a hung one are indistinguishable. Locks not owned
 *      by this acquisition are never unlinked automatically: even a confirmed
 *      dead owner can be replaced between inspection and path-based deletion.
 *      Such locks fail loudly with manual-cleanup guidance. Release is
 *      compare-and-delete on the ownership token, so a holder whose lock was
 *      taken over can never unlink the new holder's lock.
 *
 * @module store/file-lock
 */

import {link, writeFile, readFile, unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
// ── Constants ────────────────────────────────────────────────────────

/** Delay between lock acquisition retries. */
const RETRY_DELAY_MS = 50;

/** Maximum time to wait for a lock before giving up. */
const ACQUIRE_TIMEOUT_MS = 10_000;

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

/**
 * Check if an existing lock file appears abandoned.
 *
 * Same-PID lock files are always stale: the in-process mutex guarantees no
 * other live holder exists in this process while we are checking, so such a
 * file is an orphan (failed unlink, or a recycled PID from a dead process).
 * Another process's lock appears abandoned only when that process is gone.
 * This observation is used only to fail early with cleanup guidance. It must
 * never authorize unlinking by path: a different generation may have replaced
 * the inspected lock before an unlink executes. Malformed and unreadable locks
 * receive the same safety-first treatment.
 */
async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const content = await readFile(lockPath, "utf-8");
    const info = decodeLock(content);
    if (!info) return true; // Malformed = stale

    // Orphaned same-process lock (see doc comment)
    if (info.pid === process.pid) return true;

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
    if (!isProcessAlive(info.pid)) return true;

    return false;
  } catch {
    return true; // Can't read = stale
  }
}

/**
 * Try to publish a lock file exclusively. Returns true if the lock was acquired.
 *
 * The body is written under a unique sibling name before link() atomically
 * publishes it at `lockPath`. Writing directly with the `wx` flag would create
 * the public name before its body was written; a competing process could read
 * that empty file as malformed and reject an otherwise valid acquisition.
 * link() fails with EEXIST when another lock
 * is already published, retaining the same exclusive-creation semantics
 * without exposing incomplete contents.
 */
async function tryAcquire(lockPath: string, token: string): Promise<boolean> {
  const temporaryPath = `${lockPath}.${token}.tmp`;
  await writeFile(temporaryPath, encodeLock(token), { flag: "wx" });
  let published = false;

  try {
    await link(temporaryPath, lockPath);
    published = true;
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EEXIST") {
      return false;
    }
    throw err; // Unexpected error (permissions, disk full, etc.)
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (err) {
      // Once the public lock exists, failure to remove its private source name
      // must not turn a successful acquisition into an error and leak the lock.
      if (!published) throw err;
    }
  }
}

/**
 * Remove the lock file only if it still carries our ownership token.
 * A lock taken over by another writer (different token) is left untouched.
 */
async function releaseIfOwner(lockPath: string, token: string): Promise<void> {
  try {
    const info = decodeLock(await readFile(lockPath, "utf-8"));
    if (info && info.token !== token) return; // No longer ours
    await unlink(lockPath);
  } catch {
    // Lock file already removed — not an error
  }
}

async function lockAcquisitionError(lockPath: string, acquireTimeoutMs: number): Promise<Error> {
  let holder = "unknown process";
  try {
    const content = await readFile(lockPath, "utf-8");
    const info = decodeLock(content);
    if (info) holder = `PID ${info.pid} (since ${info.timestamp})`;
  } catch {
    // Keep the unknown-holder fallback while preserving cleanup guidance.
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
      if (await tryAcquire(lockPath, token)) {
        // Lock acquired — return release function
        return async () => {
          try {
            await releaseIfOwner(lockPath, token);
          } finally {
            releaseInProcess();
          }
        };
      }

      // Never unlink a lock we did not acquire. Even after observing a dead
      // owner, another contender can replace that generation before a
      // path-based unlink executes. Fail loudly and require manual cleanup.
      if (await isLockStale(lockPath)) {
        throw await lockAcquisitionError(lockPath, acquireTimeoutMs);
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
