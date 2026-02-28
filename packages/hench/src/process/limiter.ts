/**
 * Cross-process concurrency limiter for hench.
 *
 * Prevents too many simultaneous `hench run` invocations from exhausting
 * memory. Uses PID-based lock files in `.hench/locks/` to track active
 * hench processes across terminals and sessions.
 *
 * Each `hench run` acquires a lock before starting work and releases it
 * on exit. Stale locks (from crashed processes) are detected via OS-level
 * PID liveness checks and cleaned up automatically.
 *
 * @module hench/process/limiter
 */

import { readdir, writeFile, unlink, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCKS_DIR = "locks";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the maximum concurrent hench process limit is reached.
 *
 * Contains metadata about active processes so the CLI can display a
 * helpful message with actionable guidance.
 */
export class ProcessLimitReachedError extends Error {
  /** Number of currently active hench processes. */
  readonly activeCount: number;
  /** Configured maximum concurrent processes. */
  readonly maxConcurrent: number;
  /** PIDs of currently active processes. */
  readonly activePids: number[];

  constructor(activeCount: number, maxConcurrent: number, activePids: number[]) {
    const msg =
      `Concurrent process limit reached: ${activeCount}/${maxConcurrent} hench processes running. ` +
      `Wait for a running process to finish, or increase the limit with: ` +
      `hench config guard.maxConcurrentProcesses <number>`;
    super(msg);
    this.name = "ProcessLimitReachedError";
    this.activeCount = activeCount;
    this.maxConcurrent = maxConcurrent;
    this.activePids = activePids;
  }
}

// ---------------------------------------------------------------------------
// Lock file metadata
// ---------------------------------------------------------------------------

interface LockFileData {
  pid: number;
  startedAt: string;
  taskId?: string;
}

// ---------------------------------------------------------------------------
// PID liveness check
// ---------------------------------------------------------------------------

/**
 * Check whether a process with the given PID is still alive.
 *
 * Uses `process.kill(pid, 0)` which sends signal 0 (no actual signal)
 * to test for process existence. This works on all POSIX systems and
 * Windows (Node.js abstracts the platform difference).
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lock file helpers
// ---------------------------------------------------------------------------

function locksDir(henchDir: string): string {
  return join(henchDir, LOCKS_DIR);
}

function lockFilePath(henchDir: string, pid: number): string {
  return join(locksDir(henchDir), `${pid}.lock`);
}

async function ensureLocksDir(henchDir: string): Promise<void> {
  await mkdir(locksDir(henchDir), { recursive: true });
}

/**
 * Read all lock files and return only those with live PIDs.
 * Stale lock files (from crashed processes) are removed automatically.
 */
async function getActiveLocks(henchDir: string): Promise<LockFileData[]> {
  const dir = locksDir(henchDir);
  await ensureLocksDir(henchDir);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const lockFiles = entries.filter((f) => f.endsWith(".lock"));
  const active: LockFileData[] = [];

  for (const file of lockFiles) {
    const filePath = join(dir, file);
    try {
      const raw = await readFile(filePath, "utf-8");
      const data: LockFileData = JSON.parse(raw);

      if (isPidAlive(data.pid)) {
        active.push(data);
      } else {
        // Stale lock — process no longer running, clean it up
        await unlink(filePath).catch(() => {});
      }
    } catch {
      // Corrupted lock file — remove it
      await unlink(filePath).catch(() => {});
    }
  }

  return active;
}

// ---------------------------------------------------------------------------
// ProcessLimiter
// ---------------------------------------------------------------------------

/**
 * Manages cross-process concurrency for hench.
 *
 * Acquire a lock before starting a hench run; release it when done.
 * The limiter checks the number of active hench processes (via PID lock
 * files) and throws {@link ProcessLimitReachedError} if the limit is
 * already reached.
 *
 * @example
 * ```ts
 * const limiter = new ProcessLimiter(henchDir, maxConcurrent);
 * await limiter.acquire();
 * try {
 *   // ... run task
 * } finally {
 *   await limiter.release();
 * }
 * ```
 */
export class ProcessLimiter {
  private readonly _henchDir: string;
  private readonly _maxConcurrent: number;
  private readonly _pid: number;
  private _acquired = false;

  constructor(henchDir: string, maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new RangeError("ProcessLimiter maxConcurrent must be >= 1");
    }
    this._henchDir = henchDir;
    this._maxConcurrent = maxConcurrent;
    this._pid = process.pid;
  }

  /** Configured maximum concurrent processes. */
  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  /** Whether this limiter currently holds a lock. */
  get acquired(): boolean {
    return this._acquired;
  }

  /**
   * Acquire a process slot.
   *
   * Checks the count of currently active hench processes. If the limit
   * is already reached, throws {@link ProcessLimitReachedError} with
   * metadata about the active processes.
   *
   * Creates a lock file for the current PID on success.
   *
   * @param taskId  Optional task ID for diagnostic display.
   * @throws {ProcessLimitReachedError} when the limit is already reached.
   */
  async acquire(taskId?: string): Promise<void> {
    if (this._acquired) {
      throw new Error("ProcessLimiter.acquire() called while already holding a lock");
    }

    await ensureLocksDir(this._henchDir);
    const active = await getActiveLocks(this._henchDir);

    if (active.length >= this._maxConcurrent) {
      throw new ProcessLimitReachedError(
        active.length,
        this._maxConcurrent,
        active.map((l) => l.pid),
      );
    }

    // Write lock file for this process
    const data: LockFileData = {
      pid: this._pid,
      startedAt: new Date().toISOString(),
      ...(taskId ? { taskId } : {}),
    };
    await writeFile(
      lockFilePath(this._henchDir, this._pid),
      JSON.stringify(data, null, 2),
      "utf-8",
    );
    this._acquired = true;
  }

  /**
   * Release the process slot by removing the lock file.
   *
   * Safe to call multiple times (idempotent). Silently ignores
   * missing lock files (e.g. if another process cleaned up stale locks).
   */
  async release(): Promise<void> {
    if (!this._acquired) return;

    try {
      await unlink(lockFilePath(this._henchDir, this._pid));
    } catch {
      // Lock file already gone — that's fine
    }
    this._acquired = false;
  }

  /**
   * Get the count of currently active hench processes.
   *
   * Scans lock files and validates PIDs. Stale locks are cleaned up
   * as a side effect.
   */
  async activeCount(): Promise<number> {
    const active = await getActiveLocks(this._henchDir);
    return active.length;
  }
}
