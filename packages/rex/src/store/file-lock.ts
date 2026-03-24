/**
 * Advisory file lock for preventing concurrent PRD writes.
 *
 * Uses an exclusive lock file with PID + timestamp. Stale locks
 * (from crashed processes) are detected via PID liveness checks
 * and a max-age timeout.
 *
 * @module store/file-lock
 */

import { writeFile, readFile, unlink, stat } from "node:fs/promises";

// ── Constants ────────────────────────────────────────────────────────

/** Maximum age of a lock file before it's considered stale (30 seconds). */
const STALE_LOCK_MS = 30_000;

/** Delay between lock acquisition retries. */
const RETRY_DELAY_MS = 50;

/** Maximum time to wait for a lock before giving up. */
const ACQUIRE_TIMEOUT_MS = 10_000;

// ── Lock file contents ───────────────────────────────────────────────

interface LockInfo {
  pid: number;
  timestamp: string;
}

function encodeLock(): string {
  return JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() });
}

function decodeLock(content: string): LockInfo | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed.pid === "number" && typeof parsed.timestamp === "string") {
      return parsed as LockInfo;
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

// ── Lock acquisition ─────────────────────────────────────────────────

/**
 * Check if an existing lock file is stale (owner process dead or lock too old).
 */
async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const content = await readFile(lockPath, "utf-8");
    const info = decodeLock(content);
    if (!info) return true; // Malformed = stale

    // Owner process is dead
    if (!isProcessAlive(info.pid)) return true;

    // Lock is too old (process may be hung)
    const lockTime = new Date(info.timestamp).getTime();
    if (Date.now() - lockTime > STALE_LOCK_MS) return true;

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
async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    await writeFile(lockPath, encodeLock(), { flag: "wx" });
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EEXIST") {
      return false;
    }
    throw err; // Unexpected error (permissions, disk full, etc.)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Acquire an advisory file lock. Returns a release function.
 *
 * If the lock is held by another live process, retries with a short delay
 * until the timeout expires. Stale locks (dead process or expired) are
 * automatically cleaned up.
 *
 * @param lockPath - Path to the lock file (e.g., `.rex/prd.json.lock`)
 * @throws If the lock cannot be acquired within the timeout
 */
export async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await tryAcquire(lockPath)) {
      // Lock acquired — return release function
      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          // Lock file already removed (e.g., by stale cleanup) — not an error
        }
      };
    }

    // Lock exists — check if it's stale
    if (await isLockStale(lockPath)) {
      try {
        await unlink(lockPath);
      } catch {
        // Another process may have cleaned it up — retry will handle it
      }
      continue; // Retry immediately after cleanup
    }

    await sleep(RETRY_DELAY_MS);
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
    `Could not acquire PRD lock within ${ACQUIRE_TIMEOUT_MS}ms. ` +
    `Held by ${holder}. Another command may be writing to the PRD. ` +
    `If this is stale, delete ${lockPath} manually.`,
  );
}

/**
 * Execute a function while holding the PRD file lock.
 * The lock is released after the function completes (or throws).
 */
export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await release();
  }
}
