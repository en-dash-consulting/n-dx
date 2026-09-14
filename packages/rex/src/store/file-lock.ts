/**
 * Advisory file lock for preventing concurrent PRD writes.
 *
 * Two layers:
 *   1. An in-process mutex (promise queue per lock path) — callers within the
 *      same process serialize deterministically and never contend on the file,
 *      so a live in-process holder can never be misjudged as stale no matter
 *      how long its critical section runs.
 *   2. An exclusive lock path with PID + ownership token + timestamp guarding
 *      against other processes. Hard links publish a complete lock file on
 *      normal filesystems; an atomic directory backend covers filesystems that
 *      reject hard links. A lock is considered potentially abandoned
 *      only when its owning process is gone — never merely because it is old,
 *      since a slow writer and a hung one are indistinguishable. Locks not owned
 *      by this acquisition are never unlinked automatically: even a confirmed
 *      dead owner can be replaced between inspection and path-based deletion.
 *      Such locks fail loudly with manual-cleanup guidance. Release is
 *      compare-and-delete on the ownership token, so a holder whose lock was
 *      taken over can never remove the new holder's lock.
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

/** Hard-link failures that indicate the filesystem needs the directory backend. */
const UNSUPPORTED_LINK_CODES = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM", "EXDEV"]);

/** Metadata name inside a directory-backed lock. */
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

type LockState =
  | {kind: "owned"; info: LockInfo}
  | {kind: "initializing"}
  | {kind: "absent"}
  | {kind: "malformed"};

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

/**
 * Check if an existing lock file appears abandoned.
 *
 * Same-PID lock files are always stale: the in-process mutex guarantees no
 * other live holder exists in this process while we are checking, so such a
 * file is an orphan (failed unlink, or a recycled PID from a dead process).
 * Another process's lock appears abandoned only when that process is gone.
 * This observation is used only to fail early with cleanup guidance. It must
 * never authorize unlinking by path: a different generation may have replaced
 * the inspected lock before an unlink executes. An incomplete directory-backed
 * publication remains contended; malformed legacy lock files receive the
 * existing safety-first manual-cleanup treatment.
 */
async function readLockState(lockPath: string): Promise<LockState> {
  let content: string | undefined;
  try {
    content = await readFile(lockPath, "utf-8");
  } catch (err) {
    // The lock can disappear after tryAcquire() observed EEXIST but before
    // this inspection begins. Retry the acquisition even if another contender
    // republishes the path before the stat() below: any metadata would belong
    // to that new generation, not the one that caused our conflict.
    if (hasErrorCode(err, "ENOENT")) return {kind: "absent"};
    // Directories normally reject readFile(), but FreeBSD returns directory
    // data. Inspect the path type below so both platform behaviours agree.
  }

  try {
    if ((await stat(lockPath)).isDirectory()) {
      try {
        const info = decodeLock(await readFile(`${lockPath}/${FALLBACK_OWNER_FILE}`, "utf-8"));
        // mkdir() publishes the fallback lock before rename() publishes its
        // complete owner metadata. Missing or malformed metadata therefore means
        // publication may still be in progress, never that the lock is stale.
        return info ? {kind: "owned", info} : {kind: "initializing"};
      } catch {
        return {kind: "initializing"};
      }
    }
  } catch (err) {
    // A holder can release the lock after our publication attempt saw EEXIST
    // but before this inspection reaches stat(). This is not malformed lock
    // content; it is an acquisition race that the caller can safely retry.
    if (hasErrorCode(err, "ENOENT")) return {kind: "absent"};
    return {kind: "malformed"};
  }

  if (content !== undefined) {
    const info = decodeLock(content);
    return info ? {kind: "owned", info} : {kind: "malformed"};
  }

  return {kind: "malformed"};
}

function isLockStale(state: LockState): boolean {
  if (state.kind === "initializing" || state.kind === "absent") return false;
  if (state.kind === "malformed") return true;

  const {info} = state;
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
}

/**
 * Try to publish a lock exclusively. Returns its backend if acquired.
 *
 * The body is written under a unique sibling name before link() atomically
 * publishes it at `lockPath`. Writing directly with the `wx` flag would create
 * the public name before its body was written; a competing process could read
 * that empty file as malformed and reject an otherwise valid acquisition.
 * link() fails with EEXIST when another lock is already published, retaining
 * the same exclusive-creation semantics without exposing incomplete contents.
 * Filesystems without hard-link support fall back to atomic mkdir() ownership;
 * the complete body is then renamed into that directory. Contenders treat the
 * directory as held even before its metadata appears.
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
    } catch (err: unknown) {
      if (hasErrorCode(err, "EEXIST")) return false;
      if (!isUnsupportedLinkError(err)) throw err;
    }

    try {
      await mkdir(lockPath);
    } catch (err: unknown) {
      if (hasErrorCode(err, "EEXIST")) return false;
      throw err;
    }

    try {
      await rename(temporaryPath, `${lockPath}/${FALLBACK_OWNER_FILE}`);
      temporaryExists = false;
      acquired = "directory";
      return acquired;
    } catch (err) {
      // This acquisition created the still-empty directory, so it is safe to
      // retract it if metadata publication fails. No contender can replace it
      // while the directory occupies the public lock path.
      try {
        await rmdir(lockPath);
      } catch {
        // Preserve the publication error; a leftover directory remains a safe,
        // non-stale lock that carries manual-cleanup guidance on timeout.
      }
      throw err;
    }
  } finally {
    if (temporaryExists) {
      try {
        await unlink(temporaryPath);
      } catch (err) {
        // Once the public lock exists, failure to remove its private source name
        // must not turn a successful acquisition into an error and leak the lock.
        if (!acquired) throw err;
      }
    }
  }
}

/**
 * Remove the lock file only if it still carries our ownership token.
 * A lock taken over by another writer (different token) is left untouched.
 */
async function releaseIfOwner(lockPath: string, token: string, backend: LockBackend): Promise<void> {
  try {
    const ownerPath = backend === "directory" ? `${lockPath}/${FALLBACK_OWNER_FILE}` : lockPath;
    const info = decodeLock(await readFile(ownerPath, "utf-8"));
    if (info && info.token !== token) return; // No longer ours
    await unlink(ownerPath);
    if (backend === "directory") await rmdir(lockPath);
  } catch {
    // Lock file already removed — not an error
  }
}

async function lockAcquisitionError(lockPath: string, acquireTimeoutMs: number): Promise<Error> {
  let holder = "unknown process";
  try {
    const state = await readLockState(lockPath);
    if (state.kind === "owned") holder = `PID ${state.info.pid} (since ${state.info.timestamp})`;
    if (state.kind === "initializing") holder = "a lock publication in progress";
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

      // Never unlink a lock we did not acquire. Even after observing a dead
      // owner, another contender can replace that generation before a
      // path-based unlink executes. Fail loudly and require manual cleanup.
      const state = await readLockState(lockPath);
      if (state.kind === "absent") continue;

      if (isLockStale(state)) {
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
