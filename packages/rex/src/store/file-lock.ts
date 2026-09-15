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

import {writeFile, readFile, unlink, rename} from "node:fs/promises";
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

/** What a waiter should do about an existing lock file. */
type LockVerdict =
  /** Owned by a live writer — wait. */
  | { kind: "live" }
  /** File vanished while looking — retry the exclusive create. */
  | { kind: "gone" }
  /** Provably abandoned. `content` is the exact bytes the judgment was made
   *  on, required by {@link removeStaleLock}'s verification. */
  | { kind: "stale"; content: string };

/**
 * Judge an existing lock file.
 *
 * Same-PID lock files are always stale: the in-process mutex guarantees no
 * other live holder exists in this process while we are checking, so such a
 * file is an orphan (failed unlink, or a recycled PID from a dead process).
 * Another process's lock is stale only when that process is gone. Age is
 * deliberately not grounds: see the note at the liveness check below.
 *
 * A malformed lock is re-read after {@link MALFORMED_LOCK_GRACE_MS}: it may be
 * a lock caught mid-creation rather than a corpse, and stealing a live
 * writer's lock over a transient read is exactly the interleaving this module
 * exists to prevent.
 */
async function assessLock(lockPath: string): Promise<LockVerdict> {
  let content: string;
  try {
    content = await readFile(lockPath, "utf-8");
  } catch {
    return { kind: "gone" };
  }

  let info = decodeLock(content);
  if (!info) {
    // Possibly mid-creation — give the writer's content write time to land.
    await sleep(MALFORMED_LOCK_GRACE_MS);
    try {
      content = await readFile(lockPath, "utf-8");
    } catch {
      return { kind: "gone" };
    }
    info = decodeLock(content);
    if (!info) return { kind: "stale", content }; // Still garbage — a corpse.
  }

  // Orphaned same-process lock (see doc comment)
  if (info.pid === process.pid) return { kind: "stale", content };

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
  if (!isProcessAlive(info.pid)) return { kind: "stale", content };

  return { kind: "live" };
}

/**
 * Remove a lock judged stale — without ever deleting a live writer's lock.
 *
 * A bare `unlink` here has a race two waiters can hit under load: both judge
 * the same corpse stale, the faster one unlinks it and creates its own lock,
 * and the slower one's unlink then lands on the fresh lock — admitting a
 * second writer into the critical section, the exact lost-update the lock
 * exists to prevent.
 *
 * Instead the stale file is CLAIMED by an atomic rename to a tombstone path
 * unique to this waiter: of all racing cleaners exactly one rename succeeds,
 * and the losers get ENOENT and go back to the retry loop. The claimed bytes
 * are then compared with the bytes the staleness judgment was made on; a
 * mismatch means the path was re-locked between judgment and claim, and the
 * claim is rolled back by renaming the tombstone home. (The rollback itself
 * can only collide with a third writer inside the same microsecond window —
 * and a displaced writer's release is a compare-and-delete that no-ops, so
 * even that residue is bounded.)
 *
 * @internal Exported for tests only.
 */
export async function removeStaleLock(lockPath: string, judgedContent: string): Promise<void> {
  const tombstone = `${lockPath}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, tombstone);
  } catch {
    return; // Another cleaner claimed it first — nothing left to remove.
  }

  let claimed: string | null = null;
  try {
    claimed = await readFile(tombstone, "utf-8");
  } catch {
    return; // Tombstone vanished — nothing to verify or roll back.
  }

  if (claimed !== judgedContent) {
    // We claimed a lock we never judged — the path was re-locked between
    // judgment and claim. Put it back.
    try {
      await rename(tombstone, lockPath);
    } catch {
      await unlink(tombstone).catch(() => {});
    }
    return;
  }

  await unlink(tombstone).catch(() => {});
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

      // Lock exists — held by another process (or orphaned). Judge it.
      const verdict = await assessLock(lockPath);
      if (verdict.kind === "stale") {
        await removeStaleLock(lockPath, verdict.content);
        continue; // Retry immediately after cleanup
      }
      if (verdict.kind === "gone") {
        continue; // Vanished while looking — retry the exclusive create
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
