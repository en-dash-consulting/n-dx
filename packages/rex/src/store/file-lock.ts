/**
 * Advisory file lock for preventing concurrent PRD writes.
 *
 * Two layers:
 *   1. An in-process mutex (promise queue per lock path) — callers within the
 *      same process serialize deterministically and never contend on the file,
 *      so a live in-process holder can never be misjudged as stale no matter
 *      how long its critical section runs.
 *   2. An exclusive lock file with PID + ownership token + timestamp guarding
 *      against other processes. A lock is reclaimed only when its owning
 *      process is gone — never merely because it is old, since a slow writer
 *      and a hung one are indistinguishable from the outside and unlinking a
 *      running writer's lock admits a second writer rather than fencing the
 *      first. Release is compare-and-delete on the ownership token, so a holder
 *      whose lock was taken over can never unlink the new holder's lock.
 *
 * @module store/file-lock
 */

import {writeFile, readFile, unlink} from "node:fs/promises";
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
 * Check if an existing lock file is stale.
 *
 * Same-PID lock files are always stale: the in-process mutex guarantees no
 * other live holder exists in this process while we are checking, so such a
 * file is an orphan (failed unlink, or a recycled PID from a dead process).
 * Another process's lock is stale only when that process is gone. Age is
 * deliberately not grounds: see the note at the liveness check below.
 */
async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const content = await readFile(lockPath, "utf-8");
    const info = decodeLock(content);
    if (!info) {
      // Unparseable content is NOT proof the owner is gone, and treating it as
      // stale caused the concurrent-import lost update the stale-save guard kept
      // catching. `tryAcquire` creates the lock file with O_EXCL and *then*
      // writes its JSON, so between those two steps the file exists but is
      // empty. A second process that hits EEXIST and reads it in that window
      // gets "" here — and if that counted as stale, it would unlink the live
      // writer's lock and enter the critical section alongside it. Wait instead:
      // a lock mid-creation becomes readable within a retry or two, and a
      // genuinely corrupt one keeps failing to parse so this writer times out
      // loudly (naming the file to delete) rather than interleaving silently.
      return false;
    }

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
 * Try to create a lock file exclusively. Returns true if the lock was acquired.
 *
 * Uses O_EXCL via writeFile with the 'wx' flag — the write fails atomically
 * if the file already exists.
 */
async function tryAcquire(lockPath: string, token: string): Promise<boolean> {
  try {
    await writeFile(lockPath, encodeLock(token), { flag: "wx" });
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EEXIST") {
      return false;
    }
    throw err; // Unexpected error (permissions, disk full, etc.)
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
    // Lock file already removed (e.g., by stale cleanup) — not an error
  }
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
 * retries with a short delay until the timeout expires. Stale locks (dead
 * process or expired) are automatically cleaned up.
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

      // Lock exists — held by another process (or orphaned). Check staleness.
      if (await isLockStale(lockPath)) {
        try {
          await unlink(lockPath);
        } catch {
          // Another process may have cleaned it up — retry will handle it
        }
        continue; // Retry immediately after cleanup
      }

      await sleep(retryDelayMs);
    }

    // Timeout — provide a helpful error
    let holder = "unknown process";
    try {
      const content = await readFile(lockPath, "utf-8");
      const info = decodeLock(content);
      if (info) holder = `PID ${info.pid} (since ${info.timestamp})`;
    } catch {
      // Can't read lock info
    }

    throw new Error(
      `Could not acquire PRD lock within ${acquireTimeoutMs}ms. ` +
      `Held by ${holder}. Another command may be writing to the PRD. ` +
      `If this is stale, delete ${lockPath} manually.`,
    );
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
